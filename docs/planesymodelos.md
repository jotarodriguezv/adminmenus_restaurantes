# Planes, modelos y capacidades

**Para qué es este documento:** para contestar en treinta segundos "¿qué tiene
este restaurante?" sin abrir el código ni acordarse de nada. Si algo de aquí ya
no coincide con lo que hace la plataforma, manda el código y hay que corregir
este archivo.

---

## 1. Tres cosas que se confunden y no son la misma

Casi toda la confusión de esta parte del sistema viene de mezclar tres
conceptos que responden a preguntas distintas.

| | Qué contesta | Dónde vive | Quién lo cambia |
|---|---|---|---|
| **Plan** | Cuánto paga y qué tiene contratado | `restaurantes.atributos.plan` | Solo el superadmin |
| **Modelo** | Qué FORMA tiene su carta | `restaurantes.atributos.nav` | Superadmin, desde Apariencia |
| **Capacidad** | Qué puede HACER | se deriva del plan | Nadie: sale de la tabla de planes |

Un ejemplo de por qué importa: *Bonzas* es **Plan Completo**. Eso dice que no
lleva nuestra marca, que tiene estadísticas, horarios y carrito. Lo que **no**
dice —y era justo la pregunta que había que hacerse cada vez— es que su carta
es de **fotos**, porque el plan Completo no incluye video. Para eso hay que
mirar el plan *y* el modelo a la vez, que es lo que hace la línea de la lista.

---

## 2. Los planes

`PLANES` vive en dos sitios que **tienen que decir lo mismo**:
`adminmenus_restaurantes/public/index.html` y `vmenus-app/core/planes.js`. Son
dos aplicaciones desplegadas por separado; si discrepan, el panel ofrece algo
que la carta no pinta.

| Plan | Marca | QR | Estad. | Horarios | Carrito | Video |
|---|---|---|---|---|---|---|
| **Vitrina** | sí | — | — | — | — | — |
| **Pedidos** | sí | ✓ | ✓ | ✓ | ✓ | — |
| **Completo** | — | ✓ | ✓ | ✓ | ✓ | — |
| **Video** | — | ✓ | ✓ | ✓ | ✓ | ✓ |

*"Marca: sí"* significa que la carta lleva el crédito **Hecho con VMenus**. Es
al revés de lo que parece: pagar más lo quita.

El plan por defecto es **Pedidos**, y eso es a propósito: es exactamente lo que
hacía la plataforma antes de que existieran los planes, así que un restaurante
sin plan asignado no nota nada.

**Video es su propio plan y no un extra del Completo** porque su coste no se
parece: cada plato es un archivo que hay que almacenar, convertir y servir
muchas veces.

### El plan no se puede falsear desde la URL (27/08/2026)

El panel abre la carta pública con `?preview=<json>` para enseñar la apariencia
antes de guardarla, y `core/preview.js` deja pasar solo una lista de claves. La
lista plantea bien el criterio —*si un desconocido pudiera fijarle ese valor a la
carta de un cliente, ¿qué conseguiría?*— pero `'plan'` estaba dentro, y lo
contestaba por el lado malo: **el plan no es apariencia, es lo que se paga**.

Con `?preview={"atributos":{"plan":"completo"}}` desaparecía el crédito *Hecho
con VMenus* de una carta que sí lo lleva. Con `"vitrina"` se apagaba
`aplicarHorarios()` y salían categorías que estaban ocultas fuera de su franja.
El alcance es la pestaña de quien abre el enlace, así que no es grave — pero es
marca blanca regalada a quien sepa escribir una URL.

Se quitó de la lista. Probar el **modelo** de carta sigue funcionando con
`'nav'`, que sí es apariencia y no depende del plan para pintarse; un cambio de
plan se ve guardándolo.

---

## 3. Los modelos

El modelo decide la forma de la carta. Cada plan permite unos cuantos.

| Modelo | Qué es | Enseña |
|---|---|---|
| `topnav` | Categorías arriba | fotos |
| `sidebar` | Categorías al lado | fotos |
| `explorar` | Buscador y filtros | fotos |
| `carrito` | Pedido como página entera | fotos |
| `video` | Columna de tarjetas **16:9** | video |
| `vertical` | Pantalla completa **9:16**, un plato por deslizamiento | video |

