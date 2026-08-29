# Respaldo de `/opt/menus/uploads`

Esa carpeta tiene los masters, los entregables, las portadas y las fotos de
todos los restaurantes. **Dokploy respalda la base de datos y no esa carpeta.**
Perder el servidor hoy deja la base intacta apuntando a archivos que ya no
existen: vuelve la estructura, no el contenido.

Y los masters son lo que hace reversibles las decisiones de calidad. Sin ellos,
cambiar el CRF significa pedirle a cada restaurante que vuelva a grabar.

## Por qué instantáneas y no un espejo

Un `rclone sync` o un `rsync --delete` dejan el destino idéntico al origen, así
que **todo borrado se replica**. Si el limpiador de huérfanos se equivoca una
madrugada, en la siguiente pasada el respaldo también se lo lleva. Un espejo
protege de perder el disco; no protege de borrar mal — y el limpiador borra de
verdad desde el 21 de agosto.

Restic guarda instantáneas: la de ayer sigue completa aunque hoy falte medio
disco. Comprobado con un ensayo que borra 58 archivos y los recupera con los
bytes intactos.

Deduplica, así que la primera copia sube todo y las siguientes casi nada: en el
ensayo, un plato nuevo movió 1,3 MB sobre 195 MB de carpeta.

## Montarlo

### 1. Dónde guardarlo

Hace falta un sitio **fuera de este servidor**. Cualquier almacenamiento
compatible con S3 sirve; Backblaze B2 es de los más baratos para este tamaño
(los 220 MB de hoy cuestan céntimos al mes, y 50 GB rondan los 0,30 USD).

En la consola de B2: crea un bucket **privado** y luego una *application key*
con permiso de lectura y escritura sobre él. Apunta el `keyID` y el
`applicationKey` — el segundo solo se enseña una vez.

### 2. Instalar restic

```bash
apt update && apt install -y restic
```

### 3. Credenciales

Fuera del repositorio y solo legibles por root. Este archivo **nunca** va a git:

```bash
cat > /root/.respaldo.env <<'EOF'
export RESTIC_REPOSITORY="b2:NOMBRE-DEL-BUCKET:uploads"
export RESTIC_PASSWORD="una-frase-larga-que-no-uses-en-nada-mas"
export B2_ACCOUNT_ID="tu-keyID"
export B2_ACCOUNT_KEY="tu-applicationKey"
EOF
chmod 600 /root/.respaldo.env
```

> **`RESTIC_PASSWORD` cifra el respaldo. Si la pierdes, no hay forma de
> recuperar nada** — ni tú, ni Backblaze, ni nadie. Guárdala donde guardes las
> cosas importantes, y no solo en este servidor: si el motivo para restaurar es
> que se perdió el servidor, la contraseña se habría perdido con él.

### 3.bis. Poner los scripts en el anfitrión

Estos archivos viven en el repositorio, así que el despliegue los mete **dentro
del contenedor**. Pero el respaldo tiene que correr en el **anfitrión**:
`/opt/menus/uploads` es una carpeta del anfitrión y dentro del contenedor esa
ruta no existe.

```bash
mkdir -p /opt/menus/respaldo
docker cp $(docker ps -q --filter "name=adminvmenus"):/app/respaldo/. /opt/menus/respaldo/
chmod +x /opt/menus/respaldo/*.sh   # red de seguridad; ver abajo
```

> **Cada despliegue actualiza el contenedor, no `/opt/menus/respaldo/`.** Si
> algún día se cambian estos scripts hay que **repetir el `docker cp`**. Si no,
> el anfitrión sigue corriendo la versión vieja sin que nada lo diga — y eso es
> peor que no actualizarlos, porque uno cree que sí.
>
> Desde el 29/08/2026 los tres scripts están marcados como ejecutables **en el
> repositorio** (modo 100755), así que `docker cp` ya trae el permiso puesto y
> el `chmod` de arriba no debería hacer falta. Se deja porque no estorba y
> porque antes sí hacía falta: llegaban en 644 y sin él el cron no podía
> ejecutarlos, con el trabajo fallando en silencio.

### 4. Iniciar el repositorio y hacer la primera copia

```bash
. /root/.respaldo.env && restic init
/opt/menus/respaldo/respaldo.sh
```

La primera sube los ~220 MB enteros. Las siguientes, minutos y unos megas.

### 5. **Probar que se puede restaurar.** Este paso no se salta.

```bash
/opt/menus/respaldo/probar-restauracion.sh
```

Restaura la última copia en una carpeta temporal, compara el número de archivos
por carpeta y **compara byte a byte** los cinco más grandes. No toca
`/opt/menus/uploads`.

Un respaldo que nunca se ha restaurado no es un respaldo: es la esperanza de
tener uno. Hasta que esto no salga en verde, no está hecho.

### 5.bis. Comprobar que la clave ANOTADA es la buena

Hay dos copias de la contraseña: la de `/root/.respaldo.env`, que funciona
porque `restic init` la aceptó, y la que se guardó en el gestor. Si al
escribirla se fue un carácter, **no hay forma de notar que no coinciden** hasta
el día que haga falta restaurar sin el servidor delante — que es justo el día en
que la anotada es la única que queda.

```bash
env -u RESTIC_PASSWORD restic key list
```

