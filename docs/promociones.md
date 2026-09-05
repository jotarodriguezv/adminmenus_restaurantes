# Promociones — de una imagen fija a un calendario

Documento de diseño. Estado: **nada construido**, 04/09/2026.

Vive aparte de `pantalla-tv.md` porque la promoción **no es una función del
televisor**: nació en el menú del QR y la cartelera se le colgó después. Hoy
sirve a dos superficies con reglas distintas, y ese es justo el asunto de este
documento.

---

## 1. De dónde viene

La promoción se diseñó como **una ventana que aparece al abrir la carta**. La
idea era simple: un restaurante quiere destacar algo —un plato nuevo, una
oferta— y necesita que el comensal lo vea antes de ponerse a mirar el menú.

Funciona y se usa. **Bonzas saca una hamburguesa nueva cada mes**, la pone ahí
y sale sin problema. Ese caso —una promoción, encendida y apagada a mano, que
dura semanas— es el que el diseño actual resuelve bien, y conviene no perderlo
de vista: lo que venga después tiene que seguir siendo así de fácil para quien
solo quiere eso.

Más tarde (fase 3, 31/08/2026) la misma promoción se enchufó a la cartelera del
televisor, donde sale a pantalla completa cada tantas pantallas de platos.

En algún momento alguien sugirió **varias promociones que se alternaran al
azar**. No se hizo, y hoy solo hay un estado activa/inactiva.

---

## 2. Qué hay hoy, exactamente

Una sola promoción, guardada como **columnas de `restaurantes`**. No existe
ninguna tabla de promociones.

| columna | quién la lee |
|---|---|
| `promo_activa` | las dos superficies |
| `promo_imagen_url` | las dos superficies |
| `promo_nombre` | solo la cartelera |
| `promo_precio` | solo la cartelera |
| `promo_en_tv` | solo la cartelera |
| `promo_cada` | solo la cartelera |

**El popup del menú** (`core/loader.js`) abre a los 700 ms de cargar la página
si hay imagen y está activa, y enseña **solo la imagen**. `promo_nombre` y
`promo_precio` ni siquiera se piden en `COLUMNAS_PUBLICAS`, por la razón que
explica `pantalla-tv.md` §5.2: pedir una columna que no existe devuelve 400 y
tumba la carta de los nueve restaurantes.

**La cartelera** (`tv.html`) la intercala si se cumplen cuatro cosas a la vez:

```js
if (r.promo_activa && r.promo_en_tv && imagenPromo && nuevos.length)
```

y enseña imagen, nombre y precio.

### Dos cosas que salieron al leerlo

**El popup se abre en cada carga, sin memoria de nada.** Quien recarga, o vuelve
a escanear el QR en la misma comida, se lo come otra vez. Con la hamburguesa
mensual de Bonzas eso es inocuo. Con promociones programadas, que cambian solas
y son varias, deja de serlo: es la diferencia entre una novedad y un anuncio
que persigue.

**El interruptor «Intercalar mi promoción» no se bloquea cuando falta la
imagen**, y está bien así — la promoción se configura en otra pestaña y puede
llegar después.

> **Resuelto el 04/09/2026 (paso 1).** El aviso vivía solo *donde se configura
> la consecuencia*, no *donde se cambia la causa*: quien apagaba la promoción
> desde su pestaña no tenía forma de saber que el televisor acababa de perder
> una pantalla, ni motivo para ir a mirarlo.
>
> Ahora la pestaña Promoción dice qué le pasa al televisor, en los dos
> sentidos: encendida, cada cuántas pantallas sale; apagada, que el televisor
> dejó de mostrarla **y que vuelve al encenderla aquí**. La condición
> (`carteleraEsperaLaPromo`) es espejo de la de `tv.html` a propósito, y deja
> fuera `promo_activa`: si la incluyera, el aviso desaparecería justo en el
> momento en que hace falta.
>
> De paso salió un fallo aparte: los cinco avisos que usaban `var(--warning)`
> salían del color del texto normal, porque **esa variable no existe** — la
> definida es `--warn`. Comprobado en navegador antes de tocarlo.

---

## 3. Qué se quiere

