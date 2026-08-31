# Pantalla TV — cartelera digital

Documento de diseño. Estado: **fases 1 y 2 construidas** el 29-30/08/2026.

Origen: un cliente con televisor en su local quiere usarlo como cartelera de su
menú. La carta ya tiene las fotos, los nombres y los precios; falta la forma de
enseñarlos en una pantalla grande que nadie toca durante el servicio.

---

## 1. Objetivo

Una página pública que rota entre los productos de un restaurante, pensada para
quedar abierta en el navegador de un televisor. Sin video, sin IA, sin cuotas de
API: son las mismas imágenes que ya sirve la carta.

**El enlace es permanente.** Se configura una vez en el televisor y no se vuelve
a tocar; todo lo demás se cambia desde el panel y aparece solo.

---

## 2. La decisión que manda sobre todas las demás

**El navegador del televisor es el entorno más hostil en el que ha corrido este
sistema, y el único que no se puede depurar.**

Todo el código compartido (`core/`, `temas/`) usa módulos ES y encadenamiento
opcional — `?.` aparece 104 veces. El encadenamiento opcional es de 2020
(Chrome 80, Safari 13.4). Un televisor de 2018 con Tizen 4 o webOS 4 no lo
degrada: lanza un error de sintaxis al leer el archivo y **el módulo entero no
se ejecuta**. La pantalla se queda negra.

Y ahí es donde duele de verdad: en un móvil, un fallo lo ve una persona que
recarga. Aquí lo ve la sala de un restaurante durante todo un servicio, y quien
tendría que arreglarlo está a cientos de kilómetros sin poder abrir una consola.

**Por eso la página del TV NO comparte `core/`.** Es un archivo aparte, escrito
conservador:

- Sin módulos ES: un solo `<script>` clásico.
- Sin `?.`, sin `??`, sin `async/await` — `var`/`function`, `XMLHttpRequest` o
  `fetch` con comprobación previa.
- Sin `grid` con `subgrid`, sin `aspect-ratio`, sin `color-mix()`.
- Objetivo declarado: **cualquier navegador de 2017 en adelante.**

Esto contradice a propósito la regla que rige el resto del repositorio, donde
duplicar código ya nos costó dos incidentes (`esc()` que vivía en un tema y los
demás sin él; `catalogoDe` espejado en dos aplicaciones). La diferencia es que
aquí la duplicación es **pequeña y estable** —escapado de HTML, una petición a
Supabase y el bucle de rotación— mientras que el coste de compartir es que la
funcionalidad no arranque en televisores que sí existen en los locales.

Lo que se duplique lleva un comentario diciendo de dónde viene y por qué no se
importa.

---

## 3. Qué se reutiliza y qué es nuevo

**Se reutiliza tal cual:**

- La lectura pública desde el navegador. Ya hay política RLS de `SELECT`
  público en `restaurantes`, `categorias` y `productos`. **La pantalla lee
  directa de Supabase, sin pasar por el panel** — si el panel se cae, la
  cartelera sigue.
- Las imágenes, que se sirven con `Cache-Control: max-age=1 año, immutable`.
  El televisor descarga cada foto una vez y no vuelve a pedirla.
- El enrutado por slug y los dos modos de URL.

**Es nuevo:** la página, su configuración, dos layouts y cuatro columnas en
`restaurantes` para la promoción.

---

## 4. Coste real para el servidor

Medido el 29/08/2026: **15 MB en 114 fotos, ~135 KB de media.**

| momento | qué pide | a dónde |
|---|---|---|
| Arranque | ~250 KB de página + las fotos (≈8 MB en bonzas, 59 fotos) | el VPS, **una vez** |
| Cada 5 min | 2 peticiones JSON, ~20 KB | **Supabase**, no el VPS |
| Cada rotación de slide | nada | — |

Una pantalla le cuesta al servidor **una descarga y después silencio**. Diez
pantallas son 80 MB repartidos y cero carga sostenida. El cuello de botella no
es el VPS: es la memoria y la GPU del televisor.

---

## 5. Modelo de datos

