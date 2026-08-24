# Cartas en video — análisis técnico y decisiones

**Estado:** en producción, en dos encuadres. `voro` con el modelo horizontal y
`indigo` con el vertical, este último con tres estilos. Cola, panel, respaldo y
vista previa al compartir funcionando de punta a punta.
Los parámetros vigentes están en la **sección 6**; los de la sección 4 son las
mediciones del análisis inicial y varios ya no se usan — ver sección 5.
**Última revisión de este documento:** 24 de agosto de 2026
**Fecha del análisis:** agosto de 2026
**Servidor de las pruebas:** Hostinger KVM 1 · 1 vCPU · Ubuntu 24.04.4 · ffmpeg 6.1.1

Este documento recoge cómo se llegó a los parámetros de codificación del producto de
cartas en video: qué se midió, en qué máquina, y qué se decidió a partir de ahí.

Cada cifra va marcada como **medida** (sale de una ejecución real) o **estimada**
(se dedujo de otras). Durante el análisis varias estimaciones resultaron erradas al
contrastarlas, así que la distinción importa.

---

## 1. Objetivo

Ofrecer cartas digitales donde cada plato se muestra en video corto, además de las
cartas de fotos que ya existen. Una sola infraestructura para las dos cosas.

La pregunta que había que responder antes de escribir nada:

> ¿Dónde se guardan los videos, y qué cuesta procesarlos en el servidor que tenemos?

---

## 2. Qué hace la competencia (GastroVisual)

Se analizó `app.gastrovisual.com/olivosdali` desde las herramientas de desarrollo
del navegador. Todo lo de esta sección es **medido**.

### 2.1 Dónde viven sus archivos

| Contenido | Ubicación |
|---|---|
| Imágenes de producto | Supabase Storage — un bucket por restaurante, nombrado con un UUID, carpeta `IMG/` |
| Armazón de la app y JS | Service Worker (`/sw.js`), Cache API |
| **Videos** | **IndexedDB del navegador, como Blobs** |

Las tres cachés del Service Worker no contienen ni un video:

```
gastrovisual-v7          →  2 entradas  (/, offline.html)
gastrovisual-images-v7   →  3 entradas  (favicon, marco de iPhone, bandera)
gastrovisual-runtime-v7  → 55 entradas  (chunks de Next.js)
```

Y el desglose de almacenamiento lo confirma:

```js
navigator.storage.estimate() →
  { caches: 5.082.624, indexedDB: 25.084.021, serviceWorkerRegistrations: 5.342 }
```

Los 25 MB de IndexedDB son los videos. El JavaScript de la página los descarga,
los guarda ahí, y le pasa al `<video>` una URL `blob:` — que no apunta a ningún
servidor, sino a memoria del propio navegador.

**Consecuencia práctica:** sus videos no vuelven a descargarse nunca en un
dispositivo que ya visitó la carta. El coste de ancho de banda es por dispositivo
nuevo, no por visita.

### 2.2 Sus videos

De 26 elementos `<video>` en la página, 24 tenían datos cargados:

| Resolución | Cantidad |
|---|---|
| 1280×720 (horizontal) | 20 |
| 1280×1280 (cuadrado) | 2 |
| 1080×1080 (cuadrado) | 1 |
| 1280×959 | 1 |
| 1280×1598 (vertical) | 1 |

Duraciones entre 5 s y 15,6 s; **190 s en total** entre los 24.

```
25.084.021 bytes × 8 ÷ 190 s  ≈  1,06 Mbps
25.084.021 bytes ÷ 24         ≈  1,0 MB por video
```

**Ese 1,06 Mbps es el listón que había que igualar.** No es un códec exótico: es
H.264 bien apretado.

### 2.3 Lo que sí vale la pena copiar

- **Carga perezosa por visibilidad.** Usan `IntersectionObserver` para pedir y
  reproducir cada video según entra en pantalla. Nunca cargan la carta entera de golpe.
- **Guardado en el dispositivo.** Para video tiene sentido; el coste se paga una vez.
- **Manifiesto PWA por restaurante** (`/api/manifest/<slug>/`), con nombre e icono
  del local. Permite añadir la carta a la pantalla de inicio.
- **Etiquetas Open Graph** con imagen 1200×630. Al compartir por WhatsApp sale con
  foto y nombre. *(Hecho el 23/08/2026, aunque por otro camino: ellos las pueden
  poner en su HTML porque lo genera el servidor; nuestras cartas se pintan en el
  navegador, así que hacen falta un endpoint aparte y que nginx mande ahí a los
  robots. Ver la sección de pendientes.)*

### 2.4 Lo que no

- **El `<body>` entrega `<div>Cargando...</div>` y nada más.** Toda la carta se pinta
  en el navegador tras descargar ~20 archivos de JavaScript. Google ve "Cargando…".
  Las cartas de VMenus son HTML plano y ganan en esto.
- **Service Worker para las cartas de fotos.** Riesgo de servir precios viejos si la
  invalidación falla. Con `Cache-Control: max-age=1y, immutable` sobre nombres de
  archivo únicos —que ya está puesto— se logra casi lo mismo sin ese riesgo.
- **Barra libre de proporciones.** Seis relaciones de aspecto distintas en una misma
  carta. Es el resultado de aceptar lo que sube el restaurante sin normalizarlo.
- **Un bug suyo, para no repetirlo:** `AbortError: The play() request was interrupted
  by a call to pause()`. El `IntersectionObserver` llama a `pause()` antes de que
  resuelva el `play()` anterior. Se evita envolviendo el `play()` en `.catch(() => {})`
  y comprobando visibilidad antes de invocarlo.

---

## 3. El servidor

**Medido**, en la máquina de producción actual:

```
nproc     1
Mem       3,8 GiB total · 2,6 usados · 1,2 disponibles     (65 %)
Swap      2,0 GiB total · 652 MiB usados                   (ya tira de swap)
Disco     48 GB · 26 usados · 22 libres                    (55 %)
Volumen   bind mount  /opt/menus/uploads → /app/uploads    (persiste entre despliegues)
```

**El cuello de botella es el vCPU, no la RAM ni el ancho de banda** (hay 4 TB/mes
contratados y las proyecciones no llegan al 5 %). Dicho eso, la máquina ya usa swap,
así que el salto a 8 GiB del plan siguiente tampoco sobra.

---

## 4. Comparativa de codificación

### Archivo de origen (medido)

