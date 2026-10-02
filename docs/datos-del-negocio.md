# Datos del negocio

Estado: **pasos 1 a 3 hechos el 02/10/2026** (el WhatsApp; la dirección, la ubicación
y las reseñas; las redes sociales). Pasos 4 y 5 por hacer.

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
| **2** | **Dirección, ubicación (mapa) y enlace de reseñas de Google** | **Hecho 02/10/2026** |
| **3** | **Las redes sociales** (su tarjeta pasa a ser un bloque de esta; solo pantalla, no datos) | **Hecho 02/10/2026** |
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

## Paso 2: dirección, ubicación y reseñas

Se pedían dentro del formulario de la bienvenida, así que un restaurante que no
la activa nunca guardaba su dirección. Ahora son del negocio, en la misma
tarjeta del WhatsApp, y **la bienvenida los toma de ahí**.

| dato | clave | nota |
|---|---|---|
| Dirección | `direccion` | **No cambia de nombre**: ya era la clave y solo la usaba la bienvenida |
| Ubicación | `mapa_url` | antes `intro_mapa_url` |
| Reseñas de Google | `resena_url` | antes `intro_resena_url` |

El mapa y las reseñas tienen clave nueva porque las de antes llevaban el prefijo
de la pantalla que las pedía y ya no son de ella.

### Qué se queda en la bienvenida y qué se va

- **Se queda**: los interruptores (`intro_mapa_activo`, `intro_resena_activo`) y
  todo el estilo (modo del mapa, colores y fuente del botón, texto del botón de
  reseñas). Son de CÓMO se ve la bienvenida.
- **Se va**: los tres campos de texto. El formulario dice cuál es cada dato y
  lleva a donde se cambia («Cambiarlo en Datos del negocio»).
- **La bienvenida ya no los guarda.** Si los dos formularios escribieran
  `direccion`, el último en guardar pisaría al otro. Una prueba lo vigila, y
  otra comprueba que «Restaurar valores predeterminados» no puede vaciarlos.
- La vista previa de la bienvenida lee lo **guardado** del negocio, no lo que
  está a medio teclear en Ajustes.

### Las claves viejas, igual que el WhatsApp

`intro_mapa_url` e `intro_resena_url` se leen **solo si la nueva no existe**, y
`''` es «no hay enlace»: si el restaurante borra el suyo, el viejo no resucita.
El servidor sigue aceptando los nombres viejos mientras haya paneles con la
página vieja. La regla es la de `public/negocio.js` y `vmenus-app/core/negocio.js`,
y las dos corren contra la lista `enlaces` de `test/casos-negocio.json`
(**duplicado en los dos repositorios**).

**No hizo falta migración SQL**: como las viejas se siguen leyendo, el único
restaurante con enlace de mapa (`la-leydi`) sigue igual y pasa a la clave nueva
solo la primera vez que guarde Ajustes. Antes de **retirar** las claves viejas
sí hará falta copiarlas.

### El servidor

`mapa_url` y `resena_url` se validan como antes en la bienvenida: **solo https y
solo dominios de Google**, porque es lo que se le pone en la mano a un
desconocido. La dirección se recorta a 120 caracteres.

### Un fallo que salió de aquí: la carta no miraba el interruptor del mapa

`core/intro.js` enseñaba la ubicación **si había enlace**, sin mirar
`intro_mapa_activo`. No se notaba porque el enlace solo se escribía dentro de la
bienvenida, junto a su interruptor. Con el enlace en Ajustes, quien lo rellenara
habría visto aparecer un mapa que nunca encendió. Ahora la ubicación sale solo
con el interruptor **encendido** y con enlace, como ya enseña la vista previa del
panel. En producción solo `la-leydi` tiene enlace y lo tiene encendido: no cambia
nada para nadie.

## Paso 3: las redes sociales, dentro de la tarjeta

Eran una tarjeta aparte al final de Ajustes. Son datos del negocio como el
WhatsApp o la dirección, así que pasan a ser **un bloque dentro de «Datos del
negocio»**, debajo de las reseñas: el interruptor de la barra, y los enlaces de
Instagram, Facebook y TikTok.

**Es solo pantalla.** Los ids (`ajSocialBar`, `ajSocialInstagram`…), las claves
(`social_bar`, `social_instagram`, `social_facebook`, `social_tiktok`), lo que se
recoge y lo que valida el servidor **no cambian**: no hay migración ni cambio en
la carta. Una prueba comprueba que el bloque está dentro de la tarjeta y que ya no
queda una tarjeta propia.

El WhatsApp sigue sin ser una red más: tiene su interruptor aparte, arriba, y la
barra lo enseña si está encendido (`whatsapp_boton`). El texto del bloque lo dice.

## Pasos que vienen

- **Horario de atención (paso 4): estructurado**, decidido el 02/10/2026: una
  fila por día de la semana (lunes, martes…) con sus horas, como los horarios del
  panel de la televisión y de las promociones. Se reusa la forma de
  `core/horarios.js`, no se inventa una segunda: dos formas de un horario es el
  error caro de este proyecto (`docs/promociones.md` §5.2).
- **Dónde se muestran el horario y el correo**: **una línea de horario y una
  línea de enlace de correo en la pantalla de bienvenida**, decidido el
  02/10/2026.