### 5.1 La configuración va en `restaurantes.atributos.tv`

```json
{
  "tv": {
    "activa": true,
    "orientacion": "horizontal",
    "por_slide": 2,
    "segundos": 8,
    "modo": "categoria",
    "categoria_id": "uuid-de-la-categoria",
    "productos": [],
    "aleatorio": false,
    "animacion": "suave",
    "mostrar_categoria": true,
    "color_categoria": "marca"
  }
}
```

`color_categoria` toma `oscuro` (por defecto), `claro` o `marca`. No es un
color libre: ver 10.quater.

**Por qué en `atributos` y no en una tabla nueva.** Una tabla nueva significa
una política RLS más (superficie pública nueva), endpoints de alta/baja/edición
en `server.js` y su UI. Para una funcionalidad con un cliente esperándola, es
trabajo que no compra nada todavía: hoy hay **una pantalla por restaurante**.

**Cuándo dejará de servir.** El día que un restaurante quiera dos pantallas con
contenido distinto. Ese día `tv` pasa a ser una lista y la URL gana un sufijo
(`/tv/2`); es la misma forma de migración que la de los toppings del 28/08 y
costó lo que cuesta un lector tolerante. No se hace antes porque adivinar cómo
lo van a pedir sale peor que cambiarlo cuando lo pidan.

**`modo` explícito, y no dos campos a la vez.** El documento original proponía
`productos_seleccionados` y `categoria_filtro` conviviendo. Dos fuentes de
verdad para lo mismo es exactamente lo que nos pasó con `atributos` y sus siete
escritores: nadie sabe cuál manda. Con `modo`, el otro campo se ignora sin
ambigüedad.

**Rangos, no números libres.** `segundos` entre 4 y 60 — con 1 la pantalla
parpadea y marea; con 3600 parece congelada. `por_slide` entre 1 y 4.

### 5.2 Cuatro columnas nuevas en `restaurantes`, para la promoción

Hoy la promoción son dos columnas —`promo_activa` y `promo_imagen_url`— y **no
existe ninguna tabla de promociones**. Se añaden:

| columna | para qué |
|---|---|
| `promo_nombre` | texto del slide |
| `promo_precio` | precio del slide |
| `promo_en_tv` | si esta promo entra en la rotación |
| `promo_cada` | cada cuántos slides aparece |

Se guardan **desde ya** al crear una promoción, aunque el popup actual del menú
no los enseñe: el trabajo de pedirlos en el panel se hace una vez, y el día que
el popup quiera mostrarlos ya están.

`promo_cada` cuenta **slides**, no minutos. El documento original ofrecía las
dos unidades; dos unidades en un campo es una fuente segura de errores, y
contar slides es lo que el carrusel ya sabe hacer.

**Ojo:** las cuatro columnas hay que añadirlas a `COLUMNAS_PUBLICAS` en
`core/loader.js`. Esa lista es explícita a propósito —nunca `*`— así que una
columna nueva no se publica sola.

---

## 6. La ruta

`vmenus.co/{slug}/tv` y también `{slug}.vmenus.co/tv`, porque los dos modos de
URL conviven.

`leerSlug()` hoy toma el primer segmento de la ruta e ignora el resto, así que
hay que distinguir los dos casos:

| URL | slug | segmento | es TV |
|---|---|---|---|
| `vmenus.co/bonzas/tv` | `bonzas` (ruta) | `tv` es el 2.º | sí |
| `bonzas.vmenus.co/tv` | `bonzas` (host) | `tv` es el 1.º | sí |
| `vmenus.co/bonzas` | `bonzas` | — | no |

**Sin token en la URL.** El documento original lo dejaba abierto. No aporta:
el contenido —foto, nombre, precio— ya es público en la carta. Y sí añade un
modo de fallo nuevo: el día que alguien regenere la clave, el televisor del
local se queda negro y nadie sabe por qué. El coste supera al beneficio.

---

## 7. Cómo se comporta en marcha

El televisor se enciende al abrir el local y se apaga al cerrar, así que la
página vive **una jornada**, no semanas. Eso simplifica el problema, pero no
lo elimina: un computador conectado por HDMI puede quedarse encendido días.