```
prueba.mp4    2160×3840 (4K vertical, 9:16)   6,85 s   30 fps
              H.264 Main · 29.404 kb/s
              AAC 191 kb/s estéreo
              25.291.037 bytes  (24,1 MiB)
```

### Resultados (todos medidos, salida de 6,73 s)

| Variante | Parámetros | Peso | Bitrate | Tiempo |
|---|---|---|---|---|
| Base | `-b:v 1000k` · `preset medium` | 771 KB | 918 kb/s | 18,0 s |
| A | `-b:v 1000k` · `preset slow` | 769 KB | 934 kb/s | 18,3 s |
| **C** | **`-crf 26 -maxrate 1500k` · `preset slow`** | **1,4 MB** | **1.680 kb/s** | **19,8 s** |
| B | `-crf 23 -maxrate 2000k` · `preset slow` | 1,9 MB | 2.246 kb/s | 21,1 s |
| Master | 1080×1920 · `-crf 20` · `preset slow` | 5,6 MB | 6.904 kb/s | 52,7 s |

### Veredicto visual

Comparación hecha en pantalla de computador contra el original de 4K — la situación
más exigente posible, y una que ningún comensal vivirá.

| Comparación | Resultado |
|---|---|
| Base (1 Mbps) vs original | Diferencia perceptible si se busca; "no se ve mal" |
| **C (CRF 26) vs original** | **"Se ve muy bien… casi no se nota"** |
| Master 1080p vs C 720p | "Prácticamente igual, la diferencia no es evidente" |

Las dos conclusiones que salen de ahí:

1. **CRF 26 es el punto dulce.** Fijar calidad en vez de peso evita que precisamente
   el plato con más movimiento sea el que peor se vea.

   > **Revisado después.** Esta comparación se hizo en pantalla de computador contra
   > un original 4K. Repetida en el móvil de destino y a tamaño real, CRF 26 y CRF 30
   > no se distinguen, y el 30 pesa la mitad. El valor vigente **para el horizontal**
   > es **30** (decisión 3). La lección: comparar en la pantalla donde se va a ver, no
   > en la mejor que haya.
   >
   > **Y otra vez después.** Toda esta comparación se hizo sobre una tarjeta 16:9
   > dentro de una lista. El vertical ocupa la pantalla entera, así que el mismo
   > fotograma se mira ~4 veces más grande y el argumento de "a tamaño real no se
   > distinguen" deja de aplicar: ahí el valor vigente es **26**, con el techo de
   > bitrate subido a 2.500k para que el 26 pueda gastar lo que pida. Los valores
   > por formato están en `FORMATOS` (`video.js`); esta sección solo cuenta de
   > dónde salieron.
2. **720p basta para entregar.** Si con el 1080p al lado no se nota, en un teléfono
   menos. El 1080p se queda como archivo interno, no como entregable.

### Dónde se toca esto hoy

Los valores vigentes están en `video.js`, en una sola tabla:

```js
const FORMATOS = {
  horizontal: { ancho: 1280, alto:  720, crf: 30, maxrate: '1500k', bufsize: '3000k' },
  vertical:   { ancho:  720, alto: 1280, crf: 26, maxrate: '2500k', bufsize: '5000k' },
};
```

Cada formato lleva su propia calidad **a propósito**: los dos tienen los mismos
píxeles, pero el vertical ocupa la pantalla entera del móvil y ahí el mismo
archivo perdona mucho menos.

Tres cosas al ajustarlo:

1. **CRF más bajo = mejor calidad.** Va al revés de lo que sugiere la palabra.
2. **Subir el `maxrate` junto con el CRF.** Bajarlo dejando el tope no sirve en
   los planos con movimiento —justo donde se ve el problema—: el limitador
   recorta la mejora antes de que llegue.
3. **Solo afecta a conversiones NUEVAS.** Lo ya convertido se rehace desde su
   master, que se guarda sin recortar para esto.

### Notas sobre el método

- `preset slow` frente a `medium` a bitrate fijo dio **el mismo peso** (769 vs 771 KB).
  A bitrate fijo el peso está clavado por definición; la mejora, si existe, solo se
  vería mirando. No se evaluó por separado. Se conserva `slow` porque cuesta 2 s más
  y la conversión es una tarea de fondo.
- Al lanzar varios comandos `ffmpeg` pegados de golpe, los posteriores se cuelan en
  la **consola interactiva de ffmpeg** y corrompen la ejecución (`frame= 0`,
  `Enter command:`). **El worker debe pasar siempre `-nostdin`.**

---

## 5. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| 1 | Los archivos van al **disco del servidor**, no a Supabase Storage ni a Postgres | El egreso no se factura en el VPS y se factura por GB en Supabase; el bind mount ya está confirmado; el 98 % de las imágenes ya vive ahí |
| 2 | **Nunca dentro de la base de datos** | Infla las copias de seguridad y no permite peticiones de rango (sin 206 no hay reproducción progresiva ni saltos) |
| 3 | Entregable **1280×720 horizontal, CRF 30**, sin audio | 20 de los 25 videos de la competencia son exactamente 1280×720 (§3). El CRF bajó de 26 a 30 tras comparar las tres versiones en el móvil de destino: a tamaño real no se distinguen, y el archivo pasa de 1,27 MB a 0,68 — la mitad de datos para el comensal y la mitad de decodificación para su teléfono |
| 3.bis | El **vertical no hereda esos números**: 720×1280, CRF 26, techo 2.500k | El 30 se eligió mirando una tarjeta 16:9 dentro de una lista. A pantalla completa el mismo fotograma se ve ~4 veces más grande y los defectos del 30 sí se notan. Mismos píxeles, distinta distancia de mirada, distinto CRF. Pendiente de confirmar con videos reales de comida (§8) |
| 4 | Se guarda un **master sin recortar, con audio** | Permite recodificar en el futuro sin pedirle nada a los clientes — y recortar a otra proporción, que un master ya recortado no permite |
| 5 | El **original del móvil se borra** tras convertir con éxito | 22 GB libres; los originales de 25 MB llenan el disco y con el disco lleno se para el servidor entero |
| 6 | Tope de **8 segundos** por video, **desde el segundo que elija el restaurante** | Acota el coste de CPU y es la decisión de producto que hace viable todo lo demás. Cuáles 8 lo decide quien sube: los originales duran veinte o cuarenta segundos y lo bueno casi nunca está al principio |
| 7 | **Un trabajo de conversión a la vez**, con `nice` | Con 1 vCPU, ffmpeg y Express comparten núcleo |
| 8 | **Mínimo de 3 segundos aprovechables**, o se rechaza | Un bucle de uno o dos segundos marea en vez de vender: no es un video corto, es un error de grabación. Se comprueba en el panel —para no subir 30 MB en balde— y otra vez en la cola, que no se fía del panel |

