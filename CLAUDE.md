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
| `docs/pruebas-manuales-ux.md` | **Qué comprobar a mano** de todo lo que cambió con la revisión de UX, ordenado por pantalla, con casillas. |
| `docs/revision-ux.md` | **Revisión de UX de los tres repositorios**, con una casilla por hallazgo. Leerlo antes de proponer cambios de interfaz: trae lo ya detectado, lo comprobado que **no** es un fallo, y las decisiones tomadas a propósito. |

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
- `importacion.js` — decide qué categorías y qué platos crearía un borrador, sin
  escribir nada. Las dos reglas que protege: la importación **añade y nunca
  reemplaza**, y lo nuevo entra **detrás** de lo que el restaurante ya tenía.
- `precios.js` — la regla de precios, compartida por la API y el importador.
  **Un precio se guarda dos veces** (`precio` y `precio_numerico`) y separarlos
  hace que la carta muestre uno y el carrito cobre otro. Ya pasó.
- `limpieza.js` — borra del disco los archivos que ya no referencia nadie.
- `public/ajustes.js` — la pestaña Ajustes: lo que el restaurante configura de
  su carta. Hoy, el carrito, las redes sociales y los filtros y etiquetas.
- `parada.js` — qué hace el panel al recibir `SIGTERM` en cada despliegue: deja
  de aceptar conexiones, deja terminar las abiertas, la cola de video suelta su
  trabajo y se sale antes de los 10 s de Docker. **Quitarlo devuelve el
  `Exited (137)`** y las conversiones colgadas en "convirtiendo" hasta hora y
  media, que es lo que había hasta el 14/09/2026.
- `public/` — el panel (HTML + JS servidos tal cual). Lo que usan todas las
  pestañas —`esc`, `formatPrecio`, `token` y `state`, `apiFetch`, las ventanas
  y los avisos— está en `public/comun.js`, que se carga antes del script
  principal: en scripts clásicos las declaraciones de nivel superior se
  comparten entre archivos, así que **no puede repetirse ningún nombre** entre
  ellos. `cargar()` en las pruebas recibe el archivo donde vive cada función
  —y cada trozo puede nombrar el suyo, `['tv.js', 'const X', null]`, para
  juntar varios archivos en un contexto—. Las comprobaciones de que algo **no**
  aparece usan `codigoDelPanel()`, que junta todos los archivos: contra
  `index.html` solo pasarían siempre en cuanto el código se mudara.
  Los estilos están en
  `public/panel.css` desde el 15/09/2026; las pruebas que buscan una regla de
  estilo leen `index.html` y `panel.css` juntos con `codigoDelPanel()` en
  `navegador.test.js`.

  **Al mover algo de `index.html` a otro archivo, contar las pruebas antes y
  después.** Una prueba que busca en el archivo equivocado no siempre falla: si
  el `describe` revienta al preparar, sus pruebas ni se cuentan. Al sacar el CSS
  pasó con «la fila de categoría cabe en un móvil»: el total bajó de 548 a 544.

  **En `public/index.html`, entre las declaraciones no se ejecuta nada.** Las
  funciones, `const` y `let` van seguidas, y lo que arranca —registrar oyentes,
  pintar la primera pantalla— va al final, en la sección `ARRANQUE`. No es
  estética: las pruebas de `navegador.test.js` evalúan **tramos enteros** del
  fuente, a veces de miles de líneas, y una llamada suelta a mitad de archivo
  (un `document.getElementById(...).addEventListener(...)`) revienta la prueba con
  `document is not defined`. Pasó el 13/09/2026. La pista es la de siempre: el
  total de pruebas baja.
- `sql/` — migraciones numeradas.
- `respaldo/` — scripts de copia y restauración que se ejecutan en el servidor.

## Borrar un plato lo archiva

**Desde sql/23 (16/09/2026).** `DELETE /api/productos/:id` y
`DELETE /api/categorias/:id` ya no borran: escriben `archivado_en`. Las listas
del panel filtran `archivado_en is null`, así que para quien administra la
carta no cambia nada.

