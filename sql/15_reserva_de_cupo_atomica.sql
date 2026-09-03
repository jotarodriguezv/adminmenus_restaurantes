-- ═══════════════════════════════════════════════════════════════
-- LA RESERVA DE CUPO, EN UNA SOLA OPERACIÓN — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Es aditivo: crea una función nueva y no toca ninguna tabla ni ninguna fila.
-- Aplicarlo antes de desplegar el código no cambia nada, porque hasta que
-- cupo.reservar() no la llame, nadie la usa. Ese es el orden correcto —
-- primero la función, después el código. El mismo de sql/13.
--
-- ── QUÉ ARREGLA ───────────────────────────────────────────────
-- sql/13 cerró que un MISMO plato se generara dos veces. Queda abierto el
-- otro lado de la misma puerta: el cupo TOTAL del restaurante.
--
-- cupo.reservar() cuenta las generaciones gastadas y después inserta la
-- reserva. Entre esas dos cosas cabe otra petición. Dos platos DISTINTOS del
-- mismo restaurante, pedidos a la vez con una sola generación disponible,
-- pasan los dos: cada uno cuenta 23 de 24 y cada uno inserta. Se pagan dos
-- generaciones a Replicate con cupo para una.
--
-- El índice único de sql/13 no lo ve, y no es un descuido suyo: mira
-- 'producto_id', y aquí los platos son distintos, así que no hay choque.
--
-- Es el mismo razonamiento que ya está escrito en sql/13 y que sigue siendo
-- verdad aquí:
--
--   La comprobación de la ruta lee y después escribe, y entre las dos cosas
--   cabe otra petición. Eso no se arregla leyendo mejor: se arregla haciendo
--   que la base no acepte la segunda fila.
--
-- ── POR QUÉ UN CERROJO Y NO UNA RESTRICCIÓN ───────────────────
-- Con sql/13 bastó un índice único porque "dos filas para el mismo plato" se
-- puede escribir como una regla sobre una fila. "Como mucho N filas por
-- restaurante" no: depende de contar las demás, y eso ningún índice lo
-- expresa.
--
-- Así que se serializa. pg_advisory_xact_lock coge un cerrojo POR
-- RESTAURANTE mientras dura la transacción, y como cada llamada RPC es su
-- propia transacción, se suelta solo al volver. Dos peticiones del mismo
-- restaurante se ponen en fila y la segunda cuenta ya con la fila que
-- insertó la primera. Dos de restaurantes distintos no se estorban: son
-- claves de cerrojo distintas.
--
-- La alternativa era 'select ... for update' sobre restaurantes_ia, y no
-- sirve: esa fila puede no existir. Un restaurante sin fila usa el cupo por
-- defecto, y no hay nada que bloquear. El cerrojo consultivo no necesita que
-- exista nada.
--
-- ── POR QUÉ EL CUPO POR DEFECTO LLEGA COMO PARÁMETRO ──────────
-- Porque el que manda vive en el servidor (IA_CUPO_POR_DEFECTO). Si se
-- copiara aquí un 24, el día que alguien cambie la variable de entorno la
-- base seguiría contando con el número viejo y nadie se enteraría hasta ver
-- la factura. Se pasa desde cupo.js y así solo hay una fuente.
--
-- ── QUÉ DEVUELVE Y POR QUÉ NO LANZA EXCEPCIONES ───────────────
-- Un jsonb con 'ok' y, si no, un 'motivo'. Quedarse sin cupo o tener la IA
-- apagada no son fallos: son respuestas normales que el panel enseña como un
-- mensaje. Con raise exception, PostgREST las convertiría en un 500 y
-- cupo.js tendría que adivinar cuál es cuál leyendo el texto del error.
--
-- La única excepción que sí se captura aquí es unique_violation, que es el
-- índice de sql/13 haciendo su trabajo. Se traduce a 'ya_en_curso' para que
-- el usuario lea lo mismo llegue por donde llegue.

create or replace function public.reservar_generacion_ia(
  p_restaurante_id   uuid,
  p_producto_id      uuid default null,
  p_cupo_por_defecto int  default 24
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cupo   int;
  v_activa boolean;
  v_usadas int;
  v_fila   public.generaciones_ia;
begin
  -- A partir de aquí, y hasta que termine la transacción, ninguna otra
  -- llamada para este mismo restaurante avanza. La clave lleva un prefijo
  -- para no chocar con otros cerrojos consultivos que se añadan mañana.
  perform pg_advisory_xact_lock(hashtext('reservar_generacion_ia:' || p_restaurante_id::text));

  select ri.cupo, ri.activa
    into v_cupo, v_activa
    from public.restaurantes_ia ri
   where ri.restaurante_id = p_restaurante_id;

  -- Sin fila en restaurantes_ia el restaurante no está configurado, que no es
  -- lo mismo que estar apagado: le toca el cupo por defecto y la IA activa.
  v_cupo   := coalesce(v_cupo, p_cupo_por_defecto);
  v_activa := coalesce(v_activa, true);

  if not v_activa then
    return jsonb_build_object('ok', false, 'motivo', 'apagada');
  end if;

  -- El mismo criterio que cupo.usadas(): 'liberada' es la que se devolvió al
  -- cupo porque nunca llegó a salir. Todo lo demás ya se pagó o se va a pagar.
  select count(*)
    into v_usadas
    from public.generaciones_ia
   where restaurante_id = p_restaurante_id
     and estado <> 'liberada';

  if v_usadas >= v_cupo then
    return jsonb_build_object('ok', false, 'motivo', 'sin_cupo',
                              'cupo', v_cupo, 'usadas', v_usadas);
  end if;

  insert into public.generaciones_ia (restaurante_id, producto_id)
  values (p_restaurante_id, p_producto_id)
  returning * into v_fila;

  return jsonb_build_object('ok', true, 'fila', to_jsonb(v_fila));

exception
  when unique_violation then
    -- El índice parcial de sql/13: ese plato ya tiene una generación en curso.
    return jsonb_build_object('ok', false, 'motivo', 'ya_en_curso');
end;
$$;

comment on function public.reservar_generacion_ia(uuid, uuid, int) is
  'Reserva una generación de IA contando el cupo y escribiendo la fila sin que quepa nada en medio. Sustituye al leer-y-luego-insertar de cupo.reservar(), donde dos peticiones simultáneas de platos distintos se pasaban del cupo y pagaban de más. Ver sql/15.';

-- Esta función escribe en generaciones_ia y decide sobre dinero. Solo la
-- llama el servidor con la clave de servicio. Sin el revoke, PUBLIC hereda el
-- execute y cualquiera con la clave publicable podría invocarla por PostgREST
-- y quemar el cupo de un restaurante desde el navegador.
--
-- (El revoke va a 'public', el rol implícito que incluye a anon y a
-- authenticated. Quitárselo solo a esos dos no basta: seguirían heredándolo.
-- Es la misma nota que dejó sql/03.)
revoke execute on function public.reservar_generacion_ia(uuid, uuid, int) from public;
grant  execute on function public.reservar_generacion_ia(uuid, uuid, int) to service_role;