- **Varias promociones** a la vez, no una — pero con un tope, no indefinidas.
- **Que salgan por día, franja y temporada.** El caso que lo motiva: un dos por
  uno en bebidas los martes, que salga *solo* los martes. Los restaurantes con
  programación dinámica —una cosa el fin de semana, otra entre semana— son
  normales, no un caso raro.
- **Alternar entre varias** cuando más de una está vigente.
- Y, en la cartelera, **pantallas de marca** intercaladas: el logo, una frase, o
  las dos juntas.

---

## 4. La decisión que ordena todo lo demás

**Las dos superficies no quieren la misma regla, porque no hacen el mismo
trabajo.**

| | Popup del menú | Pantalla de la cartelera |
|---|---|---|
| Cuándo | una vez, al abrir | continuo, en bucle |
| Cuántas caben | **una** | **todas las que haya** |
| Repetirse | molesta | es el objetivo |
| Qué enseña | la imagen | imagen, nombre y precio |
| Quién mira | una persona, dos segundos | una sala, un servicio entero |

De ahí sale el modelo entero: **una sola tabla, dos reglas de resolución.**

- El **popup** pregunta *«¿cuál enseño ahora?»* → elige **una** entre las
  vigentes.
- La **cartelera** pregunta *«¿qué entra en la rotación?»* → entran **todas** las
  vigentes marcadas para televisor.

No hay que elegir entre las dos ideas. Son la misma tabla resuelta de dos
maneras, y cada manera es la que corresponde a su superficie.

---

## 5. El modelo de datos

### 5.1 Una tabla `promociones`, con tope

| campo | qué es |
|---|---|
| `restaurante_id` | a quién pertenece |
| `imagen_url` | obligatorio: sin imagen no hay promoción |
| `nombre`, `precio` | opcionales, los usa la cartelera |
| `activa` | el interruptor de siempre, a mano |
| `en_popup`, `en_tv` | dónde puede salir |
| `programacion` | jsonb, ver §5.2 |
| `orden` | posición en la rotación de la cartelera |

**Cinco como máximo.** Tres se queda corto en cuanto aparecen las franjas:
almuerzo, cena, martes y fin de semana ya son cuatro.

Pero el número que de verdad importa no es cuántas tiene guardadas, sino
**cuántas compiten a la vez**. Con azar y una sola visita por comensal, cinco
vigentes al mismo tiempo significa que cada una la ve uno de cada cinco
clientes. El panel tiene que decirlo con ese lenguaje: *«hoy compiten 4
promociones; cada cliente verá una»*.

Los dos niveles del §5.3 ayudan solos, porque lo normal es que un día concreto
haya una o dos programadas vigentes, no cinco.

### 5.2 La programación: fechas, días y horas

Tres capas, **todas opcionales**. Vacías = siempre vigente, que es exactamente
el comportamiento de hoy y lo que necesita quien solo quiere una promoción de
las de antes.

| capa | ejemplo | para qué sirve |
|---|---|---|
| fechas | del 1 al 24 de diciembre | la temporada |
| días | martes | el dos por uno semanal |
| horas | 18:00–23:00 | la franja del día |

**Las dos últimas son literalmente la forma que ya usa `core/horarios.js`** para
las categorías:

```js
{ activo: true, dias: [1,2,3,4,5], desde: '11:00', hasta: '15:00' }
```

`dias` va de 0 (domingo) a 6 (sábado); vacío o ausente = todos los días. **El dos
por uno de los martes es `dias: [2]`.** Las fechas son lo único nuevo, y son lo
que pedía el «tiempo de finalización».

Es la estructura del gestor de anuncios de Meta, y no por parecerse a Meta: es
que el problema es el mismo y esa forma ya está probada contra la realidad.

Con la forma de `horarios.js` vienen tres decisiones ya tomadas, y las tres son
correctas:

- **Se calcula en la zona horaria del restaurante**, nunca en la del visitante.
  Un turista con el celular en otro huso vería una carta de una hora que no es.
- **Ante configuración inválida, se muestra.** Vale más enseñar de más que
  esconderle el menú a los clientes de un restaurante por un dato mal escrito.
- **Ya está detrás del plan** (`planDe(restaurante).horarios`), o sea que ya es
  algo que se vende.

