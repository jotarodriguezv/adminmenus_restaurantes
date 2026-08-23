#!/usr/bin/env bash
# Restaura la última copia en una carpeta temporal y la compara con la real.
#
# Un respaldo que nunca se ha restaurado no es un respaldo: es la esperanza de
# tener uno. Esto convierte la esperanza en un hecho comprobado, y hay que
# correrlo el día que se monta y de vez en cuando después.
#
# NO toca /opt/menus/uploads. Restaura aparte y compara; si algo saliera mal,
# lo peor que pasa es que se llene un poco /tmp.
set -euo pipefail

CARPETA="${RESPALDO_ORIGEN:-/opt/menus/uploads}"
CONFIG="${RESPALDO_ENV:-/root/.respaldo.env}"
DESTINO=$(mktemp -d /tmp/prueba-respaldo-XXXXXX)
trap 'rm -rf "$DESTINO"' EXIT

[ -r "$CONFIG" ] || { echo "❌ no se puede leer $CONFIG"; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"

echo "── Restaurando la última copia en $DESTINO"
restic restore latest --tag uploads --target "$DESTINO" >/dev/null

RAIZ="$DESTINO$CARPETA"
[ -d "$RAIZ" ] || { echo "❌ la copia no contiene $CARPETA"; exit 1; }

echo
echo "── Archivos por carpeta"
printf '%-14s %8s %8s\n' 'carpeta' 'servidor' 'copia'
FALLOS=0
for d in "$CARPETA"/*/; do
  n=$(basename "$d")
  vivos=$(find "$d" -type f 2>/dev/null | wc -l)
  copia=$(find "$RAIZ/$n" -type f 2>/dev/null | wc -l)
  printf '%-14s %8s %8s' "$n" "$vivos" "$copia"
  # La copia puede tener MÁS archivos que el servidor y estar bien: son los que
  # se borraron después de la última instantánea, y conservarlos es justamente
  # la gracia. Lo que no puede es tener MENOS.
  if [ "$copia" -lt "$vivos" ]; then echo "  ❌ faltan $((vivos - copia))"; FALLOS=1; else echo "  ✅"; fi
done

echo
echo "── Contenido, no solo nombres"
# Se comparan de verdad unos cuantos archivos: que el nombre esté no prueba que
# los bytes estén. Se cogen los más grandes, que son los videos.
MUESTRA=$(find "$CARPETA" -type f -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -5 | cut -f2)
[ -n "$MUESTRA" ] || { echo "no hay archivos que comparar"; exit 1; }
while IFS= read -r f; do
  copia="$RAIZ${f#"$CARPETA"}"
  if [ ! -f "$copia" ]; then
    echo "❌ no está en la copia: ${f#"$CARPETA"/}"; FALLOS=1; continue
  fi
  if cmp -s "$f" "$copia"; then
    echo "✅ idéntico ($(du -h "$f" | cut -f1))  ${f#"$CARPETA"/}"
  else
    echo "❌ DIFERENTE  ${f#"$CARPETA"/}"; FALLOS=1
  fi
done <<< "$MUESTRA"

echo
[ "$FALLOS" -eq 0 ] \
  && echo "✅ La copia sirve: se restaura y el contenido coincide." \
  || { echo "❌ La copia NO es de fiar. No la des por buena."; exit 1; }
