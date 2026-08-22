# El servidor: qué hay, dónde y cómo se comprueba

Estado a **22 de agosto de 2026**. Este documento describe la máquina tal como
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

## 2. Dónde vive cada cosa

| ruta | qué es | ¿en git? |
|---|---|---|
| `/opt/menus/uploads` | **todos** los archivos: masters, videos, portadas, fotos | no |
| `/opt/menus/respaldo/` | los scripts de respaldo, copiados del contenedor | sí, en `respaldo/` |
| `/root/.respaldo.env` | credenciales de Backblaze y clave de cifrado | **NUNCA** |
| `/var/log/respaldo-uploads.log` | registro de cada copia | no |

`/opt/menus/uploads` se monta dentro del contenedor del panel como
`/app/uploads`. Es la misma carpeta vista desde dos sitios.

### Los scripts del anfitrión no se actualizan solos

Están en el repositorio, así que el despliegue los mete **dentro del
contenedor**. Pero el respaldo corre en el **anfitrión**, porque
`/opt/menus/uploads` es una carpeta suya y dentro del contenedor esa ruta no
existe.

Si algún día se cambian, hay que volver a copiarlos a mano:

```bash
docker cp $(docker ps -q --filter "name=adminvmenus"):/app/respaldo/. /opt/menus/respaldo/
chmod +x /opt/menus/respaldo/*.sh
```

**Un despliegue no hace esto.** El anfitrión seguirá corriendo la versión vieja
sin que nada lo diga.

---

## 3. Secretos

Ninguno está en el repositorio, y así debe seguir.

| secreto | dónde vive | si se pierde |
|---|---|---|
| `RESTIC_PASSWORD` | `/root/.respaldo.env` + gestor de contraseñas | **el respaldo entero es irrecuperable** |
| `B2_ACCOUNT_ID` / `B2_ACCOUNT_KEY` | `/root/.respaldo.env` | se generan otras en Backblaze |
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

**En UTC.** El respaldo de las 4:30 UTC son las **23:30 en Colombia** del día
anterior. Para moverlo a la madrugada de allá habría que poner `30 9`.

> **`MAILTO` probablemente no avisa de nada.** El servidor no tiene con qué
> enviar correo, y aunque lo tuviera, el correo directo desde la IP de un VPS
> suele acabar en spam. Está puesto porque no estorba, pero **no cuenta como
> alarma**. Ver "Lo que falta".

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

Dice cuándo fue la última copia y sale con error si pasa de 30 h. **Merece la
pena correrlo una vez a la semana** mientras no haya vigilancia externa.

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

---

## 8. Lo que falta

- **Nadie se entera si el respaldo deja de correr.** `MAILTO` no sirve (ver
  arriba). Lo estándar es un ping a un servicio externo al final del script: si
  no llega a su hora, avisan ellos. `healthchecks.io` tiene plan gratuito de
  sobra. **Es el único agujero que le queda al respaldo.**
- **Reinicio pendiente por kernel** (corre 6.8.0-134, instalado 6.8.0-138) más
  actualizaciones de seguridad sin aplicar. Con los restaurantes cerrados.
- **`docker system df`**: 26 GB usados de 48. Las imágenes viejas suelen ser lo
  que más ocupa.
- **La base de datos la respalda Supabase**, no esto. Conviene mirar qué
  retención da el plan contratado, que no es la misma en el gratuito.
- **Los archivos de menos de un día no están en ninguna copia.** Un video subido
  a las 10:00 y perdido a las 12:00 se perdió.

---

## Registro de cambios

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
