-- ═══════════════════════════════════════════════════════════════
-- PASO 1 — YA APLICADO en producción (proyecto menu-restaurantes)
-- ═══════════════════════════════════════════════════════════════
-- Se guarda aquí solo como registro de lo que se ejecutó.
--
-- Problema: 'restaurantes' tiene una política RLS de lectura pública
-- (USING true) y el menú la consultaba con select=*. RLS filtra FILAS, no
-- COLUMNAS, así que el bcrypt de pin_hash viajaba al navegador de cualquier
-- visitante. Con PIN de 4 dígitos (10.000 combinaciones) se rompe offline
-- en minutos y se entra al panel de ese restaurante.
--
-- Enfoque: los secretos salen de la tabla pública. 'restaurantes' pasa a ser
-- por definición "lo que se puede publicar"; todo lo demás vive aquí.
-- Ventaja frente a revocar la columna una por una: una columna nueva en
-- 'restaurantes' nunca es un secreto filtrado por descuido, porque los
-- secretos no se crean ahí.

create table if not exists public.restaurantes_privado (
  restaurante_id uuid primary key references public.restaurantes(id) on delete cascade,
  pin_hash       text        not null,
  actualizado_at timestamptz not null default now()
);

-- RLS activo y CERO políticas: PostgreSQL deniega por defecto. Ni anon ni
-- authenticated pueden tocarla. Solo la llave de servicio del panel, que
-- ignora RLS, la alcanza.
alter table public.restaurantes_privado enable row level security;
revoke all on public.restaurantes_privado from anon, authenticated;

comment on table public.restaurantes_privado is
  'Credenciales de acceso al panel. Sin políticas RLS a propósito: nada de lo que viva aquí puede llegar al navegador de un visitante. Todo secreto futuro (tokens, datos de facturación) va en esta tabla, nunca en public.restaurantes.';

insert into public.restaurantes_privado (restaurante_id, pin_hash)
select id, pin_hash from public.restaurantes where pin_hash is not null
on conflict (restaurante_id) do nothing;
