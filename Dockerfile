FROM node:22-alpine

# ffmpeg convierte los videos que suben los restaurantes. Va antes de copiar
# el código a propósito: Docker cachea las capas en orden, y el paquete no
# cambia entre despliegues. Si estuviera después del COPY, cada despliegue
# volvería a descargarlo e instalarlo.
#
# La imagen es Alpine, no Debian: aquí es apk, no apt-get.
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./

# 'npm ci' y no 'npm install', por el mismo motivo por el que el workflow
# fija la versión de Node: que lo que corre en producción sea lo que se
# probó. 'npm install' puede resolver versiones distintas de las del
# lockfile —una dependencia indirecta que publicó un parche entre el push y
# el despliegue—, así que las pruebas pasarían sobre un árbol y el servidor
# correría otro. 'ci' instala exactamente el lockfile y falla si package.json
# y el lockfile se han separado, en vez de inventarse una resolución.
#
# --omit=dev es el reemplazo de --production, que quedó obsoleto en npm 9.
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# El volumen de Dokploy se monta encima de uploads/ al arrancar, así que
# estas carpetas quedan tapadas y no son las que se usan de verdad — el
# servidor y el worker las crean sobre el volumen si faltan. Se listan aquí
# como documentación de qué carpetas maneja el sistema:
#
#   productos, promos, categorias, logos, fondos, portadas  → imágenes (ya existían)
#   originales   → el archivo crudo del móvil, se borra tras convertir
#   videos       → el entregable 1280x720 que ve el cliente
#   masters      → el original sin recortar, de archivo, nunca se sirve
#   miniaturas   → la portada JPEG de cada video
RUN mkdir -p uploads/productos uploads/categorias uploads/promos \
             uploads/logos uploads/fondos uploads/portadas \
             uploads/originales uploads/videos uploads/masters uploads/miniaturas

EXPOSE 3000

# Sin esto, para Docker el contenedor está sano mientras el proceso no muera —
# y un proceso puede quedarse vivo sin atender a nadie: un ffmpeg atascado, un
# bucle que no suelta el turno, un OOM a medias. Con la comprobación puesta,
# tres fallos seguidos lo marcan enfermo y Dokploy puede reiniciarlo.
#
# Va en el Dockerfile y no en la interfaz de Dokploy a propósito: aquí viaja con
# el código y se despliega con él. En la interfaz hay que acordarse, y lo que
# hay que recordar en otro sistema es justo lo que se pierde.
#
# wget viene con busybox en Alpine, así que no hace falta instalar curl.
# Se usa la forma de shell —sin corchetes— para que ${PORT} se expanda: si algún
# día el puerto cambia por variable de entorno, la comprobación lo sigue.
#
# 20 s de gracia al arrancar: el servidor levanta rápido, pero además pone en
# marcha las dos colas y no tiene sentido preguntarle mientras tanto.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/salud" > /dev/null || exit 1

CMD ["node", "server.js"]