Inventar una segunda forma de horario sería el error caro de este proyecto: el
día que haya que tocar el cálculo —feriados, una franja que cruza medianoche—
habría dos sitios que arreglar y uno se olvidaría.

#### Lo que trae de regalo una fecha de fin: la promoción se muere sola

Hoy `promo_activa` es un interruptor manual, así que **siempre hay una persona
decidiendo**. Con fecha de fin, el 25 de diciembre no pasa nada, nadie decide
nada, y sin embargo el popup deja de abrirse y el televisor pierde una pantalla.
En silencio.

El panel tiene que avisar de las promociones que terminaron, y el aviso tiene
que estar **donde el restaurante mira** — que es el mismo problema del §2 y
merece la misma solución.

### 5.3 Cuándo sale cada una: dos niveles

Una promoción es **de fondo** (sin programación, siempre vigente) o
**programada** (tiene fechas, días u horas).

> **Regla: si hay alguna programada vigente ahora mismo, solo juegan las
> programadas. Si no hay ninguna, juegan las de fondo.**

El caso que lo motiva: una promoción indefinida —la hamburguesa del mes— y otra
solo para los martes. **El martes manda la de los martes.**

Por qué así, y no todas en el mismo bombo:

- **Es lo que quiso decir el restaurante.** Programar algo para el martes es una
  decisión *sobre el martes*. Si lo de siempre siguiera compitiendo, programar
  sería una sugerencia en vez de una decisión.
- **El azar lo empeoraría.** Si el martes compiten el dos por uno y dos
  promociones de fondo, el dos por uno lo ve uno de cada tres clientes. Y cada
  cliente entra una sola vez: justo lo que el azar venía a evitar.
- **Se explica por teléfono en una frase:** *lo que programes para hoy manda; lo
  de siempre es el relleno de los días que no programaste.*

¿Y si el restaurante quiere que la hamburguesa salga **también** los martes? Le
pone al horario los siete días. Eso la sube al nivel programado y entra en el
bombo del martes junto al dos por uno. **No hace falta ningún concepto nuevo:**
la escotilla de salida ya está dentro de la propia forma del horario.

### 5.4 Azar por defecto, orden bajo aviso

**Por defecto, azar.** El comensal escanea el QR una vez y no vuelve. Con orden
fijo, la segunda promoción **no la ve nadie**: no es que se vea menos, es que no
se ve.

El orden queda disponible para quien lo pida, con el aviso dicho sin rodeos:
*si eliges un orden, la mayoría de tus clientes verá solo la primera.*

En la cartelera esto no aplica: ahí salen todas, porque el bucle da vueltas
durante todo el servicio. El campo `orden` gobierna la rotación del televisor;
el azar gobierna la elección del popup. Son dos preguntas distintas sobre la
misma tabla.

### 5.5 Las pantallas de marca

Logo solo, frase sola, o las dos juntas **no son tres tipos**. Son un tipo con
dos campos:

```
marca = { logo: sí/no, frase: "texto" }
```

Quien quiera el logo suelto *y* la frase suelta como dos pantallas distintas,
pone dos entradas. No hace falta prever nada más.

Así la lista de intercalados tiene solo dos tipos: **`promocion`** y **`marca`**.

---

## 6. Cómo se intercala en la cartelera

> **Construido el 04/09/2026.** Lo de abajo describe lo que hace el código.
> Lo que se guarda es `atributos.tv.intercalados` (lista ordenada de
> `{tipo:'promocion'}` y `{tipo:'marca', logo, frase}`) más
> `atributos.tv.cada` (el ritmo).
>
> **`promo_cada` dejó de escribirse.** El ritmo es del televisor, no de la
> promoción: manda sobre cualquier intercalado. Queda en la tabla como
> respaldo de lectura para las pantallas que aún no se hayan vuelto a
> guardar, y se puede quitar cuando todas lo hayan hecho.
>
> **`promo_en_tv` se queda**, derivado de la lista al guardar para que no
> puedan discrepar. Es una propiedad de la promoción —"esta promoción puede
> salir en el televisor"—, o sea lo que será `promociones.en_tv` en el §5.1
> cuando haya varias, y es de lo que se entera la pestaña Promoción para
> avisar (§2).
>
> **Lo que NO se construyó:** el editor de N entradas. El panel tiene dos
> casillas —promoción y marca— y, cuando las dos están encendidas, un
> selector de cuál va primero. Con dos tipos, ordenar es solo decir cuál va
> delante, y una lista con flechas para eso es más interfaz de la que el
> problema pide, sobre todo en un móvil. Lo que se pierde es tener el logo y
> la frase en **dos pantallas separadas**; el dato ya lo admite, así que el
> día que alguien lo pida es interfaz y nada más.