**Por qué:** V-POS comparte esta base, y cada línea de un pedido apunta al plato
que se vendió. Si el plato se borra, o el borrado falla por la clave foránea
—y entonces el panel no puede borrar nada— o la venta se queda sin nombre.

Dos efectos que conviene no deshacer sin pensarlo:

- **Las fotos ya no se borran** al retirar un plato: la fila sigue siendo su
  dueña, y `limpieza.js` solo se lleva lo que no referencia nadie.
- **Una categoría archiva sus platos a mano**, antes que a ella misma. Ya no hay
  cascada que los arrastre.

La carta no necesitó cambios: el filtro vive en la política de lectura, no en
`vmenus-app`.

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

### Partir `public/index.html` por pestañas

**Acordado el 14/09/2026.** El panel es un solo archivo de 10.572 líneas: el
HTML de las once pestañas y del superadmin, 721 de CSS y unas 7.800 de
JavaScript con ~330 funciones. Funciona y está probado, pero todo cambio toca el
mismo archivo —S4 y A4 chocaron siendo independientes—, un error de sintaxis en
una pestaña tumba el panel entero, y cada cliente descarga el superadmin (T2 en
`docs/revision-ux.md`).

**Cómo:** igual que ya está `qr.js`. Archivos `<script>` clásicos, **sin paso de
compilación**, moviendo código **sin cambiar lo que hace**. Un pull request por
paso, con las pruebas en verde y la pestaña mirada en el navegador:

| Paso | Qué | Riesgo |
|---|---|---|
| 0 | **Desde ya:** lo nuevo no entra en `index.html`, va a su propio archivo | ninguno |
| ~~1~~ | ~~El CSS a `panel.css`~~ **Hecho el 15/09/2026** (719 líneas; `index.html` a 9.852) | muy bajo |
| ~~2~~ | ~~Lo común: sesión, `apiFetch`, avisos, ventanas, `esc`~~ **Hecho el 15/09/2026** en `comun.js` (`index.html` a 9.744) | bajo |
| ~~3~~ | ~~Una pestaña por PR, las más aisladas primero~~ **Hecho el 15/09/2026**: `estadisticas.js`, `tv.js`, `promocion.js`, `importar.js`, `toppings.js` y `pedidos.js` (`index.html` a 7.183) | bajo |
| 4 | Las más enlazadas: Productos, Categorías, Apariencia | medio |
| 5 | El superadmin a su archivo, cargado solo con sesión de admin (resuelve T2) | medio |

### ⏸ En pausa desde el 15/09/2026, antes del paso 4

**Decidido por el usuario.** Los pasos 1–3 entraron en producción el mismo día
—ocho archivos nuevos—, y el paso 4 toca las pestañas más enlazadas. Primero se
usa el panel unos días. **No empezar el paso 4 sin que el usuario lo pida.**

**Qué vigilar mientras tanto**, porque es lo que podría haber roto una
mudanza que las pruebas no ven:

- Un error de JavaScript al abrir el panel o una pestaña (consola del
  navegador): típicamente un nombre declarado en dos archivos, o algo que un
  archivo usa al cargar y todavía no existe.
- Una pestaña que se queda en blanco o un botón que no hace nada: un `onclick`
  que llama a una función que ya no está donde se buscaba.
- En el navegador del restaurante, un panel viejo en caché. `public/` se sirve
  con `max-age=0`, así que no debería pasar; si pasa, recargar.

