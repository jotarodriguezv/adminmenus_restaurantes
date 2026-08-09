-- ═══════════════════════════════════════════════════════════════
-- PASO 3 — YA APLICADO en producción (proyecto menu-restaurantes)
-- ═══════════════════════════════════════════════════════════════
-- Se guarda como registro de lo que se ejecutó. No hay que volver a correrlo.
--
-- /api/estadisticas traía TODOS los eventos del rango a memoria y los
-- agrupaba en Node, con dos consultas más una tercera para los nombres de
-- producto. Con 400 eventos da igual; con cientos de miles el proceso se
-- queda sin aire y la red transporta datos que solo se van a contar.
--
-- Ahora cuenta la base y solo viaja el resultado: la memoria y el tamaño de
-- la respuesta ya no dependen de cuántos eventos haya, sino de cuántos días
-- y productos distintos tenga el rango.
--
-- El índice idx_eventos_restaurante_fecha sobre (restaurante_id, created_at)
-- ya existía y cubre exactamente el WHERE de esta función.

create or replace function public.estadisticas_restaurante(
  p_restaurante_id uuid,
  p_desde          timestamptz,
  p_hasta          timestamptz,
  p_zona           text default 'America/Bogota'
) returns jsonb
language sql
stable
as $$
  with eventos as (
    select tipo, producto_id, created_at
    from public.eventos_analitica
    where restaurante_id = p_restaurante_id
      and created_at >= p_desde
      and created_at <= p_hasta
  ),
  por_dia as (
    select to_char(created_at at time zone p_zona, 'YYYY-MM-DD') as dia, count(*) as n
    from eventos where tipo = 'visita' group by 1
  ),
  ranking as (
    select e.producto_id,
           coalesce(p.nombre, '(producto eliminado)') as nombre,
           count(*) as clics
    from eventos e
    left join public.productos p on p.id = e.producto_id
    where e.tipo = 'clic' and e.producto_id is not null
    group by e.producto_id, p.nombre
  )
  select jsonb_build_object(
    'totalVisitas', (select count(*) from eventos where tipo = 'visita'),
    'totalClics',   (select count(*) from eventos where tipo = 'clic'),
    'visitasPorDia', coalesce((select jsonb_object_agg(dia, n) from por_dia), '{}'::jsonb),
    -- El orden se fija dentro del agregado: un ORDER BY en la CTE no lo
    -- garantiza al agregar. Los empates se desempatan por nombre, así que el
    -- ranking es estable entre consultas (antes dependía del orden en que
    -- aparecieran los eventos).
    'rankingProductos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'nombre', nombre, 'clics', clics)
                       order by clics desc, nombre asc)
      from ranking), '[]'::jsonb)
  );
$$;

-- Solo la llave de servicio del panel. Hay que quitar el EXECUTE que
-- PostgreSQL concede a PUBLIC por defecto: revocárselo a anon no basta,
-- porque lo hereda de ahí. (Se aprendió con rls_auto_enable, donde el primer
-- revoke no surtió efecto por exactamente ese motivo.)
revoke execute on function public.estadisticas_restaurante(uuid, timestamptz, timestamptz, text) from public;
grant  execute on function public.estadisticas_restaurante(uuid, timestamptz, timestamptz, text) to service_role;

-- El linter de Supabase marca las funciones sin search_path fijo. Aquí el
-- riesgo es bajo —es SECURITY INVOKER y solo la ejecuta service_role, que ya
-- es privilegiado—, pero dejarlo mutable significa que quien la llame decide
-- qué 'productos' o qué 'eventos_analitica' se resuelven.
alter function public.estadisticas_restaurante(uuid, timestamptz, timestamptz, text)
  set search_path = public, pg_temp;
