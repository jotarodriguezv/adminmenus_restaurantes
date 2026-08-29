# El servidor: qué hay, dónde y cómo se comprueba

Estado a **23 de agosto de 2026**. Este documento describe la máquina tal como
está montada, no cómo montarla. Para instalar el respaldo desde cero está
`respaldo/LEEME.md`; esto es el mapa de lo que ya existe.

Se escribe porque **la mitad de lo que se hizo vive en el servidor y no en el
repositorio**: un archivo de credenciales, unas entradas de cron y unos scripts
copiados a mano. Nada de eso se despliega ni se ve en un `git log`, así que sin
esta hoja se olvida en dos semanas.

---

## 1. La máquina

`srv874049`, VPS de Hostinger, Ubuntu con Dokploy por encima. **Reloj en UTC** —
importante, porque todas las horas de cron de más abajo son UTC, no de Colombia
(UTC−5).

Contenedores relevantes (`docker ps`):

| contenedor | qué es |
|---|---|
| `vmenus-adminvmenus-…` | el panel: API, cola de conversión de video y limpiador |
| `vmenus-vmenusapp-…` | la carta pública (`vmenus-app`) |
| `vmenus-menubonza-…`, `vmenus-menumalparados-…`, `vmenus-perroscriollos-…`, `vmenus-menupostressanjavier-…` | despliegues por restaurante |

Para dar con el del panel sin depender del ID, que cambia en cada despliegue:

```bash
docker ps -q --filter "name=adminvmenus"
```

> El ID de contenedor **cambia con cada despliegue**. Guardarlo en una variable
> y reutilizarlo al día siguiente da errores confusos de "no such container".
> Usar siempre el filtro por nombre.

---

## 2. Dónde se ejecuta cada cosa

Hay **cinco** sitios distintos y las órdenes no son intercambiables. Un `docker`
dentro del contenedor no existe; un `npm test` en el anfitrión tampoco. Esta
tabla es para no tener que adivinarlo.

| # | Sitio | Cómo se entra | Se reconoce por | Qué se hace ahí |
|---|---|---|---|---|
| 1 | **El anfitrión** (el servidor) | Consola de Hostinger, o SSH | `root@srv874049:~#` y `docker ps` funciona | cron, `docker`, todo lo de `/opt/menus/` |
| 2 | **Dentro del contenedor** del panel | `docker exec -it $(docker ps -q --filter "name=adminvmenus") sh` | El prompt cambia y `/app` existe | mirar registros o archivos de la app; casi nunca hace falta |
| 3 | **El repositorio** | En tu computador, o la web de GitHub | Ves las carpetas `public/`, `core/`, `docs/` | reemplazar archivos, `git` |
| 4 | **Supabase** | `supabase.com` → SQL Editor | Es una web | las consultas de `sql/` |
| 5 | **El panel de VMenus** | El navegador, con tu PIN | Es la carta y sus pestañas | comprobar que un cambio se ve |

Regla que evita casi todos los líos: **si la orden empieza por `docker`, es el
anfitrión (1).** Y el anfitrión es el único sitio donde existe `/opt/menus/`.

> Un despliegue de Dokploy toca el **contenedor (2)** y nada más. No toca el
> anfitrión, ni el repositorio, ni la base de datos. Por eso los scripts de
> respaldo hay que copiarlos a mano — ver abajo — y por eso las consultas de
> `sql/` hay que correrlas aparte.

## 2.bis Dónde vive cada cosa

| ruta | qué es | ¿en git? |
|---|---|---|
| `/opt/menus/uploads` | **todos** los archivos: masters, videos, portadas, fotos | no |
| `/opt/menus/respaldo/` | los scripts de respaldo, copiados del contenedor | sí, en `respaldo/` |
| `/root/.respaldo.env` | credenciales de Backblaze y clave de cifrado | **NUNCA** |
| `/var/log/respaldo-uploads.log` | registro de cada copia | no |

Todas esas rutas son del **anfitrión (1)**.

`/opt/menus/uploads` se monta dentro del contenedor del panel como
`/app/uploads`. Es la misma carpeta vista desde dos sitios.

### Los scripts del anfitrión no se actualizan solos