**Un solo ritmo, y una lista que rota por él.** No una frecuencia por tipo de
pantalla, sino una sola: *intercalar algo cada N pantallas de platos*. N sale de
la lista que ya existe hoy (2, 3, 4, 6, 8).

```
platos ×4 → PROMO → platos ×4 → MARCA → platos ×4 → PROMO → ...
```

Tres razones:

**Con un solo elemento se comporta exactamente como hoy.** Si el restaurante
solo tiene su promoción, la secuencia es idéntica a la que corre ahora en
Bonzas. No hay regresión que explicar ni configuración que migrar.

**El resumen del panel sigue siendo una división.** Ese resumen —«la vuelta dura
2 min», «con 3 pantallas y la promoción cada 4 no llegaría a salir nunca»— caza
errores reales hoy. Con frecuencias independientes por tipo habría que
simularlo, y dejaría de ser fiable.

**Hace visible el coste.** Si alguien añade logo y frase, la promoción pasa a
salir un tercio de las veces. Con frecuencias separadas eso ocurre a escondidas;
con una rotación se ve. Y la promoción es la que vende.

Con frecuencias independientes, además, aparece la colisión: logo cada 3 y
promoción cada 4 se pelean por la pantalla 12, y el restaurante no puede
predecir qué verá mirando el panel.

### 6.bis La rotación tiene que seguir entre vueltas (05/09/2026)

**Fallo encontrado con la tele puesta, al día siguiente de construirlo.** Con la
promoción y la marca encendidas, **solo salía la primera. Siempre.**

La causa: la rotación empezaba de cero en cada vuelta. Una vuelta con seis
pantallas de platos y una intercalada cada cuatro tiene **un solo hueco**, así
que ese hueco era siempre `intercalados[0]` y el segundo elemento no aparecía
jamás. Para verlos todos hacían falta `cada × elementos` pantallas de platos
—ocho, en ese ejemplo— y casi ningún restaurante las tiene.

Lo llamativo es que el texto del panel ya describía el comportamiento correcto
—*«se van turnando: primero una, a la siguiente vuelta la otra»*—. **El texto
estaba bien y el código hacía otra cosa**, que es la forma de fallo más difícil
de ver leyendo el diff: todo parece coherente porque la intención está escrita
al lado.

**El arreglo:** el contador de rotación es de la página, no de la vuelta, y
`avanzar()` lo incrementa y rehace los slides al volver al índice 0. Rehacerlos
justo ahí no interrumpe nada, porque el ciclo estaba volviendo a empezar de
todos modos. Sin `aleatorio` el resultado es idéntico salvo por el intercalado;
con `aleatorio` encendido además se rebaraja, que es lo que esa casilla promete.

**Y una tercera, del 05/09/2026 por la tarde.** Encender la pantalla de marca
y apagar el logo dejando la frase vacía **sí dejaba guardar**: la entrada se
descartaba en silencio, el interruptor se quedaba encendido y en el televisor no
salía nada. El interruptor decía justo lo contrario de lo que pasaba, y quien lo
miraba no tenía forma de saber por qué.

Ahora **no deja guardar**, con el mismo patrón que ya usaba la cartelera
encendida sin platos. Y los nombres cambian, porque parte del lío era el
lenguaje: «Mi marca» → **«Una pantalla con mi marca»**, «Mostrar el logo» →
**«Incluir mi logo»**, y la frase deja de llamarse «(opcional)» —lo es solo si
el logo está encendido—.

**Dos cosas más que salieron de la misma prueba:**

- Encender «Mi marca» sin marcar el logo ni escribir una frase era un **estado
  muerto**: el interruptor decía que sí, no se guardaba nada y no salía ninguna
  pantalla. Ahora encender «Mi marca» enciende el logo, que es lo que se quiere
  decir al marcarlo. Quien quiera la frase sola lo apaga después.
