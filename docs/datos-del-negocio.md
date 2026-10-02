# Datos del negocio

Estado: **paso 1 hecho el 02/10/2026** (el WhatsApp). Pasos 2 a 5 por hacer.

Hasta ahora cada función de la carta pedía su propio dato: el carrito, su
WhatsApp; la bienvenida, la dirección, el mapa y las reseñas; las redes, su
tarjeta. Lo mismo escrito en dos sitios, y un restaurante que no activa la
bienvenida nunca guardaba su dirección. La idea, pedida por el usuario y su
equipo el 01/10/2026: **decirlo una vez**, en un solo sitio, y que cada función
lo tome de ahí.

## Dónde vive

**Ajustes → «Datos del negocio»**, la primera tarjeta. Es del restaurante: lo
edita él. El **nombre y el slug siguen siendo solo del superadmin** (decisión del
15/09/2026, `CLAUDE.md`, «Abrir partes de Apariencia al restaurante»), así que
si la tarjeta los enseña es solo para leer.

## Qué entra y en qué orden

| Paso | Qué | Estado |
|---|---|---|
| **1** | **El WhatsApp único**, con su interruptor «Mostrar el botón en la carta» | **Hecho 02/10/2026** |
| 2 | Dirección, ubicación (mapa) y enlace de reseñas de Google | por hacer |
| 3 | Las redes sociales (mover su tarjeta dentro de esta; solo pantalla, no datos) | por hacer |
| 4 | **Horario de atención** (estructurado) y **correo** | por hacer |
| 5 | Aviso de «datos completos» en Inicio (opcional) | por hacer |

**No entra el teléfono fijo**: casi nadie lo usa, decidido por el usuario.

## Paso 1: un solo WhatsApp

Había dos campos para el mismo número: `whatsapp_pedidos` (la tarjeta del
carrito) y `social_whatsapp` (la barra de redes y la bienvenida). Cuatro
restaurantes los tenían repetidos con el mismo valor y tres, uno solo.

**Un número, sin poder poner otro distinto para los pedidos** (decidido el
01/10/2026: no se ve la necesidad de dos).

| clave | qué es |
|---|---|
| `whatsapp_negocio` | el número, solo dígitos con código de país |
| `whatsapp_boton` | si la carta enseña el botón de WhatsApp |

### El botón se decide aparte del número

Antes el botón de la barra de redes y de la bienvenida salía **si
`social_whatsapp` tenía número**. Con un número único, quien lo puso solo para
recibir pedidos habría visto aparecer, de golpe, un botón que nunca pidió. Por
eso `whatsapp_boton` es un interruptor propio: el número sirve para pedir aunque
la carta no enseñe ningún botón.

### Las claves viejas se siguen leyendo, pero solo si la nueva NO EXISTE

`whatsapp_pedidos` y `social_whatsapp` **no se borran todavía**: una carta o un
panel con la página vieja en el navegador las usan. La cadena es:

1. si `whatsapp_negocio` **existe** (aunque sea `''`), manda ella;
2. si no, `whatsapp_pedidos`, y si no, `social_whatsapp`.

El detalle que importa: **`''` es «no hay número», no «no está»**. Si el
restaurante borra su número y la carta se pusiera a mirar la clave vieja,
**resucitaría un número que se quitó a propósito**. Hay un caso de prueba para
eso.

El botón sigue la misma lógica: sin `whatsapp_boton`, sale si había número en
`social_whatsapp`, como antes.

### La regla vive en cuatro sitios

El servidor (`negocio.js`), el panel (`public/negocio.js`) y la carta
(`vmenus-app/core/negocio.js`) —tres copias que no pueden compartir módulo—, más
la comprobación del endpoint público de pedidos, que usa la del servidor.
`test/casos-negocio.json` es el juego de casos y **va duplicado a propósito en
los dos repositorios**: si se separan, el panel dice que la carta recibe pedidos
y la carta rechaza el de un cliente.

### Qué cambia para el restaurante

- Ajustes: la primera tarjeta es «Datos del negocio», con el WhatsApp y el
  interruptor del botón.
- La tarjeta del **carrito** ya no pide el número: dice a cuál llegan los pedidos
  y lleva a donde se cambia.
- La tarjeta de **redes** ya no lleva WhatsApp.
- El servidor valida el número igual que antes: de 8 a 15 dígitos, solo dígitos.
  Vacío es válido (es como se quita).

### La migración (`sql/36`) — aplicada el 02/10/2026

Copia lo que ya había a las claves nuevas, **sin que ninguna carta cambie de
aspecto**: `whatsapp_boton` queda verdadero solo donde la barra de redes ya
tenía número. No borra las claves viejas ni toca a quien no tenía número.
Es idempotente.

**Orden de despliegue: la migración, después la carta y por último el panel.**
Con el panel primero, un restaurante cambiaría su número y la carta vieja
seguiría usando el anterior.

### Cuando se retiren las claves viejas

En una migración posterior, cuando nada las lea: `whatsapp_pedidos` y
`social_whatsapp` de `atributos`, las lecturas de respaldo de las tres copias y
las dos claves de `ATRIBUTOS_CLIENTE_PERMITIDOS`.

## Pasos que vienen

- **Dirección, mapa y reseñas (paso 2).** Hoy `direccion`, `intro_mapa_url` e
  `intro_resena_url` se escriben en el formulario de la bienvenida. La tarjeta
  pasará a ser su dueña y la bienvenida **tomará de ahí** por defecto, con la
  misma regla de respaldo que el WhatsApp.
- **Horario de atención (paso 4): estructurado**, decidido el 02/10/2026: una
  fila por día de la semana (lunes, martes…) con sus horas, como los horarios del
  panel de la televisión y de las promociones. Se reusa la forma de
  `core/horarios.js`, no se inventa una segunda: dos formas de un horario es el
  error caro de este proyecto (`docs/promociones.md` §5.2).
- **Dónde se muestran el horario y el correo**: **una línea de horario y una
  línea de enlace de correo en la pantalla de bienvenida**, decidido el
  02/10/2026.
