# Presentaciones de un plato

Estado: **primera fase hecha el 06/10/2026** en este repositorio (servidor y ficha) y en
`vmenus-app` (carta, carrito y cartelera). **Sin migración**: viven en `atributos`.

Un mismo plato puede venir en versiones: fresas con crema **1X $12.000 / 2X $20.000**, un
hojaldre sencillo o doble, un jugo de 500 ml o de 750 ml. Siguen siendo **UN plato** —su foto,
su descripción, su categoría— con una lista de presentaciones, cada una con su nombre y su
precio. La alternativa era crear un plato por versión, que repite foto y descripción y ensucia la
carta; se descartó (decisión del 06/10/2026, a raíz de Enchulados).

## Qué se guarda

`productos.atributos.presentaciones = [{ id, nombre, precio_numerico }]`.

- **Dos o más, o ninguna.** Una sola no es una presentación (no hay nada que elegir): el servidor
  la rechaza y la carta la ignora.
- Hasta **8**; nombre de hasta **40** letras y sin repetirse (sin distinguir mayúsculas).
- El `id` es **estable**: una línea del carrito guarda cuál presentación era y tiene que
  encontrarla aunque el restaurante la renombre o la reordene. Lo pone el servidor; uno que
  mande el navegador solo se respeta si el plato ya lo tenía.
- **El precio del plato** (`precio_numerico` y `precio`) pasa a ser el de la **más barata**, y lo
  sincroniza el servidor al guardar. Así el orden por precio, la cartelera y las estadísticas
  siguen funcionando sin saber que existen. El precio que mande el navegador se ignora.

## Qué valida el servidor

`normalizarPresentaciones` en `precios.js`; se aplica con `aplicarPresentaciones` en `server.js`.

- `POST /api/productos`: valida, pone ids, sincroniza el precio y apaga la oferta.
- `PATCH /api/productos/:id`: con `atributos.presentaciones` reemplaza (lista vacía = quitarlas);
  **si el guardado no trae la clave, las conserva** —un panel viejo abierto en otra pestaña no
  puede borrarlas guardando otra cosa—, y un guardado parcial de precio no pisa el precio
  derivado.
- `PUT /api/productos-sedes`: un precio para un plato con presentaciones se rechaza (400). «No
  se sirve aquí» sí se admite.

## En la ficha

`public/presentaciones.js`. El interruptor **«Viene en varias presentaciones»** muestra las
filas (nombre + precio, máximo 8) y una línea con lo que leerán los clientes. Mientras está
encendido el precio de arriba se ve pero no se toca (es «Desde»), y **«Es gratis» y la oferta se
esconden**. Al encenderlo, el precio que el plato ya tenía pasa a ser la primera presentación.
En la lista de platos, el precio sale como «Desde $ X · N presentaciones».

## En la carta (vmenus-app)

`core/presentaciones.js`: la tarjeta dice «1X $ 12.000 · 2X $ 20.000» (hasta tres; con más,
«Desde $ X»); el botón «+» abre el modal con un selector de presentación, y cada una es una
**línea distinta del carrito** («Plato · 2X»). Al revalidar el carrito se recalcula contra la
presentación de hoy, y si ya no existe la línea se retira. `tv.html` tiene su copia en dialecto
viejo; las dos corren contra `test/casos-presentaciones.json`.

## Lo que todavía no distingue presentaciones (fase 2)

1. **Precio por sede.** Un plato con presentaciones conserva las suyas en todas las sedes; la
   tabla de la pestaña Sedes lo muestra deshabilitado («Tiene presentaciones»).
2. **Oferta de precio.** No distingue cuál presentación rebaja: se apaga al guardar y se esconde.
3. **El importador** (PDF/foto de la carta) no sabe sacar presentaciones.
4. **Una foto por plato**, a propósito: la presentación no tiene imagen propia.
