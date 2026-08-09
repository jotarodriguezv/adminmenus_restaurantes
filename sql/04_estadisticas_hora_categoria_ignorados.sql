-- ═══════════════════════════════════════════════════════════════
-- PASO 4 — YA APLICADO en producción (proyecto menu-restaurantes)
-- ═══════════════════════════════════════════════════════════════
-- Registro de lo ejecutado. No hay que volver a correrlo.
--
-- Tres bloques nuevos en el agregado de estadísticas. Los tres salen del
-- MISMO evento que ya se registraba desde el principio: no hace falta
-- capturar ningún dato nuevo del visitante, solo mirar de otra forma el que
-- ya está.
--
--   porHora        · a qué horas entra la gente. La hora se saca en la zona
--                    del restaurante: en UTC, la cena colombiana aparecería
--                    de madrugada.
--   porCategoria   · qué secciones de la carta se miran de verdad, uniendo
--                    el clic con el producto y con su categoría.
--   nuncaAbiertos  · platos que nadie abrió en el rango. Es el dato más
--                    accionable de los tres, porque señala qué sobra de la
--                    carta o qué está mal presentado. Solo cuenta lo que el
--                    cliente podía ver: un producto marcado como no
--                    disponible no es que se ignore, es que no estaba.
--
-- Es compatible hacia atrás: la función devuelve más claves, y un servidor
-- que aún no las lea sigue funcionando igual. Por eso el orden de despliegue
-- aquí no importa.

create or replace function public.estadisticas_restaurante(
  p_restaurante_id uuid,
  p_desde          timestamptz,
  p_hasta          timestamptz,
  p_zona           text default 'America/Bogota'
) returns jsonb
language sql
stable
set search_path = public, pg_temp
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
  ),
  por_hora as (
    select extract(hour from created_at at time zone p_zona)::int as hora,
           count(*) filter (where tipo = 'visita') as visitas,
           count(*) filter (where tipo = 'clic')   as clics
    from eventos group by 1
  ),
  por_categoria as (
    select c.id, c.nombre, coalesce(c.emoji, '') as emoji, count(*) as clics
    from eventos e
    join public.productos  p on p.id = e.producto_id
    join public.categorias c on c.id = p.categoria_id
    where e.tipo = 'clic'
    group by c.id, c.nombre, c.emoji
  ),
  nunca_abiertos as (
    select p.nombre, c.nombre as categoria
    from public.productos  p
    join public.categorias c on c.id = p.categoria_id
    where p.restaurante_id = p_restaurante_id
      and p.disponible
      and not exists (
        select 1 from eventos e where e.producto_id = p.id and e.tipo = 'clic')
  )
  select jsonb_build_object(
    'totalVisitas', (select count(*) from eventos where tipo = 'visita'),
    'totalClics',   (select count(*) from eventos where tipo = 'clic'),
    'visitasPorDia', coalesce((select jsonb_object_agg(dia, n) from por_dia), '{}'::jsonb),
    'rankingProductos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'nombre', nombre, 'clics', clics)
                       order by clics desc, nombre asc)
      from ranking), '[]'::jsonb),
    'porHora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', hora, 'visitas', visitas, 'clics', clics)
                       order by hora asc)
      from por_hora), '[]'::jsonb),
    'porCategoria', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', nombre, 'emoji', emoji, 'clics', clics)
                       order by clics desc, nombre asc)
      from por_categoria), '[]'::jsonb),
    'nuncaAbiertos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', nombre, 'categoria', categoria)
                       order by categoria asc, nombre asc)
      from nunca_abiertos), '[]'::jsonb)
  );
$$;

revoke execute on function public.estadisticas_restaurante(uuid, timestamptz, timestamptz, text) from public;
grant  execute on function public.estadisticas_restaurante(uuid, timestamptz, timestamptz, text) to service_role;

-- Comprobación de que la hora respeta la zona: el pico de bonzas debe salir
-- a las 19 pedido en 'America/Bogota' y a las 0 pedido en 'UTC'.
--
--   select (x->>'hora')::int, (x->>'visitas')::int
--   from public.estadisticas_restaurante(
--          (select id from public.restaurantes where slug='bonzas'),
--          '2026-07-01 00:00 America/Bogota'::timestamptz,
--          '2026-08-08 23:59 America/Bogota'::timestamptz,
--          'America/Bogota') n,
--        jsonb_array_elements(n->'porHora') x
--   order by 2 desc limit 1;
