-- ═══════════════════════════════════════════════════════════════
-- RESERVAS DE MESA — PREPARADA, SIN APLICAR (01/10/2026)
-- ═══════════════════════════════════════════════════════════════
-- Pedida por el usuario el 01/10/2026: botón «Reservar mesa» en la pantalla
-- de bienvenida de la carta. El comensal deja nombre, celular, fecha, hora y
-- para cuántas personas; el restaurante la ve en el panel, la confirma o la
-- cancela y le escribe por WhatsApp. No hay aviso automático.
--
-- ── ES UNA TABLA PRIVADA ──────────────────────────────────────
-- Lleva el nombre y el celular de un comensal. RLS encendido y sin ninguna
-- política, y sin permisos para anon ni authenticated: solo el servidor del
-- panel (service_role) la toca. Mismo trato que pedidos_carta y solicitudes.
-- La carta NO escribe aquí directamente: llama a POST /api/reservas, que
-- valida, limita por IP y por celular y comprueba que el restaurante las
-- tenga encendidas.
--
-- ── CUÁNTO SE GUARDA ──────────────────────────────────────────
-- 90 días después de la fecha de la reserva las borra el panel (reservas.js,
-- purgarPasadas). Es un dato personal de alguien que no es cliente de nadie
-- más que de ese restaurante, y una reserva ya pasada no sirve para nada. Hay
-- que reflejarlo en la política de privacidad de verificame.co.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────
-- Aditiva: nadie la lee hasta que se despliegue el panel que la usa.

create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'cancelada')),
  nombre text not null check (length(trim(nombre)) between 1 and 80),
  -- Solo dígitos y con indicativo (573001234567): sirve para el enlace wa.me.
  celular text not null check (celular ~ '^[0-9]{8,15}$'),
  -- Fecha y hora del reloj del restaurante, tal como las escribió el comensal.
  fecha date not null,
  hora time not null,
  personas integer not null check (personas between 1 and 50)
);

-- La lista del panel: las de un restaurante, por fecha.
create index if not exists idx_reservas_restaurante_fecha
  on public.reservas (restaurante_id, fecha, hora);

-- La purga busca por fecha en toda la tabla.
create index if not exists idx_reservas_fecha on public.reservas (fecha);

alter table public.reservas enable row level security;
revoke all on public.reservas from anon, authenticated, public;
grant select, insert, update, delete on public.reservas to service_role;

comment on table public.reservas is
  'Reservas de mesa pedidas desde la bienvenida de la carta. Privada: solo la toca el panel. Se borran 90 días después de su fecha.';

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
-- RLS encendido, sin políticas, y anon sin acceso:
--
--   select relrowsecurity from pg_class where oid = 'public.reservas'::regclass;
--   select count(*) from pg_policies where tablename = 'reservas';          -- 0
--   select has_table_privilege('anon', 'public.reservas', 'select');        -- false
