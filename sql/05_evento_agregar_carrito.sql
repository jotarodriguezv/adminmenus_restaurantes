-- ═══════════════════════════════════════════════════════════════
-- PASO 5 — YA APLICADO en producción (proyecto menu-restaurantes)
-- ═══════════════════════════════════════════════════════════════
-- Registro de lo ejecutado. No hay que volver a correrlo.
--
-- Tercer tipo de evento: cuando el cliente mete un producto al carrito.
-- Es el primer dato NUEVO que se captura del visitante; las analíticas
-- anteriores (horas, categorías, ignorados) salían de lo que ya se registraba.
--
-- Sigue sin haber nada personal: restaurante, producto y momento, igual que
-- los otros dos tipos. No hay identificador de persona ni de sesión.
--
-- Solo lo emiten los restaurantes con el modelo carrito. En el resto no habrá
-- ningún evento de este tipo y el panel esconde la sección entera, en vez de
-- enseñar ceros que no significan nada.

-- ── 1. Permitir el tipo nuevo ─────────────────────────────────
alter table public.eventos_analitica drop constraint eventos_analitica_tipo_check;

alter table public.eventos_analitica add constraint eventos_analitica_tipo_check
  check (tipo = any (array['visita'::text, 'clic'::text, 'agregar_carrito'::text]));

comment on column public.eventos_analitica.tipo is
  'visita = carga del menú · clic = abrir la ficha de un producto · agregar_carrito = meterlo al carrito. Solo lo usan los restaurantes con el modelo carrito.';

-- ── 2. Recogerlo en el agregado ───────────────────────────────
-- Se cuenta aparte de los clics a propósito: abrir una ficha puede ser
-- curiosidad, meterla al carrito es intención de pedir. Comparar los dos
-- números es lo que dice si un plato se mira mucho pero no convence.
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
  -- Cuántas veces se abrió cada ficha, para contrastarlo con lo que acabó
  -- en el carrito.
  clics_por_producto as (
    select producto_id, count(*) as clics from eventos
    where tipo = 'clic' and producto_id is not null group by 1
  ),
  agregados as (
    select e.producto_id,
           coalesce(p.nombre, '(producto eliminado)') as nombre,
           count(*) as agregados,
           coalesce(c.clics, 0) as clics
    from eventos e
    left join public.productos p on p.id = e.producto_id
    left join clics_por_producto c on c.producto_id = e.producto_id
    where e.tipo = 'agregar_carrito' and e.producto_id is not null
    group by e.producto_id, p.nombre, c.clics
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
    'totalVisitas',   (select count(*) from eventos where tipo = 'visita'),
    'totalClics',     (select count(*) from eventos where tipo = 'clic'),
    'totalAgregados', (select count(*) from eventos where tipo = 'agregar_carrito'),
    'visitasPorDia', coalesce((select jsonb_object_agg(dia, n) from por_dia), '{}'::jsonb),
    'rankingProductos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'nombre', nombre, 'clics', clics)
                       order by clics desc, nombre asc)
      from ranking), '[]'::jsonb),
    'masAgregados', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'nombre', nombre,
                                          'agregados', agregados, 'clics', clics)
                       order by agregados desc, nombre asc)
      from agregados), '[]'::jsonb),
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
