-- ═══════════════════════════════════════════════════════════════
-- SI SE MUESTRA "PARA CUÁNTAS PERSONAS", Y SI SE MUESTRA CON UNA SOLA
-- ═══════════════════════════════════════════════════════════════
-- sql/26 guardó el número; esto guarda si se enseña. Pedido el 24/09/2026:
-- que el número exista no significa que quien administra quiera anunciarlo, y
-- al revés —un plato para una sola persona— puede querer decirlo igual, por
-- ejemplo para dejar claro que NO se comparte.
--
-- Dos columnas y no una, porque son dos preguntas distintas:
--   'mostrar_personas'      — ¿se enseña esta información, sea cual sea el
--                              número guardado?
--   'mostrar_personas_uno'  — con 1, ¿se enseña igual?
--
-- Los valores por defecto conservan el comportamiento de hoy sin que nadie
-- tenga que tocar nada: 'mostrar_personas' en true (ya se enseñaba a partir de
-- 2) y 'mostrar_personas_uno' en false (con 1 no se decía nada).
--
-- Columnas propias y no claves de 'atributos', por la misma razón que
-- 'personas' en sql/26: tv.html pide las columnas de productos por su nombre,
-- nunca con asterisco ni leyendo el jsonb completo, así que algo que tv.html
-- tiene que ver no puede vivir solo en 'atributos'.
alter table public.productos
  add column mostrar_personas boolean not null default true,
  add column mostrar_personas_uno boolean not null default false;

comment on column public.productos.mostrar_personas is
  'Si se enseña la nota de "para cuántas personas" en el panel y en la pantalla de TV, sea cual sea el número guardado en personas.';
comment on column public.productos.mostrar_personas_uno is
  'Si la nota se enseña también cuando personas = 1. Por defecto no: 1 es el caso normal de casi toda la carta.';

-- Sin GRANT ni política nueva: mismo motivo que sql/26 y que las columnas de
-- la promoción en sql/15 (§10.sexies de docs/pantalla-tv.md). El permiso de
-- lectura de 'anon' sobre 'productos' es de tabla, no por columnas.