- **Sondeo cada 5 minutos** de configuración y productos. Si algo cambió, el
  carrusel se reconstruye en la siguiente transición, nunca a media animación.
- **Si la red falla, la pantalla NO se queda en blanco.** Sigue rotando lo
  último que tenía y reintenta en silencio. Lo último bueno se guarda en
  `localStorage`, así que incluso un arranque sin internet pinta algo.
- **Recarga de seguridad** si la página lleva más de 18 horas viva, en la
  siguiente transición. Cubre el caso del PC que nadie apaga sin necesidad de
  programar nada a una hora fija.
- **Sin elementos fijos y brillantes.** Los paneles OLED marcan lo que no se
  mueve. El fondo y las zonas de texto tienen que cambiar entre slides.

---

## 8. Qué se muestra

- Solo productos **disponibles y con foto**. Sin foto no hay slide: es un medio
  visual y un hueco gris se ve peor que un plato menos.
- **Se respetan los horarios de categoría** si el plan los incluye. Un
  restaurante que esconde los desayunos a las 4 de la tarde no querría verlos
  en la pantalla de la sala.
- **Si no queda nada que mostrar** —categoría vacía, fuera de horario, sin
  fotos— se pinta el logo y el nombre del restaurante, nunca una pantalla en
  blanco ni un error.
- La promoción, si está activa y marcada, entra como slide **a pantalla
  completa**, al margen de `por_slide`: esas piezas están diseñadas para verse
  solas.
- Con orden aleatorio, se baraja el ciclo entero y, si el primero del ciclo
  nuevo coincide con el último del anterior, se intercambia. Sin eso, el punto
  de vuelta es donde más se nota la repetición.

---

## 9. Analítica

**La pantalla no cuenta como visita.** `trackVisita()` se dispara al cargar y
hoy solo se excluye a sí misma cuando ve `?preview=`. Un televisor en el local
no es un cliente mirando la carta: contarlo infla las estadísticas del
restaurante y las vuelve inservibles justo para quien las paga.

La página del TV no llama a la analítica en absoluto. Si algún día se quiere
medir el uso de la cartelera, será un tipo de evento aparte.

---

## 10. Fuera de alcance

- Varias pantallas por restaurante con contenido distinto (§5.1).
- Realtime de Supabase en vez de sondeo. Con 5 minutos sobra para una carta.
- Pieza gráfica propia por producto para la pantalla.
- Que el televisor se encienda o apague solo.

---

## 11. Plan por fases

**Fase 1 — Que se vea.** ✅ **Hecha el 29/08/2026.** `vmenus-app/tv.html` y su
bloque en `nginx.conf`. Salieron los dos layouts, no solo el horizontal.
Configuración a mano en `atributos` mientras no exista la pestaña.

Probado en Chromium con datos reales de bonzas: de 1 a 4 platos por slide, el
giro de 90° del modo vertical, la promoción intercalada a pantalla completa, el
corte de red —sigue rotando lo último y lo avisa— y que los slides viejos se
retiran del DOM en vez de acumularse.

30 pruebas en `test/tv.test.js`. La que más vale es el guardián de sintaxis, y
tiene una historia: la primera versión despojaba comentarios y cadenas antes de
mirar, una expresión regular con dos barras seguidas disparaba el borrador de
comentarios de línea, y el 94 % del código desaparecía antes del escaneo — la
prueba pasaba **por vacía**. Se descubrió inyectando encadenamiento opcional a
propósito y viendo que seguía en verde. Ahora escanea el texto en crudo,
comentarios incluidos; el precio es que los comentarios de `tv.html` tampoco
pueden citar la sintaxis prohibida, y sale barato.

**Fase 2 — Que el restaurante lo configure.** ✅ **Hecha el 30/08/2026.**
Pestaña **propia** en el panel, no dentro de Apariencia: es otro servicio, no
una opción de la carta. La usan el restaurante y el superadmin.