- La línea de secuencia del panel dibujaba la vuelta **por dentro**, así que con
  un solo hueco enseñaba `platos ×4 → PROMOCIÓN` y daba a entender que la marca
  no salía. Ahora dice lo que pasa de verdad: *«cabe 1 por vuelta, así que se
  van turnando: esta vuelta tu promoción, la siguiente tu marca»*.

---

## 7. Reglas cerradas

Qué pasa cuando algo está a medias. **Ninguna de estas situaciones puede dejar
una pantalla en blanco ni tumbar la carta.**

| Situación | Popup | Cartelera |
|---|---|---|
| Promoción sin imagen | no cuenta | no cuenta |
| Programación inválida o incompleta | **se muestra** (igual que las categorías) | **se muestra** |
| Ninguna vigente ahora mismo | no se abre | rota solo platos |
| Varias programadas vigentes | se elige **una**, al azar | entran **todas** |
| Hay programadas vigentes | las de fondo **no juegan** | las de fondo **no juegan** |
| `marca` sin logo y sin frase | — | no cuenta |
| Restaurante sin zona horaria | `America/Bogota` | `America/Bogota` |

La regla de fondo es la que ya aplica `horarios.js`: **ante la duda, mostrar.**
Un dato mal escrito no puede dejar a un restaurante sin promoción un sábado por
la noche sin que nadie se entere.

---

## 8. Lo que hay que resolver en la cartelera

### 8.1 La cartelera no se entera de que pasa el tiempo

`tv.html` solo reconstruye los slides cuando **cambian los datos**:

```js
if (JSON.stringify(datos) !== antes) aplicar(false);
```

Cuando llega el martes no cambia ningún dato: cambia el reloj.

Y ese `if` no se puede quitar: está puesto a propósito, porque rehacer los
slides en cada sondeo reiniciaría el ciclo cada cinco minutos y el comensal
vería siempre los mismos primeros platos.

**La salida:** meter en la comparación el **resultado** de la programación, no
solo los datos. Así se reconstruye justo al cruzar la frontera del martes —una
vez— y el resto del tiempo se comporta igual que hoy.

### 8.2 Que la pantalla no esté encendida siempre reduce el problema

Un televisor que se apaga al cerrar el local **arranca de cero cada mañana**:
carga la página y evalúa la programación con el reloj de ese momento. El martes
que llega a medianoche no le afecta, porque a medianoche no había nadie mirando
y a las nueve de la mañana arranca ya siendo martes.

El caso malo es el otro, y es exactamente el que ya está documentado en
`pantalla-tv.md`: **el computador conectado por HDMI que se queda días
encendido.** Es para el que se escribió la recarga de seguridad de las 18 horas.
Ahí sí hace falta el arreglo del §8.1.

**No hace falta una programación propia para el televisor.** Apagarlo ya es la
programación, y tiene una ventaja que ninguna configuración iguala: **no se
puede desincronizar de la realidad.** Un horario de pantalla puesto a mano se
queda viejo el día que el restaurante cambia de turno y nadie se acuerda de
tocarlo; el interruptor de la pared, nunca.

Lo que sí hace falta es un aviso, hermano del que ya existe: una promoción
programada de 02:00 a 06:00 **no la va a ver nadie** en un local que cierra a
las 23:00. Es la misma clase de error que «con 3 pantallas y la promoción cada 4
no llegaría a salir nunca», que el panel ya caza y avisa.

**Y una regla para la caché:** la programación se evalúa contra el reloj **en el
momento de pintar**, y nunca se guarda ya resuelta. La cartelera pinta desde
caché cuando arranca sin internet —el local abre y el router no ha levantado—, y
si esa caché trajera «la promoción del martes está vigente» congelado del martes
pasado, el miércoles saldría mal.

### 8.3 La regla quedaría escrita tres veces, no dos

`core/horarios.js` usa módulos ES, `const`, funciones flecha, `Object.fromEntries`
y `?.`. Todo eso está **prohibido en `tv.html`** por las pruebas, y por el motivo
de `pantalla-tv.md` §2: un televisor viejo no degrada esa sintaxis, lanza un
error y deja la pantalla negra durante todo un servicio.

