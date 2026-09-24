-- ═══════════════════════════════════════════════════════════════
-- "MOSTRAR PERSONAS" PASA DE CADA PLATO AL RESTAURANTE
-- ═══════════════════════════════════════════════════════════════
-- sql/27 puso 'mostrar_personas' y 'mostrar_personas_uno' en cada plato.
-- Corregido el mismo día, antes de que ningún restaurante llegara a
-- guardarlas: pedirle a un negocio con muchos platos que marque uno por uno
-- es justo el trabajo repetitivo que esto tenía que evitarle. La decisión es
-- del restaurante entero, no de cada plato.
--
-- Se retiran las dos columnas de 'productos' —una migración no se edita
-- después de aplicarla; lo que estaba mal se corrige en la siguiente, y
-- ninguna fila las había usado todavía— y sus equivalentes pasan a
-- 'restaurantes.atributos.tv', junto a 'mostrar_categoria' y
-- 'mostrar_descripcion', que ya viven ahí y ya no necesitan tocar la base para
-- guardarse: 'atributos' es jsonb.
alter table public.productos
  drop column mostrar_personas,
  drop column mostrar_personas_uno;

-- 'productos.personas' (sql/26) se queda: es un dato del PLATO — cuántas
-- personas alcanza esa salchipapa— y no tiene sustituto en atributos.tv.