Están en el repositorio, así que el despliegue los mete **dentro del
contenedor**. Pero el respaldo corre en el **anfitrión**, porque
`/opt/menus/uploads` es una carpeta suya y dentro del contenedor esa ruta no
existe.

Si algún día se cambian, hay que volver a copiarlos a mano:

En el **anfitrión (1)**:

```bash
docker cp $(docker ps -q --filter "name=adminvmenus"):/app/respaldo/. /opt/menus/respaldo/
chmod +x /opt/menus/respaldo/*.sh
```

**Un despliegue no hace esto.** El anfitrión seguirá corriendo la versión vieja
sin que nada lo diga.

El `chmod` va con `*` a propósito. El permiso de ejecución no viaja dentro del
archivo: viaja en el modo que git guarda, y solo si el archivo llegó al
repositorio por git. Reemplazándolos a mano —copiando o descargando— llegan en
644 y el cron no puede ejecutarlos: `Permission denied`, el trabajo falla y en
`crontab` no hay nada que lo cuente. Pasó el 29/08/2026 con
`probar-restauracion.sh`, y explica por qué `respaldo.sh` y `verificar.sh`
llevaban meses corriendo con un `+x` puesto a mano que el repositorio no sabía
que existía.

---

## 3. Secretos

Ninguno está en el repositorio, y así debe seguir.

| secreto | dónde vive | si se pierde |
|---|---|---|
| `RESTIC_PASSWORD` | `/root/.respaldo.env` + gestor de contraseñas | **el respaldo entero es irrecuperable** |
| `B2_ACCOUNT_ID` / `B2_ACCOUNT_KEY` | `/root/.respaldo.env` | se generan otras en Backblaze |
| `RESPALDO_PING` | `/root/.respaldo.env` | se regenera en healthchecks.io |
| `PIN_ADMIN` | variables de entorno de Dokploy | se cambia en el panel de Dokploy |
| PIN de cada restaurante | tabla `restaurantes_privado`, como hash bcrypt | se reasigna desde el panel |

### Sobre la clave del respaldo

Es la única de la lista que **no se puede regenerar**. Cifra el repositorio; ni
nosotros ni Backblaze podemos leer nada sin ella.

Se comprobó el 22/08/2026 que la copia guardada en el gestor **abre el
repositorio de verdad**, no solo que "parece la misma". Conviene repetirlo si
alguna vez se cambia:

```bash
env -u RESTIC_PASSWORD restic key list
```

Pide la clave por teclado ignorando la del archivo. Si lista una llave, la copia
anotada sirve.

Restic admite **varias claves** sobre el mismo repositorio. Mientras haya una
buena se puede añadir otra —una de reserva, o una para alguien del equipo—:

```bash
. /root/.respaldo.env && restic key add
```

Lo que no existe es recuperar una perdida cuando ya no queda ninguna.

---

## 4. Tareas programadas

`crontab -l` de root:

```cron
MAILTO=verificameco@gmail.com
30 4 * * * /opt/menus/respaldo/respaldo.sh >> /var/log/respaldo-uploads.log 2>&1
0 9 * * 1 /opt/menus/respaldo/verificar.sh
```

**Pendiente de añadir** (29/08/2026) — esto todavía NO está en el crontab:

```cron
0 10 1 * * /opt/menus/respaldo/probar-restauracion.sh >> /var/log/respaldo-prueba.log 2>&1
```

> El script existía desde el principio y decía que había que correrlo "de vez en
> cuando", pero no lo corría nadie — que es el modo de fallo del que avisa su
> propio repo hermano: no que reviente, sino que deje de pasar sin que nadie se
> entere. Un respaldo que nunca se ha restaurado es la esperanza de tener uno.
>
> **Antes de la línea del cron hay que copiar el script al anfitrión**, con el
> `docker cp` del paso 3.bis de `respaldo/LEEME.md`. `/opt/menus/respaldo/` no
> lo actualiza el despliegue: sin esa copia, el cron correría la versión vieja
> —la que no tiene el freno de espacio— y encima nada lo diría.
>
> Mensual y no semanal porque restaura la copia entera y con los masters de
> video eso son gigas. Por eso mismo el script comprueba antes que quepa y se
> planta si no: llenar el disco no rompe solo la prueba, rompe la cola de
> conversión y las subidas del panel. Si `/tmp` se queda corto,
> `RESPALDO_DESTINO_TMP=/ruta/con/sitio` lo manda a otro disco.

