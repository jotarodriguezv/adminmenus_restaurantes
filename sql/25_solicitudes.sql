-- ═══════════════════════════════════════════════════════════════
-- SOLICITUDES DE ALTA DE RESTAURANTES — APLICADO EL 19/09/2026
-- ═══════════════════════════════════════════════════════════════
-- Decidido con el usuario el 18-19/09/2026, para empezar a comercializar el
-- panel con publicidad en Facebook e Instagram.
--
-- ── QUÉ ABRE ──────────────────────────────────────────────────
-- Nadie se crea una cuenta solo: el restaurante lo crea el superadmin y le da
-- el PIN. Esto no cambia. Lo que se añade es una forma de PEDIRLO: una bandeja
-- de solicitudes que el superadmin aprueba o descarta a mano.
--
-- Entran por dos puertas y acaban aquí las dos:
--   · 'meta'  — el formulario instantáneo de un anuncio. Lo recibe el n8n del
--               usuario y lo reenvía al panel con una clave secreta.
--   · 'campo' — la página /solicitud, que usa el equipo comercial en la calle.
--   · 'web'   — la misma página, sin nombre de comercial.
--
-- ── POR QUÉ PRIVADA ───────────────────────────────────────────
-- Lleva nombres y teléfonos de personas (Ley 1581 de 2012). NUNCA va en
-- 'restaurantes', que se lee entera desde el navegador de cualquier comensal:
-- es la misma regla que las credenciales (sql/01) y la cobranza (sql/06). Solo
-- la lee y la escribe el servidor.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────
-- Es aditiva: nace vacía y nadie la lee hasta que se despliegue el código que
-- la usa. Al revés, el código desplegado pediría una tabla que no existe.

create table if not exists public.solicitudes (
  id              uuid primary key default gen_random_uuid(),

  origen          text not null check (origen in ('meta', 'campo', 'web')),
  estado          text not null default 'nueva'
                  check (estado in ('nueva', 'contactada', 'aprobada', 'descartada')),

  -- Lo que se pide en el formulario. Los límites de longitud se repiten aquí
  -- aunque el servidor ya los compruebe: es la última barrera si alguien llega
  -- a la tabla por otro camino.
  negocio         text not null check (char_length(negocio) between 1 and 120),
  contacto        text not null check (char_length(contacto) between 1 and 120),
  -- Solo dígitos, con el indicativo del país (57 para Colombia). Así se puede
  -- montar el enlace de WhatsApp y encontrar repetidas sin pelear con formatos.
  whatsapp        text not null check (whatsapp ~ '^[0-9]{8,15}$'),
  ciudad          text check (char_length(ciudad) <= 80),
  tipo_negocio    text check (char_length(tipo_negocio) <= 60),
  -- Quién del equipo la mandó, en las de 'campo'.
  comercial       text check (char_length(comercial) <= 80),
  notas           text check (char_length(notas) <= 1000),

  -- La autorización de tratamiento de datos. Sin ella el servidor no guarda
  -- nada: se deja constancia de cuándo se dio.
  autoriza_datos  boolean not null,
  autorizado_en   timestamptz,

  -- El identificador del lead en Meta. Único: n8n puede reintentar el envío, y
  -- sin esto un reintento sería una solicitud repetida y un segundo aviso.
  meta_lead_id    text unique,
  -- Lo demás que trae Meta (campaña, anuncio, formulario), para saber qué
  -- campaña trae clientes sin tener que cruzar nada.
  datos_origen    jsonb not null default '{}'::jsonb,

  -- El restaurante que se creó al aprobarla.
  restaurante_id  uuid references public.restaurantes(id) on delete set null,
  -- Lo que anota el equipo al gestionarla («llamar el lunes», «no contesta»).
  notas_internas  text check (char_length(notas_internas) <= 1000),

  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

-- La bandeja se lee por estado y por lo más reciente; las repetidas se buscan
-- por número.
create index if not exists solicitudes_estado_idx on public.solicitudes (estado, creado_en desc);
create index if not exists solicitudes_whatsapp_idx on public.solicitudes (whatsapp);

-- actualizado_en, con el nombre que escribe el trigger compartido. En sql/21 se
-- llamó distinto y cada update reventaba (sql/22); lo vigila migraciones.test.js.
create trigger solicitudes_actualizado
  before update on public.solicitudes
  for each row execute function public.tocar_actualizado_en();

-- ── PERMISOS: LOS DOS REVOKE, Y COMPROBAR DESPUÉS ─────────────
-- Una tabla nueva en 'public' nace abierta a anon y authenticated. Hacen falta
-- los dos revoke y RLS encendido; la lección está en sql/16 y sql/20.
revoke all on public.solicitudes from public;
revoke all on public.solicitudes from anon, authenticated;
alter table public.solicitudes enable row level security;
grant select, insert, update, delete on public.solicitudes to service_role;

comment on table public.solicitudes is
  'Solicitudes de alta de restaurantes (Meta, equipo en campo, web). Datos personales: solo las lee el servidor. Nunca crean un restaurante solas: las aprueba el superadmin.';

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
-- Las cuatro primeras en 'f' y la última en 't':
--
--   select has_table_privilege('anon', 'public.solicitudes', 'SELECT') as anon_lee,
--          has_table_privilege('anon', 'public.solicitudes', 'INSERT') as anon_ins,
--          has_table_privilege('authenticated', 'public.solicitudes', 'SELECT') as auth_lee,
--          has_table_privilege('authenticated', 'public.solicitudes', 'INSERT') as auth_ins,
--          has_table_privilege('service_role', 'public.solicitudes', 'INSERT') as servidor;
--
--   select relrowsecurity from pg_class where relname = 'solicitudes';   -- t