- Interruptor de encendido, enlace listo para copiar o abrir.
- Toda la carta / una categoría / platos sueltos, estos con su foto para
  marcarlos. **Solo se ofrecen los disponibles y con foto**: sin foto no hay
  slide, así que ofrecerlos sería una trampa.
- Orientación, platos a la vez, segundos y orden aleatorio.
- Un resumen que dice **cuántos platos se verán y cuánto dura la vuelta**, y
  que avisa en rojo si la selección no mostraría ninguno. Guardar una
  cartelera encendida que no enseña nada está bloqueado: es el caso de «puse
  la tele y solo sale mi logo».
- Con un plato por pantalla avisa de que las fotos son de 800 px y pueden
  verse blandas en televisores grandes.

**La cartelera pasa a ser opt-in.** Antes `/{slug}/tv` funcionaba para
cualquier restaurante, porque la configuración por defecto estaba activa — es
decir, la funcionalidad de pago era gratis para todos. Ahora, sin la clave
`tv` en sus atributos la pantalla queda en reposo con el logo.

**Lo que la cobra es el servidor, no el panel.** `tv` entra en
`ATRIBUTOS_SEGUN_PLAN`, así que un restaurante sin el plan no puede guardar
esa clave ni llamando a la API directamente. Esconder la pestaña es cortesía.
Se enseña igualmente si ya está configurada, para que un cambio de plan no
deje una pantalla encendida sin forma de apagarla.

**En qué planes.** `completo` y `video`, que son los de los dos clientes
reales. Moverlo es una línea en cada una de las tres tablas de planes.

**Fase 3 — Las cuatro columnas de la promoción.** El layout vertical y el slide
de promo ya están; falta que el panel pida `nombre` y `precio` al guardar una
promoción, las columnas en la tabla, añadirlas a `COLUMNAS_PUBLICAS` **y al
`select` de `cargar()` en `tv.html`**.

Ese último punto costó el primer despliegue. Aquí ponía que hasta la fase 3 el
slide de promo no se activaría «porque `promo_en_tv` no existe y la página lo
lee como falso». **Es falso**, y la pantalla lo demostró: las columnas se piden
una por una —nunca con asterisco, igual que en `core/loader.js`—, y pedir una
que no existe en la tabla no devuelve un hueco, devuelve un **400** y se cae la
petición entera. Un campo ausente en la respuesta se lee como falso; uno
ausente en la tabla tumba la consulta.

**Fase 4 — Contra un televisor de verdad.** Es la única fase que importa de
verdad y no se puede simular: llevar el enlace a la pantalla del cliente y
mirar. Ahí se decide si 800 px bastan, si el texto se lee desde las mesas y si
el navegador aguanta un servicio entero.

---

## 10.bis Ajustes tras verlo funcionando (30/08/2026)

Tres cosas que solo se ven con la cartelera puesta y datos de verdad.

**La última pantalla se quedaba coja.** Con 16 hamburguesas de tres en tres, la
sexta enseñaba **una sola y enorme** mientras las cinco anteriores iban llenas:
parece que se rompió algo. Se resuelve corriendo la ventana hacia atrás — la
última pasa a ser los tres últimos platos —, así que se repiten los dos que ya
salieron en la anterior. Repetir dos se nota muchísimo menos que una pantalla a
medias, y es lo que hace cualquier cartelera. Si no hay ni para llenar una sola
pantalla se deja como esté: rellenar duplicando *dentro* del mismo slide sí se
vería roto.

**Animación.** Antes solo había el fundido entre pantallas. Ahora las fotos se
acercan despacio mientras dura el slide y los textos entran desde abajo, con el
precio un pelín después del nombre — que es lo que hace que se lean en ese
orden en vez de todo de golpe. Cada plato arranca con un desfase pequeño: todos
a la vez se lee como un zoom de la pantalla entera; escalonados, como fotos que
respiran.

Solo se animan `transform` y `opacity`, que son las dos propiedades que el
navegador puede pasarle a la GPU. Cualquier otra obliga a repintar cada
fotograma y en un televisor barato eso se ve a tirones. Aun así **hay
interruptor para apagarla**, porque el único que puede juzgarlo es quien tenga
la pantalla delante. De paso, el movimiento ayuda contra el quemado del panel.

