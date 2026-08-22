#!/usr/bin/env bash
# ¿Sigue vivo el respaldo?
#
# El modo de fallo de un respaldo no es que reviente: es que deje de correr y
# nadie se entere. Pasa exactamente igual que con el limpiador, que estuvo
# semanas en simulacro escribiendo en un registro que nadie leía.
#
# Esto responde a la única pregunta que importa —¿cuándo fue la última copia
# buena?— y sale con código distinto de cero si la respuesta no gusta, para
# poder colgarlo de un cron con MAILTO y que avise solo.
set -euo pipefail

HORAS_MAX="${RESPALDO_HORAS_MAX:-30}"   # margen sobre las 24 h del cron
CONFIG="${RESPALDO_ENV:-/root/.respaldo.env}"

[ -r "$CONFIG" ] || { echo "❌ no se puede leer $CONFIG"; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"

ULTIMA=$(restic snapshots --tag uploads --latest 1 --json 2>/dev/null \
  | grep -o '"time":"[^"]*"' | head -1 | cut -d'"' -f4) \
  || { echo "❌ no se pudo consultar el repositorio"; exit 1; }

[ -n "$ULTIMA" ] || { echo "❌ no hay ninguna instantánea"; exit 1; }

EDAD=$(( ( $(date +%s) - $(date -d "$ULTIMA" +%s) ) / 3600 ))

echo "Última copia: $ULTIMA (hace ${EDAD} h)"
restic snapshots --tag uploads --compact 2>/dev/null | tail -12

if [ "$EDAD" -gt "$HORAS_MAX" ]; then
  echo "❌ El respaldo lleva ${EDAD} h sin correr (el tope son ${HORAS_MAX} h)."
  echo "   Mira /var/log/respaldo-uploads.log y comprueba el cron."
  exit 1
fi

echo "✅ al día"