**Cómo se hizo cada mudanza, para retomarlo igual** (PRs #138–#145):

1. Antes de mover, por sección: qué se ejecuta al cargar (debe ser nada),
   qué nombres usa código de fuera y **cuándo** (al cargar no vale; al usar,
   sí), qué pruebas tienen marcas dentro y qué constantes de nivel superior
   dependen de algo de fuera.
2. Mover **tal cual**, de un título `// ── ` al siguiente, con cabecera que
   diga qué es y qué comparte con otros archivos.
3. `<script src>` detrás de los ya movidos y **antes** del script principal.
4. Pruebas: contar las de `navegador.test.js` antes y después (**548**);
   `cargar()` con el archivo por trozo; lecturas del código con
   `codigoDelPanel()` cuando mezclan archivos; y comprobar que una
   comprobación negativa sigue fallando si se le mete el error a propósito.
5. Navegador con el `server.js` real y `apiFetch` sustituido por datos
   inventados: pintar la pestaña, usar un control y guardar, sin errores.

Las pruebas de `navegador.test.js` leen tramos del panel con `cargar()`;
al mover una función hay que cambiar el archivo en su llamada (`cargar('qr.js',
…)` ya lo hace). Son unas 91 llamadas, trabajo mecánico.

**Buen momento:** antes de que entre otra persona a programar, o antes de rehacer
los planes, que tocará varias pestañas a la vez.

**Lo que no se decidió:** usar un framework. No está prohibido —el proyecto se
empezó sin él, no se descartó—, y el análisis está resumido en el `CLAUDE.md` de
`C:\ProyectosVerificame`. Partir por archivos sirve en los dos casos: es el
primer paso también si algún día se adopta uno, pestaña a pestaña.

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

### El Supabase simulado no ejecuta triggers ni restricciones

**07/09/2026.** `sql/21` creó `importaciones_carta` con la columna
`actualizada_en` —en femenino, que concuerda con "importación"— y le colgó el
trigger compartido `tocar_actualizado_en()`, que escribe en `actualizado_en`.
Esa columna no existía, así que **cada `update` sobre la tabla reventaba** con
`record "new" has no field "actualizado_en"`.

Por esa tabla pasa todo lo que hace la importación de cartas: guardar el
borrador, marcar un error, guardar correcciones, aplicar y descartar. La
funcionalidad **no podía funcionar** y las 772 pruebas estaban en verde.

**Por qué ninguna lo vio:** el arnés de `test/helpers/servidor.js` sustituye
Supabase por un objeto que devuelve lo que se le diga. No hay PostgreSQL, así
que no hay triggers, ni `check`, ni claves foráneas, ni `not null`. Toda esa
familia de fallos es invisible para la suite por construcción.

Lo que se hizo: `sql/22` renombra la columna, y `test/migraciones.test.js`
comprueba las convenciones **leyendo los archivos de `sql/`** —que es lo único
que se puede comprobar sin una base de datos—. Al escribirlo hay que mirar el
conjunto y no cada archivo: una migración aplicada no se edita, lo que estaba
mal se arregla en la siguiente, y `sql/19` cierra lo que abre `sql/18`.

**Lo segundo que hay que aprender de esto:** el servidor no miraba el error del
`update` que marca el estado, así que la fila quedó en `pendiente` con `error`
en `null` —un estado imposible— y durante una tarde pareció que lo roto era la
extracción. Un `update` cuyo resultado no se mira puede esconder el motivo del
fallo que sí se ve.

### `uploads/` es una carpeta compartida entre ficheros de prueba

**07/09/2026.** El ejecutor corre cada fichero en un proceso **aparte y en
paralelo**, pero todos escriben en el mismo `uploads/`. Dos patrones que
parecen inocentes y no lo son:

- **contar** "los archivos que no estaban" mezcla los de otro fichero;
- **borrar** todos los que aparecieron se lleva los de otro fichero.

Ya había pasado con `uploads/originales` (anotado en `regresiones.test.js`), y
volvió con `uploads/productos`: una ejecución de CI dio **404 al borrar
`verif-huerfano.jpg`** porque el archivo dejó de estar en el disco entre que se
escribió y que se pidió borrarlo. **Al relanzar el mismo commit pasó en verde.**

**Lo que NO era**, y conviene no volver ahí: la ruta `DELETE /api/upload` está
bien. Un archivo huérfano —el que no referencia ninguna fila— ya se borra: la
comprobación es `if (dueno && dueno !== ...)`, así que `null` pasa. El 404 sale
de `if (!fs.existsSync(fp))`, o sea que hablaba **del disco, no de la ruta**.
Un análisis automático propuso cambiar la ruta para devolver 200 cuando el
dueño es `null`; eso ya funcionaba, y aplicarlo habría roto el 404 legítimo de
un archivo que no existe.

**Lo que se hizo:** las pruebas ya no cuentan ni borran lo que no crearon —solo
lo que nombró el servidor en esa subida, o el nombre exacto que devolvió— y las
que escriben archivos a mano usan nombres únicos por ejecución.

**Lo que queda sin demostrar:** no se consiguió reproducir el borrado en local,
ni con ejecuciones repetidas ni forzando la carrera a propósito, así que **no
está probado quién se llevó el archivo**. Lo de arriba quita el peligro y deja
la próxima vez diagnosticable: la prueba ahora comprueba que el archivo sigue
en el disco *antes* de llamar, y si falla dice cuál de las dos cosas pasó en
vez de dejar un 404 ambiguo.

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

### 09/09/2026 — dejó de ser intermitente, y eso lo hizo diagnosticable

Pasó de aparecer de vez en cuando a fallar **en todas las ejecuciones de main**,
y el reintento dejó de recuperarlo. Tres merges seguidos en rojo con la misma
firma, mientras las ramas de esos mismos pull requests pasaban en verde.

**La correlación que lo explica:** esa semana el repositorio pasó de 8 a **13
ficheros de prueba**. El ejecutor lanza un proceso hijo por fichero y los corre
en paralelo, y el error vive en `node:internal/test_runner/runner` — justamente
quien coordina esos hijos y junta lo que le mandan. Más hijos a la vez, más
probabilidad, hasta volverse constante.

Encaja con todo lo que ya se sabía: el recuento baja (767 de 805) porque
`api.test.js` se muere a mitad, el mensaje es el del deserializador de V8
leyendo un encabezado que no reconoce —o sea, un flujo desalineado— y la
sospecha que quedó anotada era «contención, no código».

**Lo que se hizo:** `npm test` corre con `--test-concurrency=1`. Un hijo cada
vez, sin coordinación que corromper.

Va en `package.json` y **no solo en el workflow**, a propósito: si local y CI
corrieran con concurrencias distintas volveríamos a tener algo que pasa aquí y
falla allí. Es el mismo motivo por el que las dos usan Node 22.

Cuesta **diez segundos** (9 s → 19 s). No es precio para nadie.

**Lo que sigue sin saberse:** por qué exactamente se corrompe el flujo. Esto
quita la condición que lo provoca; no arregla el ejecutor. Si vuelve a aparecer
con un solo hijo, la hipótesis era falsa y hay que volver aquí.

### 14/09/2026 — volvió con un solo hijo: la hipótesis era falsa. **Pendiente.**

Con `--test-concurrency=1` ya puesto, en las últimas 25 ejecuciones hubo **dos
fallos completos** (el reintento también cayó: un merge a `main` y el PR #131,
que solo tocaba un script de bash) y **al menos dos más** salvados por el
reintento. Misma firma de siempre: `api.test.js`, `uncaughtException`,
`Unable to deserialize cloned data`, y el recuento bajando de 1033 a 995.
Relanzado, pasó en verde.

Así que la concurrencia **no** era la causa, o no la única, y va a más. Queda
para una sesión dedicada, empezando por **reproducir** —en Linux y bajo carga,
que es donde aparece— antes de tocar nada.

Mientras tanto, la regla práctica: un PR en rojo **con ese mensaje y menos de
1033 pruebas** se relanza (*Re-run failed jobs*); con el recuento completo, el
fallo es real. Lo que NO hacer sigue igual que abajo: ni más reintentos ni bajar
de Node 22 — lo volvió a proponer Copilot al analizar el fallo del #131.

**Lo que NO se hizo, y conviene no hacer:**

- **Más reintentos.** Lo propuso un análisis automático. Esconde más un fallo
  que ya estaba escondido, y lo que se paga es que un rojo deje de significar
  algo.
- **Bajar a Node 20.** También lo propuso, y contradice una decisión ya tomada:
  producción es `node:22-alpine`. Probar sobre otra versión es exactamente cómo
  se consigue que algo pase en las pruebas y falle en el servidor.

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

### Decisión: abrir partes de Apariencia al restaurante

**Tomada por el usuario el 15/09/2026, al revisar A3.** Solo anotada: **no
implementar nada hasta que lo pida**, y «poco a poco», una cosa cada vez.

Cambia una decisión anterior: hasta ahora Apariencia era entera del superadmin
(`switchTab` corta si `state.rol !== 'admin'`, decisión del 09/09/2026). Lo que
queda y lo que se abre:

| Qué | Quién | Claves en `atributos` |
|---|---|---|
| **Datos del restaurante** (nombre, slug) | **solo superadmin**, lo dijo expresamente | — |
| ~~**Filtros y etiquetas**~~ **Hecho el 15/09/2026**, pestaña Ajustes; interruptor y nota el 16/09/2026 | el restaurante | `filtros_disponibles`, `filtros_activos` |
| ~~**Redes sociales**~~ **Hecho el 15/09/2026**, pestaña Ajustes | el restaurante | `social_bar`, `social_facebook`, `social_instagram`, `social_tiktok`, `social_whatsapp` |
| ~~**Carrito activable o desactivable**~~ **Hecho el 15/09/2026**, pestaña Ajustes, con vmenus-app#28 | el restaurante | `carrito` |
| Plan, modelo, colores, tipografía, CSS, dominio, zona horaria… | superadmin, **sin decidir todavía** | — |

**Hecho el 16/09/2026: Ajustes se quedó con todo lo del carrito.** Encender el
carrito hacía aparecer dos pestañas nuevas —Pedidos y Toppings— sin que nada lo
explicara, y «Pedidos» daba a entender que ahí se **ven** los pedidos, que es
otra cosa y todavía no existe. Las dos se mudaron a la tarjeta del carrito, en
Ajustes, y se guardan con su botón: todo eso escribe en
`restaurantes.atributos`, así que va en una sola petición. Con ello el carrito
ya no hace aparecer ninguna pestaña. La regla de cuándo se enseñan es la de
siempre (`cartaTieneCarrito`, PE3), ahora en `carritoEnPantalla()` y
`hayQueEnsenarToppings()` de `ajustes.js`.

Ajustado al probarlo, el mismo día: todo va **en una sola tarjeta**, con
líneas dentro (`.aj-bloque`), porque con una tarjeta por parte no se veía qué
iba con el carrito; los toppings **solo se ven con el carrito encendido**
(antes también si ya había alguno); y la pregunta de «estos platos pierden
toppings» mira **solo lo que quita ese guardado** (`toppingsQueSeQuitan`),
porque un plato que apuntaba a un topping borrado antes la hacía saltar en
cada guardado. «Platino» y «Premium» desaparecieron de todo lo que se lee —panel
y carta, vmenus-app#31—; las claves en `atributos` siguen igual.

**Anotado el 16/09/2026, sin hacer todavía: «Apariencia» ya no se llama como lo
que es.** Desde que las redes, los filtros y el carrito se fueron a Ajustes, lo
que le queda es la configuración general del restaurante —nombre, slug, plan,
modelo, dominio, zona horaria, colores—, y de eso solo lo último es apariencia.
El usuario quiere **otro nombre y la primera posición del carril, incluso antes
de Productos**, porque es la pestaña donde se monta un restaurante nuevo. Sin
decidir el nombre; «Configuración» o «General» son los candidatos. Ojo al
hacerlo: `switchTab` corta la pestaña si `state.rol !== 'admin'`, y hay pruebas
que buscan `tabBtnApariencia` y el texto «Apariencia» en los avisos.

**Lo que hay que saber antes de empezar**, comprobado ese día:

1. **El servidor ya filtra lo que puede cambiar un cliente**:
   `ATRIBUTOS_CLIENTE_PERMITIDOS` en `server.js`. Hoy son toppings, pedidos,
   pagos, QR, orden de productos y TV. Abrir algo es añadir sus claves ahí
   —y a `ATRIBUTOS_SEGUN_PLAN` si depende del plan—, **no** solo enseñar el
   formulario: esconder o enseñar una pantalla no cambia lo que acepta la API.
2. **El carrito no existía en todas las plantillas.** En `vmenus-app` solo lo
   pintaban `carrito` (siempre), `video` y `vertical` (con plan e
   interruptor); **Topnav y Sidebar no**, y son Bonzas y Malparados. **Hecho el
   15/09/2026 en vmenus-app#28**: botón flotante en Topnav, el de la cabecera en
   Sidebar, un «+» en cada plato y otro en la ficha, decidido con el usuario. La
   regla plan + interruptor quedó en una sola función, `carritoEncendido()`, y
   la lista del panel es `MODELOS_CARRITO_OPCIONAL` (`video`, `vertical`,
   `topnav`, `sidebar`, y `explorar` desde el 17/09/2026 con vmenus-app#33,
   que lleva el botón del pedido arriba junto a la lupa porque abajo está la
   barra de categorías).

   **El orden de despliegue importa:** primero la carta, después el panel. Con
   `carrito: false` la carta nueva se pinta igual que antes; al revés, un
   restaurante podría encender un carrito que su carta aún no pinta.

   **Corregido el 15/09/2026:** aquí ponía que los filtros tampoco existían en
   Topnav y Sidebar, y era falso. `core/menu.js`, el `buildMenu` que comparten,
   llama a `montarChips`, así que los filtros salen en **los seis modelos** (A4
   ya lo había comprobado). Visto en producción ese día: la carta de Bonzas
   enseña «🌶 Picante» y al pulsarlo deja solo el jalapeño.
3. **El carrito es de plan**: Vitrina no lo tiene. Lo respeta el servidor con
   `ATRIBUTOS_SEGUN_PLAN.carrito`, igual que el QR y la TV, y lo guarda como
   booleano. El interruptor solo se ofrece donde el modelo y el plan lo permiten;
   en el resto la tarjeta dice por qué no.

   **Encenderlo no basta para recibir pedidos**: hace falta el número de
   WhatsApp en la pestaña Pedidos, que aparece al guardar. Ni Bonzas ni
   Malparados lo tenían el 15/09/2026, y Ajustes lo avisa.
4. Las **redes sociales** sí salen en todas las plantillas (`core/menu.js`): es
   lo más fácil de abrir y lo que menos riesgo tiene. Son datos públicos, así
   que vivir en `restaurantes.atributos` está bien.
5. **Dónde, decidido el 15/09/2026: la pestaña «Ajustes»** (`public/ajustes.js`),
   visible para el restaurante y para el superadmin, que la usa igual. Lo que se
   abra después va ahí. Cada dato vive en **un solo sitio**: al pasar a Ajustes
   se quita de Apariencia, o las dos pantallas se pisarían al guardar.
6. **Lo que llega del restaurante se valida en el servidor**, no solo en el
   formulario, y para los dos roles: `validarRedes()` (enlaces `http(s)://`,
   WhatsApp de 8 a 15 dígitos) y `validarFiltros()` (lista de hasta 40,
   identificadores `[a-z0-9_]`, nombre de 1 a 40, solo `id`, `label` y
   `emoji`, sin repetidos). Lo siguiente que se abra necesita la suya. El
   nombre de un filtro lo pintan la carta y el panel escapado (`esc()` o
   `textContent`); comprobado en los seis modelos y en el panel antes de abrirlo.

### En diseño: rehacer los planes en dos familias, Fotos y Video

**Planteado por el usuario el 16/09/2026. Solo anotado: no implementar nada
hasta que lo pida.** Lo está pensando; lo de abajo es su idea y lo que hay que
decidir antes de escribir código.

**El problema de hoy.** Un plan mezcla tres ejes que no tienen nada que ver:
**qué es la carta** (fotos o video), **cuánto se paga** y **qué funciones
tiene**. Por eso existe un plan «Pedidos» cuya única diferencia es encender el
carrito, y un modelo «Carrito» cuya única diferencia con Sidebar es que tocar
un plato lo suma al pedido en vez de abrir su ficha.

**La idea:**

| Familia | Niveles | Qué los diferencia |
|---|---|---|
| **Fotos** | uno de entrada (¿«Inicial»?) y **«Pro»**, que es el Completo de hoy | la entrada no tiene fotos, o tiene un tope |
| **Video** | horizontal y vertical | la orientación de la carta |

- Una carta es de fotos **o** de video, nunca las dos.
- **Desaparecen «Pedidos» y «Vitrina».**
- El **carrito, los filtros y el buscador** —que todavía no existe y el usuario
  quiere en las plantillas— van **aparte** del plan.
- ~~**Explorar tendrá carrito**~~ **Hecho el 17/09/2026** (vmenus-app#33): el
  carrito ya es un interruptor en todos los modelos menos en «Carrito».
- **El modelo «Carrito» se retira.** Lo usan `aojocerrado` y `perroscriollos`,
  los dos de prueba. Pasarían a Sidebar con el carrito encendido, que es lo más
  parecido que hay. Orden: quitarlo del selector, migrar esos dos (escritura en
  producción: avisar) y después borrar el tema y su regla de «carrito siempre
  encendido».

**Lo que falta decidir:**

1. **La entrada de Fotos: ¿sin fotos o con tope?** Si es tope: cuántas, qué
   cuenta (¿la foto de cada plato y también las adicionales?; logo y fondo
   seguramente no), y qué pasa al bajar de plan con más fotos del tope. Lo
   razonable es no borrar nada y no dejar subir más. El tope tiene que
   comprobarlo el servidor, no solo el panel.
2. **Qué va en cada nivel** de lo que hoy decide el plan: el crédito «Hecho con
   VMenus», el QR personalizable, las estadísticas, los horarios, la cartelera
   de TV y las promociones.
3. **Video: ¿tiene niveles?** Hoy horizontal y vertical son el **mismo plan** y
   lo que cambia es el modelo, porque pasar de uno a otro obliga a reconvertir
   los videos (`docs/planesymodelos.md` §3). Si la orientación pasa a ser el
   plan, hay que decidir qué pasa al cambiarla.
4. **«Aparte» del plan: ¿incluido en todos o vendido como extra?** Si va
   incluido, sobra `ATRIBUTOS_SEGUN_PLAN.carrito` y el carrito es un interruptor
   en todas las cartas. Si se vende, hace falta un concepto nuevo de extras,
   separado del plan.
5. **Los nombres**, y **qué plan tiene un restaurante sin plan**: hoy cae en
   `pedidos` (`PLAN_POR_DEFECTO`), que desaparecería.

**Lo que hay que saber antes de tocarlo:**

- **`PLANES` vive en TRES sitios**, no en dos como dice
  `docs/planesymodelos.md`: `server.js`, `public/index.html` y
  `vmenus-app/core/planes.js`. El del servidor es el que manda. Es el momento
  de corregir el documento.
- **El plan se guarda por nombre** en `atributos.plan`. Renombrar obliga a
  migrar los restaurantes y, mientras tanto, a seguir entendiendo los nombres
  viejos, igual que se hizo con `filtros_activos`.
- **Los dos de producción no deberían notar nada:** Bonzas y Malparados son
  Completo, y pasarían a Fotos Pro.
- **La IA no entra en esto:** va por cupo, aparte del plan (§4 del documento).

### Decisión abierta: la sesión caduca en seco a las 8 horas

**Marcado el 14/09/2026. La decide el equipo del usuario.** No implementar nada
hasta que lo digan.

Cómo es hoy: el login firma un JWT de **8 h fijas desde que se entra** —no se
renueva usándolo— y el panel lo guarda en `sessionStorage`, así que cerrar la
pestaña ya cierra la sesión. Pasadas las 8 h la pestaña **parece abierta**, pero
la primera petición devuelve 401 y `apiFetch` llama a `logout()`.

**El problema no es de seguridad, es perder trabajo.** Quien lleva un rato
escribiendo la descripción de un plato y pulsa guardar justo después de las 8 h
acaba en el login sin aviso, y lo escrito se pierde. Afecta igual a los
restaurantes, que usan la misma sesión.

Sobre la seguridad se concluyó que **acortar la sesión no es la respuesta**: el
riesgo de una pestaña abierta es que otra persona use el equipo, y eso lo tapa
bloquear el computador, no una sesión de 2 h que obliga a entrar más veces.

Las dos opciones puestas sobre la mesa:

1. **Avisar antes de caducar** («tu sesión caduca en 5 minutos, guarda lo que
   estés editando»). Solo frontend: el panel ya tiene el token y puede leer su
   `exp`.
2. **Renovar mientras se usa** (caduca tras X tiempo sin actividad, no a las 8 h
   del login). Mejor para quien trabaja y cierra antes una pestaña olvidada,
   pero toca servidor y panel.

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
