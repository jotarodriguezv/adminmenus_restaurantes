-- ═══════════════════════════════════════════════════════════════
-- PARA CUÁNTAS PERSONAS ALCANZA UN PLATO
-- ═══════════════════════════════════════════════════════════════
-- Lo pidió el restaurante: platos para compartir —una salchipapa grande, una
-- bandeja para dos— y hoy no hay dónde decir para cuántos alcanzan. El
-- comensal pregunta en la mesa; con esto la carta ya responde.
--
-- Por defecto 1, que ya es cierto para casi todo el menú: ningún plato
-- existente cambia de significado al aplicar esto. El panel y la pantalla de
-- TV solo muestran la nota a partir de 2 (server.js y tv.html); decirlo
-- siempre sería ruido en una carta donde lo normal es una persona.
--
-- El tope de 50 es una restricción de integridad, no un límite de negocio: es
-- el mismo criterio de 'segundos' y 'por_slide' en atributos.tv, para que un
-- valor absurdo no llegue a la base por un dedazo. server.js valida lo mismo
-- antes, para no depender del mensaje crudo de Postgres.
alter table public.productos
  add column personas integer not null default 1
  check (personas >= 1 and personas <= 50);

comment on column public.productos.personas is
  'Para cuántas personas alcanza el plato. 1 es el valor normal y no se resalta en el panel ni en la pantalla de TV.';

-- ── SIN GRANT NI POLÍTICA NUEVA ───────────────────────────────
-- Comprobado en sql/15 (§10.sexies de docs/pantalla-tv.md) para las columnas
-- de la promoción, y vale igual aquí: el permiso de lectura de 'anon' sobre
-- 'productos' es de tabla, no por columnas, así que la columna nueva se lee
-- sola con las políticas ya existentes.
--
-- ── ORDEN DE DESPLIEGUE ────────────────────────────────────────
-- Esta migración va ANTES que el código. vmenus-app/tv.html pide las columnas
-- de 'productos' por su nombre, nunca con asterisco: pedir 'personas' antes de
-- que exista no deja un hueco, devuelve 400 y apaga la pantalla de TODOS los
-- restaurantes (11.bis de docs/pantalla-tv.md). adminmenus_restaurantes usa
-- select('*') al leer, así que a él no lo rompe el orden, pero si se aplica
-- después de desplegar el PATCH/POST con 'personas' en el cuerpo, cualquier
-- guardado de un plato falla con el error crudo de Postgres.