Sin modelo asignado, `topnav`.

### `video` y `vertical` son el mismo plan, no dos

Cuesta lo mismo servir uno que otro: los dos entregables tienen el mismo número
de píxeles (1280×720 y 720×1280 son lo mismo girado). Lo que cambia es el
encuadre con el que se graba o se genera, y eso lo decide el restaurante. Por
eso no son dos planes ni dos precios: **son dos modelos del plan Video.**

⚠ **Pero el encuadre no es cosmético.**

### Qué pasa con los videos ya cargados si se cambia de modelo

El formato de recorte **se guarda en cada trabajo de conversión**, no se lee del
restaurante al pintar. Así que cambiar el modelo no toca nada de lo ya
convertido: los videos siguen recortados como estaban, y en la carta nueva se
ven como una franja del centro. Es deliberado — que un cambio de ajuste
reprocese la carta entera sin avisar sería peor.

Lo que pasa entonces, paso a paso:

1. Cambias el modelo en Apariencia (`video` ⇄ `vertical`).
2. Los videos existentes **siguen funcionando**, mal encuadrados.
3. En la ficha de cada plato aparece un aviso naranja: *"este video se recortó
   apaisado y tu carta ahora es vertical"*, con el botón **Reconvertir**.
4. Reconvertir vuelve a cortar **desde el master**, que se guarda sin recortar
   justamente para esto. No hay que volver a grabar, no cuesta dinero, y en un
   video generado con IA **no gasta otra animación**.

El aviso solo sale cuando de verdad hace falta: video publicado, con master, y
en un formato distinto al de la carta. Ver `docs/cartas-en-video.md`.

⚠ **Lo único que no se recupera** es lo que el recorte original ya tiró — pero
el master no está recortado, así que en la práctica se recupera todo. Los
videos convertidos antes de que existiera el master son la excepción.

---

## 4. La IA no viene con el plan de video

**Que una carta sea de video no significa que pueda fabricar video.** Servir un
archivo cuesta almacenamiento; generarlo cuesta dinero cada vez, a un tercero.

Por eso el interruptor es aparte (`restaurantes_ia.activa`), y por eso hay
**tres estados distintos que antes se confundían en uno**. Cada uno lleva a una
acción diferente, y esa es toda la razón de separarlos:

| Estado | Qué significa | Qué se ve | Qué se hace |
|---|---|---|---|
| `activa = false` | Esta carta no genera. Decisión de producto. | El botón **no existe** | Encenderla desde la lista |
| `cupo = 0` | Podría, pero no se le ha dado ninguna | "sin animaciones disponibles" | Darle cupo |
| `usadas >= cupo` | Se le acabaron | "sin animaciones disponibles" | Conversación comercial |

El caso que hizo falta: **un restaurante con la carta ya completa no necesita
seguir generando**, y dejarle la puerta abierta es dejar abierta una forma de
gastar. Apagarlo no puede exigir bajarle el plan —seguiría necesitando servir
sus videos— ni ponerle el cupo a cero, que significa otra cosa y le invita a
pedir más.

**Apagar esconde el botón, no lo deja muerto.** Un botón apagado con un "no
disponible" invita a preguntar por algo que se quitó a propósito. El cupo se
conserva: si se vuelve a encender, sigue donde iba.

---

## 5. Cómo leer la lista de restaurantes

Cada tarjeta lleva una fila de etiquetas que contesta las cuatro preguntas en
el orden en que se hacen:

```
[📷 solo fotos] [Topnav] [🛒 pedidos] [PLAN COMPLETO]
[🎬 video vertical 9:16] [Vertical] [🛒 pedidos] [✨ IA] [PLAN VIDEO]
[🎬 video apaisado 16:9] [Video] [🛒 pedidos] [✨ IA apagada] [PLAN VIDEO]
```

Son etiquetas y no un texto con separadores porque cada dato tiene que poder
envolver **entero**: con "·" el salto de línea caía en cualquier sitio y dejaba
el punto colgando al principio de la línea siguiente.

