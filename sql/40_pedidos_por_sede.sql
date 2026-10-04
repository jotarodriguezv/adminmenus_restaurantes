-- ═══════════════════════════════════════════════════════════════
-- PEDIDOS POR SEDE — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Leer docs/sedes.md §14. Un pedido del carrito de un restaurante con varias sedes tiene
-- que decir PARA QUÉ LOCAL es: quien lo prepara no puede adivinarlo. Es lo mismo que se
-- hizo con las reservas (sql/38), por las mismas razones.
--
-- ── QUÉ AÑADE ─────────────────────────────────────────────────
-- Dos columnas, las dos opcionales (un restaurante de un solo local no las usa):
--
--   sede_id      la sede, con 'on delete set null': borrar una sede no se lleva los pedidos,
--                que son del cliente y del negocio.
--   sede_nombre  el nombre de la sede TAL COMO ESTABA al pedir. Una copia a propósito: si la
--                sede se borra o se renombra, el pedido sigue diciendo a qué local iba, y la
--                lista del panel no necesita cruzar tablas.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────────
-- Aditivo: dos columnas nuevas, NULL en todo lo que ya hay. El servidor actual no las nombra.
-- Al revés no: el servidor nuevo escribe 'sede_id' y 'sede_nombre' y, sin las columnas, ese
-- pedido fallaría con un 500 —solo en restaurantes con sedes: los demás no mandan esas claves.
--
-- ── NO SE TOCAN LOS PERMISOS ──────────────────────────────────
-- 'pedidos_carta' ya es privada (sql/31). Las columnas nuevas heredan eso.

alter table public.pedidos_carta
  add column if not exists sede_id uuid references public.sedes(id) on delete set null,
  add column if not exists sede_nombre text check (sede_nombre is null or char_length(sede_nombre) <= 80);

create index if not exists idx_pedidos_carta_sede
  on public.pedidos_carta (sede_id, creado_en desc) where sede_id is not null;

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'pedidos_carta'
--      and column_name in ('sede_id', 'sede_nombre');            -- dos filas, YES
--
--   select has_table_privilege('anon', 'public.pedidos_carta', 'SELECT');   -- f