### Por qué existe el master

Las decisiones 4 y 5 se contradicen aparentemente. La resolución es guardar
**tres archivos con vidas distintas**:

```
Original del móvil     25 MB    →  se borra al convertir
Master sin recortar   ~6,6 MB   →  se guarda indefinidamente, no se sirve nunca
Entregable 1280×720   ~1,6 MB   →  es lo que ve el cliente
Portada JPEG           ~80 KB   →  se muestra antes de reproducir
```

El master **no se recorta**. Recortar es una decisión de presentación y el
master existe justamente para sobrevivir a esas decisiones: se limita el lado
largo a 1920 conservando la proporción del original, así que un 16:9 sale
1920×1080 y un vertical sale 1080×1920 — el mismo número de píxeles, sin
sorpresas de almacenamiento.

Esto no es teórico. La primera versión de este documento fijaba el entregable
en 9:16 vertical y el master en 1080×1920, también recortado. Cuando se midió
la maqueta real de la competencia resultó que el hueco es 16:9. Si los masters
se hubieran generado recortados en vertical, no habría forma de recuperar los
lados: esos píxeles ya no existirían y habría que pedirle los originales a
cada cliente. El master se libró porque todavía no se había procesado ningún
video.

Sin master, subir la calidad más adelante exigiría que cada restaurante volviera a
grabar y subir toda su carta. Con master, es un proceso de una noche que ningún
cliente nota. Cuesta ~265 MB por restaurante: barato a cambio de poder cambiar de
opinión.

---

## 6. Ficha técnica

### Entregable

Hay **dos**, uno por formato. Cuál se usa lo decide el servidor a partir del
modelo del restaurante (`atributos.nav`), no el navegador.

> ⚠ La fuente de verdad es la tabla `FORMATOS` de `video.js`. Lo de aquí abajo
> es su reflejo a 23/08/2026 y puede quedarse atrás — antes de fiarse, mirar el
> código. (Esta sección ya dijo `-crf 26` durante días después de que el
> horizontal pasara a 30.)

**Horizontal** (modelo `video` — tarjeta 16:9 dentro de una lista):

```bash
ffmpeg -nostdin -y -ss DESDE -i ENTRADA \
  -t 8 \
  -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30" \
  -c:v libx264 -profile:v main -pix_fmt yuv420p \
  -crf 30 -maxrate 1500k -bufsize 3000k -preset slow \
  -movflags +faststart -an \
  SALIDA.mp4
```

**Vertical** (modelo `vertical` — a pantalla completa):

```bash
ffmpeg -nostdin -y -ss DESDE -i ENTRADA \
  -t 8 \
  -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30" \
  -c:v libx264 -profile:v main -pix_fmt yuv420p \
  -crf 26 -maxrate 2500k -bufsize 5000k -preset slow \
  -movflags +faststart -an \
  SALIDA.mp4
```

Mismo número de píxeles en los dos; lo que cambia es **dónde se mira**. El
vertical ocupa la pantalla entera del móvil y ahí el mismo archivo perdona
mucho menos, así que gasta más bits a propósito.

### Master

```bash
ffmpeg -nostdin -y -ss DESDE -i ENTRADA \
  -t 8 \
  -vf 'scale=w=min(1920\,iw):h=min(1920\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2' \
  -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -crf 21 -preset medium \
  -movflags +faststart \
  -c:a aac -b:a 96k \
  MASTER.mp4
```

### Portada

```bash
ffmpeg -nostdin -y -i SALIDA.mp4 -ss 1 -frames:v 1 -update 1 -q:v 5 PORTADA.jpg
```

### Qué hace cada parámetro

| Parámetro | Función |
|---|---|
| `-nostdin` | Impide que ffmpeg consuma la entrada estándar. **Obligatorio en el worker.** |
| `-t 8` | Corta a 8 s. Acota el coste sea cual sea la duración del original. |
| `-ss N` **antes** de `-i` | Empieza en el segundo que marcó el restaurante. Delante del `-i`, ffmpeg salta por el índice del archivo en vez de decodificar y descartar todo lo anterior; detrás, cuesta CPU proporcional a lo que se salta. Desde ffmpeg 2.1 el salto previo también es exacto al fotograma. |
| `scale …:increase` + `crop` | Llena el 16:9 recortando lo que sobre, sin barras negras. Solo en el entregable: el master no se recorta nunca. |
| `scale=w=min(1920\,iw)…:decrease` | Solo en el master: limita el lado largo sin recortar y conserva la proporción original. El `min()` evita que una fuente pequeña se **amplíe**: con la caja fija en 1920 un 1280×959 saldría 1920×1438, más pesado que el original y sin información nueva. |
| `force_divisible_by=2` | Evita lados impares, que `yuv420p` no admite. Requiere ffmpeg 5 o superior. |
| `-crf` | Calidad fija; el peso varía según el contenido. **Depende del formato:** 30 en horizontal, 26 en vertical. En horizontal, a 26 el archivo se pegaba al techo de 1.500k — señal de que el codificador quería más bits de los que hacían falta para una tarjeta pequeña. En vertical el fotograma se mira a pantalla completa, así que sí hacen falta: por eso va a 26 **y** con el techo subido. |
| `-maxrate` / `-bufsize` | Techo de bitrate, para que ningún video se dispare. 1.500k/3.000k en horizontal, 2.500k/5.000k en vertical. Subirlo sin bajar el CRF no cambia nada: el techo solo actúa cuando el CRF pide más de lo que cabe. |
| `-pix_fmt yuv420p` | Sin esto, los videos de iPhone no se ven en algunos Android. |
| `-movflags +faststart` | Mueve el índice al principio del archivo: la reproducción empieza antes de terminar la descarga. **Crítico.** |
| `-an` | Quita el audio del entregable (ningún navegador móvil autoreproduce con sonido). El master sí lo conserva. |

> **Pendiente de medir:** los parámetros del master cambiaron respecto a la prueba
> (`-crf 20 -preset slow -an` → `-crf 21 -preset medium` con audio) para recortar
> tiempo y peso. Los números de la sección 7 usan los de la prueba, así que la
> realidad debería salir algo mejor.

