-- ═══════════════════════════════════════════════════════════════
-- IMPORTAR LA CARTA DESDE UN PDF O UNA IMAGEN — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- docs/importar-carta.md §6. Leer ese documento antes de tocar esto: aquí está
-- el "qué" y allí el "por qué" de cada decisión.
--
-- ── QUÉ ABRE ──────────────────────────────────────────────────
-- Hoy, al dar de alta un restaurante, alguien teclea sus productos uno por
-- uno: entre cuarenta y ciento setenta fichas. Es donde se muere un alta.
--
-- Esta tabla guarda lo que el modelo PROPONE a partir del archivo que subió el
-- restaurante, para que una persona lo revise antes de que llegue a
-- 'categorias' y 'productos'.
--
-- ── POR QUÉ UNA TABLA Y NO ESCRIBIR DIRECTO ───────────────────
-- Porque el modelo puede colar un plato que no existe, y encontrarlo DESPUÉS,
-- con la carta ya publicada y el QR repartido, cuesta mucho más que mirarlo
-- antes. El borrador es el sitio donde eso se puede mirar.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────
-- Es aditiva. La tabla nace y no la lee nadie hasta que se despliegue el
-- código que la usa, así que aplicarla antes es gratis y no cambia nada de lo
-- que se ve hoy.
--
-- Al revés no: el código desplegado preguntaría por una tabla que no existe, y
-- pedir algo que no existe en PostgREST no devuelve un hueco, devuelve 400 y
-- se cae la petición entera (docs/pantalla-tv.md §11.bis).

-- ── LA TABLA ──────────────────────────────────────────────────
create table if not exists public.importaciones_carta (
  id             uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,

  -- Qué subió la persona.
  origen         text not null check (origen in ('pdf', 'imagen')),

  -- Por dónde acabó yendo: 'texto' si el PDF traía capa de texto, 'vision' si
  -- hubo que mirar las páginas. Lo decide lectorpdf.js, no el usuario.
  --
  -- Se guarda para poder MEDIR. El documento dice que la vía de texto es
  -- exacta y la de imagen puede fallar en un dígito; sin esta columna, esa
  -- frase se queda en una opinión y nunca se sabe cuál de las dos da guerra.
  via            text check (via in ('texto', 'vision')),

  -- Ruta del archivo subido, para poder repetir la extracción sin pedirle a
  -- nadie que vuelva a subir la carta.
  archivo        text,

  estado         text not null default 'pendiente'
                 check (estado in ('pendiente', 'listo', 'aplicado', 'descartado', 'error')),

  -- El árbol propuesto, tal cual:
  --
  --   { "categorias": [
  --       { "nombre": "CALDOS", "platos": [
  --           { "nombre": "CALDO DE COSTILLA",
  --             "descripcion": "ACOMPAÑADO DE AREPA DE MAÍZ",
  --             "precio_numerico": 10000 } ] } ] }
  --
  -- En jsonb y no en tablas normalizadas a propósito: esto es un borrador que
  -- se mira una vez y se aplica o se tira. Nadie lo consulta por plato, nadie
  -- lo ordena, nadie lo cruza con nada. Dos tablas más para eso serían dos
  -- tablas que mantener para siempre por una comodidad de un solo día.
  borrador       jsonb not null default '{}'::jsonb,

  -- Qué salió mal, cuando 'estado' es 'error'. Va a la cara del usuario, así
  -- que lo que se guarde aquí tiene que poder leerlo alguien que no programa:
  -- el texto de una excepción puede llevar rutas del disco o nombres de
  -- tablas, y eso no sale de aquí (misma regla que el manejador de errores de
  -- server.js).
  error          text,

  -- Lo que costó, en tokens. Es la única forma de contestar con números la
  -- pregunta que docs/importar-carta.md §9 deja abierta: si la vía de texto
  -- puede bajar a un modelo más barato. Sin medirlo, se decide a ojo.
  tokens_entrada integer,
  tokens_salida  integer,
  modelo         text,

  creada_en      timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

-- Se consulta siempre por restaurante y por lo más reciente.
create index if not exists importaciones_carta_restaurante_idx
  on public.importaciones_carta (restaurante_id, creada_en desc);

create trigger importaciones_carta_actualizada
  before update on public.importaciones_carta
  for each row execute function public.tocar_actualizado_en();

-- ── PERMISOS: LOS DOS REVOKE, Y COMPROBAR DESPUÉS ─────────────
-- Una tabla nueva en 'public' NACE ABIERTA. Hay dos vías de acceso
-- independientes y ninguna se quita revocando la otra:
--
--   · PostgreSQL concede a PUBLIC lo que herede de los privilegios por defecto
--   · Supabase, ADEMÁS, concede a 'anon' y 'authenticated' de forma explícita
--
-- Se emiten los dos siempre, sin pararse a averiguar cuál aplica: sobra uno y
-- no cuesta nada. La lección está en sql/16, donde el primer intento cerró una
-- función y dejó la otra abierta.
--
-- Aquí importa especialmente: un borrador lleva la carta entera de un
-- restaurante ANTES de revisarla, con el nombre del archivo que subió. Nada de
-- eso tiene por qué llegar al navegador de un comensal.
revoke all on public.importaciones_carta from public;
revoke all on public.importaciones_carta from anon, authenticated;

-- La segunda barrera: con RLS encendido y sin ninguna política permisiva, un
-- comando se deniega aunque el privilegio de tabla estuviera concedido.
alter table public.importaciones_carta enable row level security;

-- 'service_role' se salta RLS pero necesita el privilegio de tabla. Explícito,
-- para no depender de un privilegio por defecto que mañana puede cambiar.
grant select, insert, update, delete on public.importaciones_carta to service_role;

comment on table public.importaciones_carta is
  'Borrador de una carta extraída de un PDF o una imagen. Nada llega a productos sin que una persona lo apruebe. Ver docs/importar-carta.md.';

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
-- No dar por hecho que funcionó. Lo de abajo tiene que salir con las cuatro
-- primeras columnas en 'f' y la última en 't':
--
--   select has_table_privilege('anon', 'public.importaciones_carta', 'SELECT') as anon_lee,
--          has_table_privilege('anon', 'public.importaciones_carta', 'INSERT') as anon_ins,
--          has_table_privilege('authenticated', 'public.importaciones_carta', 'SELECT') as auth_lee,
--          has_table_privilege('authenticated', 'public.importaciones_carta', 'INSERT') as auth_ins,
--          has_table_privilege('service_role', 'public.importaciones_carta', 'INSERT') as servidor;
--
-- Y comprobar que RLS quedó encendido, que es la barrera de detrás:
--
--   select relrowsecurity from pg_class where relname = 'importaciones_carta';