**En UTC.** El respaldo de las 4:30 UTC son las **23:30 en Colombia** del día
anterior. Para moverlo a la madrugada de allá habría que poner `30 9`.

> **`MAILTO` probablemente no avisa de nada.** El servidor no tiene con qué
> enviar correo, y aunque lo tuviera, el correo directo desde la IP de un VPS
> suele acabar en spam. Está puesto porque no estorba, pero **no cuenta como
> alarma**.
>
> La alarma de verdad es el ping de `respaldo.sh` a un servicio externo: un
> servidor apagado no manda un correo diciendo que está apagado, y un silencio
> solo lo nota quien esperaba noticias desde fuera. Ver "Lo que falta".

Confirmado el 23/08/2026 que el cron dispara de verdad: apareció una
instantánea de las 04:30 UTC que no la lanzó nadie a mano.

`respaldo.sh` avisa además a healthchecks.io al terminar — a la URL de éxito
si todo fue bien, y a `<url>/fail` con el motivo si algo falló. Esa es la
alarma real; el `MAILTO` de arriba no cuenta.

Dentro del contenedor del panel corren además, sin cron, arrancados por
`server.js`:

- **La cola de conversión de video** — mira si hay trabajos pendientes cada 15 s.
- **El limpiador de huérfanos** — cada 24 h, la primera a los 5 min de arrancar.

---

## 5. Comprobaciones rutinarias

### ¿Sigue vivo el respaldo?

```bash
/opt/menus/respaldo/verificar.sh
```

Dice cuándo fue la última copia y sale con error si pasa de 30 h. Ya no hace
falta acordarse de correrlo: desde el 23/08/2026 la vigilancia de
healthchecks.io avisa sola si el respaldo deja de reportar. Esto queda para
mirarlo a mano cuando se quiera comprobar algo concreto.

### ¿Qué está borrando el limpiador?

```bash
docker logs $(docker ps -q --filter "name=adminvmenus") 2>&1 | grep 🧹
```

La línea de arranque debe decir `BORRANDO`. Si dice `simulacro`, la variable
`LIMPIEZA_BORRAR=1` no llegó al contenedor: se pone en **Environment** de la
aplicación en Dokploy y hace falta volver a desplegar.

Si alguna pasada dice `limpieza ABORTADA`, **no subir `LIMPIEZA_TOPE` sin
mirar**: ese tope salta cuando sobraría más de la mitad del disco, y eso casi
siempre significa que la lista de referencias está rota, no que sobre todo.

### ¿Cuánto ocupa la carpeta?

```bash
docker exec $(docker ps -q --filter "name=adminvmenus") \
  sh -c 'for d in /app/uploads/*/; do echo "$(basename $d): $(ls -1 $d | wc -l)"; done; du -sh /app/uploads'
```

`originales/` debería estar **casi siempre vacía**: el original se borra al
terminar de convertir. Archivos ahí son subidas que se cortaron o conversiones
que fallaron.

---

## 6. Recuperar archivos

```bash
. /root/.respaldo.env
restic snapshots --tag uploads          # ver qué hay
```

Una carpeta concreta de una instantánea concreta, sin tocar el resto:

```bash
restic restore <ID> --target / --include /opt/menus/uploads/masters
```

Todo tal como estaba ese día:

```bash
restic restore <ID> --target /
```

Un archivo suelto, sin restaurar nada:

```bash
restic dump <ID> /opt/menus/uploads/videos/NOMBRE.mp4 > /tmp/recuperado.mp4
```

Y para confirmar que la copia sigue sirviendo (restaura aparte y compara bytes,
no toca nada):

```bash
/opt/menus/respaldo/probar-restauracion.sh
```

### Retención

`--keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 6`.

Los 7 días diarios y los 7 días de gracia del limpiador coinciden **a
propósito**: cualquier cosa que el limpiador borre está en al menos una
instantánea. Cambiar uno de los dos números sin el otro rompe esa garantía.