---

## 7. Proyecciones

**Estimadas.** Se extrapolan de los 6,73 s medidos a los 8 s de tope, asumiendo
comportamiento lineal.

### Por plato

```
Entregable    ~1,6 MB    ~23 s de CPU
Master        ~6,6 MB    ~63 s de CPU
Portada       ~80 KB          —
                         ─────────
                         ~86 s por plato
```

### Por restaurante (carta de 40 platos)

```
Tiempo de proceso    ~57 min   una sola vez, en segundo plano, al dar de alta
Disco                ~331 MB   (64 MB entregables + 264 MB masters + 3 MB portadas)
Datos del comensal    ~64 MB   por dispositivo nuevo que recorra la carta entera,
                               repartidos progresivamente según hace scroll
```

### A diez restaurantes

```
Disco     ~3,3 GB     cabe en los 22 GB libres actuales
Egreso   ~150 GB/mes  el 4 % de los 4 TB contratados
```

**La carga de conversión no crece con el número de clientes, crece con el número de
altas.** Un restaurante convierte su carta una vez y luego cambia un plato al mes.
Eso es lo que hace viable un solo núcleo para empezar.

---

## 8. Lo que no está probado

| Asunto | Riesgo |
|---|---|
| **El recorte a 16:9 con origen vertical** | El video de prueba venía vertical y el entregable ahora es horizontal, así que `crop` recorta arriba y abajo. Hay que comprobar con un plato real que no se le corta la parte de arriba, que es donde suele estar la comida. |
| **Los parámetros nuevos del master** | Cambiaron tras la prueba y no se han vuelto a medir. |
| **La portada a `-q:v 5`** | Medida a `-q:v 3` (155 KB). Los ~80 KB son estimación. |
| **Concurrencia real** | Nunca se ha ejecutado ffmpeg mientras el servidor atendía tráfico de comensales. |
| **Videos con poca luz** | Todas las pruebas son sobre un único archivo. Contenido oscuro o con mucho grano comprime peor. |
| **El CRF 26 del vertical** | Elegido por razonamiento —a pantalla completa el fotograma se ve ~4 veces más grande que en la tarjeta 16:9 donde se decidió el 30—, **no medido**. Nadie ha comparado 26 contra 30 en vertical, a pantalla completa, en el móvil de destino y con comida real. Hasta que se haga, es una apuesta razonable, no un valor comprobado. Se decide cuando haya videos reales de restaurante. |

---

## 9. Deuda técnica detectada en el camino

Encontrada al revisar el código para este análisis. Son **fugas que ya existen hoy**
con las imágenes; con videos de 25 MB pasan de cosméticas a graves.

1. **`PATCH /api/productos/:id`** no borra la imagen anterior al reemplazarla.
2. **`DELETE /api/restaurantes/:id`** borra las filas con un `delete().eq(...)` masivo
   que no pasa por la ruta que limpia archivos: todas las imágenes quedan huérfanas.
3. **Subidas abandonadas.** El panel sube el archivo al elegirlo; si el formulario se
   cierra sin guardar, el archivo queda en disco sin que nada lo referencie.

La solución para las tres es la misma: **un limpiador periódico** que compare el
contenido de `/opt/menus/uploads` con las URLs presentes en la base de datos y borre
lo no referenciado con más de N días de antigüedad. Ese margen es imprescindible: sin
él borraría archivos recién subidos que aún no se han guardado.

Conviene montarlo **antes** del video, porque ya está corriendo con las cartas de fotos.

> **Resuelto.** `limpieza.js`, activo desde agosto de 2026. Primera pasada real: 35
> huérfanos de 154 archivos (23 %), 8,7 MB. Verificado por dos vías independientes
> antes de activarlo — recuento SQL desde la base (154 − 119 = 35) y contraste de
> archivos concretos con un control que sí se usa.

### 9.1 `/api/login` sin límite de intentos

Detectado al revisar las variables de entorno. **Pendiente.**

El limitador por IP existe (`dentroDelLimite`) pero está conectado únicamente a
`/api/track`. El login acepta intentos tan rápido como aguante la red, sin registro
ni freno.

| Cuenta | Exposición |
|---|---|
| Restaurantes | PIN de 4 caracteres mínimo, tecleado por personal en móvil. Bcrypt de coste 10 encarece cada intento a ~100 ms, pero 10.000 combinaciones siguen siendo ~15 minutos. **Afecta a bonzas y malparados, que están en producción.** |
| Administrador | `PIN_ADMIN` en variable de entorno, comparado en claro. Ve y edita todos los restaurantes. |

Hay además un efecto secundario: cada intento consume ~100 ms del único núcleo, así
que una fuerza bruta contra el login degrada las cartas aunque no acierte nunca.

**Qué hacer, por orden:**

1. **Alargar `PIN_ADMIN`.** No lo teclea nadie en un móvil durante el servicio, así
   que puede ser una frase de 20+ caracteres. Elimina la fuerza bruta para esa cuenta
   independientemente del resto. Coste: cero.
2. **Limitar `/api/login`.** Reutilizar `dentroDelLimite` con un tope mucho más bajo
   que el de `/api/track` (5-10 por minuto, no 120) y contando por IP **y** por slug,
   para que atacar a un restaurante no bloquee a los demás. ~15 líneas.
3. Comparación en tiempo constante (`crypto.timingSafeEqual`) para `PIN_ADMIN`. De
   manual, no de esta situación: contra una cadena larga y con la variación de
   internet de por medio el ataque no es realista. Baja prioridad.

**Decidido sobre dónde vive `PIN_ADMIN`:** se queda en la variable de entorno. Pasarlo
a hash en la base sería una mejora marginal —solo llega quien tiene acceso a Dokploy,
que ya podría cambiar el código— y crearía un problema de arranque: con qué credencial
se pone el primer PIN de administrador si no hay ninguno.

Las credenciales de restaurante en texto plano (`PIN_BONZAS`, `PIN_MALPARADOS`,
`PIN_PERROSCRIOLLOS`, `PIN_SANJAVIER`) **sí se eliminaron** de la configuración de
despliegue: el código no las leía desde que los PIN viven como hash bcrypt en
`restaurantes_privado`.

### 9.2 La vista previa del panel era un parámetro de la URL

Detectado al revisar `vmenus-app/core/loader.js`. **Resuelto el 24/08/2026.**

El panel abre la carta pública con `?preview=<json>` para enseñar la apariencia
antes de guardarla, y `loader.js` fundía ese JSON entero sobre los atributos del
restaurante. El detalle que lo convierte en un problema:

