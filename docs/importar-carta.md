# Importar la carta desde un PDF o una imagen

Documento de diseño. Estado: **nada construido**, 06/09/2026.

Las cifras van marcadas como **medida** (sale de una ejecución real sobre un
archivo de un restaurante nuestro) o **estimada**.

---

## 1. Por qué existe

Hoy la hoja de ruta del alta es esta: creamos el restaurante, le damos acceso a
la persona, y **la persona teclea sus productos uno por uno**. Una carta de
tamaño normal son entre cuarenta y ciento setenta fichas.

Ese es el momento en el que un alta se muere. No por el precio ni por la
herramienta: por la tarde que hay que sentarse a copiar.

Y el restaurante **ya tiene la carta escrita**. En PDF si se la hizo un
diseñador, en foto si la maneja por WhatsApp. La idea es partir de ahí.

---

## 2. Las dos pruebas de realidad

No se diseña esto sobre suposiciones. Se probó con material real antes de
escribir una línea de producto.

### 2.1 PDF con capa de texto — `CARTA A OJO CERRADO.pdf` **(medida)**

| | |
|---|---|
| Páginas | 9 |
| Tamaño | 23,6 MB (casi todo son las fotos) |
| Texto extraído | 7,5 KB · 169 líneas útiles |
| Precios | **94 apariciones, 23 valores distintos** ($2.000 – $35.000) |
| Categorías | **16** |
| Tiempo | ~2 segundos |
| Coste de IA | **cero** |

Las 16: CALDOS, ENTRADAS, BEBIDAS CALIENTES, PATACONES, SALCHIPAPAS,
HAMBURGUESA, PERROS, ENSALADAS, PESCADOS, CARNES, PASTAS, RAVIOLES,
ADICIONALES, POSTRES, JUGO.

**La trampa que solo se ve haciéndolo.** El primer intento devolvió
`& $ 1 $ 6 7 , & 2`. Las fuentes van en **subconjunto** (`XXXXXX+Nombre`) y
remapean los códigos empezando en 0x20, así que leer los operadores `Tj`/`TJ` a
lo bruto da un desplazamiento constante y sale mojibake.

La solución no es una librería mejor: es **usar las tablas `/ToUnicode` que el
propio PDF trae**, una por fuente, siguiendo el operador `Tf` para saber cuál
está activa. Con eso sale `CANASTICO DE PLÁTANO` con su tilde. Este PDF trae 6
fuentes y **6 tablas**.

Quede escrito, porque quien lo implemente con la primera librería que encuentre
y no compruebe el resultado **se lleva mojibake a producción sin enterarse**.

**Lo que queda sucio:** cortes de palabra por el espaciado del diseño —
`PLÁT ANO`, `T OST ADAS`, `CA LD OS`. Vienen de que el PDF coloca cada glifo por
separado. Se limpian en parte con una regla de espacios (uno solo se quita, dos
o más separan palabras de verdad), y lo que sobreviva lo arregla el modelo al
estructurar.

### 2.2 Imagen — carta de plantilla, en inglés **(medida)**

Un JPG de una sola página, seis columnas, precios a la derecha del plato.

| | |
|---|---|
| Platos | **28, con su descripción** |
| Precios | **28** ($2 – $16) |
| Categorías | **6** (Starter, Seafood, Steaks, Drinks, Salads, Desserts) |
| Palabras partidas | **ninguna** |

En bruto salió **mejor que el PDF**, porque el modelo lee la maqueta como la lee
una persona: ve las columnas, ve que el precio de la derecha pertenece al plato
de la izquierda, y ve dónde termina una categoría.

Dos avisos sobre esta medición:

- Es **una** imagen, limpia, generada por ordenador. Una foto torcida de una
  pizarra con reflejo es otro caso y **no está probado**.
- La plantilla **repite descripciones** entre columnas (las de bebidas aparecen
  otra vez en ensaladas). Es un defecto del material de ejemplo, no del método:
  no sirve para concluir nada sobre cartas reales.

### 2.3 Lo que apareció y no estaba en el plan: **las erratas del original**

El archivo de ejemplo trae `MOZARELLA`, `NANCHOS`, `SIRLON` (tres veces),
`RASBERRY`, `FUDGE SUNDAY`. Se transcribieron tal cual, que es lo correcto por
defecto: **el importador copia, no opina**.

Pero abre una pregunta de producto que hay que contestar antes de construir la
pantalla de revisión — está en §9.

---

## 3. Corrección sobre el coste

