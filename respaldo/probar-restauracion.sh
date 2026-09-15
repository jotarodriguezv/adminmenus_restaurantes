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
DESTINO=$(mktemp -d "${RESPALDO_DESTINO_TMP:-/tmp}/prueba-respaldo-XXXXXX")
SALIDA=$(mktemp "${TMPDIR:-/tmp}/prueba-respaldo-salida-XXXXXX")

# ── AVISAR A LA VIGILANCIA ────────────────────────────────────────────────
# Esta prueba corre una vez al mes desde cron, y el MAILTO de este servidor no
# llega a ningún sitio. Sin esto, el día que la copia deje de restaurarse bien
# el único rastro es una línea en un log que nadie abre: la misma trampa de la
# que protege respaldo.sh, un mes más lenta.
#
# Tiene su propio check, RESTAURACION_PING, y NO reutiliza RESPALDO_PING. Ese
# check espera noticias cada día; un ping mensual no lo mantendría vivo, y un
# fallo de aquí lo pondría en rojo como si el respaldo diario hubiera fallado,
# que no es lo que pasó.
#
# Se avisa desde un trap de salida y no en cada 'exit 1' a mano: el script
# tiene 'set -e', así que puede morirse en cualquier línea —un restic que
# revienta, un find sin permisos— sin pasar por ningún echo de error. El trap
# se entera de todas. Al fallar manda las últimas líneas de la salida, para
# que el aviso ya diga qué pasó.
#
# Sin RESTAURACION_PING configurado no hace nada distinto. Y si falta el propio
# /root/.respaldo.env no hay URL a la que avisar, pero tampoco llega el ping de
# éxito: ese silencio es el que healthchecks convierte en aviso.
exec > >(tee "$SALIDA") 2>&1
TEE_PID=$!

al_salir() {
  local codigo=$?
  rm -rf "$DESTINO"
  if [ -n "${RESTAURACION_PING:-}" ]; then
    # Hay que dejar terminar a tee antes de leer $SALIDA: si no, las últimas
    # líneas —justo las que dicen por qué falló— pueden no estar escritas aún.
    exec 1>&- 2>&-
    wait "$TEE_PID" 2>/dev/null || true
    # Los fallos del aviso no cambian el resultado de la prueba: una copia
    # buena sigue siendo buena aunque healthchecks no conteste.
    if [ "$codigo" -eq 0 ]; then
      curl -fsS -m 10 --retry 3 "$RESTAURACION_PING" > /dev/null 2>&1 || true
    else
      tail -20 "$SALIDA" | curl -fsS -m 10 --retry 3 --data-binary @- \
        "$RESTAURACION_PING/fail" > /dev/null 2>&1 || true
    fi
  fi
  rm -f "$SALIDA"
  exit "$codigo"
}
trap al_salir EXIT