> ese JSON lo escribe **quien construye la URL**, y cualquiera puede construir
> una. No hace falta entrar al panel ni tener credenciales.

Lo aprovechable no era el aspecto sino `whatsapp_pedidos`, que es el número al
que el carrito manda el pedido:

```
menu.vmenus.co/<carta>?preview={"atributos":{"whatsapp_pedidos":"57..."}}
```

Eso abre la carta de verdad —su logo, sus platos, sus precios— y manda los
pedidos al teléfono de quien repartió el enlace. Afectaba a **indigo,
perroscriollos y voro**, que son los tres que tienen WhatsApp de pedidos
configurado. El aviso amarillo de "vista previa" era la única señal, y se podía
quitar desde el mismo parámetro: `css_custom` también entraba por ahí, así que
una regla de CSS lo escondía.

**Qué se hizo:**

1. `core/preview.js` — una lista de claves que la vista previa puede tocar. Solo
   apariencia: colores, fondo, tipografías, modelo y estilo, y las banderas que
   enseñan o esconden bloques. Los **destinos** (`whatsapp_pedidos`,
   `metodos_pago`, `social_*`) salen siempre de la base de datos, también durante
   una vista previa.
2. El aviso pasa a un **shadow root cerrado**, donde el CSS de la página no
   llega. Es lo único que separa una vista previa de una carta real a ojos del
   comensal y tenía que sobrevivir a lo que traiga el parámetro.

**Efecto secundario aceptado:** al editar una red social y pulsar "Vista previa",
el enlace que se ve es el guardado, no el del formulario. Se prefiere eso a que
un enlace preparado pueda apuntar los botones de un cliente a otro sitio. La
regla para ampliar la lista está escrita en `core/preview.js`: si un desconocido
pudiera fijar ese valor, ¿qué consigue? Si la respuesta es "que se vea distinto",
entra; si es "que el pedido acabe en otro sitio", no.

### 9.3 La extensión del archivo la escribía quien subía

Detectado al revisar `server.js` contra `limpieza.js`. **Resuelto el 24/08/2026.**

El nombre de lo subido lo genera el servidor entero **salvo la extensión**, que
salía de `path.extname(file.originalname)`. El filtro que la validaba,
`/jpeg|jpg|png|webp/`, no estaba anclado: bastaba que esas letras aparecieran en
algún sitio. Pasaban `.apng`, `.webpx`, `.jpeg2000` — y también `.jpg;rm`.

El daño no es el que parece a primera vista. No es que se pudiera subir un
ejecutable; es que **`limpieza.js` reconoce los nombres con `[A-Za-z0-9._-]+`**,
así que de `foto.jpg;rm` guardado en la base solo leía hasta el punto y coma. El
archivo del disco y la referencia de la base dejaban de coincidir, y pasados los
siete días de gracia el limpiador borraba **una foto que sí estaba en uso**.

Es el modo de fallo que el tope del 50 % no cubre: no borra de más, borra
exactamente un archivo, el equivocado, y en silencio.

Ahora la extensión se devuelve **de la lista** (`EXTENSIONES_IMAGEN` /
`EXTENSIONES_VIDEO`) en vez de copiarse del original, así que lo que se escribe
en el disco solo puede ser una de ellas. Cuatro pruebas nuevas en `test/api.test.js`.

### 9.4 Una imagen del carrusel podía ejecutarse en la sesión del superadmin

Detectado al revisar `public/index.html` contra su propio `esc()`.
**Resuelto el 24/08/2026.**

El panel ya tiene escapado de HTML, y su comentario explica exactamente por
qué: *"el superadmin abre el panel de CUALQUIER restaurante, y su token vive en
sessionStorage"*. La regla estaba escrita. Lo que pasó es que una plantilla se
quedó fuera:

```js
item.innerHTML = `<img src="${url}" alt="">…`   // renderExtraImgs()
```

Esa `url` sale de `productos.atributos.imagenes`, y `PATCH /api/productos/:id`
era el único endpoint que **no filtraba** su objeto `atributos` — restaurantes y
categorías sí lo hacían. Así que un restaurante podía guardar ahí cualquier
cadena, y al abrir el superadmin la ficha de ese plato, se ejecutaba con su
sesión: acceso a todos los restaurantes.

Se cerró por los dos lados, porque cada mitad sola deja el agujero abierto:

1. **El panel escapa** esa plantilla como todas las demás.
2. **El servidor filtra** `atributos` de producto contra una lista
   (`imagenes`, `personalizacion`, `filtros`, `popular`, `chef`, `nuevo`).

Con un detalle que no se puede pasar por alto: `video` lo escribe el worker, no
el navegador, así que no se acepta de fuera — pero **tampoco se descarta**. El
panel manda el objeto completo, y descartarlo sin más le habría borrado el video
al plato al guardar cualquier otro cambio. Se conserva el que ya estaba en la
base. Hay ocho platos con video en producción; hay una prueba para eso.

### 9.5 `dia_pago` y `ultimo_pago` eran públicos

Detectado al revisar las políticas RLS contra el contenido real de la tabla.
**Cerrado el 24/08/2026, los tres pasos.**

`restaurantes` tiene lectura pública (`USING true`) y la llave publishable está,
como debe, dentro de `core/supabase.js`. Eso es correcto para una carta que se
pinta en el navegador. El problema es **qué** hay dentro de `atributos`:

| clave | en cuántos restaurantes |
|---|---|
| `dia_pago` | 3 |
| `ultimo_pago` | 2 |

Son datos de **tu** cobranza, no del restaurante. Y `loader.js` pide `atributos`
entero, así que hoy viajan al navegador de cada comensal que abre esas cartas:
se ven en las herramientas de desarrollo sin ninguna llave. Con la llave del
repositorio se pueden pedir los de todos a la vez.

No es una credencial y no permite entrar a ningún sitio. Es información
comercial: quién te paga, cuándo, y quién va atrasado.

Es el mismo patrón que evitó el paso 1 —"los secretos no se crean en la tabla
pública"— pero aplicado a **columnas**. `atributos` es una columna pública, y
dentro de ella se metieron datos administrativos.

**Cómo se resolvió.** Tabla propia `restaurantes_facturacion`, con RLS y cero
políticas —solo la llave de servicio la alcanza—, y una API que es la única
puerta: `GET /api/facturacion` y `PATCH /api/facturacion/:id`, las dos **solo
admin**. Un restaurante no ve ni escribe su propia cobranza: es un dato de la
plataforma *sobre* él, no suyo, así que aquí no vale `canAccessRestaurante()`.