---

## 7. Cosas que sorprenden

Recogidas por haberlas sufrido:

- **El ID del contenedor cambia en cada despliegue.** Filtrar por nombre.
- **El anfitrión va en UTC.** Todas las horas de cron son UTC.
- **La imagen es Alpine**, así que dentro del contenedor es `apk` y el `ls` es
  el de BusyBox: no acepta `--time-style`, sí `--full-time`.
- **`/opt/menus/respaldo/` no se actualiza con los despliegues.**
- **El caché de nginx de la carta pública está en `no-cache` a propósito.** Se
  puso tras un incidente en que un `expires 1h` dejó a los visitantes con
  JavaScript viejo durante una hora después de desplegar.
- **Migrar datos y desplegar código el mismo día** deja una ventana de "código
  viejo con datos nuevos". El orden correcto es: desplegar código tolerante,
  esperar, y luego migrar.
- **El aviso de "1 zombie process" al entrar es de Dokploy, no nuestro.** Es un
  `curl` que su proceso (`node -r dotenv/config dist/server.mjs`) lanza para sus
  comprobaciones y no recoge. Uno suelto no consume nada; lo que habría que
  mirar es que se acumularan. Investigado el 23/08/2026: uno solo tras cuatro
  horas de uptime. Para comprobarlo otro día:

  ```bash
  ps -eo stat,ppid,pid,comm | awk '$1 ~ /Z/'    # cuántos y de quién cuelgan
  ```

---

## 8. Lo que falta

- ~~La vigilancia del respaldo~~ — **hecho el 23/08/2026.** Check en
  healthchecks.io (periodo 1 día, margen 6 h) y `RESPALDO_PING` en
  `/root/.respaldo.env`. Probada en los dos sentidos: una copia buena lo pone
  en verde, y un fallo lo pone en rojo con el motivo dentro.
- ~~Reinicio pendiente por kernel~~ — **hecho el 23/08/2026.** Corre
  6.8.0-138 y no quedan actualizaciones pendientes. Los 17 contenedores
  volvieron solos.
- **`docker system df`**: 26 GB usados de 48. Las imágenes viejas suelen ser lo
  que más ocupa.
- **La base de datos la respalda Supabase**, no esto. Conviene mirar qué
  retención da el plan contratado, que no es la misma en el gratuito.
- **Los archivos de menos de un día no están en ninguna copia.** Un video subido
  a las 10:00 y perdido a las 12:00 se perdió.

> Esta lista es solo lo del **servidor**. Los pendientes de infraestructura que
> no viven aquí —borrar el bucket `vmenus-imagenes` de Supabase, alargar
> `PIN_ADMIN`, ampliar a KVM 2— están en la checklist de
> `docs/cartas-en-video.md` (§11), que es la única lista completa. No se
> duplican a propósito: dos listas del mismo pendiente se desincronizan y
> entonces ninguna es de fiar.

---

## Registro de cambios

**29/08/2026 — Dónde se ejecuta cada cosa**

Sección 2 nueva, escrita después de perder un rato con un `Permission denied`
que no era del script sino del sitio desde el que se miraba. Hay cinco sitios
—anfitrión, contenedor, repositorio, Supabase y el panel— y las órdenes no son
intercambiables; ahora está la tabla con cómo se entra a cada uno y en qué se
reconoce.

La regla corta: **si la orden empieza por `docker`, es el anfitrión**, y el
anfitrión es el único sitio donde existe `/opt/menus/`.

De paso queda explicado por qué el `chmod +x` sigue haciendo falta: el permiso
de ejecución no viaja dentro del archivo, viaja en el modo que guarda git — y
solo si el archivo llegó al repositorio por git. Reemplazándolos a mano llegan
en 644 y el cron falla en silencio. Es lo que llevaba pasando desde siempre con
`respaldo.sh` y `verificar.sh`, que corren con un `+x` puesto a mano que el
repositorio no sabía que existía.

**29/08/2026 — Los tres menores de la revisión**

Cierre de lo que quedó anotado esa misma mañana.

