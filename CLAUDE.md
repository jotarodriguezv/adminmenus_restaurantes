# adminmenus_restaurantes

Panel de administración de la plataforma de menús digitales. Node + Express,
sin framework de frontend. El menú que ve el comensal es **otro repositorio**,
`vmenus-app`; los dos comparten la misma base de datos Supabase
(`menu-restaurantes`, `tllpmdhkdlqoqpnqmuwn`).

## Reglas de trabajo

- **Nunca commitear sobre `main`.** Una rama por tarea, salida de `main`, y el
  merge lo hace el usuario por pull request.
- **Commitear y abrir el pull request al terminar cada tarea, sin preguntar.**
  Acordado el 05/09/2026; antes había que esperar el visto bueno antes de cada
  commit. La revisión pasó a ocurrir **en el pull request**: el usuario entra,
  lee el diff y mergea. Preguntar al final de cada tarea era un paso de más que
  no añadía revisión, porque la revisión de verdad la hace igualmente en GitHub.
- **El merge lo sigue haciendo el usuario.** Un pull request abierto no es un
  cambio aplicado, y `main` no se toca nunca directamente.
- **Correr las pruebas antes de commitear**, no después: ya no hay una pausa en
  la que alguien las mire por ti.
- Código, comentarios y documentación en español. Los mensajes de commit son la
  excepción: van en inglés e imperativos ("Add…", "Enhance…", "Refactor…"),
  siguiendo el historial existente.

## Antes de tocar nada: leer `docs/`

Es documentación viva y densa, escrita para no repetir análisis ya hechos. Si
la tarea roza alguno de estos temas, leer el documento primero:

| Documento | Cubre |
|---|---|
| `docs/servidor.md` | La máquina real: qué vive en el servidor y **no** en el repositorio (credenciales, cron, scripts copiados a mano). |
| `docs/planesymodelos.md` | Qué tiene contratado cada restaurante. Responde "¿qué puede hacer este cliente?" sin leer código. |
| `docs/cartas-en-video.md` | Los parámetros de codificación de video y de dónde salió cada número. |
| `docs/video-con-ia.md` | La generación con Replicate (`minimax/hailuo-02`) y sus costes. |
| `docs/pantalla-tv.md` | La cartelera para televisores del local. |
| `docs/promociones.md` | La promoción: el popup de la carta y la pantalla del televisor. Diseño de las promociones programadas. |
| `docs/seguridad-subidas.md` | Las dos puertas por las que entra un archivo. Qué se comprobó, qué se arregló y qué se dejó a propósito. |
| `docs/importar-carta.md` | Importar la carta desde un PDF o una imagen. Las dos pruebas de realidad, con sus números. |

Si el código y un documento se contradicen, manda el código — y hay que
corregir el documento en la misma tarea.

## Estructura

- `server.js` (~2000 líneas) — Express y todas las rutas HTTP. Un manejador
  que lanza no tumba el proceso: Express 5 manda la excepción al manejador de
  errores del final. Fuera de una petición —una cola, un temporizador— eso no
  aplica, y ahí está el `process.on('unhandledRejection')`.
- `video.js` — cola de conversión de video. Un trabajo a la vez, porque ffmpeg
  y Express comparten un solo núcleo. **Límite por CPU.**
- `colaia.js` — cola de generación con IA. Carril aparte del anterior a
  propósito: generar no gasta CPU, solo espera una respuesta HTTP.
  **Límite por presupuesto.**
- `cupo.js` — cupo de generaciones. Reserva antes de llamar a Replicate, porque
  aquí el peor caso de un fallo no es lentitud, es una factura.
- `lectorpdf.js` — saca el texto de un PDF y decide si el archivo trae capa de
  texto o es un escaneo. **Aquí los fallos son silenciosos**: devuelven texto
  de aspecto correcto que no dice lo que dice la carta. No tocarlo sin leer su
  cabecera y sin pasarlo por un PDF de verdad, que es lo que cazó los dos
  fallos que las pruebas construidas a mano no vieron.
- `lectorcarta.js` — convierte esa carta en categorías y platos hablando con la
  API de Anthropic. Es a la importación lo que `ia.js` a los videos: lo único
  que depende de un tercero. `ANTHROPIC_API_KEY` vive en Dokploy.