En la conversación previa se dijo que la vía de imagen costaría «varios euros
por carta» frente a «céntimos» de la vía de texto. **Eso estaba mal por mucho** y
conviene corregirlo, porque cambia el argumento entero.

Con los números de arriba **(estimada, a partir de tamaños medidos)**:

| | Entrada al modelo | Aprox. |
|---|---|---|
| Vía texto (9 páginas) | 7,5 KB de texto plano | ~2.500 tokens |
| Vía imagen (9 páginas) | 9 imágenes de página | ~17.000 tokens |

Unas **7 veces más cara la imagen**, sí — pero las dos son **céntimos**. Lo que
domina el gasto no es la entrada sino la salida: 170 fichas estructuradas en
JSON. Y esa salida es idéntica por las dos vías.

**Entonces el motivo para preferir la capa de texto no es el precio: es la
exactitud.** Un precio leído del PDF *es* el precio, byte a byte. Un precio
leído de una imagen es la lectura de un modelo, y un modelo puede equivocarse en
un dígito sin avisar. En una carta, `$ 12.000` en vez de `$ 2.000` es un
problema real del restaurante, no una errata cosmética.

Ese es el argumento, y se sostiene solo.

---

## 4. Lo que NO se importa: las fotos

**Decisión tomada, 06/09/2026.** Se extrae **la información**: nombres, precios,
descripciones y categorías. **Las fotografías no.**

Las fotos de producto se suben aparte, como se suben hoy.

Tres razones, y la tercera es la que manda:

1. Las imágenes de un PDF vienen recortadas a la maqueta, comprimidas para
   imprimir y con el texto del diseño encima. No sirven.
2. Casar cada imagen con su plato es un problema aparte, y falla en silencio:
   la foto del pescado acaba en la hamburguesa.
3. La foto es lo que hace que una carta digital funcione. Es el trabajo que el
   restaurante **sí** quiere hacer, y donde el equipo ya tiene un flujo. No hay
   que ahorrárselo mal.

---

## 5. Arquitectura: dos vías, una sola cola

```
  archivo subido
        │
        ├── ¿trae capa de texto?
        │
       sí ──►  extraer texto  ──┐
                                ├──►  modelo estructura  ──►  BORRADOR
       no ──►  páginas a imagen ┘                                │
                                                                 ▼
                                                        pantalla de revisión
                                                                 │
                                                                 ▼
                                                     categorias + productos
```

**La detección es automática y no la decide el usuario.** Se descomprimen los
flujos de contenido y se busca `Tj`/`TJ`: si hay texto suficiente, vía de texto;
si no, vía de imagen. Un JPG o un PNG entran directos por la de abajo.

El umbral no puede ser «hay algún `Tj`», porque un escaneo con una marca de agua
en texto lo cumpliría. **Estimado:** menos de ~200 caracteres útiles por página
se trata como escaneo. Hay que calibrarlo con archivos reales antes de fijarlo.

Las dos vías desembocan en **el mismo paso** —un modelo que convierte texto o
imagen en filas— y en **el mismo borrador**. Esto es deliberado y es la misma
forma que ya tiene `video-con-ia.md` §2: dos orígenes, una cola. Lo que viene
después no sabe por dónde entró.

---

## 6. El modelo de datos

Nada se escribe en `productos` ni en `categorias` hasta que una persona lo
aprueba. En medio hace falta un sitio donde vivan las filas propuestas.

Una tabla nueva, `importaciones_carta`, con el borrador entero en `jsonb`:

| columna | para qué |
|---|---|
| `id` | |
| `restaurante_id` | |
| `origen` | `'pdf'` \| `'imagen'` |
| `via` | `'texto'` \| `'vision'` — qué camino tomó, para poder medir cuál falla |
| `archivo` | ruta del original subido |
| `estado` | `pendiente` \| `listo` \| `aplicado` \| `descartado` \| `error` |
| `borrador` | `jsonb`: el árbol de categorías y platos propuesto |
| `creado` / `actualizado` | |

El borrador se aplica a las tablas de verdad rellenando:

- **`categorias`**: `nombre`, `orden` (el orden en que aparecían en la carta).
- **`productos`**: `nombre`, `descripcion`, `categoria_id`, `orden`,
  `precio_numerico` **y** `precio`.

Las dos columnas de precio, no una. `precio` es el texto que ve el comensal y
`precio_numerico` es con lo que se ordena el menú y se suma el carrito. El
importador tiene que dejar las dos coherentes, y eso ya lo hace
`formatoPrecio()`: se le pasa el número y devuelve el texto.