- **`social_whatsapp` no filtraba los no-dígitos.** `wa.me` solo acepta
  dígitos, así que un `+57 300 123 4567` —como lo teclea cualquiera— arma un
  enlace que no abre ningún chat, y no se ve desde el panel: el botón existe y
  se pulsa. El checkout ya lo limpiaba desde que costó un pedido; la barra
  social montaba el enlace en crudo. Ahora comparten `soloDigitos()`, y el
  panel guarda el número ya limpio para que no entren más. Los cuatro guardados
  hoy estaban bien: era mina, no incendio.
- **`explorar.js` usaba `esc()` donde el resto usa `escUrl()`** en los seis
  `src` de imagen. No era explotable —un `javascript:` no corre en un
  `<img src>`— pero es exactamente la forma que tiene esto de romperse: una
  copia que se queda atrás, igual que cuando `esc()` vivía dentro de ese mismo
  archivo y los demás temas se quedaban sin él. Hay una prueba que recorre
  `core/` y `temas/` y falla nombrando el archivo si vuelve a aparecer.
- **`probar-restauracion.sh` no lo corría nadie.** Se añade al cron, mensual, y
  antes se le pone un freno: mide lo que ocupa la copia y no restaura si no
  cabe. La primera versión del freno **fallaba abierto** —restauraba igual— y
  lo cazó la prueba; ahora se comprueban los tres caminos (no cabe, cabe, no se
  puede medir). La línea del cron hay que añadirla a mano en el servidor.

**29/08/2026 — Lo que quedaba sin revisar: tres arreglos**

Barrido de lo que no entró en la revisión del 27/08: `public/qr.js` (540
líneas), los seis temas de vmenus-app, `core/` entero y los scripts de respaldo.
Detalle en `cartas-en-video.md` §9.13–9.15.

- **La vista previa podía suplantar una carta entera.** `css_custom` estaba en
  la lista blanca de `?preview=`, y una hoja de estilos arbitraria escribe texto
  con `content:`: la carta real —dominio, logo, platos y precios— con un teléfono
  de pedidos falso encima, sin credenciales de nadie. El aviso amarillo era la
  única defensa y el mismo CSS lo tumbaba: el shadow root cerrado protege el
  contenido, no el `<div>` que lo sostiene, y un `!important` de autor le gana a
  un estilo en línea. Se cierra la puerta (fuera de la lista) y se atranca (las
  propiedades del anfitrión con `!important` en línea, ahora en `core/aviso.js`
  con pruebas). Verificado en Chromium contra nueve formas de esconder un
  elemento.
- **Guardar el diseño del QR pisaba el resto de `atributos`.** Es el fallo de
  §9.10 en la sexta pantalla: se arreglaron las cinco de `index.html` el 27/08 y
  `public/qr.js`, por vivir en otro archivo, siguió mandando el objeto entero
  desde la copia de al entrar. Su propio comentario describía un servidor que
  había dejado de comportarse así ese mismo día.
- **El carrito no recalculaba el recargo de los toppings.** `revalidarCarrito`
  refrescaba el precio base contra el menú de hoy y el recargo lo cogía de lo
  guardado. Arreglable gracias a los identificadores del 28/08. Solo se
  recalcula si la línea trae selección: sin ella no hay base para decir que el
  recargo es cero, y ponerlo a cero cobraría de menos.

Salieron limpios: `core/horarios.js` (probado con medianoche exacta y franjas
que cruzan el día), el escapado de los seis temas —usan `textContent`—, `escUrl`
frente a `javascript:` y la validación del formulario de checkout.

Quedan anotados como menores: `social_whatsapp` no filtra no-dígitos al montar
el enlace de `wa.me` (el checkout sí lo hace; los cuatro números guardados hoy
están limpios), `explorar.js` usa `esc()` donde el resto usa `escUrl()` para los
`src` de imagen, y `respaldo/probar-restauracion.sh` no lo corre ningún cron.

**28/08/2026 — Toppings por identificador**

Los platos guardaban el **nombre** del topping, así que renombrar uno en el
panel dejaba a todos los platos que lo ofrecían apuntando a algo que ya no
existe — sin error, sin aviso y sin cobro. Por eso la pestaña Toppings solo
dejaba añadir y borrar.

