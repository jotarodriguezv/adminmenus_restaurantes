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
```

`verificar.sh` solo escribe si algo va mal o si se le pide, y sale con código
distinto de cero cuando la última copia es vieja. Cron manda correo cuando un
trabajo escribe algo, así que un lunes sin correo significa que todo va bien.

El modo de fallo de un respaldo no es reventar: es **dejar de correr sin que
nadie se entere**. Igual que el limpiador, que estuvo semanas en simulacro
escribiendo en un registro que nadie leía.

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