Y ya hay un segundo sitio: **el panel tiene su propio espejo** de `horarios.js`,
declarado como tal en un comentario, para poder decirle al usuario si su
categoría se ve ahora mismo. `tv.html` sería **el tercero**.

Si discrepan, el menú del QR dice que la promoción del martes está vigente y el
televisor dice que no — **y eso solo se nota los martes**.

**Mitigación:** un juego de casos compartido (momento + configuración →
resultado esperado) que corran las pruebas de los **dos** repositorios. Los dos
usan ya `node --test`. Con tres copias de la misma regla esto deja de ser una
buena práctica y pasa a ser necesario.

---

## 9. La migración

**Bonzas tiene una promoción funcionando. No puede apagarse.**

El paso de columnas a tabla tiene que crear una fila por cada restaurante con
`promo_activa` o `promo_imagen_url`, copiando también `promo_en_tv`, `promo_cada`,
nombre y precio, con `programacion` vacía (= de fondo, siempre vigente).

Y el orden de despliegue es el de `pantalla-tv.md` §11.bis, que ya costó un
incidente: **primero la base de datos, después el código.** Pedir una columna
que aún no existe devuelve 400 y tumba la petición entera; en `loader.js` eso
apaga la carta de todos los restaurantes a la vez.

---

### 9.bis Por dónde va el paso 3 (05/09/2026)

El paso 3 es varios despliegues, no uno. Este es el reparto y en qué punto
está, para que no haya que reconstruirlo de una conversación:

| | Qué | Estado |
|---|---|---|
| ~~**A**~~ | `sql/18_promociones.sql` — la tabla, su RLS y el copiado de lo que ya hay | **aplicada el 05/09/2026** |
| ~~**B**~~ | `server.js` — alta, baja y edición, y el tope como número del plan | **hecho el 05/09/2026** |
| **A.bis** | `sql/19` — cerrar la escritura de la tabla a `anon` | **escrita, SIN aplicar** |
| **C** | Panel — la lista de promociones y el editor de días, horas y fechas | pendiente |
| **D** | `vmenus-app` — el popup elige una; `tv.html` resuelve la programación | pendiente |
| **E** | El juego de casos compartido entre los dos repositorios (§8.3) | pendiente |

**A es aditiva y va primero**, por la regla de `pantalla-tv.md` §11.bis: la tabla
nace y no la lee nadie, así que aplicarla no cambia nada de lo que se ve hoy.
Al revés, el código preguntaría por una tabla que no existe y PostgREST
devuelve 400, que tumba la petición entera.

**Las columnas viejas no se borran en A.** Las siguen leyendo las cartas y las
carteleras que no se hayan recargado, y una pantalla de restaurante puede
pasarse días sin recargar. Se borran en una migración posterior, cuando nada
las lea.

**El tope de cinco no va en el esquema.** Va a ser un número del plan, y
clavarlo en un `check` convertiría una decisión comercial en una migración. Lo
comprueba el servidor en B, que es quien conoce el plan.

**Lo que se cobra es programar, no tener varias.** Decidido al hacer B: los
cuatro planes llevan `promociones: 5`, y poner días u horas exige `horarios` —
la misma bandera que ya gobierna los horarios de categoría, que `vitrina` no
tiene. Es la respuesta a la pregunta abierta «¿en qué plan entra?», y se puede
cambiar en una línea si el negocio decide otra cosa.

**La tabla nació abierta a `anon`.** Al comprobar el 18 después de aplicarlo
—la regla del `CLAUDE.md` de no dar nada por hecho— salió que `anon` tenía
INSERT, UPDATE y DELETE sobre `promociones`. RLS lo bloquea, así que no había
nada expuesto, pero toda la protección descansaba en una sola barrera. Lo cierra
`sql/19`.

La misma comprobación encontró que `anon` tiene DELETE sobre `productos`,
`categorias` y `restaurantes`, y las tres cosas sobre `trabajos_video`,
`eventos_analitica` y `menu_activo`. Todas con RLS activo, o sea que tampoco hay
nada expuesto. **No se tocan de rebote**: van a la revisión de seguridad, que es
donde toca mirarlas una por una.

---

## 10. Orden propuesto