- `precios.js` — la regla de precios, compartida por la API y el importador.
  **Un precio se guarda dos veces** (`precio` y `precio_numerico`) y separarlos
  hace que la carta muestre uno y el carrito cobre otro. Ya pasó.
- `limpieza.js` — borra del disco los archivos que ya no referencia nadie.
- `public/` — el panel (HTML + JS servidos tal cual).
- `sql/` — migraciones numeradas.
- `respaldo/` — scripts de copia y restauración que se ejecutan en el servidor.

## El slug de un restaurante

No es un nombre interno: es la URL pública y lo que va impreso en los QR. Un
slug malo no se nota al crearlo, se nota cuando el restaurante ya repartió los
códigos.

Cinco están reservados y el servidor los rechaza al crear y al editar
(`SLUGS_RESERVADOS` en `server.js`): `admin`, `menu`, `www`, `app` y `api`.
`admin` porque lo intercepta el login y ese restaurante nunca podría entrar a
su panel; los otros cuatro porque son subdominios de la plataforma.

**La misma lista vive en `vmenus-app/core/loader.js`**, y no se puede compartir
el módulo porque son dos aplicaciones desplegadas por separado. Si cambia en un
sitio, hay que cambiarla en el otro — y desincronizarlas rompe la vista previa
al compartir, que anunciaría un restaurante distinto del que se abre al pulsar.

## Base de datos

Las migraciones se versionan en `sql/`, numeradas correlativamente. Un cambio
de esquema **añade un archivo nuevo**; no se edita uno ya aplicado ni se toca
el esquema solo desde la consola de Supabase.

**Avisar antes de escribir en producción.** Consultar y leer es libre; aplicar
una migración, no.

**Orden de despliegue: primero la base, después el código.** Una migración
aditiva —una función o un índice que todavía no usa nadie— no cambia nada al
aplicarse, así que ponerla antes es gratis. Al revés no: el código desplegado
llamaría a algo que aún no existe. Está escrito en `sql/13` y volvió a hacer
falta en `sql/15`.

La separación entre tablas públicas y privadas es deliberada y no es
negociable: `restaurantes` viaja entera al navegador de cualquier comensal.
Credenciales, cobranza y cualquier secreto van en `restaurantes_privado` y
`restaurantes_facturacion`. **Nunca meter un dato sensible en
`restaurantes.atributos`.**

### Al crear una función SQL: los dos `revoke`, y verificar después

Una función nueva en el esquema `public` nace accesible con la clave
publicable. Para cerrarla hacen falta **dos** `revoke`, porque hay **dos vías
de acceso independientes** y ninguna se quita revocando la otra:

```sql
revoke execute on function public.mi_funcion(...) from public;
revoke execute on function public.mi_funcion(...) from anon, authenticated;
grant  execute on function public.mi_funcion(...) to service_role;
```

- PostgreSQL concede `EXECUTE` a `PUBLIC` en cada función nueva (aparece en el
  ACL como el grantee vacío: `{=X/postgres,...}`).
- Supabase, **además**, se lo concede a `anon` y `authenticated` de forma
  explícita, por privilegios por defecto sobre el esquema.

Emitir los dos siempre, sin pararse a averiguar cuál aplica: sobra uno en cada
caso y no cuesta nada.

**Y comprobarlo después de aplicar, no dar por hecho que funcionó:**

```sql
select proname, has_function_privilege('anon', oid, 'EXECUTE')
  from pg_proc where proname = 'mi_funcion';
```

Esto no es teoría. `sql/03` cerró una vía y dejó la otra abierta, y la función
pasó meses accesible **pareciendo que no lo estaba**, que es peor que saberla
abierta. Al arreglarlo en `sql/16` volvió a pasar: el primer intento cerró una
función y dejó la otra igual, porque cada una estaba abierta por una vía
distinta. Se detectó solo por verificar. El detalle completo está en `sql/16`.

## Pendiente

### Si las peticiones de fuente se vuelven frecuentes

Hoy la lista de tipografías es **curada a mano**: 14 para títulos y 13 para
cuerpo, en los dos `select` de `public/index.html`. Cuando un restaurante
quiere otra, la pide y se añade una línea.

**Eso está bien y no hay que cambiarlo todavía.** La lista no es una
limitación técnica, es una decisión de diseño tomada por adelantado: Google
tiene unas mil ochocientas familias y muchas son ilegibles a tamaño pequeño en
un móvil. Si un restaurante elige mal, la carta se ve mal — y quien la
construyó fue esta plataforma.

