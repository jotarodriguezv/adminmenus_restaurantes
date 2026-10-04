-- ═══════════════════════════════════════════════════════════════
-- DESTACADOS POR SEDE — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Leer docs/sedes.md §13. Un destacado puede ser de UNA sede o de todas: un «2x1 en
-- Bucaramanga» no puede salirle a quien mira la carta de Piedecuesta, y menos con su
-- precio.
--
-- ── QUÉ AÑADE ─────────────────────────────────────────────────
-- Una columna, opcional:
--
--   sede_id   la sede a la que está dirigido el destacado. NULL = todas las sedes, que
--             es lo que son todos los destacados que existen hoy: ninguno cambia.
--
-- ── POR QUÉ 'on delete cascade' Y NO 'set null' ───────────────
-- Es lo contrario de lo que se hizo con las reservas (sql/38), y a propósito. Una
-- reserva es del comensal y del negocio y sobrevive a su sede. Un destacado dirigido a
-- una sede que se borra, en cambio, NO puede pasar a valer para todas: con 'set null'
-- el «2x1 en Bucaramanga» empezaría a salir en Piedecuesta justo cuando se borra
-- Bucaramanga. Es mejor que desaparezca con ella. Quien solo quiera quitarla un tiempo
-- apaga la sede (activa = false), que no borra nada.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────────
-- Es aditivo: una columna nueva y NULL en todas las filas que ya hay. La carta nueva lee
-- 'promociones' con '*' y la cartelera nueva pide 'sede_id' por nombre: sin la columna,
-- esa petición devolvería 400 —y la cartelera trata las promociones como «hoy no hay»,
-- no se cae— pero no hay por qué pasar por ahí. Aplicar esto antes es gratis.
--
-- ── NO SE TOCAN LOS PERMISOS ──────────────────────────────────
-- 'promociones' ya tiene su lectura pública solo de lo encendido y la escritura cerrada
-- (sql/18 y sql/19). La columna nueva hereda eso.

alter table public.promociones
  add column if not exists sede_id uuid references public.sedes(id) on delete cascade;

-- Parcial: casi todos los destacados son de todas las sedes y no tiene sentido indexar los
-- NULL. Sirve a la propia cascada, que busca por sede al borrar una.
create index if not exists idx_promociones_sede
  on public.promociones (sede_id) where sede_id is not null;

comment on column public.promociones.sede_id is
  'Sede a la que está dirigido el destacado. NULL = todas las sedes. Se borra con la sede.';

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'promociones' and column_name = 'sede_id';
--                                                     -- una fila: uuid, YES
--
--   select count(*) filter (where sede_id is not null) as con_sede, count(*) as total
--     from public.promociones;                        -- con_sede = 0
--
--   select has_table_privilege('anon', 'public.promociones', 'SELECT') as lee,   -- t
--          has_table_privilege('anon', 'public.promociones', 'INSERT') as escribe; -- f