Tabla propia y no `restaurantes_privado`: ahí viven los secretos de acceso y su
`pin_hash` es `NOT NULL`. Un restaurante puede no tener PIN todavía y aun así
deberte una mensualidad; mezclarlos obligaría a inventarle una credencial para
poder anotarle una fecha.

Y la otra mitad, sin la cual la fuga volvería sola: `PATCH /api/restaurantes/:id`
**quita** `dia_pago` y `ultimo_pago` de cualquier `atributos` que le llegue,
incluso del superadmin. Así ninguna pantalla vieja ni ninguna llamada suelta los
devuelve a la tabla que ve todo el mundo.

**Orden, que es lo que importa** (el de `sql/06`, y el mismo que pide
`docs/servidor.md` §7 — *"migrar datos y desplegar código el mismo día deja una
ventana de código viejo con datos nuevos"*):

| # | Qué | Estado |
|---|---|---|
| 1 | Crear la tabla y **copiar** el dato (queda duplicado a propósito) | ✅ 24/08/2026 |
| 2 | Desplegar el panel que lee de la tabla nueva | ✅ código listo |
| 3 | Borrar las dos claves de `restaurantes.atributos` | ✅ 24/08/2026 |

Entre 1 y 3 el dato estuvo en los dos sitios y todo siguió funcionando: el panel
viejo leyendo de `atributos`, el nuevo de la tabla. Correr el paso 3 antes de
desplegar habría dejado al superadmin sin ver quién le debe.

El paso 3 se autorizó con dos comprobaciones, no con una: que el panel **ya
desplegado** siguiera enseñando las insignias de cobro (si las enseña, está
leyendo de la tabla nueva), y que la consulta de contraste diera cero filas —
cada dato de `atributos` con su copia idéntica al lado. Después: cero claves en
la tabla pública, los dos restaurantes con fecha intactos en la privada, y el
resto de `atributos` sin tocar.

**Un detalle que casi se cuela.** El día de pago se pinta en la ficha de un
restaurante, y la cobranza ahora llega por una ruta aparte que puede no haberse
pedido todavía: a la lista se llega por un camino y a la ficha de uno solo por
otro. Con el campo vacío por "no se sabe", guardar habría **borrado** el día de
pago. Por eso `state.facturacionCargada`: mientras sea falso, ese campo no se
escribe. Un dato que no se pudo leer no se puede guardar.

---

## 10. Plan por fases

**Paso 0 — Medición.** ✅ Cerrado. Es este documento.

**Paso 1 — Ingesta y conversión.**
- Subir el límite de multer (hoy 10 MB) y aceptar `.mp4` / `.mov`
- Tabla `trabajos_video` con estados `pendiente` → `procesando` → `listo` / `error`
- Worker que lee la cola, ejecuta ffmpeg con `nice` y `-nostdin`, uno a la vez
- Borrado del original tras conversión verificada
- ffmpeg en el `Dockerfile`, para que sobreviva a los despliegues
- El limpiador de huérfanos de la sección 9

**Paso 2 — Panel.** Subir, ver progreso, aprobar o descartar antes de publicar.

**Paso 3 — Cartas.** Pintar el video con carga perezosa por visibilidad, portada
primero, `muted` + `playsinline` + `autoplay`.

**Paso 4 — Generación con IA.** Foto → video mediante un servicio externo. Se enchufa
a la misma cola: es otra forma de llenarla, no otra arquitectura. Notas para entonces:

- El coste computacional es del proveedor, no nuestro. Nuestro servidor solo hace una
  llamada HTTP y luego normaliza el resultado.
- Del orden de 0,10–0,50 USD por clip de 5 s según modelo. **Verificar precios
  vigentes antes de presupuestar**; cambian cada pocos meses.
- Presupuestar 1,3–1,5 generaciones por plato: la comida es de lo más difícil de
  generar y se descartan resultados.
- Hace falta un paso de aprobación humana. Publicar automáticamente lo que salga de
  un modelo es como acaba una hamburguesa con tres panes en la carta de un cliente.
- **Restricción de producto, no técnica:** movimiento de cámara sobre la foto real,
  sin añadir ingredientes ni cambiar la presentación. Si el modelo agrega una
  guarnición que el restaurante no sirve, eso es publicidad engañosa y el expuesto
  ante la SIC es el cliente.
- Revisar la licencia comercial del modelo y de quién es el resultado.

---

## 11. Checklist

Estado a agosto de 2026. Pensada para copiar y pegar.

### Video

- [x] **Paso 0 — Medición.** Parámetros fijados sobre mediciones reales
- [x] **Paso 1 — Ingesta y conversión.** Tabla, worker, ffmpeg en la imagen, rutas
- [x] **Paso 2 — Panel.** Subir video desde la ficha del plato, con estado que se
      refresca solo y elección del segundo de inicio
- [x] Botón para descartar trabajos fallidos (`descartarVideoFallido()`, en el aviso
      rojo de la ficha del plato)
- [x] **Paso 3 — Cartas.** `temas/video.js` en vmenus-app: carga perezosa, portada
      primero, un solo video en marcha a la vez
- [x] **Plantilla vertical** (`temas/vertical.js`): pantalla completa, un plato por
      deslizamiento con `scroll-snap`, tres estilos (`clasico`, `intenso`, `avance`)
      elegibles desde el panel. En producción en Indigo; Voro sigue de demo
      horizontal
- [ ] **Paso 4 — Generación con IA.** Foto → video contra un servicio externo, a la misma cola
- [x] Probado el recorte 16:9 con origen vertical: el plato queda centrado, pero se
      pierde el 69 % de la altura. Decisión tomada: se mantiene 16:9 y se recomienda
      al restaurante grabar en horizontal
- [x] `force_divisible_by=2` comprobado en el servidor con cuatro proporciones.
      Redondea al par más cercano, no hacia abajo
- [ ] Medir los parámetros nuevos del master (`-crf 21 -preset medium` con audio); los de la sección 6 son los de la prueba vieja
- [ ] Verificar la portada a `-q:v 5` — los ~80 KB son estimación, se midió a `-q:v 3` (155 KB)
- [ ] Convertir con el servidor sirviendo tráfico real, para ver si `nice` basta
- [ ] **Confirmar el CRF del vertical.** El 26 está razonado, no medido (§8).
      Comparar 26 contra 30 a pantalla completa, en el móvil, con comida real —
      cuando haya videos de restaurante de verdad
- [x] Pruebas para `argumentosEntregable` (8: encuadre por formato, calidad por
      formato, formato desconocido, y lo que NO debe cambiar con él)
- [x] **El rescate de trabajos colgados pasa a ser periódico** (24/08/2026). Corría
      solo al arrancar, así que un trabajo que se quedara en `procesando` —porque
      el proceso murió a mitad de conversión— no lo desbloqueaba nadie: no vuelve
      a la cola porque ya no está `pendiente`, y el restaurante veía
      "convirtiendo" indefinidamente. La única cura era otro despliegue. Ahora se
      reintenta cada 30 min dentro del mismo `tick`
- [ ] Pruebas para `argumentosMaster` / `argumentosPortada` (están exportadas para eso)
- [x] Pruebas para `limpieza.recogerNombres` — y para `pasada`, que es la que borra

### Seguridad

- [x] PIN de restaurante fuera de la tabla pública, como hash bcrypt
- [x] PIN de restaurante en claro eliminados de las variables de entorno
- [x] Límite de intentos en `/api/login` (10 fallos / 15 min por IP, con pruebas)
- [x] Comparación en tiempo constante para `PIN_ADMIN`
- [x] **La vista previa ya no puede desviar los pedidos** (24/08/2026). `?preview=`
      solo cambia apariencia; el WhatsApp, los métodos de pago y las redes salen
      siempre de la base. El aviso va en un shadow root para que `css_custom` no
      lo esconda. Ver §9.2 y `vmenus-app/test/preview.test.js`
- [x] **La extensión de lo subido sale de una lista** (24/08/2026). El filtro sin
      anclar dejaba pasar `.jpg;rm`, y eso desincronizaba `limpieza.js` hasta
      borrar fotos en uso. Ver §9.3
- [x] **La categoría de un plato tiene que ser del mismo restaurante**
      (24/08/2026). El permiso se comprueba sobre `restaurante_id` y eso no dice
      nada sobre a quién pertenece `categoria_id`. El daño era callado: el plato
      se guardaba, el panel decía que bien, y la carta pública —que agrupa por
      las categorías del restaurante— no lo enseñaba en ningún sitio
- [x] **`atributos` de producto filtrado y el panel escapando la lista de
      imágenes** (24/08/2026). Era la vía para que lo que escribe un restaurante
      se ejecutara en la sesión del superadmin. Ver §9.4
- [x] **`dia_pago` y `ultimo_pago` fuera de la tabla pública** (24/08/2026).
      Tabla `restaurantes_facturacion` con RLS y cero políticas, API solo
      admin, y `PATCH /api/restaurantes` los quita de `atributos` para que no
      vuelvan. Ver §9.5 y `sql/06`
- [x] **Paso 3 de esa migración** (24/08/2026). Las dos claves borradas de
      `restaurantes.atributos` tras confirmar el panel desplegado. La fuga
      queda cerrada: lo que hoy viaja al navegador de un comensal es solo
      apariencia, redes y datos de pedido — nada de cobranza
- [ ] **Alargar `PIN_ADMIN`** a una frase de 20+ caracteres. No lo teclea nadie en móvil; no hay razón para que sea corto

### Cartas públicas (no es video, pero está abierto)

- [x] **Etiquetas Open Graph** (23/08/2026). NO están en `vmenus-app/index.html`
      y no pueden estarlo: el robot de WhatsApp lee el HTML crudo y no ejecuta
      JavaScript, así que una carta que se pinta en el navegador nunca llega a
      tiempo. Las sirve `/api/og` del panel, y nginx manda ahí solo a los robots.
      Comprobado en producción con Malparados (logo) y Voro (foto de plato como
      respaldo). Ver `docs/servidor.md`
- [x] **Un modelo mal escrito ya no apaga la carta** (24/08/2026). `atributos.nav`
      se valida contra los modelos que existen antes de importar el archivo; una
      errata cae en `topnav` en vez de dejar "No se pudo cargar el menú"
- [x] **Los videos vuelven a moverse al volver a la pestaña** (24/08/2026). El
      observador solo avisa cuando algo cruza un umbral, y cambiar de pestaña no
      mueve nada: el plato se quedaba congelado hasta deslizar
- [x] **Editar un plato personalizado ya no puede perder el recargo**
      (24/08/2026). Al pulsar "editar" en el carrito, la selección se
      reconstruía leyendo el texto de la línea y partiéndolo por `', '`. Un
      topping con coma en el nombre —"Salsa de la casa, picante"— se partía en
      dos que no existen en el catálogo, el modal abría sin nada marcado y, al
      guardar, la línea volvía SIN el recargo. Ningún error a la vista y el
      pedido llega con el precio de menos. Hoy ningún restaurante tiene comas en
      sus toppings, así que estaba latente. Ahora la selección se guarda aparte
      (`sel`) y el texto solo se usa para leerlo
- [ ] Manifiesto PWA por restaurante, para añadir la carta a la pantalla de inicio con el logo del local

### Infraestructura

- [x] Limpiador de huérfanos activo y BORRANDO desde el 21 de agosto, con tope
      de seguridad al 50 % del disco y pruebas. La primera pasada real dio
      `0/0 de 148 archivos`: correcto, porque los cuatro que sobraban tenían
      menos de los 7 días de gracia. La primera que borre algo cae sobre el 25.
      (Aquí ponía "primera pasada: 35 archivos, 8,7 MB", que no cuadra con
      ningún registro observado — llevaba desde entonces en simulacro.)
- [x] **Copia de seguridad de `/opt/menus/uploads`** (22/08/2026). Instantáneas
      con restic en Backblaze B2, a diario, con restauración comprobada byte a
      byte y la clave verificada. Ver `docs/servidor.md` y `respaldo/LEEME.md`.
      Vigilancia externa añadida el 23/08/2026 (healthchecks.io), probada en
      los dos sentidos: verde al terminar bien, rojo con el motivo si falla
- [x] **Reinicio y actualizaciones** (23/08/2026). Kernel 6.8.0-138, cero
      pendientes, los 17 contenedores volvieron solos
- [x] **`npm ci --omit=dev` en el Dockerfile** (24/08/2026), en vez de
      `npm install --production`. Mismo argumento que ya fija la versión de Node
      en el workflow: que lo que corre en producción sea lo que se probó.
      `--production` además quedó obsoleto en npm 9
- [x] **`Dockerfile` y `nginx.conf` fuera de la web pública** (24/08/2026). La
      imagen hace `COPY . /usr/share/nginx/html`, así que `/nginx.conf` y
      `/Dockerfile` se servían a cualquiera. No enseñaban ningún secreto —el
      host del panel ya está en `core/analytics.js`— pero lo que se añada mañana
      a esos archivos se habría regalado igual.

      **Dos trampas, las dos sufridas:**

      1. `nginx.conf` **no se puede excluir en `.dockerignore`**. Eso lo saca
         del contexto de construcción ENTERO, y entonces el
         `COPY nginx.conf /etc/nginx/conf.d/default.conf` se queda sin archivo:
         `ERROR: "/nginx.conf": not found`, y el despliegue no termina. Se quita
         con un `rm` en el Dockerfile, después de copiarlo donde hace falta.
         (`Dockerfile` sí se puede excluir: Docker no lo necesita dentro.)

      2. **No se comprueba esperando un 404.** Con `try_files $uri $uri/
         /index.html`, ninguna ruta inexistente da 404: todas devuelven la
         carta. Al pedir `/nginx.conf` sale "No se pudo cargar el menú" y en la
         consola "Restaurante no encontrado" — porque la aplicación toma
         `nginx.conf` como si fuera el slug de un restaurante. **Eso es lo
         correcto**, no un fallo. La prueba limpia es comparar con una ruta
         inventada: si `/nginx.conf` y `/esto-no-existe-12345` se comportan
         igual, el archivo ya no está
- [x] **`search_path` fijado en `tocar_actualizado_en()`** (24/08/2026). El aviso
      desapareció del linter. Se comprobó que el trigger sigue disparando —de él
      depende el rescate de trabajos colgados— con una tabla temporal y `rollback`
- [x] **`menu_activo` resuelto** (24/08/2026). **NO borrar: hace falta.** No es
      un contador de visitas ni código viejo: es el *keep-alive* del proyecto de
      Supabase. Lo escribe un `pg_cron` que vive dentro de la propia base, por
      eso no aparecía en ningún repositorio:

      ```sql
      -- cron.job, jobid 1, jobname 'menus_activos'
      0 0 */3 * *   insert into menu_activo(num) values(1);
      ```

      El plan de la organización es **free**, y ahí Supabase pausa un proyecto
      tras 7 días sin actividad. Una escritura cada 3 días lo mantiene despierto
      con margen. Encaja con todo lo observado: siempre a las 00:00:00 UTC,
      siempre `num = 1`, siempre cada 3 días exactos.

      Se puede retirar el día que la organización deje de ser free —o cuando
      haya tráfico real suficiente—, pero entonces hay que quitar **las dos
      cosas a la vez**: el job y la tabla. Quitar solo la tabla deja un cron
      fallando cada tres días contra una tabla que no existe.

      Para verlo:
      ```sql
      select jobid, jobname, schedule, command, active from cron.job;
      select * from cron.job_run_details order by start_time desc limit 5;
      ```
- [ ] Revisar `docker system df` y limpiar imágenes viejas (26 GB de 48 sin video de por medio, y la imagen creció con ffmpeg)
- [ ] **Borrar el bucket `vmenus-imagenes` de Supabase.** Comprobado el
      23/08/2026: 4 objetos, **18,2 MB** (no los 14 que decía aquí — ese es el
      tamaño de uno solo, `fondos/bonzas.png`), del 10 de julio, y **ninguno
      referenciado** por restaurantes, productos ni categorías. Seguro de
      borrar
- [ ] Ampliar a KVM 2 (2 vCPU) cuando haya 2-3 clientes usando video

### Producto

- [x] **Quién graba** (decidido el 23/08/2026). Depende de la distancia:
      - **En el área de San Gil**, graba el equipo. Es parte del servicio y
        permite controlar encuadre, luz y duración desde el principio.
      - **Fuera del área, no.** No hay compromiso de desplazarse. El
        restaurante graba por su cuenta o contrata a una agencia.

      La consecuencia es que **la carta tiene que aguantar material que nadie
      del equipo ha visto antes de subirse**: mal encuadrado, mal iluminado, en
      proporción rara. Eso ya está cubierto —el recorte es forzado a 16:9 o
      9:16 con `increase`+`crop`, así que nunca salen franjas negras— pero
      conviene no romperlo.
- [ ] **Escribir la guía de grabación.** Deja de ser un extra: es el entregable
      para los restaurantes de fuera del área. Debería decir en horizontal o
      vertical según su modelo, cuántos segundos, con qué luz, y que no hace
      falta editar nada porque el recorte lo hace el servidor
- [ ] Generación con IA: queda como posible salida para los de fuera del área
      que no quieran grabar ni contratar. Si se explora, probar 3-4 modelos con
      la misma foto de plato y verificar precios vigentes y licencia comercial

---

## Sobre la infraestructura, a futuro

El escalado del servidor va por número de clientes, no por adelantado:

| Momento | Plan | Motivo |
|---|---|---|
| Ahora, en pruebas | KVM 1 · 1 vCPU · 4 GB | Suficiente para desarrollar y validar |
| 2-3 clientes | KVM 2 · 2 vCPU · 8 GB | El segundo núcleo separa conversión de servicio: dejan de competir |
| Producción | 4 vCPU · 16 GB | Permite convertir en paralelo |

Un **VPS aparte solo para convertir** es plan C, no plan B. El coste no es el dinero
(unos 5 USD), es que obliga a resolver cómo viajan los archivos entre dos máquinas,
con credenciales, transferencias y un modo de fallo nuevo. Dado que la conversión es
esporádica, probablemente nunca haga falta.

### Pendientes de mantenimiento

- `/opt/menus/uploads` **ya está respaldado** desde el 22/08/2026 — instantáneas
  diarias en Backblaze, con restauración comprobada. Todo lo operativo (rutas,
  cron, secretos, cómo recuperar) está en `docs/servidor.md`; cómo se montó, en
  `respaldo/LEEME.md`. Lo que sigue abierto es enterarse si deja de correr.
- Hay un reinicio pendiente por actualización de kernel y actualizaciones de
  seguridad sin aplicar. Hacer en horario de restaurantes cerrados.
- Revisar `docker system df`: 26 GB usados de 48 sin video de por medio, y las
  imágenes viejas de Docker suelen ser lo que más ocupa.