| | Qué | Por qué ahí |
|---|---|---|
| ~~**1**~~ | ~~Avisar en la pestaña Promoción cuando se apaga y la cartelera la usaba~~ **Hecho el 04/09/2026**, ver §2 | Pequeño e independiente; tapaba un hueco de hoy |
| ~~**2**~~ | ~~Ritmo único + lista rotatoria (`promocion` y `marca`)~~ **Hecho el 04/09/2026**, ver §6 | Con un elemento se comporta igual que hoy; Bonzas no nota nada |
| **3** | Tabla `promociones` con programación · **empezado el 05/09/2026**, ver §9.bis | Aquí entra el martes, y aquí está el trabajo de verdad |

Lo de la frase y el logo cabe entero en el paso 2, que es el barato.

**Aviso sobre el orden:** si el paso 3 se va a hacer de todas formas, parte de
lo que se construya en el paso 2 sobre las columnas actuales habrá que
rehacerlo. Hacer la tabla primero cuesta más al principio y menos en total.
Depende de si urge enseñar algo o urge terminarlo.

### Corrección al coste del panel

En una estimación anterior dije que lo caro de todo esto era el panel. Sigue
siendo lo más caro de los tres frentes, pero **bastante menos de lo que dije**:
el panel ya tiene construido, para las categorías, el selector de días en fichas
(`L M X J V S D`), `describirHorario()` —que produce «L a V · 11:00–15:00»— y el
aviso de «ahora mismo está oculta». Se reutiliza casi tal cual. Lo nuevo de
verdad son las fechas y la lista de hasta cinco.

---

## 11. Preguntas abiertas

- **¿El popup debe recordar que ya se enseñó?** Hoy sale en cada carga. Una vez
  por visita es lo normal en el resto de la industria, pero cambia el
  comportamiento actual y Bonzas lo usa contento. Decidirlo antes de que haya
  varias promociones, no después.
- **¿En qué plan entra?** Los horarios de categoría ya están en `completo` y
  `video`. Las promociones programadas son candidatas naturales a lo mismo, pero
  el popup de una sola promoción lleva desde el principio en todos los planes y
  no se le puede quitar a nadie.
- **¿El tope de cinco es por restaurante o por plan?** Cinco es el número de
  trabajo. Si más adelante se quiere vender «hasta 15», el tope tiene que ser un
  número del plan desde el primer día, no una constante en el código.
- **¿Y una promoción que se pisa a sí misma?** Dos programadas para el martes a
  la misma hora es perfectamente válido —entran las dos en el bombo— pero puede
  no ser lo que el restaurante quería. Un aviso, nunca un bloqueo.

---

## Decisiones tomadas

| Fecha | Decisión |
|---|---|
| 04/09/2026 | Una tabla, dos reglas de resolución: el popup elige una, la cartelera rota todas. |
| 04/09/2026 | Máximo **cinco** promociones. Lo que importa no es cuántas hay, sino cuántas compiten a la vez. |
| 04/09/2026 | **Azar por defecto** en el popup. El orden queda disponible, avisando de que la mayoría verá solo la primera. |
| 04/09/2026 | **Dos niveles:** si hay alguna programada vigente, las de fondo no juegan. |
| 04/09/2026 | Programación de tres capas opcionales —fechas, días, horas—, reusando la forma de `horarios.js`. |
| 04/09/2026 | **Sin programación propia para el televisor.** Apagarlo ya es la programación y no se desincroniza. |
| 04/09/2026 | La programación se evalúa al pintar, nunca se guarda resuelta en la caché. |
| 04/09/2026 | **Construido el paso 1**: la pestaña Promoción avisa de lo que le pasa al televisor. |
| 04/09/2026 | **Construido el paso 2**: `atributos.tv.intercalados` y `atributos.tv.cada`; la animación del logo cuelga del interruptor de animación que ya existía. |
| 05/09/2026 | La rotación de intercalados **continúa entre vueltas**: reiniciarla dejaba sin salir todo lo que no fuera el primer elemento (§6.bis). |
| 05/09/2026 | El tope de promociones es un **número del plan**, no una restricción del esquema: si no, cambiarlo sería una migración. |
| 05/09/2026 | Una pantalla de marca sin logo y sin frase **no se puede guardar**: antes se descartaba en silencio con el interruptor encendido. |
