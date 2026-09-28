-- Contacto operativo que ve el restaurante al reportar un pago. No puede vivir
-- en restaurantes.atributos: la carta pública lee ese JSON completo.
create table if not exists public.configuracion_plataforma (
  id boolean primary key default true check (id),
  nombre_empresa text not null default 'VMenús',
  whatsapp_cobranza text not null default '',
  actualizado_at timestamptz not null default now(),
  constraint nombre_empresa_no_vacio check (length(trim(nombre_empresa)) between 1 and 80),
  constraint whatsapp_cobranza_formato check (whatsapp_cobranza = '' or whatsapp_cobranza ~ '^[0-9]{8,15}$')
);

alter table public.configuracion_plataforma enable row level security;
revoke all on public.configuracion_plataforma from anon, authenticated;

insert into public.configuracion_plataforma (id, nombre_empresa, whatsapp_cobranza)
values (true, 'VMenús', '')
on conflict (id) do nothing;