[ -r "$CONFIG" ] || { echo "❌ no se puede leer $CONFIG"; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"

# El /start le dice a healthchecks que la prueba arrancó. Así mide cuánto
# tarda y, si se queda colgada restaurando, avisa por el margen en vez de
# esperar al mes siguiente.
[ -n "${RESTAURACION_PING:-}" ] && \
  curl -fsS -m 10 "$RESTAURACION_PING/start" > /dev/null 2>&1 || true

# ── ¿Cabe? ────────────────────────────────────────────────────────────────
# Esto restaura la copia ENTERA, y con los masters de video eso son gigas.
# Antes de colgarlo de un cron hay que asegurarse de que no llene el disco una
# madrugada: quedarse sin espacio no rompe solo esta prueba, rompe la cola de
# conversión y las subidas del panel.
#
# Se pide el tamaño a restic y se compara con lo libre, dejando un 20 % de
# margen. Si algo no se puede medir se avisa y se sigue —no medir no es no
# caber—, pero si se mide y NO cabe, no se intenta: mejor no probar hoy que
# tumbar el servidor probando.
espacio_libre() {
  # --output=avail da KiB y no admite -P (son excluyentes). La primera línea
  # es la cabecera.
  df --output=avail "$1" 2>/dev/null | tail -1 | tr -dc '0-9'
}

NECESARIO=$(restic stats latest --tag uploads --mode restore-size --json 2>/dev/null \
  | grep -o '"total_size":[0-9]*' | head -1 | cut -d: -f2 | tr -dc '0-9') || NECESARIO=""
LIBRE_KIB=$(espacio_libre "$(dirname "$DESTINO")")

legible() { numfmt --to=iec "$1" 2>/dev/null || echo "$1 B"; }

if [ -n "$NECESARIO" ] && [ -n "$LIBRE_KIB" ]; then
  LIBRE=$(( LIBRE_KIB * 1024 ))
  CON_MARGEN=$(( NECESARIO * 12 / 10 ))
  if [ "$LIBRE" -lt "$CON_MARGEN" ]; then
    echo "❌ No hay espacio para la prueba en $(dirname "$DESTINO")."
    echo "   La copia ocupa $(legible "$NECESARIO"); hacen falta $(legible "$CON_MARGEN") y hay $(legible "$LIBRE")."
    echo "   No se restaura nada: llenar el disco tumbaría la cola de video y las subidas."
    echo "   Usa RESPALDO_DESTINO_TMP=/ruta/con/sitio para restaurar en otro disco."
    exit 1
  fi
  echo "── La copia ocupa $(legible "$NECESARIO") y hay $(legible "$LIBRE") libres: cabe"
else
  echo "⚠ No se pudo medir $([ -z "$NECESARIO" ] && echo "el tamaño de la copia" || echo "el espacio libre"); se intenta igual"
fi

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
# los bytes estén. Se coge EL MÁS GRANDE DE CADA CARPETA.
#
# Antes eran los cinco más grandes de todo uploads/, suponiendo que serían los
# videos. Dejó de ser verdad sin que nada lo dijera: el 14/09/2026 los cinco
# fueron PDF de cartas/ de 24 MB, y ningún video ni master se comparó byte a
# byte. Por carpeta no depende de qué tipo de archivo pese más este mes: cada
# tipo tiene al menos un representante, y los masters —lo único que no se puede
# volver a generar— entran siempre que haya alguno.
#
# El recorte lo hace awk y no 'head -5' a propósito. 'head' se va en cuanto
# tiene sus cinco líneas y le cierra la tubería a 'sort', que muere de SIGPIPE
# con código 141; con 'pipefail' eso es el resultado de TODA la tubería, y con
# 'set -e' el script se muere aquí mismo, justo antes de la comprobación que más
# importa. Sin decir nada: la tabla de arriba ya salió en verde, así que parece
# que todo fue bien.
#
# Es una CARRERA, no un umbral, y por eso costó verlo: gana quien llegue antes,
# 'sort' terminando de escribir o 'head' marchándose. Con varios núcleos 'sort'
# gana casi siempre; con uno solo —que es este servidor— pierde de vez en
# cuando. Medido con los archivos de verdad: 0 de 60 con varios núcleos, 4 de
# 60 con uno. Por encima de unos 2000 archivos deja de ser carrera y muere
# siempre, porque la salida ya no cabe en el buffer de la tubería.
#
# Se vio en el servidor el 29/08/2026: una corrida terminó bien y la siguiente
# se murió aquí, minutos después y sin tocar nada.
#
# 'awk' lee hasta el final y no cierra nada: 0 de 60 en las dos condiciones.
# Por carpeta sigue valiendo: la tubería es la misma, solo que una por carpeta.
MUESTRA=$(for d in "$CARPETA"/*/; do
  find "$d" -type f -printf '%s\t%p\n' 2>/dev/null | sort -rn | awk -F'\t' 'NR==1 {print $2}'
done)
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