1. **Qué le enseña al comensal** — fotos o video, y en qué encuadre
2. **El modelo** — la forma de la carta
3. **Si puede pedir** — solo aparece cuando lo tiene; "sin carrito" en tres
   cuartas partes de la lista sería ruido
4. **La IA** — solo en planes con video, pero ahí **siempre**, encendida o
   apagada: el silencio se leería como "no la tiene", y son cosas distintas
5. **El plan**, al final, porque es lo que menos cambia

Debajo, cuando hay algo que contar, la segunda línea con el estado del video:

```
[🎬 12 videos] [👀 1 sin revisar] [⏳ 2 convirtiendo] [✨ 14/24 con IA]
```

**"sin revisar" no está en la carta.** Es un video generado, convertido y
pagado que espera a que alguien lo mire; hasta entonces el plato sigue
enseñando su foto. Se publica o se descarta desde la ficha del plato.

### Producción o prueba (31/08/2026)

De los nueve restaurantes, **dos son clientes de verdad** —bonzas con 97 platos
y malparados con 37, los dos pagando— y los otros siete son demos y pruebas;
uno de ellos con cero platos. Hasta ahora nada lo decía, así que en la lista se
veían todos igual y cualquier promedio los mezclaba.

Ahora los de prueba llevan un distintivo a rayas, el primero de la fila:

```
[Prueba] [Vencido desde 1 ago] [📷 solo fotos] [Topnav] [PLAN VIDEO]
```

**Producción no lleva etiqueta.** Son la mayoría de los que importan, y llenar
la lista de distintivos «Producción» haría que el de «Prueba» dejara de saltar
a la vista, que es lo único que tiene que hacer.

Se cambia en **Apariencia → Datos del restaurante**, solo superadmin.

**Es solo una etiqueta.** No cambia la carta pública, ni los respaldos, ni las
estadísticas, ni los cupos de IA. Se decidió así a propósito: el problema que
resuelve es de lectura —no confundir una demo con un cliente al mirar los
números—, y encadenarlo a comportamientos habría que pensarlo caso por caso.
Si algún día tiene que hacer más, la columna ya está puesta.

**Dónde vive, y por qué no en `atributos`.** En `restaurantes_facturacion`
(`sql/16_restaurantes_de_prueba.sql`). `restaurantes.atributos` se lee
públicamente, y que un restaurante sea una demo es un dato **nuestro sobre él**,
no suyo: la misma clase que el día de pago, que ya salió de ahí por este motivo
en `sql/06`. Esa tabla ya tiene RLS sin políticas y una API solo-superadmin en
las dos direcciones, así que no hacía falta nada nuevo.

El nombre de la tabla se queda corto —«facturación» para «esto es una demo»—
aunque encaja: una demo es un restaurante al que no se le factura. Si se
acumula más metadato de plataforma que no sea cobranza, el movimiento es
renombrarla a `restaurantes_plataforma`.

El servidor la borra de `atributos` al guardar, junto a `dia_pago` y
`ultimo_pago`, y por lo mismo: una copia ahí sería pública, no la leería nadie,
y contradiría a la de verdad en cuanto una de las dos cambiara. Al cliente ya lo
frena la lista de claves permitidas; el borrado cubre también al superadmin, que
no pasa por ella. **Lo encontró una prueba** que daba por hecho que no se podía
colar y descubrió que sí.

---

## 6. Dónde tocar cada cosa

| Para cambiar... | Se toca |
|---|---|
| Qué incluye un plan | `PLANES` en **los dos** repos |
| Qué modelos permite un plan | `PLANES[x].modelos`, en los dos |
| El modelo de un restaurante | Panel → Apariencia |
| El plan de un restaurante | Panel → Apariencia (solo superadmin) |
| Si es de producción o de prueba | Panel → Apariencia → Datos del restaurante (solo superadmin) |
| Si un restaurante genera con IA | Botón **✨ IA** de la lista |
| Cuántas animaciones tiene | Panel, cupo (solo superadmin) |
| El prompt de generación | Variable `IA_PROMPT`, sin desplegar |
