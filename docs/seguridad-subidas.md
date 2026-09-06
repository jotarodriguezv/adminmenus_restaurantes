# Las dos puertas de subida — revisión de seguridad

**06/09/2026.** Revisión de `POST /api/upload` (imágenes) y `POST /api/video`,
que son los dos sitios por los que entra un archivo al servidor.

No es una lectura del código: se arrancó el servidor de verdad con el arnés de
pruebas y **se le lanzaron ataques**. Lo que dice este documento está
comprobado, no deducido.

---

## 1. Lo que ya estaba bien

Y conviene que quede escrito, porque lo que no se documenta se "arregla" otra
vez o se rompe sin saberlo.

| Comprobación | Resultado |
|---|---|
| Subir sin token | 401 en las dos puertas |
| `?folder=../../` | Cae en `productos`: la carpeta sale de una lista cerrada |
| Nombre `../../../server.js` | 400 — su extensión no está en la lista |
| `evil.php.jpg` | Entra, pero el nombre lo genera el servidor entero |
| `logo.svg` | 400 — un SVG es HTML ejecutable disfrazado de imagen |
| `foto.jpg;rm -rf /` | 400 — la extensión sale de la lista, no de la cadena |
| `/uploads/masters/`, `/uploads/originales/` | 404: no se sirven |
| Video sin plan | 403 |
| Video de otro restaurante | 403 |
| Video con extensión `.exe` | 400 |

**El nombre del archivo no lo escribe nunca quien sube.** Se genera entero, y la
extensión sale de una lista blanca anclada. Eso no es cosmético: cuando no lo
estaba, `foto.jpg;rm` se guardaba tal cual, `limpieza.js` leía los nombres con
`[A-Za-z0-9._-]+` y solo reconocía hasta el punto y coma — disco y base dejaban
de coincidir, y a los siete días el limpiador **borraba una foto en uso**.

**Las dos instancias de multer están separadas a propósito.** Si la de imágenes
subiera a 200 MB, cualquiera podría colar un archivo de 200 MB por la ruta de
fotos.

---

## 2. Lo que se arregló en esta revisión

### 2.1 El contenido no se miraba, solo el nombre

Se aceptaba **un HTML llamado `.jpg`**, y quedaba servido con URL permanente y
caché de un año.

**El riesgo no era que se ejecutara.** Se sirve como `image/jpeg`, y un
navegador moderno no ejecuta eso. Era que el dominio de la plataforma se
convertía en **alojamiento gratis de cualquier cosa** — se paga en ancho de
banda y en reputación del dominio.

Ahora se comprueban los **primeros 12 bytes** contra las firmas de JPEG, PNG y
WebP. Doce y no cuatro porque WebP necesita `RIFF` al principio **y** `WEBP` en
la posición 8: mirando solo los cuatro primeros entraría un WAV o un AVI con
nombre de imagen.

Se mira **después** de escribir, porque multer decide el destino antes de ver un
byte. Si no encaja, se borra.

### 2.2 No había ninguna cabecera de seguridad

Ninguna. Ahora, y **antes de todo lo demás, incluido `/salud`** — una cabecera
puesta a mitad de la lista solo protege la mitad de las respuestas:

- **`X-Content-Type-Options: nosniff`** — la que importa aquí. Sin ella, un
  navegador que adivine el tipo por el contenido podría tratar una "imagen"
  como otra cosa.
- **`X-Frame-Options: DENY`** — el panel no se enmarca desde ningún sitio.
- **`Referrer-Policy: strict-origin-when-cross-origin`**.

> ⚠️ **`X-Frame-Options` vale para el PANEL, no para el menú.** El menú público
> **sí** se enmarca: la vista previa de la cartelera lo mete en un iframe dentro
> del panel (`pantalla-tv.md` §11.quater). Poner esta cabecera en el nginx de
> `vmenus-app` rompería esa vista previa.

### 2.3 La ruta de imágenes no miraba el disco

`POST /api/video` comprobaba el espacio libre antes de escribir; `POST
/api/upload` no. Una imagen son 10 MB y no 200, pero **el limpiador tarda siete
días** en recoger huérfanos: una racha de subidas llena el disco mucho antes.

Y con el disco lleno no deja de funcionar la subida: deja de funcionar **el
servidor entero**, porque no se puede ni escribir un registro.

---

## 3. Lo que NO se arregló, y por qué

### 3.1 Sin cupo por restaurante

Cualquier restaurante con sesión puede subir imágenes hasta llenar el disco. El
guardián de espacio evita que el servidor se caiga, pero no evita el abuso.

**No se pone un número porque no hay ninguno defendible todavía.** ¿Cien fotos?
¿Quinientos megas? Es una decisión de producto, y además el tope tendría que ser
**un número del plan** —como el de promociones— y no una constante.

Hay además un obstáculo real: **un archivo subido no tiene dueño**. El panel
sube la foto en cuanto se elige y la fila no se escribe hasta guardar, así que
entre esos dos momentos no es de nadie (ver `restauranteDelArchivo`). Contar por
restaurante exige o bien apuntar quién subió cada archivo, o bien contar solo lo
referenciado — que no es lo mismo.

### 3.2 Sin `Content-Security-Policy`

El panel es una sola página con estilos y manejadores **en línea** por todas
partes. Una CSP realista necesitaría `unsafe-inline`, que es casi no tenerla;
una estricta lo rompería entero.

Ponerla de verdad significa sacar los manejadores en línea del HTML, y eso es un
trabajo aparte con su propio riesgo. **No es un olvido: es una decisión.**

### 3.3 CORS abierto

`app.use(cors())` responde `Access-Control-Allow-Origin: *` en todo.

**No se cierra, y hay una razón concreta:** el menú público llama a
`POST /api/track` desde otro dominio. Cerrarlo exige distinguir las rutas
públicas de las privadas.

El riesgo práctico hoy es bajo: la sesión va en un **token en la cabecera**, no
en una cookie, así que una página maliciosa no puede usar la sesión de nadie —
no tiene forma de leer el token de otro origen. Lo que permite es llamar a la
API desde cualquier sitio **con un token ya robado**, que es un problema
distinto y anterior.

### 3.4 El resto de tablas con permisos de más para `anon`

Salió al crear `promociones` (ver `promociones.md` §9.bis): `anon` tiene `DELETE`
sobre `productos`, `categorias` y `restaurantes`, y las tres operaciones sobre
`trabajos_video`, `eventos_analitica` y `menu_activo`.

**Todas tienen RLS activo, así que no hay nada expuesto.** Pero toda la
protección descansa en una sola barrera, igual que pasaba con `promociones`
antes del `sql/19`.

No se tocan aquí porque son tablas que llevan meses funcionando y cambiarles los
permisos dentro de una revisión que va de subidas es como se rompe algo sin que
nadie pueda rastrear por qué. **Es la siguiente tarea natural**, y se hace igual
que el `sql/19`: un `revoke` por tabla, y comprobar después.

---

## 4. Cómo repetir esto

Las sondas son un script suelto que arranca el servidor con el arnés de pruebas
—**no toca producción**, el cliente de Supabase es de mentira— y le lanza cada
ataque. Lo que dejan en el disco se borra al terminar.

Lo que ya está cubierto por `npm test` no hace falta repetirlo a mano: las
comprobaciones de contenido y de cabeceras viven ahora en `test/api.test.js`.