Convertir `"$ 12.000"` a `12000` es quitar todo lo que no sea dígito, que es
exactamente lo que la ruta de actualización de producto ya hace hoy. **No se
escribe una segunda regla de precios.**

`imagen_url` se deja en `null` siempre. Ver §4.

### Privilegios

Tabla nueva en `public`, así que aplica lo de `sql/20`: Supabase concede por
defecto a `anon` y `authenticated`. Hacen falta **los dos `revoke`** (a `public`
y a `anon, authenticated`), `grant` explícito a `service_role`, RLS encendida
sin política permisiva, y **comprobarlo después con `has_table_privilege`**.
Un borrador de importación lleva la carta entera de un restaurante antes de
revisarla: no tiene por qué verla el navegador de nadie.

---

## 7. La pantalla de revisión

**El importador nunca escribe directo.** Propone; una persona aprueba.

No es prudencia genérica: un modelo puede colar un plato que no existe, y
detectar eso *después*, con la carta ya publicada, es mucho más caro que
mirarlo antes.

La pantalla enseña el árbol propuesto —categorías con sus platos, nombre,
descripción y precio— con todo editable en el sitio y una casilla por fila para
descartar lo que sobre. El botón de aplicar dice cuántas categorías y cuántos
platos va a crear, con el número delante.

Dos comportamientos que hay que decidir a conciencia:

- **Añadir, no reemplazar.** Si el restaurante ya tiene productos, la
  importación **suma**. Nunca borra lo que había. Es la misma regla que se tomó
  para las selecciones de la cartelera, y por el mismo motivo: reemplazar es
  irreversible y nadie lo pidió.
- **Categoría que ya existe.** Si la carta trae `POSTRES` y el restaurante ya
  tiene `Postres`, los platos van a la que existe. Casar por nombre normalizado
  (sin tildes, sin mayúsculas); si no hay coincidencia, se crea.

---

## 8. Control de coste y de abuso

Ya hay un patrón resuelto para esto en este repositorio y no hace falta inventar
otro: `generaciones_ia` + `cupo` (`sql/07`, `sql/15`), con **reserva atómica
antes de llamar al modelo**.

La importación es un caso más suave —se hace una o dos veces por restaurante, en
el alta— pero el problema es idéntico: sin cupo, alguien sube el mismo PDF de
40 páginas veinte veces y la factura la pagamos nosotros.

**Estimado:** un cupo bajo, del orden de 5 importaciones, con posibilidad de
ampliarlo a mano. Y un límite de páginas por archivo, porque el coste crece con
ellas y una carta no tiene cuarenta.

La puerta de subida hereda lo de `seguridad-subidas.md`: comprobar el contenido
real del archivo, no la extensión ni el `Content-Type`. Para PDF eso es el
`%PDF-` de cabecera; para imagen, la comprobación de firma que ya existe.

---

## 9. Lo que falta decidir

Preguntas de producto, no técnicas. Van sin contestar a propósito.

1. **Las erratas del original.** Si la carta dice `MOZARELLA`, ¿el importador
   copia o corrige? Copiar es honesto y predecible. Corregir ahorra trabajo pero
   hace que el modelo cambie un dato sin que nadie se lo pida, y algún día
   «corregirá» el nombre propio de un plato de la casa. La opción intermedia:
   copiar, y **señalar** lo que parece errata en la pantalla de revisión para
   que decida la persona.

2. **Las descripciones.** ¿Se importan tal cual, aunque muchas cartas impresas
   las traigan en mayúsculas y abreviadas? ¿O se dejan vacías y las escribe el
   restaurante?

3. **¿Quién importa?** ¿Es una herramienta del equipo, para el alta, o la ve el
   restaurante en su panel? Cambia dónde va el botón y quién consume cupo.

4. **La foto torcida.** §2.2 midió una imagen limpia. Antes de prometer la vía
   de imagen hay que probarla con **fotos de móvil reales** de cartas de
   verdad: pizarras, plastificadas con reflejo, hojas dobladas. Eso es material
   que el equipo tiene y yo no.

---

## 10. Resumen para quien llegue nuevo

- Se puede. Está **medido**, no supuesto.
- Con capa de texto: exacto y prácticamente gratis, **si** se usan las tablas
  `/ToUnicode`. Sin ellas, mojibake silencioso.
- Sin capa de texto: también funciona, cuesta unas 7 veces más de entrada
  —céntimos igual— y la diferencia real es que **puede equivocarse en un
  dígito**. Por eso el texto va primero y la visión es el respaldo.
- **Las fotos de los platos no se importan.** Se suben aparte, como hoy.
- Nada llega a `productos` sin que una persona lo apruebe.