Ignora la clave del archivo y la pide por teclado. Se escribe **la anotada**. Si
sale una tabla con una llave, la copia es correcta; si dice `wrong password`,
hay que corregirla mientras todavía se tiene la buena.

### 6. Automatizarlo

```bash
crontab -e
```

```cron
MAILTO=verificameco@gmail.com
# Respaldo diario a las 4:30, con los restaurantes cerrados.
30 4 * * * /opt/menus/respaldo/respaldo.sh >> /var/log/respaldo-uploads.log 2>&1
# Los lunes, avisar si lleva más de 30 h sin correr.
0 9 * * 1 /opt/menus/respaldo/verificar.sh
# El día 1 de cada mes, restaurar de verdad y comparar bytes.
0 10 1 * * /opt/menus/respaldo/probar-restauracion.sh >> /var/log/respaldo-prueba.log 2>&1
```

La tercera línea es del 29/08/2026. El paso 5 dice que probar la restauración no
se salta, pero sin cron eso solo pasaba el día de montarlo: el script llevaba
desde entonces diciendo que había que correrlo "de vez en cuando" y no lo corría
nadie. Es el mismo modo de fallo del que avisa `verificar.sh`, aplicado a la
comprobación que más cuesta echar de menos.

Mensual y no semanal porque restaura la copia **entera**, y con los masters de
video eso son gigas. Por eso el script mide antes lo que ocupa y se planta si no
cabe: llenar el disco del anfitrión no rompe solo la prueba, rompe la cola de
conversión y las subidas del panel. Si `/tmp` se queda corto,
`RESPALDO_DESTINO_TMP=/ruta/con/sitio` lo manda a otro disco.

`verificar.sh` solo escribe si algo va mal o si se le pide, y sale con código
distinto de cero cuando la última copia es vieja. Cron manda correo cuando un
trabajo escribe algo, así que un lunes sin correo significa que todo va bien.

El modo de fallo de un respaldo no es reventar: es **dejar de correr sin que
nadie se entere**. Igual que el limpiador, que estuvo semanas en simulacro
escribiendo en un registro que nadie leía.

### 7. Vigilancia externa

Un servidor apagado no manda un correo diciendo que está apagado. Un silencio
solo lo nota alguien de fuera que esperaba noticias — por eso esto no se puede
resolver desde el propio servidor, y por eso `MAILTO` no basta.

En [healthchecks.io](https://healthchecks.io) (plan gratuito de sobra): crear un
check, ponerle periodo de 1 día y margen de 6 horas, y copiar su URL de ping.
Luego añadirla a las credenciales:

```bash
echo 'export RESPALDO_PING=https://hc-ping.com/TU-UUID' >> /root/.respaldo.env
```

`respaldo.sh` la llama **al final y solo si todo salió bien**. Un respaldo que
falla y avisa de que fue bien sería peor que no avisar.

Y si falla, no se calla: manda el aviso a `<url>/fail` con el motivo dentro, así
que el correo llega enseguida y ya dice qué pasó, en vez de un "lleva 30 horas
sin reportar" seis horas después. El silencio queda para lo único que no se
puede avisar desde dentro: que el servidor esté apagado.

Sin `RESPALDO_PING` configurado el script no hace nada distinto, así que se
puede dejar sin poner.

Para comprobar que llega, forzar una ejecución y mirar en healthchecks que el
check pasó a verde.

## Recuperar

Ver qué hay:

```bash
. /root/.respaldo.env
restic snapshots --tag uploads
```

Recuperar una carpeta concreta de una instantánea concreta, sin tocar el resto:

```bash
restic restore <ID> --target / --include /opt/menus/uploads/masters
```

Recuperarlo todo tal como estaba ese día:

```bash
restic restore <ID> --target /
```

Sacar un archivo suelto sin restaurar nada:

```bash
restic dump <ID> /opt/menus/uploads/videos/1787002755989-kyrba5df2dh.mp4 > /tmp/recuperado.mp4
```

## Retención

| regla | para qué |
|---|---|
| `--keep-last 3` | que dos ejecuciones el mismo día no se pisen |
| `--keep-daily 7` | red contra un borrado malo reciente |
| `--keep-weekly 4` | red contra darse cuenta tarde |
| `--keep-monthly 6` | historia larga, casi sin coste por la deduplicación |

Los 7 días diarios y los 7 días de gracia del limpiador coinciden a propósito:
cualquier cosa que el limpiador borre está en al menos una instantánea.

## Lo que esto NO cubre

- **La base de datos.** La respalda Supabase por su cuenta. Conviene comprobar
  qué retención da el plan contratado, que no es lo mismo en el gratuito.
- **Los archivos de menos de un día.** Un video subido a las 10:00 y perdido a
  las 12:00 no ha entrado en ninguna copia todavía.
- **La contraseña del repositorio.** Ver el aviso de arriba.

## Qué se probó y qué no

Los tres scripts se ensayaron contra un repositorio local con una carpeta que
imita a la real (125 archivos, 194 MB, con videos de 70 MB): copia inicial,
copia incremental, verificación de frescura, restauración con comparación de
bytes, y el ensayo de borrado malo con recuperación completa.

**No se probaron contra B2**, porque hace falta una cuenta. El paso 5 es el que
convierte eso en comprobado; hasta entonces, lo de arriba es solo una promesa
razonable.