Ahora cada elemento del catálogo lleva un identificador propio y los platos
guardan ese identificador. **Renombrar es seguro y el panel ya lo permite**:
se pulsa sobre el chip y se edita, precio incluido.

- No toca `server.js`: el catálogo y la selección viven en `atributos`, que el
  servidor guarda como llega. Lo que cambia es el panel (`public/index.html`) y
  el menú público (`core/carrito.js` de vmenus-app).
- `catalogoDe()` está en los dos, como `planActual()`: dos aplicaciones
  separadas, una sola definición. Si cambias una, cambia la otra.
- Un elemento **sin** identificador usa su nombre como tal. Eso es lo que
  permite desplegar sin apagar nada: las dos formas se encuentran en las dos
  direcciones.
- **El orden importa y es al revés que en `sql/13`**: primero el código,
  después `sql/14_toppings_por_identificador.sql`. Al revés, una carta con el
  JavaScript anterior abriría el modal de personalización vacío.
- La migración es idempotente —solo toca lo que le falta el identificador—,
  va en una transacción y aborta sola si dos toppings de un mismo restaurante
  acabaran con el mismo. Probada contra una copia completa de producción:
  23 elementos, 23 identificadores distintos, los 4 platos con contenido
  traducidos en el mismo orden, y una segunda pasada que cambia 0 filas.

De paso: el botón «✏ Editar» de una línea del carrito preguntaba por la copia
del catálogo dentro del plato, que ya no existe en ningún plato de ninguna
carta. Llevaba desde entonces sin salir nunca.

**Aplicado en producción el 29/08/2026**, en el orden correcto: primero los dos
despliegues, después el SQL. Comprobado contra la base después de correrlo:

| | |
|---|---|
| Elementos de catálogo sin identificador | **0** |
| Elementos de catálogo con identificador | **23** |
| Referencias de plato todavía por nombre | **0** |
| Referencias de plato ya por identificador | **79** |
| Huérfanos (plato apuntando a algo inexistente) | **0** |
| Platos con la copia vieja del catálogo dentro | **0** |

Y lo que importa no es que haya identificadores, sino que signifiquen lo mismo
que antes: resueltos de vuelta a nombres, los cuatro platos de `perroscriollos`
ofrecen exactamente lo que ofrecían, en el mismo orden, y los cuatro premium
siguen a $4.000.

**28/08/2026 — Comprobación de salud del contenedor**

Hasta ahora, para Docker el contenedor estaba sano mientras el proceso no
muriera. Un ffmpeg atascado, un bucle que no suelta el turno o un OOM a medias
lo dejan **vivo pero sin atender a nadie**, y eso no lo arreglaba nadie hasta
que alguien se quejaba.

Pesa un poco más desde el 27/08: antes, un fallo grave se llevaba el proceso por
delante y Docker lo reiniciaba solo. Con el envoltorio que impide que una
excepción mate el proceso, ahora puede quedarse vivo y tonto.

- `GET /salud` — sin credenciales, contesta `{ ok, arriba_desde_s }` y nada más.
- El `HEALTHCHECK` va **en el Dockerfile**, no en la interfaz de Dokploy: así
  viaja con el código y se despliega con él. Lo que hay que recordar configurar
  en otro sistema es justo lo que se pierde.
- Cada 30 s, 5 s de espera, 20 s de gracia al arrancar, 3 fallos seguidos para
  marcarlo enfermo.

**Lo que NO hace, a propósito:** no consulta la base de datos. Un healthcheck
corre cada pocos segundos y pegarle a Supabase en cada uno es carga constante
por nada; peor aún, si la base se cayera, fallar aquí reiniciaría el contenedor
en bucle — reiniciar no arregla una base caída, solo añade un servidor que
tampoco arranca. Y no devuelve versiones ni conteos de la cola: no lleva
autenticación, así que lo único que puede decir es que está vivo.

Comprobado con la orden exacta del `HEALTHCHECK` contra el servidor real:
código 0 con el proceso en pie, código 4 con el proceso caído.