**Cuándo cambia:** cuando el superadmin sea el cuello de botella, o sea,
cuando lleguen peticiones cada semana y esperar a que alguien añada una línea
estorbe la venta.

**Qué NO hacer entonces:** abrir el catálogo entero de Google con su API. Eso
regala el control de calidad a cambio de ahorrarse un minuto.

**Qué hacer:** ampliar la lista curada a treinta o cuarenta y ponerle un
buscador **entre ellas**. Se quita el trabajo manual y se conserva la curaduría.

Un dato que se comprobó el 04/09/2026 y ahorra una preocupación: **los acentos
y la ñ no son un problema**. Se probaron cinco familias, incluidas las más
decorativas, y todas cubren el latín básico y el extendido. Lo que hay que
mirar al añadir una fuente es la **legibilidad**, no la cobertura.

### `test/api.test.js` falla a veces en CI sin que nadie haya roto nada

**Visto el 04/09/2026 en un pull request que solo cambiaba texto de HTML.**
Al relanzar el mismo commit, sin tocar una línea, pasó en verde.

Cuesta más de lo que parece: **cada fallo manda un correo**, así que una
inestabilidad no es ruido, es una falsa alarma que hace desconfiar de un cambio
que estaba bien. Pasó exactamente eso.

**Cómo se reconoce**, para no volver a perseguir el fantasma:

```
not ok 1 - test/api.test.js
  failureType: 'uncaughtException'
  error: 'Unable to deserialize cloned data due to invalid or unsupported version.'
```

Ese mensaje no habla del código: es la fontanería del ejecutor de pruebas de
Node, que no consigue serializar una excepción para contarla.

**La pista que lo delata es el recuento.** Un fallo de verdad deja el total
intacto; aquí baja —485 en vez de 506— porque `api.test.js` se muere a mitad y
sus pruebas restantes ni se ejecutan. Si el número cuadra, el fallo es real.

**Lo que NO es el problema:** las líneas
`⚠️ fallo no controlado en POST /api/video: Error: Request aborted` que salen
alrededor. Es el servidor comportándose bien —registrando que una subida se
cortó— y aparecen igual en las ejecuciones que pasan.

**El sospechoso** es `subirYCortar()` en `test/helpers/servidor.js`: corta el
socket a media subida a propósito, para cubrir la conexión que se cae con un
video de 70 MB. Es una prueba valiosa y depende del tiempo, que es la
combinación que produce inestabilidad.

### Lo que se investigó el 06/09/2026, y lo que quedó descartado

**No se encontró la causa.** Lo que sigue es para no repetir el camino.

Lo que **sí** se sabe:

- El mensaje sale del deserializador de V8, en el canal por el que el proceso
  hijo de cada archivo de pruebas le cuenta al padre cómo le fue. «Versión no
  soportada» significa que el lector empezó a leer en el sitio equivocado: o se
  colaron bytes en el canal, o un mensaje llegó cortado.
- El recuento baja porque el padre deja de leer ese archivo a mitad.

Lo que se **descartó**, con la prueba al lado:

| Hipótesis | Cómo se descartó |
|---|---|
| Es de `api.test.js` por sí solo | 8 ejecuciones del archivo suelto, todas verdes |
| Se reproduce con la suite entera a voluntad | 6 ejecuciones completas seguidas, todas verdes |
| Lo causa el registro tardío de `limpiarSubidaCortada` (500 ms después, con un temporizador `unref`) | Se parametrizó el retraso y se probó con 900, 1200, 1500, 1800 y 2200 ms, 3 ejecuciones cada uno: **0 de 15** |
| Lo causa la **clase** de escritura tardía por `stdout` | Laboratorio aparte con 40 escrituras tardías desde un temporizador `unref` y tres archivos en paralelo: **0 de 10** |

O sea que **no es una escritura tardía**, que era la sospecha obvia. El
parámetro del retraso se revirtió: no se deja código especulativo en el manejo
de errores.

Sigue apareciendo bajo carga —las dos veces que se vio en local fue con el
equipo ocupado— así que la siguiente pista razonable es la contención, no el
código.

### Mientras tanto: un reintento acotado en CI

El coste real de esto no es el fallo, es **el correo**: una falsa alarma acaba
haciendo desconfiar de un verde que sí valía.

