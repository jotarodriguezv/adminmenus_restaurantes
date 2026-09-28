-- Pedidos que el cliente declara haber enviado por WhatsApp. No son pagos ni
-- ventas confirmadas: el restaurante los opera después desde el panel.
create table if not exists public.pedidos_carta (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  estado text not null default 'enviado_cliente'
    check (estado in ('enviado_cliente', 'recibido', 'en_preparacion', 'completado', 'cancelado')),
  tipo_entrega text not null check (tipo_entrega in ('domicilio', 'local', 'recoger')),
  cliente_nombre text not null check (length(trim(cliente_nombre)) between 1 and 80),
  cliente_telefono text not null check (length(trim(cliente_telefono)) between 6 and 30),
  direccion_entrega text,
  metodo_pago text not null check (length(trim(metodo_pago)) between 1 and 50),
  total_reportado integer not null check (total_reportado >= 0),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  check ((tipo_entrega = 'domicilio' and length(trim(coalesce(direccion_entrega, ''))) > 0)
      or (tipo_entrega <> 'domicilio' and direccion_entrega is null))
);

create index if not exists idx_pedidos_carta_restaurante_fecha
  on public.pedidos_carta (restaurante_id, creado_en desc);

alter table public.pedidos_carta enable row level security;
revoke all on public.pedidos_carta from anon, authenticated, public;
grant select, insert, update, delete on public.pedidos_carta to service_role;
