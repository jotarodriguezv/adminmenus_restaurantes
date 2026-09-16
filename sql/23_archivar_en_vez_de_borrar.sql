-- ═══════════════════════════════════════════════════════════════
-- ARCHIVAR EN VEZ DE BORRAR PLATOS Y CATEGORÍAS — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Lo pide V-POS, el punto de venta que comparte esta base (esquema `pos`).
--
-- ── POR QUÉ ───────────────────────────────────────────────────
-- Hoy, borrar un plato lo borra de verdad. Mientras la carta era lo único que
-- había, eso estaba bien: un plato retirado no le interesa a nadie.
--
-- Con el POS deja de estarlo. Cada línea de un pedido apunta al plato que se
-- vendió, y un pedido de hace tres meses tiene que seguir diciendo qué se
-- vendió, a qué precio y a quién se le cobró. Si el plato desaparece de la
-- base, o el borrado falla por la clave foránea —y entonces el panel no puede
-- borrar nada— o la venta se queda sin nombre.
--
-- Archivar resuelve las dos cosas: la fila se queda, la carta deja de verla y
-- el historial sigue completo.
--
-- ── EL PANEL SIGUE VIÉNDOSE IGUAL ─────────────────────────────
-- server.js filtra 'archivado_en is null' en las listas, así que quien
-- administra la carta no nota la diferencia: borra, y el plato desaparece de
-- su pantalla. Lo que cambia es que se puede recuperar, y que la venta vieja
-- no se queda coja.
--
-- ── Y LA CARTA TAMPOCO ────────────────────────────────────────
-- El filtro va dentro de la política de lectura y no en el código de la carta,
-- a propósito: así ni vmenus-app ni la cartelera necesitan cambiar, y ningún
-- sitio nuevo que lea esta tabla puede olvidarse de excluir lo archivado.

alter table public.productos  add column archivado_en timestamptz;
alter table public.categorias add column archivado_en timestamptz;

comment on column public.productos.archivado_en is
  'Cuándo se retiró de la carta. La fila se conserva porque los pedidos del POS apuntan a ella.';
comment on column public.categorias.archivado_en is
  'Cuándo se retiró de la carta. Sus platos se archivan con ella.';

-- ── LO QUE VE UN COMENSAL ─────────────────────────────────────
-- Igual que antes, menos lo archivado.
drop policy lectura_publica_productos on public.productos;
create policy lectura_publica_productos on public.productos
  for select to public
  using (disponible = true and archivado_en is null);

drop policy lectura_publica_categorias on public.categorias;
create policy lectura_publica_categorias on public.categorias
  for select to public
  using (archivado_en is null);

-- ── LO QUE VE EL POS ──────────────────────────────────────────
-- Un plato marcado como agotado en la carta SÍ tiene que verse en el punto de
-- venta: si no, no se puede ni configurar ni volver a activar desde allí, y un
-- plato que el restaurante venda solo en el local nunca podría cobrarse.
--
-- Por eso esta política añade a los miembros del restaurante —y a sus
-- dispositivos registrados— todo lo suyo que no esté archivado. pos.pertenece()
-- responde solo sobre quien llama, así que nadie ve otro restaurante.
--
-- Lo archivado queda fuera también aquí: archivar es retirar, y un plato
-- retirado no debe volver a venderse por error. Los pedidos viejos lo siguen
-- nombrando porque guardan su propia copia.
create policy lectura_del_pos_productos on public.productos
  for select to authenticated
  using (archivado_en is null and pos.pertenece(restaurante_id));

create policy lectura_del_pos_categorias on public.categorias
  for select to authenticated
  using (archivado_en is null and pos.pertenece(restaurante_id));

-- Las listas del panel y del POS piden siempre lo no archivado, que con el
-- tiempo será casi todo: el índice parcial es pequeño y sirve para esas
-- consultas.
create index productos_sin_archivar  on public.productos  (restaurante_id) where archivado_en is null;
create index categorias_sin_archivar on public.categorias (restaurante_id) where archivado_en is null;
