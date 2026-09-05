-- ═══════════════════════════════════════════════════════════════
-- VARIAS PROMOCIONES, CON DÍAS Y HORAS — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Paso 3 de docs/promociones.md. Leer ese documento antes de tocar esto: aquí
-- está el "qué" y allí el "por qué" de cada decisión.
--
-- ── QUÉ ABRE ──────────────────────────────────────────────────
-- Hoy la promoción es UNA, guardada como columnas de 'restaurantes'. El caso
-- que no cabe es el que pidió el negocio: un dos por uno en bebidas los
-- martes, que salga SOLO los martes. Y, de paso, promociones de temporada con
-- fecha de fin.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────
-- Es aditivo. La tabla nace y no la lee nadie: 'tv.html' y 'core/loader.js'
-- siguen leyendo las columnas de siempre hasta que se desplieguen sus
-- versiones nuevas. Aplicarla antes es gratis y no cambia nada de lo que se
-- ve hoy.
--
-- Al revés no: el código desplegado preguntaría por una tabla que no existe, y
-- pedir algo que no existe en PostgREST no devuelve un hueco, devuelve 400 y
-- se cae la petición entera (docs/pantalla-tv.md §11.bis).
--
-- ── LAS COLUMNAS VIEJAS NO SE BORRAN AQUÍ ─────────────────────
-- 'promo_activa', 'promo_imagen_url', 'promo_nombre', 'promo_precio',
-- 'promo_en_tv' y 'promo_cada' se quedan. Las siguen leyendo las cartas y las
-- carteleras que aún no se hayan recargado, y una pantalla de restaurante
-- puede pasarse días sin recargar. Se borran en una migración posterior,
-- cuando nada las lea — nunca en la misma que crea su sustituta.

-- ── LA TABLA ──────────────────────────────────────────────────
create table if not exists public.promociones (
  id             uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,

  -- Sin imagen no hay promoción: es lo único que la pantalla enseña seguro.
  -- Por eso 'not null' aquí y no una comprobación en el servidor.
  imagen_url     text not null,

  -- Los usa la cartelera bajo la imagen. El popup de la carta enseña la
  -- imagen sola, así que en él no salen (docs/promociones.md §2).
  nombre         text,
  precio         text,

  -- El interruptor de siempre, a mano. Separado de la programación a
  -- propósito: apagar algo por las bravas tiene que seguir siendo posible sin
  -- desarmarle el horario.
  activa         boolean not null default true,

  -- Dónde puede salir. Son dos superficies con reglas distintas —el popup
  -- elige UNA, la cartelera las rota TODAS— y un restaurante puede querer una
  -- promoción solo en una de las dos.
  en_popup       boolean not null default true,
  en_tv          boolean not null default false,

  -- Fechas, días y horas. Misma forma que 'categorias.atributos.horario', que
  -- ya resuelve esto para las categorías desde hace meses:
  --
  --   { "activo": true, "dias": [2], "desde": "18:00", "hasta": "23:00",
  --     "desde_fecha": "2026-12-01", "hasta_fecha": "2026-12-24" }
  --
  -- Todo opcional. '{}' = de fondo, vigente siempre, que es exactamente el
  -- comportamiento de la promoción única de hoy.
  --
  -- Inventar una segunda forma de horario sería el error caro: el día que haya
  -- que tocar el cálculo —feriados, una franja que cruza medianoche— habría
  -- dos sitios que arreglar y uno se olvidaría.
  programacion   jsonb not null default '{}'::jsonb,

  -- Orden en la rotación de la cartelera. El popup no lo usa: elige al azar,
  -- porque el comensal escanea el QR una vez y con orden fijo la segunda
  -- promoción no la vería nadie.
  orden          integer not null default 0,

  creada_en      timestamptz not null default now()
);

-- Se consulta siempre por restaurante, nunca por id suelto.
create index if not exists promociones_restaurante_idx
  on public.promociones (restaurante_id, orden);

-- ── EL TOPE DE CINCO NO VA AQUÍ ───────────────────────────────
-- Tentador ponerlo como 'check' o como disparador, y es un error: el tope va a
-- ser un número del PLAN —hoy cinco para todos, mañana quizá quince en uno de
-- pago— y un número clavado en el esquema convierte una decisión comercial en
-- una migración. Lo comprueba el servidor, que es quien conoce el plan.

-- ── QUIÉN PUEDE LEER ──────────────────────────────────────────
-- La carta del comensal y la cartelera leen con la clave publicable, así que
-- hace falta lectura pública. Pero solo de lo ENCENDIDO: una promoción
-- preparada y aún apagada no tiene por qué poder leerla cualquiera que mire la
-- red, igual que 'productos' solo expone los disponibles.
--
-- No se crean políticas de escritura: sin ellas, solo escribe 'service_role',
-- que se salta RLS y es la clave que usa el servidor. Es lo mismo que hacen
-- las demás tablas.
alter table public.promociones enable row level security;

drop policy if exists lectura_publica_promociones on public.promociones;
create policy lectura_publica_promociones
  on public.promociones
  for select
  to public
  using (activa = true);

-- ── LO QUE YA HAY NO SE PUEDE APAGAR ──────────────────────────
-- Bonzas tiene una promoción funcionando y sale cada mes con su hamburguesa
-- nueva. Se copia a una fila, con la programación vacía —de fondo, siempre
-- vigente— para que su comportamiento sea idéntico al de ayer.
--
-- 'on conflict' no aplica porque no hay clave única por restaurante: se filtra
-- por 'not exists' para que correr esto dos veces no duplique nada.
insert into public.promociones
  (restaurante_id, imagen_url, nombre, precio, activa, en_popup, en_tv, orden)
select r.id,
       r.promo_imagen_url,
       nullif(btrim(coalesce(r.promo_nombre, '')), ''),
       nullif(btrim(coalesce(r.promo_precio, '')), ''),
       coalesce(r.promo_activa, false),
       true,                                  -- el popup es de donde viene
       coalesce(r.promo_en_tv, false),
       0
  from public.restaurantes r
 where r.promo_imagen_url is not null
   and btrim(r.promo_imagen_url) <> ''
   and not exists (select 1 from public.promociones p
                    where p.restaurante_id = r.id);

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
-- No dar por hecho que funcionó. Lo de abajo tiene que devolver una fila por
-- cada restaurante que hoy tiene promoción, y 'anon' tiene que poder leer solo
-- las encendidas:
--
--   select r.slug, p.activa, p.en_tv, p.programacion
--     from public.promociones p
--     join public.restaurantes r on r.id = p.restaurante_id
--    order by r.slug;
--
--   select has_table_privilege('anon', 'public.promociones', 'SELECT');   -- t
--   select has_table_privilege('anon', 'public.promociones', 'INSERT');   -- f
