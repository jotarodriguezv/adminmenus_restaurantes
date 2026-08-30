# Pantalla TV — cartelera digital

Documento de diseño. Estado: **fase 1 construida** el 29/08/2026, sin desplegar.

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
    "aleatorio": false
  }
}
```

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

**Fase 2 — Que el restaurante lo configure.** Pestaña en el panel: activar,
elegir productos o categoría, orientación, cuántos por slide, segundos.

**Fase 3 — Las cuatro columnas de la promoción.** El layout vertical y el slide
de promo ya están; falta que el panel pida `nombre` y `precio` al guardar una
promoción, las columnas en la tabla y añadirlas a `COLUMNAS_PUBLICAS`. Hasta
entonces el slide de promo no se activa, porque `promo_en_tv` no existe todavía
y la página lo lee como falso.

**Fase 4 — Contra un televisor de verdad.** Es la única fase que importa de
verdad y no se puede simular: llevar el enlace a la pantalla del cliente y
mirar. Ahí se decide si 800 px bastan, si el texto se lee desde las mesas y si
el navegador aguanta un servicio entero.

---

## 12. Preguntas abiertas

- **¿En qué planes entra?** Va como capacidad (`tv`), no como plan nuevo. Falta
  decidir en cuáles se enciende. Pendiente también la revisión de los planes:
  los nombres no dicen lo que incluyen y el de video se añadió después.
- **Panel de capacidades por restaurante para el superadmin.** Hoy se editan a
  mano en `atributos`. Anotado, no urgente.
- **¿800 px bastan?** No se sabe hasta la fase 4. Con 2 o más por slide casi
  seguro que sí; con uno solo a pantalla completa, probablemente no.
- **Tres restaurantes sin plan** (perroscriollos, sanjavier, aojocerrado) caen
  por defecto en `pedidos` y reciben QR, estadísticas y horarios sin que nadie
  lo haya decidido.
