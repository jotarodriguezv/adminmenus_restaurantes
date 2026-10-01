# Ofertas de precio

Estado: **hecha el 01/10/2026** en los tres sitios: la base (`sql/35`), este
repositorio (servidor y panel) y `vmenus-app` (carta, carrito y cartelera, PR 86).

Un plato que ya está en la carta puede tener, por un tiempo limitado o
indefinido, un precio menor. La carta enseña el de siempre tachado y el nuevo al
lado: ~~$ 50.000~~ $ 40.000.

## No es la «promoción»

Se confunden fácil y no tienen nada que ver. La **promoción**
(`docs/promociones.md`) es una imagen que sale al abrir la carta o en la
cartelera, y no toca ningún precio. La **oferta** baja el precio de un plato. Por
eso todo lo de esta función se llama `oferta`, nunca `promo`: en la landing,
«Activar promoción» junto al precio era una maqueta de esto, y se retitula
«Activar oferta» cuando la carta la pinte.

## Qué se guarda (`sql/35`)

Cuatro columnas en `productos`:

| columna | qué es |
|---|---|
| `oferta_activa` | el interruptor, a mano. Apagado = sin oferta aunque conserve los datos |
| `oferta_precio_numerico` | el precio rebajado, **solo el número** |
| `oferta_desde` | primer día en que rige (`date`), nulo = ya rige |
| `oferta_hasta` | último día, **inclusivo**, nulo = sin fin |

- **Solo el número, no el par precio/precio_numerico.** Ese par ya costó un fallo
  —la carta mostraba un precio y el carrito cobraba otro—, y repetirlo para la
  oferta sería otra pareja que puede discrepar. El texto se formatea al pintar.
- **Fechas `date`, no instantes**, leídas en la zona horaria del restaurante:
  «hasta el 24 de diciembre» quiere decir que el 24 todavía rige.
- **No hay `check` entre la oferta y el precio normal.** Si lo hubiera, bajar
  después el precio normal por debajo de la oferta haría fallar ese guardado con
  un error que no habla de ofertas.

## Qué acepta el servidor

`normalizarOferta()` en `precios.js`, llamada desde `POST` y `PATCH
/api/productos`, para los dos roles:

- Encendida, **tiene que traer precio, y menor que el precio normal**. «Normal»
  es el que llega en el mismo guardado, o si no el ya guardado: se puede subir el
  precio y poner la oferta a la vez.
- **Apagada se deja pasar** aunque ya no sea menor. Quien bajó el precio normal
  después no puede quedar bloqueado en un guardado que no habla de ofertas.
- Las fechas tienen que existir (`2026-02-31` no) y estar en orden. Si llega solo
  una, se compara con la guardada.
- `oferta_activa` se coacciona a booleano: el texto «false» es verdadero para
  cualquier `if`.
- Un PATCH que no menciona la oferta no la toca.

## Cómo se decide que rige hoy

Cuatro estados, que son lo que cuenta el panel:

| estado | cuándo |
|---|---|
| `sin` | no hay, está apagada, no tiene precio o **no es menor que el normal** |
| `programada` | encendida y `hoy < oferta_desde` |
| `vigente` | rige ahora |
| `terminada` | encendida y `hoy > oferta_hasta` |

Una oferta que no es menor que el normal **se ignora**: ante la duda, se enseña
el precio de siempre.

**La regla vive en tres sitios**: el espejo del panel (`public/oferta.js`), la
carta (`core/ofertas.js`) y la cartelera (`tv.html`, en el dialecto viejo de los
televisores), estas dos en `vmenus-app`. `test/casos-oferta.json` es el juego de
casos y **va duplicado a propósito en los dos repositorios**; es lo único que
impide que se separen, como con `casos-programacion.json`. Se evalúa al pintar,
contra el reloj y nunca guardada ya resuelta.

## El panel

- **La ficha del plato**, pestaña General, bajo el precio: «Poner en oferta», y
  al encenderlo, el precio, el porcentaje, y las fechas opcionales.
- **Porcentaje y precio son la misma cosa dicha de dos maneras.** Se escribe uno
  y el otro se calcula; lo que viaja al servidor es el precio. Un porcentaje se
  **redondea a la centena** ($ 21.165 no es un precio de carta); como el campo
  del precio queda a la vista, se ajusta a mano.
- Sin fechas la ficha dice «la oferta rige hasta que la apagues».
- **La lista de Productos** enseña el precio de siempre tachado y el nuevo, y
  una marca: «En oferta · hasta el 24 dic», «Oferta desde el…» o, en el color de
  aviso, **«Oferta terminada el…»**. Esa última es el motivo de la marca: una
  oferta con fecha de fin muere sola, nadie decide nada, y el precio vuelve a
  subir sin que el restaurante se entere.

## Lo que no se hizo

- **V-POS no se toca.** Es otro proyecto, y por ahora cobra el precio normal.
  Cuando se trabaje allí, es allí donde se decide.
- **Días y horas** (un dos por uno los martes, un happy hour). Es lo natural
  después y puede reusar la forma de `horarios.js`; la primera versión es solo
  fechas.
- **Una oferta por plato**, no varias.
- **El importador de cartas** no crea ofertas: importa platos a su precio normal.
- **«Imprimir carta» sigue imprimiendo el precio normal, a propósito.** Un papel
  no sabe cuándo termina la oferta: impresa con un descuento, seguiría
  enseñándolo semanas después de que la carta digital lo hubiera quitado.
## La carta, el carrito y la cartelera (`vmenus-app`)

- **La carta** enseña el precio de siempre tachado y el nuevo al lado, en los
  cinco modelos y en la ficha del plato. Todo pasa por `htmlPrecio()`
  (`core/html.js`): una sola regla, no una por plantilla. «Gratis» manda sobre la
  oferta.
- **El carrito cobra el precio de oferta** (`precioVigente()`), también en el
  total de un plato personalizado. Si una línea guardada ve empezar o terminar su
  oferta, la revalidación la reprecia con el aviso de siempre.
- **La cartelera** aplica la regla en ES5 y **se reconstruye también cuando solo
  cambia el reloj**: al acabar el último día de una oferta no cambia ningún dato,
  así que el sondeo compara además qué ofertas rigen ahora (`firmaDeOfertas()`).
  Sin eso la pantalla seguiría enseñando una oferta terminada hasta la próxima
  recarga.
- La zona horaria es la del restaurante: lo fija `setRestaurante()` al cargar.
  Un turista con el móvil en otro huso no ve una oferta terminada ni futura.

## Qué falta

- La landing (`vmenus-landing`) todavía dice «Activar promoción» en la maqueta
  del editor; con la función ya real, debería decir «Activar oferta».
- V-POS, por decisión: otro proyecto, cobra el precio normal por ahora.