**Las cartas también la llevan** (`Dockerfile` de vmenus-app). Ahí el proceso es
nginx, que no se cuelga como se cuelga un Node con ffmpeg detrás, pero hay un
fallo que sí atrapa: nginx vivo con la raíz web vacía —un `COPY` que salió mal,
un volumen que tapa la carpeta— acepta conexiones y responde 404 a todo el
mundo. Desde fuera eso se ve como una carta en blanco y nadie se entera hasta
que llama un restaurante. Por eso pide el `index.html` de verdad y no solo el
puerto.

No pasa por el panel a propósito: el bloque `location /` manda los robots a
`/api/og`, pero esta petición no lleva ese User-Agent y se resuelve con el
archivo local. Si preguntara por algo que cruza al panel, un panel caído
marcaría enfermas unas cartas que se sirven perfectamente sin él.

Comprobados los tres casos con la orden exacta: **404 → código 8, archivo
presente → código 0, proceso caído → código 4.**

**Estado en producción el 29/08/2026:**

| Contenedor | Estado |
|---|---|
| `adminvmenus` (panel) | `Up 11 minutes (healthy)` |
| `vmenusapp` (cartas) | `Up 14 minutes (healthy)` |
| `menubonza` | `Up 5 hours`, sin estado |
| `menumalparados` | `Up 5 hours`, sin estado |

Los dos últimos **no se redesplegaron**, así que siguen con la imagen anterior y
no tienen `HEALTHCHECK` que informar. No es un fallo —«sin estado» no es
«enfermo»— y la ganan en su próximo despliegue. Tampoco corren riesgo con lo de
los toppings: ni `bonzas` ni `malparados` tienen catálogo, así que el código
anterior y el nuevo hacen exactamente lo mismo en sus cartas. Aun así, conviene
redesplegarlos para que las cuatro cartas corran el mismo código.

**28/08/2026 — Contraste y etiquetas del panel**

Cierre de lo que quedó abierto de la revisión del día anterior. Detalle en
`cartas-en-video.md §9.11`.

`--text-dim` estaba por debajo del umbral de legibilidad en **los dos**
repositorios, y el de la carta pública era el que más pesaba: 1,92:1 en el texto
que le dice al comensal qué eligió dentro del carrito y qué está a punto de
mandar por WhatsApp. En el panel, 1,54:1 en el tema que viene por defecto, con
78 usos en tamaños de 9 a 14 px.

En el panel hubo que mover dos tokens y no uno: `--text-muted` estaba él mismo
en 3,49:1, así que subir solo el `dim` habría invertido la jerarquía. Los nueve
pares de texto sobre fondo de los tres temas quedan ahora por encima de 4,5:1.

Y las 93 etiquetas del panel, que eran `<label>` sin `for`: 62 enlazadas, 20 que
ya envolvían su campo, 11 que son títulos de grupo y piden otro marcado.

**27/08/2026 — Revisión completa del código: 33 fallos**

Repaso de los dos repositorios contra el esquema real de Supabase. No salió de
un fallo reportado sino de leer el código entero. **Ninguno de los treinta y
tres rompía una prueba**: las 427 que había estaban en verde antes y después de
confirmar cada uno.

El detalle de cada uno vive donde le toca por tema: la deuda técnica general y
todo lo del panel en `cartas-en-video.md §9.6–9.11`, el cupo de IA en
`video-con-ia.md §5`, y la vista previa del plan en `planesymodelos.md §2`. Lo
que conviene saber desde aquí:

- **Un `throw` dentro de una ruta `async` mataba el proceso entero** — panel,
  las dos colas y el limpiador a la vez. Express 4 no reenvía el rechazo de una
  promesa y Node 22 termina con código 1. Bastaba un POST sin un campo. La red
  se puso en el registro de las rutas, así que la ruta que se escriba mañana
  nace cubierta.
- **Tres rutas destructivas sin las comprobaciones que el resto sí hacía:**
  `DELETE /api/upload` no miraba de quién era el archivo, `DELETE
  /api/productos` no comprobaba contención de rutas, y `POST /api/video` era la
  única de las cuatro rutas que encolan trabajo sin freno contra dos
  conversiones del mismo plato.
- **Reconvertir borraba el master que acababa de heredar.** Había una prueba
  que lo cubría y pasaba: le entregaba una forma que producción nunca produce.
