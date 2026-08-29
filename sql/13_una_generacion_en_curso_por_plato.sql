-- ═══════════════════════════════════════════════════════════════
-- UNA SOLA GENERACIÓN EN CURSO POR PLATO — YA APLICADO el 28/08/2026
-- ═══════════════════════════════════════════════════════════════
-- Es aditivo: un índice sobre una tabla que hoy no tiene ninguna fila en los
-- estados que cubre, así que aplicarlo antes de desplegar el código no cambia
-- nada. Ese es el orden correcto — primero el índice, después el código.
--
-- ── QUÉ ARREGLA ───────────────────────────────────────────────
-- El 26/08/2026 un mismo plato se generó dos veces con 21 segundos de
-- diferencia. Se arregló en el panel y después en el servidor, pero el freno
-- del servidor comprobaba `estado = 'generando'` y una reserva NO nace así:
-- nace 'reservada' (el valor por defecto de la columna) y solo pasa a
-- 'generando' cuando anotarPrediccion() escribe el identificador, o sea
-- después de que Replicate acepte la petición — hasta 30 segundos.
--
-- Durante ese tramo la segunda pulsación pasaba el freno, y el otro control
-- —el de trabajos_video sin revisar— tampoco la veía, porque el trabajo
-- todavía no existe. server.js ya mira los dos estados; esto es lo que cierra
-- el resto.
--
-- ── POR QUÉ AQUÍ Y NO SOLO EN EL CÓDIGO ───────────────────────
-- La comprobación de la ruta lee y después escribe, y entre las dos cosas
-- cabe otra petición. Eso no se arregla leyendo mejor: se arregla haciendo
-- que la base no acepte la segunda fila. Es la única forma de que dos
-- peticiones exactamente simultáneas no acaben en dos cobros.
--
-- Cuando el índice rechaza una inserción, cupo.reservar() traduce el 23505 a
-- la misma respuesta que da el freno del servidor, así que el usuario lee el
-- mismo mensaje llegue por donde llegue.
--
-- ── LO QUE EL ÍNDICE NO CUBRE, A PROPÓSITO ────────────────────
-- Solo los dos estados en curso. Un plato puede tener muchas generaciones
-- 'lista', 'error' o 'liberada' a lo largo del tiempo y eso es normal — el
-- historial es justamente lo que permite contar el cupo.
--
-- Y producto_id puede ser null. En un índice único los nulos no chocan entre
-- sí, así que varias generaciones sin plato asociado siguen conviviendo; el
-- índice solo habla de platos concretos, que es de lo que se cobra dos veces.

-- Antes de crearlo, comprobar que no hay ya duplicados. Si esta consulta
-- devuelve filas, el índice fallará al crearse: hay que resolver esas
-- generaciones primero (liberarlas o dejar una sola por plato).
--
--   select producto_id, count(*)
--     from public.generaciones_ia
--    where estado in ('reservada', 'generando') and producto_id is not null
--    group by producto_id having count(*) > 1;
--
-- Comprobado el 27/08/2026: 0 filas.

create unique index if not exists generaciones_ia_una_en_curso_por_plato
  on public.generaciones_ia (producto_id)
  where estado in ('reservada', 'generando');

comment on index public.generaciones_ia_una_en_curso_por_plato is
  'Impide dos generaciones en curso para el mismo plato. Cada una es un cobro de Replicate, y la comprobación del servidor lee antes de escribir: sin esto, dos peticiones simultáneas pagan dos veces. Ver sql/13 y cupo.reservar().';
