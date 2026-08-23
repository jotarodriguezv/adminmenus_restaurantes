# Cartas en video — análisis técnico y decisiones

**Estado:** en producción. Cola, panel y plantilla funcionando de punta a punta;
primeros videos reales convertidos y servidos (restaurante `voro`).
Los parámetros de la sección 7 son los vigentes; los de la sección 4 son las
mediciones del análisis inicial y varios ya no se usan — ver sección 5.
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
   > no se distinguen, y el 30 pesa la mitad. El valor vigente es **30** (decisión 3).
   > La lección: comparar en la pantalla donde se va a ver, no en la mejor que haya.
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

```bash
ffmpeg -nostdin -y -ss DESDE -i ENTRADA \
  -t 8 \
  -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30" \
  -c:v libx264 -profile:v main -pix_fmt yuv420p \
  -crf 26 -maxrate 1500k -bufsize 3000k -preset slow \
  -movflags +faststart -an \
  SALIDA.mp4
```

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
| `-crf 30` | Calidad fija; el peso varía según el contenido. A 26 el archivo se pegaba al techo de 1.500k, señal de que el codificador quería más bits de los que hacían falta. |
| `-maxrate` / `-bufsize` | Techo de bitrate, para que ningún video se dispare. |
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
- [ ] Botón para descartar trabajos fallidos (la ruta `DELETE /api/video/trabajos/:id`
      existe; falta el botón en el panel)
- [x] **Paso 3 — Cartas.** `temas/video.js` en vmenus-app: carga perezosa, portada
      primero, un solo video en marcha a la vez
- [ ] **Paso 4 — Generación con IA.** Foto → video contra un servicio externo, a la misma cola
- [x] Probado el recorte 16:9 con origen vertical: el plato queda centrado, pero se
      pierde el 69 % de la altura. Decisión tomada: se mantiene 16:9 y se recomienda
      al restaurante grabar en horizontal
- [x] `force_divisible_by=2` comprobado en el servidor con cuatro proporciones.
      Redondea al par más cercano, no hacia abajo
- [ ] Medir los parámetros nuevos del master (`-crf 21 -preset medium` con audio); los de la sección 7 son los de la prueba vieja
- [ ] Verificar la portada a `-q:v 5` — los ~80 KB son estimación, se midió a `-q:v 3` (155 KB)
- [ ] Convertir con el servidor sirviendo tráfico real, para ver si `nice` basta
- [x] Pruebas para `argumentosEntregable` (8: encuadre por formato, calidad por
      formato, formato desconocido, y lo que NO debe cambiar con él)
- [ ] Pruebas para `argumentosMaster` / `argumentosPortada` (están exportadas para eso)
- [x] Pruebas para `limpieza.recogerNombres` — y para `pasada`, que es la que borra

### Seguridad

- [x] PIN de restaurante fuera de la tabla pública, como hash bcrypt
- [x] PIN de restaurante en claro eliminados de las variables de entorno
- [x] Límite de intentos en `/api/login` (10 fallos / 15 min por IP, con pruebas)
- [x] Comparación en tiempo constante para `PIN_ADMIN`
- [ ] **Alargar `PIN_ADMIN`** a una frase de 20+ caracteres. No lo teclea nadie en móvil; no hay razón para que sea corto

### Cartas públicas (no es video, pero está abierto)

- [x] **Etiquetas Open Graph** (23/08/2026). NO están en `vmenus-app/index.html`
      y no pueden estarlo: el robot de WhatsApp lee el HTML crudo y no ejecuta
      JavaScript, así que una carta que se pinta en el navegador nunca llega a
      tiempo. Las sirve `/api/og` del panel, y nginx manda ahí solo a los robots.
      Comprobado en producción con Malparados (logo) y Voro (foto de plato como
      respaldo). Ver `docs/servidor.md`
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
      Queda un agujero: nadie se entera si deja de correr — `MAILTO` no avisa
      porque el servidor no sabe enviar correo
- [ ] Reinicio pendiente por actualización de kernel, más 27 actualizaciones sin aplicar. Con los restaurantes cerrados
- [ ] Revisar `docker system df` y limpiar imágenes viejas (26 GB de 48 sin video de por medio, y la imagen creció con ffmpeg)
- [ ] Borrar el bucket `vmenus-imagenes` de Supabase (los 14 MB viejos, ya sin referencias)
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