**Filtro por categoría al elegir platos a mano.** Con 59 platos, buscar uno a
ojo en una rejilla que se desplaza es incómodo. Los chips filtran lo que se
**ve**, nunca lo que está marcado — cambiar de categoría no puede perderle al
restaurante lo que ya eligió en otra, que es el susto obvio al pulsarlos. Cada
chip lleva su cuenta de marcados y hay un pie con el total, para no perder de
vista los que quedan fuera de la vista. Con una sola categoría no se pinta:
un filtro que no filtra estorba.

## 10.ter Lo que salió de probarlo en un televisor (30/08/2026)

Con la cartelera en una pantalla de verdad, cambiando de categoría y de vista.
Las fotos aguantan bien con 3 y 4 platos; **con 2 se empieza a notar** el
límite de los 800 px, y con 1 más. Queda pendiente decidir qué hacer con eso.

**El nombre de la categoría, opcional.** Hay platos cuyo nombre no dice qué
son —«Pepito», «La Descarada»— y en una pantalla, sin nadie a quien
preguntar, eso se pierde. Ahora puede salir una etiqueta pequeña en la esquina
de la foto, con su fondo para que se lea sobre cualquier imagen. Apagada por
defecto: para el restaurante cuyos platos ya se entienden solos, es ruido.

**Marcar toda una categoría de una vez.** Con diez hamburguesas, marcarlas una
a una es trabajo tonto. Un solo botón que cambia de sentido —si ya están todas,
ofrece quitarlas— en vez de dos que obligan a mirar cuál toca.

**Menos platos que huecos: no es un fallo.** Una categoría de dos platos con la
vista puesta en cuatro no se rompe; flexbox reparte y salen dos grandes que
llenan la pantalla, que además se ve mejor que dos pequeños con huecos.
Comprobado en el navegador. Pero elegir «4 a la vez» y ver dos descoloca, así
que el panel lo dice antes de guardar.

**Ciclos muy cortos.** Con una o dos pantallas el bucle se nota mucho. El panel
sugiere encender el orden aleatorio: no añade platos, pero cambia las parejas
en cada vuelta y disimula la repetición. Solo lo sugiere si está apagado —
sugerir algo que ya está puesto hace dudar de si de verdad lo está.

## 10.quater La etiqueta de categoría, legible y con color (30/08/2026)

Tres retoques a la etiqueta que estrenó 10.ter, todos salidos de mirarla puesta.

**Se leía pequeña.** Iba proporcional al nombre del plato (×0,42) y con cuatro
platos bajaba a 1 vmin — unos 11 px en un televisor de 1080. Ahora va a ×0,58
**con un suelo de 1,9 vmin**: por debajo de eso deja de leerse desde la mesa del
fondo, y una etiqueta que no se lee es solo un borrón encima de la foto. El
suelo es lo que importa; el multiplicador solo decide cuándo se supera. De paso
el relleno pasó de `vmin` fijo a `em`, para que la caja crezca con la letra en
vez de quedarse estrecha.

**Se la comía el logo del negocio.** El logo se dibuja **encima** de la primera
foto y la etiqueta vivía siempre en el mismo rincón de esa misma foto: con el
logo a la izquierda, uno tapaba al otro. Como el logo cambia de esquina en cada
pantalla —contra el quemado del panel—, esto no se podía arreglar fijando un
lado. Ahora la etiqueta se va **a la esquina contraria del logo**, y se recalcula
en cada slide.

Van **todas** del mismo lado, no solo la del plato que estorba: mover una sola
deja una etiqueta descolocada y se lee como un fallo; moverlas todas se lee como
un espejo. Efecto secundario útil: las etiquetas también son cajas quietas de
alto contraste, así que ahora ellas tampoco se quedan meses en el mismo píxel.

El detalle que hay que cuidar al tocar `avanzar()`: **el lado se decide antes de
pintar**. Si el volteo de `marcaDerecha` vuelve al final de la función, las
etiquetas se pintan con el lado de la pantalla *anterior* y aterrizan justo
encima del logo. Hay una prueba que lo comprueba sobre el propio código fuente.

