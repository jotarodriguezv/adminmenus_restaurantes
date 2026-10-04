# Sedes: varios locales, una sola carta

Creado el 03/10/2026 para el caso de un restaurante con dos locales
(Piedecuesta y Bucaramanga) que comparten carta pero **no precios**: casi todos
los platos cuestan entre un 10 y un 20 % más en uno, y alguno existe solo en uno.

Las dos mitades del trabajo: la carta (`vmenus-app`, `core/sedes.js`) y este
panel (`/api/sedes`, `/api/productos-sedes`, `public/sedes.js`). La migración es
`sql/37_sedes.sql`.

## 1. Por qué este modelo y no otro

Se descartaron dos caminos simples:

- **Un restaurante por sede.** Funciona hoy sin tocar nada, pero la carta se
  duplica y cada cambio de plato o de descripción hay que hacerlo dos veces. Con
  75 platos eso se desincroniza en una semana.
- **Una carta idéntica con datos de contacto distintos.** Era la primera idea y
  no vale: los precios no coinciden.

El modelo elegido: un plato sigue siendo **uno**, con su precio de siempre (el
*base*). `productos_sedes` guarda **solo lo que cambia** en una sede: un precio
propio o que el plato no se sirve allí. Sin fila, el plato hereda.

Consecuencia que importa: un restaurante de una sola sede no tiene filas ni en
`sedes` ni en `productos_sedes`, y su carta es exactamente la de ayer.

## 2. Las tablas

- `sedes` — `restaurante_id`, `slug` (único por restaurante, va en la URL),
  `nombre`, `atributos` (datos del negocio de la sede), `orden`, `activa`.
- `productos_sedes` — `(producto_id, sede_id)`, `precio`, `precio_numerico`,
  `disponible`. `NULL` hereda. `disponible` solo vale `false` o `NULL`: un plato
  base no disponible no sale en ninguna parte y eso no se deshace desde aquí.

Lectura pública solo de lo encendido; escribe únicamente `service_role`. Nacen
con los permisos de `anon` ya cerrados (lección del `sql/19`).

### Los datos del negocio de la sede

`sedes.atributos` usa las **mismas claves** que `restaurantes.atributos`:
`direccion`, `mapa_url`, `resena_url`, `whatsapp_negocio`, `whatsapp_boton`,
`horario_atencion`, `correo`. Esa lista cerrada vive en DOS sitios —
`CLAVES_SEDE` en `server.js` y `CLAVES_DE_SEDE` en `core/sedes.js` de la carta— y
las dos tienen que coincidir. La carta ignora cualquier otra clave, así que una
sede nunca puede pisar colores, fuentes ni CSS del restaurante.

Una clave que la sede **no trae** se hereda del restaurante. Una que trae vacía
(`''`) se respeta como «no hay»: heredar el WhatsApp del restaurante en una sede
que no tiene el suyo mandaría pedidos a otro local.

## 3. La URL

`menu.vmenus.co/<restaurante>/<sede>` abre la carta de esa sede.
`menu.vmenus.co/<restaurante>` sale el selector. Lo mismo por subdominio:
`<restaurante>.vmenus.co/<sede>`. Un restaurante **sin** sedes ignora el segundo
trozo, así que `/bonzas/lo-que-sea` sigue abriendo Bonzas.

Con **una sola sede** no se pregunta nada: se entra directo a ella.

Un slug de sede no puede ser `tv`: nginx sirve `/<restaurante>/tv` como la
cartelera antes de que la carta lo vea.

## 4. La marca `atributos.con_sedes`

La carta solo pide `sedes` si el restaurante tiene `con_sedes: true`. La pone el
servidor al crear la primera sede y la quita al borrar la última. Es la que hace
que (a) ningún restaurante existente pague una petición de más y (b) la carta no
dependa de que las tablas existan.

**No está en `ATRIBUTOS_CLIENTE_PERMITIDOS`**: un cliente no puede encenderla ni
apagarla desde Ajustes. El PATCH de `atributos` se funde, así que guardar
Apariencia no la pisa.

## 5. Quién puede qué

| | Administrador | Dueño del restaurante |
|---|---|---|
| Ver las sedes | ✔ | ✔ las suyas |
| Crear, editar, apagar, borrar sedes | ✔ | ✘ |
| Poner precios y platos por sede | ✔ | ✔ |

Crear una sede extra es una decisión comercial (se acuerda y quizá se cobra), por
eso no la hace el cliente solo. Ajustar precios es el trabajo de todos los días.

## 6. Lo que se decidió a propósito

- **Si falla la lectura de `productos_sedes`, la carta se cae** («No se pudo
  cargar el menú») y no sigue con precios base. Cobrar el precio de otra sede en
  silencio es peor que un error visible. Es lo contrario de las promociones, que
  sí llevan `.catch`.
- **La oferta de precio se apaga en una sede que cambia el precio.** La oferta es
  un precio *menor que el base*; con otro base en la sede quedaría una rebaja de
  otro local o un tachado que no corresponde. Ofertas por sede es de más
  adelante.
- **`PUT /api/productos-sedes` es por lote** y borra las filas que no cambian
  nada: la tabla solo guarda excepciones. Una carta de 75 platos se carga de una
  vez; 75 peticiones sueltas dejan la sede a medias si una falla.
- **Apagar vs. borrar:** borrar una sede se lleva sus precios (`on delete
  cascade`). Apagarla (`activa = false`) los conserva. El panel lo dice al pedir
  confirmación.
- **El nombre de la carta lleva la sede** («Demo · Bucaramanga»): sale en el
  encabezado, la pestaña y el pedido de WhatsApp, donde saber de qué local viene
  es justo lo que hace falta.
- **`index.html` de la carta importa con ruta absoluta** (`/core/loader.js`).
  Con dos trozos en la URL, una ruta relativa buscaría `/<restaurante>/core/…`.

## 7. Orden de despliegue

1. **`sql/37_sedes.sql`** — aditivo; no lo lee nadie todavía. Aplicarlo antes es
   gratis. Comprobar los permisos con la consulta del final del archivo.
2. **El panel** (este repositorio) — la ruta y la pestaña. Sin sedes creadas no
   cambia nada para nadie.
3. **La carta** (`vmenus-app`) — solo pide sedes con `con_sedes`, así que es
   seguro desplegarla antes o después del paso 2.

Al revés no: la carta o el panel desplegados sin las tablas preguntarían por
algo que no existe (PostgREST responde 400).

## 8. Lo que queda fuera (fase 2)

- **Estadísticas por sede.** Hoy una visita cuenta para el restaurante.
- **Reservas por sede.** La reserva no sabe a qué sede va.
- **Televisor por sede.** `tv.html` no entiende la sede, y la ruta
  `/<restaurante>/<sede>/tv` no la sirve nginx.
- **QR por sede.** La pestaña QR genera el del restaurante; el de cada sede se
  hace hoy con el enlace que enseña la pestaña Sedes.
- **Ofertas por sede.**
- **La bienvenida**: que ofrezca elegir sede dentro de su propia tarjeta. Hoy el
  selector (`core/selector-sedes.js`) es una pantalla aparte.
- **Horario por sede** en el formulario del panel (la carta ya lo soporta: es una
  clave de `CLAVES_DE_SEDE`).
- **Carga masiva de precios** (pegar una columna, o «subir X %»): hoy se
  teclea plato por plato.
- **Pestaña Importar carta** no conoce sedes: importa a la carta base.
- Los precios de las **variantes** de un plato («Desde $ 25.000», por proteína o
  tamaño) viven donde ya vivían, en el plato; esta función no los distingue por
  sede.
