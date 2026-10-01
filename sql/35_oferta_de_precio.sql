-- ═══════════════════════════════════════════════════════════════
-- OFERTA DE PRECIO EN UN PLATO — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Un plato que ya está en la carta puede tener, por un tiempo limitado o
-- indefinido, un precio menor: la carta enseña el de siempre tachado y el
-- nuevo al lado.
--
-- No es lo mismo que las «promociones» (sql/18): aquellas son una imagen que
-- sale al abrir la carta o en la cartelera y no tocan ningún precio. Por eso
-- los nombres de aquí empiezan por `oferta_` y no por `promo_`.
--
-- ── EL PRECIO DE OFERTA SE GUARDA SOLO COMO NÚMERO ────────────
-- `precio` (texto) y `precio_numerico` se escriben siempre juntos desde
-- precios.js, porque separarlos hizo que la carta mostrara un precio y el
-- carrito cobrara otro. Aquí NO se repite ese par: la oferta es solo el número,
-- y el texto se obtiene al pintar con el mismo formateador. Un segundo texto
-- guardado sería otra cosa que puede discrepar.
--
-- ── LAS FECHAS SON FECHAS, NO INSTANTES ───────────────────────
-- `oferta_desde` y `oferta_hasta` son `date`, y se leen en la zona horaria del
-- restaurante: el restaurante dice «hasta el 24 de diciembre» y quiere decir
-- que el 24 todavía rige. `oferta_hasta` es inclusivo. Un `timestamptz` haría
-- que «hasta el 24» significara a las 00:00 del 24 según el huso de quien lo
-- escribió, y el último día se perdería.
--
-- Las dos son opcionales. Sin ninguna, la oferta rige mientras
-- `oferta_activa` esté encendida: indefinida y apagada a mano.
--
-- ── LO QUE NO SE COMPRUEBA AQUÍ ───────────────────────────────
-- Que el precio de oferta sea menor que `precio_numerico` NO es un `check`.
-- Si lo fuera, bajar después el precio normal por debajo de la oferta haría
-- fallar ese update con un error que no habla de ofertas. Lo comprueba el
-- servidor al guardar, y quien pinta ignora una oferta que no sea menor que el
-- precio: ante la duda, se enseña el precio normal.
--
-- ── NADA QUE LEER TODAVÍA ─────────────────────────────────────
-- Las políticas de lectura de `productos` no cambian: ven la fila entera, así
-- que ni la carta ni la cartelera necesitan permisos nuevos. Aditiva y sin
-- default que cambie lo existente: todo plato sigue sin oferta.

alter table public.productos
  add column oferta_activa boolean not null default false,
  add column oferta_precio_numerico numeric,
  add column oferta_desde date,
  add column oferta_hasta date;

alter table public.productos
  add constraint productos_oferta_precio_valido
    check (oferta_precio_numerico is null or oferta_precio_numerico >= 0),
  add constraint productos_oferta_fechas_en_orden
    check (oferta_desde is null or oferta_hasta is null or oferta_desde <= oferta_hasta);

comment on column public.productos.oferta_activa is
  'Interruptor a mano. Apagado, el plato no tiene oferta aunque conserve los demás datos.';
comment on column public.productos.oferta_precio_numerico is
  'Precio rebajado. Solo el número: el texto se formatea al pintar. Debe ser menor que precio_numerico; lo exige el servidor, no un check.';
comment on column public.productos.oferta_desde is
  'Primer día en que rige, en la zona horaria del restaurante. Nulo = ya rige.';
comment on column public.productos.oferta_hasta is
  'Último día en que rige, inclusivo, en la zona horaria del restaurante. Nulo = sin fin.';