**Color.** Tres presets, no un selector libre: un selector libre deja elegir
gris sobre gris, y esto acaba colgado en una pared donde nadie va a volver a
mirarlo.

| valor | qué es | cuándo |
|---|---|---|
| `oscuro` | negro translúcido, texto claro *(por defecto)* | se lee sobre cualquier foto |
| `claro` | blanco translúcido, texto oscuro | fotos oscuras, carta luminosa |
| `marca` | el `color_primario` del restaurante | que la cartelera y la carta se parezcan |

`marca` **reutiliza el color que el restaurante ya guardó** para su menú
(`restaurantes.color_primario`) en vez de pedirle que configure el color otra
vez. Eso obligó a añadir esa columna al `select` de `tv.html` — con lo que costó
la última vez que faltó una columna, ver 11.bis, esta vez se comprobó primero
contra `information_schema` que existe de verdad.

El texto encima **no puede ser fijo**. Los nueve restaurantes van de `#ffd521`
(amarillo) a `#0a4380` (azul marino); con blanco fijo la mitad no se lee y con
negro fijo la otra mitad tampoco. Se calcula por brillo percibido
—`(r·299 + g·587 + b·114)/1000`, que pesa el verde seis veces más que el azul—
y por encima de 145 va texto oscuro. Comprobado contra los nueve colores reales.

Tres restaurantes tienen la columna vacía. Ahí no se inventa un color: se vuelve
al oscuro, **y el panel lo dice** en vez de enseñar una muestra bonita que no es
lo que va a salir en la pared.

**El espejo que hay que vigilar.** La muestra del panel repite a mano la paleta
y el cálculo de contraste de `tv.html`. No hay forma de que una prueba compare
las dos: están en repositorios distintos y `tv.html` no puede importar nada
—corre en televisores de 2018, sin módulos ES. Es la misma clase de duplicado
que `PLANES`. Si se desincronizan, el restaurante ve un color en el panel y otro
en la pantalla.

## 11.bis Lo que enseñó el primer despliegue (29/08/2026)

La pantalla salió con el aviso de **«sin conexión»** y la red perfectamente.

- **El fallo:** el `select` pedía cuatro columnas de la fase 3. PostgREST
  contestó 400 y la página lo trató como caída de red.
- **Lo que costó el rato no fue el fallo, fue el aviso.** Decir «sin conexión»
  cuando el servidor contestó manda a buscar la avería al sitio equivocado.
  Ahora se distingue: `status` 0 es no llegar —red, DNS, CORS—; cualquier otro
  número es el servidor diciendo que no, y sale como «error 400» con el detalle
  completo en la consola del navegador. En un televisor no se puede abrir una
  consola, pero en el móvil desde el que se prueba el enlace la primera vez sí,
  y es justo entonces cuando hace falta.
- **Por qué no lo cazaron las pruebas:** el banco de pruebas aceptaba cualquier
  columna. Ahora imita a PostgREST y devuelve 400 con código 42703 ante una
  desconocida. La lección general es que un simulador más permisivo que el
  sistema real no prueba nada — solo da confianza.

## 12. Preguntas abiertas

- ~~¿En qué planes entra?~~ **Decidido:** capacidad `tv` en `completo` y
  `video`. Sigue pendiente la revisión de los planes en general: los nombres no
  dicen lo que incluyen y el de video se añadió después de constituirlos.
- **Panel de capacidades por restaurante para el superadmin.** Hoy se editan a
  mano en `atributos`. Anotado, no urgente.
- **¿800 px bastan?** Probado en televisor el 30/08/2026: **con 3 y 4 se ven
  bien; con 2 se nota y con 1 más.** Falta decidir qué hacer — subir el límite
  para las fotos nuevas es fácil, volver a subir las 119 que ya hay no lo es.
- **Tres restaurantes sin plan** (perroscriollos, sanjavier, aojocerrado) caen
  por defecto en `pedidos` y reciben QR, estadísticas y horarios sin que nadie
  lo haya decidido.