- **El freno anti-doble-generación tenía un hueco de 30 s** — miraba
  `'generando'` y una reserva nace `'reservada'`. Se cerró por las dos capas:
  la ruta mira los dos estados y `sql/13` añade un índice único parcial, que es
  lo único que cierra la carrera de verdad.
- **`atributos` se reemplazaba entero desde la copia que el panel cargó al
  entrar**, así que un guardado del superadmin devolvía a su valor viejo lo que
  el dueño hubiera cambiado mientras tanto. Ahora cada pantalla manda solo sus
  claves y las funde el servidor.

**Aplicado en la base:** `sql/13_una_generacion_en_curso_por_plato.sql`. Es
aditivo —un índice sobre una tabla sin filas en los estados que cubre— y se
verificó después: rechaza la segunda generación en curso del mismo plato y sigue
permitiendo el historial, que es sobre lo que se cuenta el cupo.

Quedan 361 pruebas, 34 nuevas. Sin revisar: el HTML y el CSS del panel.

**23/08/2026 — Reinicio y actualizaciones**

Kernel 6.8.0-134 → 6.8.0-138 y las 27 actualizaciones de seguridad que había
pendientes. Los 17 contenedores levantaron solos; no hizo falta tocar nada.

Se hizo un domingo por la tarde porque los restaurantes de San Gil abren
después de las cinco. **Antes de reiniciar se apuntó el estado** —kernel,
número de contenedores, servicios activos, si había algún video
convirtiéndose— para que la comprobación de después fuera una comparación y
no una impresión. Es barato y quita toda la duda.

La limpieza de Docker se dejó para otro día a propósito: `system prune` puede
llevarse una imagen que Dokploy necesite, y justo después de un reinicio
distinguir "no arrancó por el kernel" de "no arrancó porque le falta la
imagen" es tiempo perdido. Un cambio cada vez.

**23/08/2026 — Vigilancia del respaldo**

Faltaba lo único que no se puede resolver desde el propio servidor: enterarse
de que dejó de correr. Un servidor apagado no manda un correo diciendo que
está apagado.

- Check en healthchecks.io, periodo 1 día y margen 6 h — los mismos 30 h que
  usa `verificar.sh`, para que los dos digan lo mismo.
- Éxito → ping. Fallo → `<url>/fail` **con el motivo dentro**, así que el
  aviso llega enseguida y ya explica qué pasó, en vez de un silencio que
  tarda seis horas en notarse.
- Probada en los dos sentidos, que es lo que la convierte en alarma: una que
  solo se ha visto funcionar cuando todo va bien no está comprobada.

El mismo día se confirmó que el cron dispara solo: apareció una instantánea de
las 04:30 UTC que no lanzó nadie.

**22/08/2026 — Respaldo de `/opt/menus/uploads`**

Antes de este día esa carpeta **no la respaldaba nadie**: Dokploy respalda la
base de datos y no ese volumen. Perder el servidor habría dejado la base intacta
apuntando a archivos inexistentes.

- Repositorio restic en Backblaze B2, bucket privado `vmenus-respaldo`.
- Instantáneas, **no espejo**: un `rclone sync` replica los borrados, así que un
  error del limpiador se habría copiado al respaldo en la pasada siguiente. Un
  espejo protege de perder el disco; no de borrar mal.
- Primera copia: 148 archivos, 220 MB, en 5 s.
- Ensayo de restauración en verde: los cinco archivos más grandes byte a byte
  idénticos.
- Clave anotada verificada contra el repositorio de verdad.
- Programado a diario.

**21/08/2026 — El limpiador de huérfanos pasa a borrar de verdad**

Llevaba desde que se escribió en simulacro. Se le añadieron antes un tope de
seguridad al 50 % del disco, orden explícito en la paginación de referencias
(sin `ORDER BY` se pueden saltar filas, y una fila saltada es un archivo que
parece huérfano) y 14 pruebas.

**20-21/08/2026 — Carta en video vertical**

Modelo `vertical` con tres estilos, corte 9:16 derivado del modelo en el
servidor, y calidad propia para el vertical (crf 26 frente a 30) porque ocupa la
pantalla entera y el mismo archivo perdona menos. Solo afecta a conversiones
nuevas: lo ya convertido se rehace desde su master.
