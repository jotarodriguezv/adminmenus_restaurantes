#!/usr/bin/env bash
# Respaldo de /opt/menus/uploads fuera del servidor.
#
# Esa carpeta tiene los masters, los entregables, las portadas y las fotos de
# todos los restaurantes. Dokploy respalda la base de datos y NO esta carpeta,
# así que perder el servidor hoy significa quedarse con la base intacta
# apuntando a archivos que ya no existen: la estructura vuelve, el contenido no.
#
# ── Por qué instantáneas y no una copia espejo ────────────────────────────
# Un 'rclone sync' o un 'rsync --delete' mantienen el destino idéntico al
# origen. Eso significa que TODO borrado se replica: si el limpiador de
# huérfanos se equivoca una madrugada y se lleva doscientos archivos, en la
# siguiente pasada el respaldo también se los lleva y no queda de dónde
# sacarlos. Un espejo protege de perder el disco; no protege de borrar mal.
#
# Restic guarda instantáneas: cada ejecución conserva el estado de ese día, y
# las de días anteriores siguen ahí aunque el origen cambie. Con la retención
# de abajo hay margen de una semana para darse cuenta de un borrado malo. Es
# justo la protección que hace falta ahora que el limpiador borra de verdad.
#
# Deduplica y sube solo bloques nuevos, así que la primera vez sube todo y las
# siguientes casi nada: un plato nuevo al día son unos megas.
set -euo pipefail

CARPETA="${RESPALDO_ORIGEN:-/opt/menus/uploads}"
REGISTRO="${RESPALDO_LOG:-/var/log/respaldo-uploads.log}"

# Las credenciales van en un archivo aparte, fuera del repositorio y con
# permisos 600. Nunca aquí dentro: este archivo sí está en git.
CONFIG="${RESPALDO_ENV:-/root/.respaldo.env}"

decir() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$REGISTRO"; }

fallar() { decir "❌ FALLÓ: $*"; exit 1; }

[ -r "$CONFIG" ] || fallar "no se puede leer $CONFIG (¿lo creaste? ¿chmod 600?)"
# shellcheck disable=SC1090
. "$CONFIG"

[ -d "$CARPETA" ] || fallar "$CARPETA no existe"

# Guardia contra el respaldo inútil. Si la carpeta apareciera vacía —el volumen
# sin montar tras un reinicio, por ejemplo—, una instantánea vacía no rompe
# nada por sí sola, pero sí empuja a las buenas hacia el borde de la retención.
# Mejor no hacer nada y avisar.
ARCHIVOS=$(find "$CARPETA" -type f | head -1000 | wc -l)
[ "$ARCHIVOS" -gt 0 ] || fallar "$CARPETA está vacía; no se toca el respaldo"

# Dos ejecuciones a la vez sobre el mismo repositorio se bloquean entre ellas y
# dejan un cerrojo colgado que hay que quitar a mano. flock lo evita: si ya hay
# una corriendo, esta se va sin ruido.
exec 9>/var/lock/respaldo-uploads.lock
flock -n 9 || { decir "ya hay un respaldo en marcha; se salta este turno"; exit 0; }

decir "── empieza · $ARCHIVOS+ archivos en $CARPETA"

restic backup "$CARPETA" --tag uploads --host "$(hostname)" 2>&1 | tee -a "$REGISTRO" \
  || fallar "restic backup"

# Retención. Los diarios son la red contra un borrado malo reciente; los
# semanales y mensuales, contra darse cuenta tarde.
#
# El --keep-last no sobra, aunque lo parezca. Las reglas por fecha guardan LA
# ÚLTIMA de cada día, así que dos ejecuciones el mismo día dejan solo una: la
# segunda se lleva por delante a la primera. Con el cron diario da igual, pero
# el día que se lance a mano un par de veces —montándolo, o después de un
# susto— se estarían tirando justo las instantáneas que se quieren mirar.
# Salió en el ensayo de restauración: la copia de antes del borrado
# desapareció al correr el respaldo dos veces en la misma tarde.
decir "── retención"
restic forget --tag uploads \
  --keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 \
  --prune 2>&1 | tee -a "$REGISTRO" \
  || fallar "restic forget"

decir "✅ listo · $(restic snapshots --tag uploads --json | grep -o '"time"' | wc -l) instantáneas guardadas"

# ── AVISAR DE QUE SIGUE VIVO ──────────────────────────────────
# El modo de fallo de un respaldo no es reventar: es dejar de correr sin que
# nadie se entere. Y no se puede resolver desde aquí — un servidor apagado no
# manda un correo diciendo que está apagado. Solo lo nota alguien de fuera que
# esperaba noticias y no las recibe.
#
# Eso es un ping a un servicio de vigilancia: si no llega a su hora, avisan
# ellos. Es la única forma de enterarse de un silencio.
#
# Va al FINAL y solo si todo lo anterior salió bien: cualquier fallo de arriba
# corta el script por el set -e y el ping no se manda, que es exactamente lo
# que tiene que pasar. Un respaldo que falla y avisa de que fue bien es peor
# que no avisar.
#
# Sin RESPALDO_PING configurado no hace nada y no estorba.
if [ -n "${RESPALDO_PING:-}" ]; then
  if curl -fsS -m 10 --retry 3 "$RESPALDO_PING" > /dev/null; then
    decir "── vigilancia avisada"
  else
    # Que no llegue el ping no invalida el respaldo, que ya está hecho. Se
    # anota y se sigue: sería absurdo dar por fallida una copia buena porque
    # falló el aviso.
    decir "⚠️  el respaldo salió bien pero no se pudo avisar a la vigilancia"
  fi
fi
