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

## 4. El interruptor `atributos.con_sedes` (Superadmin → Varias sedes)

Lo enciende **el superadmin**, restaurante por restaurante, en la pestaña
Superadmin (tarjeta «Varias sedes», junto a «Importar la carta»). Es el que decide
si un restaurante *tiene* sedes. Hasta el 04/10/2026 se encendía solo al crear la
primera sede y se apagaba al borrar la última; se cambió porque el superadmin tiene
que poder **activarlas y desactivarlas** sin tocar los datos.

Lo que hace:

- **Encendido:** aparece la pestaña **Sedes** (para el superadmin y para el dueño),
  se pueden crear sedes, la carta las lee y pregunta en cuál está el cliente, y
  Inicio dice cuántas sedes activas tiene la carta.
- **Apagado:** la pestaña desaparece, `POST /api/sedes` contesta 409, y la carta
  **ignora** las sedes y se ve la general. Las sedes y sus precios **no se borran**:
  encenderlo otra vez lo devuelve todo como estaba.
- Crear o borrar sedes **no lo mueve**. Borrar la última deja el interruptor
  encendido (la carta se ve como la de un solo local hasta que haya otra).

Es también lo que hace que la carta no pida `sedes` a nadie más: un restaurante sin
el interruptor no paga una petición de más ni depende de que las tablas existan.

**No está en `ATRIBUTOS_CLIENTE_PERMITIDOS`**: un cliente no puede encenderlo ni
apagarlo desde Ajustes. El PATCH de `atributos` se funde, así que guardar Apariencia
no lo pisa, y el servidor lo fuerza a booleano (`=== true`).

### Inicio avisa

Una carta con sedes se ve distinta de una de un solo local desde su primera pantalla
(selector, precios propios), así que el resumen de Inicio lleva una fila **Varias
sedes** —solo si el interruptor está encendido— con las sedes activas por nombre y
el aviso de que la carta pregunta en cuál está el cliente. La fila lleva a la
pestaña Sedes.

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
- **Encender las sedes es de superadmin** (§4): crear una sede con el interruptor
  apagado se rechaza, para no dejar una sede que nadie ve.
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
  `/<restaurante>/<sede>/tv` no la sirve nginx. Propuesta y problema de precios en §9.
- **Ofertas por sede.**
- **Horario por sede** en el formulario del panel (la carta ya lo soporta: es una
  clave de `CLAVES_DE_SEDE`). Ver §10: compartido por defecto, propio si se pide.
- **Pestaña Importar carta** no conoce sedes: importa a la carta base. Ver §10 para
  cómo podría servir para los precios de una sede.
- Los precios de las **variantes** de un plato («Desde $ 25.000», por proteína o
  tamaño) viven donde ya vivían, en el plato; esta función no los distingue por
  sede.

## 9. Anotado para después: la cartelera (TV) y los precios por sede

*Pedido por Jota el 04/10/2026: que quede escrito. **No está hecho** y no entra en
el PR de las sedes.*

### El problema

`tv.html` lee `productos` directamente, con el precio **base**. Una pantalla puesta
en un local con precios propios enseñaría los precios del otro, y esa es la peor
clase de error: un cliente lee en la pared un precio y en la caja le cobran otro.
Hoy, con sedes encendidas, la cartelera sigue siendo del restaurante a secas.

### La idea que se propuso: ligar cada pantalla a una sede

`atributos.tv_pantallas` ya soporta hasta **tres** carteleras por restaurante
(`docs/pantalla-tv.md` §14): la primera en `atributos.tv` (`/{slug}/tv`) y las
adicionales en `tv_pantallas["2"|"3"]` (`/{slug}/tv/2`, `/tv/3`). Cada una guarda su
propia configuración y un `nombre` que solo identifica el televisor desde el panel.

En vez de tocar esa lógica, **cada pantalla recibiría un campo `sede`** (el slug de
la sede a la que pertenece): «esta pantalla es la de Bucaramanga, esta la de
Piedecuesta». El panel lo elegiría en la tarjeta de la pantalla.

Ventajas de ligarla por configuración y no por URL:

- **No cambia ninguna URL ni hay que tocar nginx.** La regla de `tv.html` en
  `nginx.conf` (`^/([^/]+/)?tv(?:/[123])?/?$`) no admite un trozo de sede
  (`/{slug}/{sede}/tv`); haría falta ampliarla, y cada televisor ya encendido
  seguiría en su enlace de siempre.
- La lógica de pantallas, horarios y ritmo **no se toca**.
- Un restaurante con tres pantallas y dos sedes ya cabe: dos pantallas de una sede y
  una de la otra, o la que quiera.

### Lo que sí hay que resolver (y es lo interesante): los precios

Ligar la pantalla a la sede resuelve *qué pantalla es de quién*, no *qué precio
enseña*. Con precios distintos por sede, `tv.html` tendría que:

1. leer las sedes del restaurante y encontrar la suya por el slug;
2. pedir sus `productos_sedes`;
3. aplicar **la misma regla** que la carta (`productosDeLaSede` en
   `vmenus-app/core/sedes.js`): precio propio, plato no servido y, en la cartelera,
   también la ausencia de la categoría que la sede dejó vacía.

`tv.html` está escrito en el JavaScript conservador de los televisores viejos y **no
puede importar** módulos ES. Eso es una **cuarta copia de una regla** (la carta, el
panel, el servidor y ahora la TV), con el mismo coste que ya se pagó con las
ofertas (`test/casos-oferta.json`) y los datos del negocio (`casos-negocio.json`):
un juego de casos compartido y duplicado en los dos repositorios, y una prueba por
sitio, para que ninguna copia se separe sin que salte algo.

