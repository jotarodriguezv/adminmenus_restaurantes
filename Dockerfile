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
RUN mkdir -p uploads/productos uploads/promos \
             uploads/originales uploads/videos uploads/masters uploads/miniaturas

EXPOSE 3000
CMD ["node", "server.js"]
