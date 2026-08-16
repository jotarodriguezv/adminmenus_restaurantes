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
RUN npm install --production
COPY . .

# El volumen de Dokploy se monta encima de uploads/ al arrancar, así que
# estas carpetas quedan tapadas y no son las que se usan de verdad — el
# servidor y el worker las crean sobre el volumen si faltan. Se listan aquí
# como documentación de qué carpetas maneja el sistema:
#
#   productos, promos, categorias, logos, fondos, portadas  → imágenes (ya existían)
#   originales   → el archivo crudo del móvil, se borra tras convertir
#   videos       → el entregable 720x1280 que ve el cliente
#   masters      → el 1080x1920 de archivo, nunca se sirve
#   miniaturas   → la portada JPEG de cada video
RUN mkdir -p uploads/productos uploads/promos \
             uploads/originales uploads/videos uploads/masters uploads/miniaturas

EXPOSE 3000
CMD ["node", "server.js"]
