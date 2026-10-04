-- ═══════════════════════════════════════════════════════════════
-- RESERVAS POR SEDE — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Leer docs/sedes.md §10. Una reserva de un restaurante con varias sedes tiene que
-- decir para QUÉ LOCAL es: quien la prepara no puede adivinarlo.
--
-- ── QUÉ AÑADE ─────────────────────────────────────────────────
-- Dos columnas, las dos opcionales (un restaurante de un solo local no las usa):
--
--   sede_id      la sede, con 'on delete set null': borrar una sede no se lleva
--                las reservas, que son del comensal y del negocio.
--   sede_nombre  el nombre de la sede TAL COMO ESTABA al reservar. Es una copia a
--                propósito: si la sede se borra o se renombra, la reserva sigue
--                diciendo a qué local iba, y la lista del panel no necesita cruzar
--                tablas (que además se purgan a los 90 días: son de vida corta).
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────────
-- Es aditivo: dos columnas nuevas y NULL en todas las reservas que ya existen. Las
-- versiones actuales del servidor no las nombran, así que aplicar esto antes es
-- gratis. Al revés no: el servidor nuevo escribe 'sede_id' y 'sede_nombre' y, sin
-- las columnas, esa reserva fallaría con un 500 — aunque solo en restaurantes con
-- sedes: los demás no mandan esas claves.
--
-- ── NO SE TOCAN LOS PERMISOS ──────────────────────────────────
-- 'reservas' ya es privada (sql/34): RLS encendido, sin acceso para anon. Las dos
-- columnas heredan eso.

alter table public.reservas
  add column if not exists sede_id uuid references public.sedes(id) on delete set null,
  add column if not exists sede_nombre text check (sede_nombre is null or char_length(sede_nombre) <= 80);

-- Para mirar las reservas de una sede. Parcial: la mayoría de las filas no la
-- llevan, y no tiene sentido indexar los NULL.
create index if not exists idx_reservas_sede
  on public.reservas (sede_id, fecha, hora) where sede_id is not null;

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'reservas'
--      and column_name in ('sede_id', 'sede_nombre');          -- dos filas, YES
--
--   select has_table_privilege('anon', 'public.reservas', 'SELECT');   -- f