El workflow reintenta **una vez y solo si el fallo trae ese mensaje**. Un fallo
de verdad es determinista: vuelve a fallar, y ahí ni siquiera se reintenta. Lo
único que puede esconder es código de producto genuinamente inestable, y no hay
ninguno conocido. Los cuatro casos —verde, fallo conocido que se recupera,
fallo conocido que persiste, y fallo real— se comprobaron a mano antes de
subirlo.

**Es una mitigación, no un arreglo.** El primer intento se conserva en el
registro a propósito: si esto empieza a saltar a menudo, tiene que verse.

Cuando se retome:

- **Reproducir primero.** Sin eso no hay forma de saber si un arreglo arregló
  algo o solo tuvo suerte. Probar **bajo carga**, que es donde apareció.
- **No aplicar el arreglo genérico** que sugieren las herramientas de análisis
  automático: proponen envolver multer y rehacer el manejo de errores, citando
  librerías que este repositorio no usa. Eso desharía `limpiarSubidaCortada`,
  que está puesto por un incidente real.
- La prueba que se corta **no se borra**. Cubre un fallo que ocurrió de verdad;
  lo que hay que arreglar es cómo se cuenta su excepción, no dejar de probarlo.

### En pausa: la cartelera, a evaluación del equipo

**06/09/2026.** El paso 3 de `docs/promociones.md` quedó completo —promociones
con horario, excepciones por hora en la pantalla, mezclar en vez de reemplazar,
platos sueltos e imágenes libres— y el usuario lo para aquí a propósito para
evaluarlo con su equipo antes de seguir añadiendo.

**No empezar nada más de horarios o calendario sin que él lo pida.** Lo que
venga después sale de esa evaluación, no de seguir la lista.

### Decisión abierta: ¿avisar o impedir salir con un video a medias?

**Marcado el 3 de septiembre de 2026. La decide el equipo del usuario, no
nosotros.** No proponer un cambio aquí hasta que lo digan.

Hoy, cerrar la ficha de un producto mientras un video se sube o se convierte
enseña la ventana `procesoModal`, que **avisa y deja salir**: el proceso sigue
en segundo plano y avisa al terminar con un aviso flotante.

El usuario planteaba **impedir la salida**. Se implementó avisando, con este
argumento: un video de 66 MB tarda minutos y la conversión un par más, así que
encerrar a alguien en una ficha mirando una barra es peor que dejarle seguir
trabajando, y el proceso no necesita que esté delante.

Queda a revisión con su equipo, que no ha participado en el desarrollo y por
eso lee la interfaz sin saber lo que hay detrás — que es exactamente el punto
de vista que falta aquí.

Si deciden impedir la salida, el cambio es **quitar un botón** de
`procesoModal`.

### Ocho diálogos del navegador sin unificar

**Depende de la decisión de arriba. No empezar antes.**

El panel usa dos patrones para lo mismo: la ventana en la página
(`cambiosModal`, `procesoModal`) y el `confirm()` del navegador, este último en
ocho sitios —borrar categoría, quitar imagen, quitar video, apagar la IA, y
otros—. No es una convención rota por descuido reciente: llevan conviviendo
desde antes.

El usuario prefiere la ventana en la página, y su motivo es bueno: un diálogo
del sistema en medio del panel rompe el aspecto, y en un móvil se nota más.

**Por qué esperar:** si su equipo concluye que para estas confirmaciones el
diálogo del navegador está bien —es más difícil de ignorar, y eso a veces se
busca— unificar los ocho sería trabajo tirado. Primero la regla, después
aplicarla.

## Comandos

```bash
npm test        # node --test sobre test/*.test.js
npm run dev     # nodemon
npm start       # node server.js
```

Las pruebas corren en GitHub Actions en cada push a `main` y en cada PR, con
Node 22 — la misma versión que la imagen de producción (`node:22-alpine`).
Correrlas antes de dar una tarea por terminada.

## Entorno

`.env` no está versionado. El servidor necesita al menos `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `PORT` y `TRUST_PROXY`. La lista real y dónde vive el
archivo en producción están en `docs/servidor.md`.

Ojo con `SUPABASE_SERVICE_KEY`: se salta las políticas RLS. Solo el servidor la
usa; jamás puede acabar en nada que se sirva al navegador.
