-- ═══════════════════════════════════════════════════════════════
-- SEDES: VARIOS LOCALES, UNA SOLA CARTA — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Leer docs/sedes.md: aquí está el "qué" y allí el "por qué".
--
-- ── EL CASO ───────────────────────────────────────────────────
-- Un restaurante con dos locales (Piedecuesta y Bucaramanga) que comparten
-- carta pero NO precios: casi todos los platos cuestan entre un 10 y un 20 %
-- más en uno. Y a veces un plato existe en un local y en el otro no.
--
-- Por eso no vale ni «un restaurante por sede» (la carta se duplicaría y cada
-- cambio habría que hacerlo dos veces) ni «una carta idéntica con datos de
-- contacto distintos» (los precios no coinciden).
--
-- ── EL MODELO ─────────────────────────────────────────────────
-- Un plato sigue siendo UNO, en 'productos', con su precio de siempre: es el
-- precio BASE. Encima, 'productos_sedes' guarda solo lo que cambia en una sede:
-- un precio propio o que el plato no se sirve allí. Sin fila, el plato hereda
-- el precio y la disponibilidad base.
--
-- Eso tiene una consecuencia que importa: un restaurante de UNA sola sede no
-- tiene filas aquí ni en 'sedes', y su carta se comporta exactamente como ayer.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────────
-- Es aditivo: dos tablas nuevas que no lee nadie hasta que se desplieguen las
-- versiones nuevas de la carta y del panel. Aplicarlo antes es gratis.
--
-- Al revés no: la carta desplegada preguntaría por una tabla que no existe, y
-- PostgREST contesta 400 y se cae la petición entera, igual que pasó con las
-- columnas de la promoción (core/loader.js). La carta nueva además protege el
-- arranque con un .catch, pero no hay que depender de eso.
--
-- ── NO SE TOCA NINGUNA TABLA EXISTENTE ────────────────────────────
-- Ni 'restaurantes', ni 'productos', ni 'categorias'. Las cartas de hoy no
-- pueden notar esta migración.

-- ── LAS SEDES ─────────────────────────────────────────────────
create table if not exists public.sedes (
  id             uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,

  -- Va en la URL: menu.vmenus.co/<restaurante>/<sede>. Minúsculas, números y
  -- guiones; es lo único que el comensal ve y lo que queda impreso en un QR, así
  -- que no se cambia a la ligera.
  slug           text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  nombre         text not null check (char_length(btrim(nombre)) between 1 and 80),

  -- Los datos del negocio DE ESTA SEDE, con las mismas claves que ya usa
  -- 'restaurantes.atributos' (direccion, mapa_url, whatsapp_negocio,
  -- horario_atencion, correo, resena_url…). La carta los pone por encima de los
  -- del restaurante al entrar por la sede, y todo lo que ya los lee —el carrito,
  -- la bienvenida, los botones— los sigue leyendo igual, sin enterarse.
  --
  -- Son datos que ya son públicos hoy; los secretos no viven aquí, como en
  -- 'restaurantes' (CLAUDE.md, «Supabase»).
  atributos      jsonb not null default '{}'::jsonb,

  orden          integer not null default 0,

  -- Apagar una sede sin borrarla: el QR impreso deja de abrir su carta pero no
  -- se pierden sus precios.
  activa         boolean not null default true,

  creada_en      timestamptz not null default now(),

  unique (restaurante_id, slug)
);

create index if not exists sedes_restaurante_idx
  on public.sedes (restaurante_id, orden);

-- ── LO QUE CAMBIA EN CADA SEDE ────────────────────────────────
create table if not exists public.productos_sedes (
  producto_id     uuid not null references public.productos(id) on delete cascade,
  sede_id         uuid not null references public.sedes(id) on delete cascade,

  -- Precio propio de la sede. Mismo par que en 'productos': el texto es lo que
  -- se enseña, el número lo que cobra el carrito y ordena. NULL = hereda el base.
  precio          text,
  precio_numerico numeric check (precio_numerico is null or precio_numerico >= 0),

  -- NULL = hereda. false = este plato no se sirve en esta sede. Nunca hace falta
  -- 'true': un plato base no disponible no sale en ninguna parte, y eso no se
  -- deshace desde aquí.
  disponible      boolean,

  primary key (producto_id, sede_id)
);

-- Se consulta siempre por sede.
create index if not exists productos_sedes_sede_idx
  on public.productos_sedes (sede_id);

-- ── QUIÉN PUEDE LEER ──────────────────────────────────────────
-- La carta del comensal lee con la clave publicable. Solo de lo ENCENDIDO: una
-- sede apagada no se ve, y sus precios tampoco.
--
-- Sin políticas de escritura, solo escribe 'service_role', que se salta RLS y
-- es la clave del servidor. Igual que las demás tablas.
alter table public.sedes           enable row level security;
alter table public.productos_sedes enable row level security;

drop policy if exists lectura_publica_sedes on public.sedes;
create policy lectura_publica_sedes
  on public.sedes
  for select
  to public
  using (activa = true);

drop policy if exists lectura_publica_productos_sedes on public.productos_sedes;
create policy lectura_publica_productos_sedes
  on public.productos_sedes
  for select
  to public
  using (exists (select 1 from public.sedes s
                  where s.id = productos_sedes.sede_id and s.activa = true));

-- ── PERMISOS DE TABLA: CERRADOS DESDE EL PRINCIPIO ───────────
-- Supabase da privilegios por defecto a 'anon' y 'authenticated' sobre lo que
-- nace en 'public'; una tabla nueva llega abierta (sql/19). Aquí no se espera a
-- que haya que cerrarlo después: se nace cerrada.
revoke insert, update, delete on public.sedes           from anon, authenticated, public;
revoke insert, update, delete on public.productos_sedes from anon, authenticated, public;

grant select, insert, update, delete on public.sedes           to service_role;
grant select, insert, update, delete on public.productos_sedes to service_role;

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
--   select c.relname,
--          has_table_privilege('anon', c.oid, 'SELECT') as anon_lee,   -- t
--          has_table_privilege('anon', c.oid, 'INSERT') as anon_ins,   -- f
--          has_table_privilege('anon', c.oid, 'UPDATE') as anon_upd,   -- f
--          has_table_privilege('anon', c.oid, 'DELETE') as anon_del,   -- f
--          has_table_privilege('service_role', c.oid, 'INSERT') as servidor  -- t
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname in ('sedes', 'productos_sedes');