Preguntas que quedan abiertas:

- **¿Y si la pantalla no tiene sede asignada** en un restaurante con sedes? Lo
  prudente es enseñar solo los platos sin ningún precio de sede... o avisar en el
  panel y no dejar encenderla. No decidido.
- **Platos que no se sirven en esa sede** deben salir también de la selección que ya
  hizo la cartelera, no solo de la carta.
- **El `fetch` se hace desde el televisor**: dos peticiones más cada recarga, en
  aparatos lentos. Medirlo antes de decidir.
- **La oferta de precio** (`oferta_*`) se apaga en una sede con precio propio en la
  carta (§6); la TV tiene que hacer lo mismo o enseñaría un tachado que la carta no.

### Mientras tanto

Si una sede con precios distintos necesita cartelera **ya**, lo que no engaña es no
encender la pantalla de ese restaurante, o dejarla solo con platos de precio igual en
todas las sedes. Está dicho aquí para que no se descubra frente a un cliente.

## 10. QR por sede, tope de sedes y carga de precios (04/10/2026)

Pedido para dejar listo al primer cliente con sedes. Se hizo lo que no dependía de
una decisión de negocio; lo demás está más abajo con su propuesta.

### El tope de sedes lo fija el superadmin

`atributos.max_sedes` (Superadmin → Varias sedes → «Sedes contratadas (máximo)»):
un entero entre 1 y 20. El servidor lo normaliza al guardarlo (lo que no sea un
número queda en el valor por defecto, no en «sin límite») y `POST /api/sedes`
contesta 409 al llegar a él. **Sin número puesto, el tope es dos**: lo prudente si
se olvida fijarlo es no regalar sedes. El 20 sigue siendo el techo absoluto.

La pestaña Sedes dice «2 de 2 sedes contratadas» y esconde el formulario de crear
mientras no quede cupo; si falta una sede, el superadmin sube el tope y ya.

La razón de que sea un número y no «las que quiera»: la sede extra es una decisión
comercial caso por caso (el primer cliente llegado por marketing se trata distinto
de uno que paga la lista), y eso tiene que poder cambiarse sin tocar código.

### QR por sede

La pestaña QR, con sedes encendidas, deja elegir **de qué es el QR**: el del
restaurante (lleva al selector, para la puerta o las redes) o el de una sede
activa (`/<restaurante>/<sede>`, abre directo su carta, para sus mesas). El diseño
—colores, forma, logo— es uno solo; cambian el destino, el nombre del archivo
(`qr-<slug>-<sede>.png`) y, en el cartel, el pie, que dice la sede cuando es el
nombre del restaurante (un texto propio no se toca). Las sedes apagadas no salen:
su enlace no abre ninguna carta.

### Cargar precios sin teclear plato por plato

Dos herramientas en la tabla de precios de cada sede. **Solo rellenan las cajas**:
nada se guarda hasta «Guardar precios», y se deshace recargando.

- **Subir o bajar todo un %**, sobre el precio base y redondeado (500 por defecto,
  lo normal en pesos). «Solo a los vacíos» no pisa lo ya escrito; «A todos» sí.
  Los platos desmarcados («no se sirve aquí») no reciben precio.
- **Pegar precios**: una línea por plato —nombre y precio separados por tabulador
  (copiado de Excel o Sheets), `;`, `|` o dos espacios—. Se busca el plato por
  nombre sin importar tildes ni mayúsculas, y lo que **no** entró se enseña aparte
  (plato que no existe, línea sin precio): que se vea lo que quedó fuera es lo que
  permite fiarse de lo que entró. Un `19,5` se rechaza en vez de adivinar si son
  diecinueve pesos o diecinueve mil quinientos.

### ¿Sirve el importador de cartas (PDF o foto) para esto?

Sí, para **dos cosas distintas**, y conviene no mezclarlas:

1. **La carta base** (la de la sede de referencia): es justo para lo que está. Sube
   el PDF o la foto, se crean los platos, y esos precios son el *base*.
2. **Los precios de otra sede**: hoy no. El importador solo *crea* platos
   (`docs/importar-carta.md`: «añade y no pisa»); no sabe poner un precio a un plato
   que ya existe, ni en una sede. Se podría hacer un modo «importar precios de una
   sede» que lea la carta de esa sede con la misma extracción y, en vez de crear,
   **empareje por nombre** con los platos existentes (la regla de
   `normalizarNombreDePlato`) y rellene las cajas de la tabla, con la misma lista de
   «no coincidió». Cuesta una extracción de IA por carta, como cualquier importación.
   No está hecho: para una carta de 75 platos, pegar una columna ya lo resuelve; el
   importador compensa cuando la carta de la otra sede solo existe en papel.

### Pendiente de decidir o construir

- **Horario por sede.** La carta ya lo soporta (`horario_atencion` es clave de
  sede). Propuesta: **compartido por defecto**, y una casilla «esta sede tiene otro
  horario» que enseña el mismo editor de franjas de Ajustes. Así, si es el mismo en
  los dos locales, se escribe una vez; y si difiere, se puede. Falta cablear el
  editor (`horario-atencion.js`) a un contenedor que no sea el de Ajustes.
- **Reservas por sede.** Hace falta `sede_id` en `reservas` (migración), que el
  formulario de la bienvenida de una sede lo mande, que la lista del panel diga el
  local y que el mensaje de WhatsApp al comensal nombre la sede. Hoy, en la
  bienvenida de selección, el botón de reservas **se esconde** a propósito.
- **Cartelera (TV) por sede.** §9.
