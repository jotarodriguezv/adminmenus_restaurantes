# Video generado con IA — análisis y decisiones

**Estado:** funcionando de punta a punta desde el 24/08/2026. Falta el paso de aprobación.
**Fecha:** 24 de agosto de 2026
**Modelo elegido:** `minimax/hailuo-02` en Replicate (foto → video)

Este documento es a la generación con IA lo que `cartas-en-video.md` fue a la
conversión: decidir sobre números antes de escribir nada. Cada cifra va marcada
como **medida** (sale de una ejecución real) o **estimada**.

---

## 1. Por qué existe

Hoy una carta en video exige que alguien grabe. En el área de San Gil graba el
equipo; fuera, no hay compromiso de desplazarse y el restaurante se queda con
tres salidas: grabar por su cuenta, contratar a una agencia, o no tener carta en
video.

Esto abre una cuarta: **partir de la foto de producto que ya tiene**.

No sustituye a la grabación. Son dos caminos hacia la misma cola:

```
  Graba el restaurante  ──┐
                          ├──►  trabajos_video  ──►  entregable + master + portada
  Genera la IA         ──┘
```

---

## 2. Lo que NO hay que construir

Conviene decirlo primero, porque cambia el tamaño del trabajo: **la conversión
ya está hecha**.

`trabajos_video.origen` significa hoy *"el archivo que subió el móvil"*. Con IA
pasa a significar *"el archivo que devolvió Replicate"*, descargado a
`originales/`. A partir de ahí no cambia nada:

- El recorte al formato del restaurante, igual.
- El master sin recortar, igual.
- La portada, igual.
- `purgarAnteriores`, la limpieza de huérfanos, los estados, el rescate de
  colgados: igual.

Lo único que se construye es **cómo se llena la cola**, no cómo se vacía.

---

## 3. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| 1 | **6 segundos**, no 10 | Coste. Se sube cuando haya clientes que lo paguen; es un parámetro, no una reescritura. `hailuo-02` **no ofrece 10 s en 1080p**, así que a resolución alta la decisión ya venía tomada |
| 2 | **768p**, no 1080p | Ver §4. Es la decisión que más dinero mueve |
| 3 | El cupo cuenta **generaciones**, no productos | Es lo que factura Replicate. Ver §5 |
| 4 | **20 platos → 24 generaciones** (20% de margen) | Absorbe el descarte natural sin abrir la puerta a gastar sin fin |
| 5 | Agotado el cupo, **se bloquea** | El botón se desactiva y el restaurante escribe. Da la conversación comercial en vez de una factura sorpresa |
| 6 | El master del video generado **no se corta** | Ya se pagó por esos segundos. Ocupa 2-3 MB y conserva la opción de subir la duración sin volver a pagar. Es el mismo argumento por el que el master existe |

---

## 4. La resolución es donde está el dinero

**Estimado**, a partir de los precios que da Replicate para 6 s (**medidos** por
el usuario en la ficha del modelo): 1080p = $0,48 · 768p = $0,27.

El entregable de la carta es **1280×720**. Por tanto:

| Se genera | Llega al comensal | Se descarta |
|---|---|---|
| 768p (~1366×768) | 1280×720 | **6% de lado** — prácticamente nada |
| 1080p (1920×1080) | 1280×720 | 33% de lado, **55% de los píxeles** |

A 768p se paga casi exactamente por lo que el comensal ve. A 1080p se paga un
**78% más** para que ffmpeg tire más de la mitad.

Con el cupo de 24 generaciones, por restaurante y una sola vez:

```
768p    24 × $0,27  =  $6,48
1080p   24 × $0,48  =  $11,52
```

> ⚠ **La tabla de arriba supone que el modelo devuelve 16:9. La primera
> generación real dice que no.** Medido con `ffprobe` sobre el master del
> 24/08/2026: **768×1024**. La foto de origen era vertical 3:4 y el video salió
> vertical 3:4 — el modelo hereda la proporción de la foto, como dice §6.3, y el
> "768" es el **lado corto**, no la altura.
>
> Con esa fuente y un restaurante **horizontal**, ffmpeg hace
> `scale=1280:720:increase` sobre 768×1024 → 1280×1707, y recorta a 1280×720:
>
> - se tira el **58% de la altura** (queda una franja de 1707 líneas)
> - y es una **ampliación**: 768 px de ancho estirados a 1280 (×1,67)
>
> Es decir, el entregable dice 720p pero el detalle real que lleva dentro es el
> de una zona de ~768×432. En **vertical** sale mejor —960×1280 recortado a
> 720×1280: 25% de ancho y ×1,25 de ampliación— pero tampoco es gratis.
>
> **Lo que esto NO cambia:** la decisión de 768p sobre 1080p sigue en pie. A
> 1080p el recorte sería el mismo, solo que pagando $0,48. Lo que cambia es de
> dónde viene la pérdida: no del salto de resolución, sino de la **proporción de
> la foto**.
>
> **Lo que queda por saber, y se resuelve por $0,27:** con una foto ya recortada
> a 16:9, ¿el modelo devuelve 1366×768 (lado corto 768 → la tabla se cumple y no
> hay ni recorte ni ampliación) o 768×432 (ancho fijo 768 → habría que subir a
> 1080p para los restaurantes horizontales)? Una generación desde una foto
> apaisada y un `ffprobe` lo cierran. Es la medición que la de §8 fase 0 no era:
> aquí las dos respuestas llevan a decisiones distintas.
>
> **La mejora que sugiere, en cualquier caso:** recortar la foto al formato del
> restaurante **antes** de mandarla a Replicate. El modelo hereda la proporción,
> así que ese recorte se hace una vez sobre una imagen —gratis— en vez de
> tirarse el 58% del video ya pagado.

**Lo que reducir de 1080 a 720 sí aporta:** el downscale promedia y limpia algo
de ruido. No es cero. Pero es medible, y es lo que decide §8.

---

## 5. Por qué el cupo cuenta generaciones y no productos

Porque es lo que se factura. Un plato regenerado tres veces sigue siendo **un
producto** y son **tres cobros**.

Contar productos parece más natural de explicar, pero deja el gasto sin techo
justo por el lado que más duele: el descarte. Contando generaciones, el peor
caso es una multiplicación y se sabe de antemano.

Al restaurante se le presenta como *"20 platos, con margen para repetir algunos
que no queden bien"*, que se entiende igual y no miente.

### El margen del 20% es ajustado a propósito, y hay que vigilarlo

El análisis de `cartas-en-video.md` §10 estimaba **1,3–1,5 generaciones por
plato** —entre un 30% y un 50% de descarte— porque *"la comida es de lo más
difícil de generar"*.

Las 24 generaciones para 20 platos son un margen del **20%**: por debajo de esa
estimación. Es deliberado —empezar apretado y soltar con datos, no al revés—
pero significa que **si la tasa real de descarte se parece a la estimada, 24 no
van a alcanzar**.

Por eso lo primero que hay que medir en la primera carta real es **cuántas
generaciones se gastaron por plato publicado**. Ese número corrige el cupo, y
hasta tenerlo el 24 es una apuesta, no un valor comprobado.

### Reservar, no contar al final

Detalle de implementación que no es opcional: el cupo se **reserva al empezar** y
se libera solo si la generación falló **sin que Replicate cobrara**.

Contando al terminar, alguien puede lanzar veinte peticiones antes de que se
cuente ninguna. Contando al empezar sin liberar nunca, un fallo de red le come
una animación al cliente que no llegó a usar.

---

## 6. Tres riesgos técnicos

### 6.1 El reintento que se paga dos veces

**El más caro, y el menos evidente.**

La cola reintenta hasta `INTENTOS_MAX = 3`. Con ffmpeg reintentar es gratis. Con
Replicate, cada reintento es dinero.

El escenario concreto: se manda la petición, Replicate **empieza a generar**, y
la respuesta se pierde por un corte de red. El trabajo falla, se reintenta, y se
genera —y se paga— otra vez lo mismo. Tres reintentos, tres cobros, un plato.

La defensa es guardar el **identificador de la predicción en cuanto se crea,
antes de esperar nada**. Al reintentar, lo primero es preguntar por esa
predicción: si ya terminó, se recoge el resultado en vez de pedir otra. Es la
misma idea que `rescatarColgados`, pero con dinero de por medio.

### 6.2 La generación no puede bloquear la conversión

`arrancar()` procesa **un trabajo a la vez** con el flag `ocupado`, y con razón:
ffmpeg y Express comparten un solo núcleo.

Pero **generar no gasta CPU** — es una llamada HTTP y esperar. Si la generación
entra en ese mismo carril, un trabajo de IA que tarda dos minutos deja parada la
conversión de videos reales durante dos minutos sin ningún motivo.

Son dos límites distintos: la conversión se limita por **CPU**, la generación por
**presupuesto**. Necesitan carriles separados.

### 6.3 La proporción — el riesgo abierto

Con video grabado, el recorte forzado cuesta: está **medido** que pasar un
origen vertical a 16:9 se lleva el **69% de la altura**.

La ruta IA podría librarse de eso si al modelo se le pudiera pedir la
proporción. **No se puede:** el JSON de entrada de `hailuo-02` no tiene ese
campo, así que hereda la de la foto.

**Conclusión: el recorte no desaparece.** Un restaurante vertical con fotos
apaisadas vuelve a perder altura, exactamente igual que con un video grabado.
La ventaja que se esperaba de esta ruta no se materializa, y conviene tenerlo
presente antes de ofrecerle esto a Indigo: ahí la foto de origen importa tanto
como en la grabación.

**Confirmado con la primera generación real (24/08/2026): 768×1024 desde una
foto 3:4.** El modelo heredó la proporción de la foto, como se esperaba, y el
coste del recorte resultó mayor de lo que suponía §4 — el detalle está ahí, con
los números.

Pero el mismo hecho abre la salida: **si la proporción se hereda de la foto, la
foto decide la proporción del video.**

### La foto tiene que encajar — comprobado antes de pagar (26/08/2026)

`video.encajeDeFoto()` mide la foto antes de llamar y decide. **La regla no es
simétrica**, y eso es lo que la hace útil:

| Foto | Carta | Se recorta | Qué pasa |
|---|---|---|---|
| 16:9 | horizontal | 0% | pasa |
| 3:4 | horizontal | **58%** | **avisa, y pasa** |
| 9:16 | vertical | 0% | pasa |
| 3:4 | vertical | 25% | avisa, y pasa |
| cuadrada | vertical | 44% | **rechaza** |
| 16:9 | vertical | **68%** | **rechaza** |

Salta a la vista lo raro: se deja pasar un 58% de recorte y se rechaza un 44%.
No es un error. **Lo que decide no es cuánto se recorta, sino a qué tamaño se
mira:**

- En **horizontal** el video vive en una tarjeta dentro de una lista. Una foto
  3:4 pierde el 58% de la altura y queda bien porque el plato está centrado y la
  banda del medio se lo lleva entero. No es teoría: es la Salchipapa de Juan Mar,
  y el video salió bueno. Rechazarla habría bloqueado una generación que sirvió.
- En **vertical** el video ocupa la pantalla **entera**. Una foto apaisada obliga
  a sacar una tira estrecha del centro y a ampliarla ×1,67 para llenar 1280 de
  alto. Ahí el plato no sobrevive: se le van los lados, y a tamaño completo se
  ve todo.

El rechazo vive en **dos sitios y no es duplicación por descuido**: el panel
avisa pegado al botón y apaga el botón —para no hacer el viaje— y
`POST /api/ia/generar` rechaza de verdad. El panel es un `index.html` sin
compilación y no puede requerir el módulo de Node; se duplica lo mínimo (una
división y dos umbrales) y **manda el servidor**. Ocultar un botón nunca fue
impedir una llamada, y al otro lado hay dinero.

Y una asimetría más, en cómo fallan las dos comprobaciones de esta ruta: si no
se puede leer el **cupo**, no se genera; si no se pueden leer las **medidas de
la foto**, se genera igual. No saber el cupo arriesga la factura; no saber la
proporción arriesga un resultado feo. Distinto riesgo, distinto fallo seguro.

### El techo que nadie había mirado: la foto entra a 800 px

`compressImage(file, 800, 0.82)` del panel reduce **toda** foto de producto a 800
px de ancho antes de subirla, y solo limita el ancho:

```js
if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
```

Así que una foto de móvil 3024×4032 llega al servidor como **800×1067**, y eso
—no el original— es lo que ve el modelo. La cadena completa de una carta vertical
hoy es:

```
móvil 3024×4032 → 800×1067 (q82) → Replicate → 768×1024 → recorte+ampliación → 720×1280
```

Todos los pasos van hacia abajo menos el último, que **amplía**. En horizontal da
igual: se mira en una tarjeta. En **vertical se mira a pantalla completa**, y ahí
un JPEG de 800 px al 82% es el suelo de todo lo que venga después. Es candidato a
subir el tope para los restaurantes con modelo de video — pero **antes hay que
medirlo**, no cambiarlo por si acaso.

---

## 7. Lo que se verificó, y lo que queda

**Cerrado el 24/08/2026 con la primera generación real** (Juan Mar · Salchipapa
Ensueño). El recorrido entero salió **a la primera, con `intentos: 0`**:

| | |
|---|---|
| Generación en Replicate | **115 s** |
| Conversión con ffmpeg | **29 s** |
| Total de punta a punta | **~2 min 24 s** |
| Duración publicada | **5,9 s** de los 6 pedidos |
| Formato aplicado | `horizontal`, el del modelo del restaurante |

Con eso quedan confirmados los dos huecos que tenía este documento: **la forma
de la API** (rutas, `status` y `output` responden como se esperaba) y que **el
modelo no acepta proporción** — el JSON de entrada no la lleva, así que la
hereda de la foto y el recorte lo sigue haciendo ffmpeg.

**Sigue abierto:** si el "768p" del modelo es altura 768 en 16:9 o algo
distinto. El recorte forzado evita franjas negras pase lo que pase, así que
mirando el video final no se distingue. Se resuelve preguntándole al **master**,
que es el único archivo que conserva la proporción sin recortar:

```bash
docker exec $(docker ps -q --filter "name=adminvmenus") \
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
  -of csv=p=0 /app/uploads/masters/1787619100287-hu3i5ewab4i-master.mp4
```

Si sale algo como `1366x768`, la tabla de §4 es correcta y a 768p se paga casi
exactamente por los píxeles que ve el comensal. Si sale cuadrado, hay que
rehacer ese cálculo.

### Lo que quedó por medir del análisis original

1. **Qué es "768p" en este modelo**: ¿altura 768 en 16:9, o cuadrado?
2. ~~¿Acepta proporción como parámetro?~~ **No.** Confirmado en el JSON de entrada
3. ~~La forma exacta de la API~~ **Confirmada** en producción. Nombre del campo de la imagen, de la duración y
   de la resolución; y qué devuelve al terminar.
4. **Si Replicate cobra una predicción que falla** a mitad. Decide si un fallo
   libera el cupo reservado (§5).

---

## 8. Plan por fases

**Fase 0 — Medición.** Antes de integrar nada. Dos platos reales de Bonzas,
generados a 768p y a 1080p con el prompt de producción, pasados por el pipeline
**que ya existe**, y mirados en el móvil de destino. Cierra la resolución y
confirma §4. Coste: menos de $2.

**Fase 1 — Cupo. ✅ Hecha el 24/08/2026.** `sql/07`, `cupo.js` y las rutas
`GET /api/ia/cupo` · `PATCH /api/ia/cupo/:id`. 22 pruebas, **sin llamar a
Replicate ni una vez**: el módulo entero se comprueba con un proveedor de
mentira, que es lo que permite tener el freno puesto antes de que exista el
botón que gasta.

Lo que quedó decidido al escribirla:

- El restaurante **sí ve su cupo** ("te quedan 12"): es información que necesita
  para usar la función. Lo que no puede es cambiarlo — ampliarlo es solo del
  superadmin, porque es la palanca comercial de "escríbenos".
- **Si no se puede leer el cupo, no se genera.** Un error de red leyendo el
  conteo no puede convertirse en una generación gratis: el fallo cae del lado de
  no gastar.
- **Las reservas huérfanas se devuelven.** Un corte de red entre reservar y
  llamar dejaría una fila consumiendo cupo sin haber generado nada, y al
  restaurante le faltarían animaciones sin explicación. `rescatarReservas()` las
  libera pasados 15 min — holgado frente a lo que tarda una generación, para no
  liberar el cupo de algo que aún se está haciendo.
- El cupo se valida **sin `parseInt`**: `parseInt('1.5')` da 1, y guardar un
  número distinto del que se mandó no es aceptable en el dato que autoriza el
  gasto. (Lo encontró una prueba.)

**Queda por enganchar:** `rescatarReservas()` está escrita y probada pero nadie
la llama todavía. Va al `tick` de la cola en la fase 2, cuando existan reservas
que rescatar; añadir hoy un temporizador que no hace nada sería ruido.

**Fase 2 — Integración. Módulo hecho el 24/08/2026; falta engancharlo.**

`ia.js` habla con Replicate y no sabe de nada más: ni de cupos, ni de la cola,
ni de ffmpeg. Está separado así porque es lo único que depende de un tercero —
el día que cambie el proveedor o el modelo, se reescribe eso y nada más. 18
pruebas, **sin una sola llamada real**: se sustituye `fetch` y se comprueba qué
se habría mandado y cómo se interpreta lo que vuelve.

Confirmado contra el editor JSON del propio modelo:

```json
{ "first_frame_image": "<url de la foto>", "prompt": "...",
  "duration": 6, "resolution": "768p", "prompt_optimizer": false }
```

- **No hay campo de proporción**, así que se hereda de la foto. El recorte al
  formato del restaurante lo sigue haciendo ffmpeg después, igual que con un
  video grabado: §6.3 queda cerrado, y el recorte no desaparece.
- `first_frame_image` es una **URL**, no un archivo. Las fotos de producto ya
  son públicas, así que sirve tal cual — pero significa que Replicate tiene que
  poder descargarla, y por eso una ruta relativa o un `data:` se rechaza **antes
  de llamar**: ese fallo pasaría del otro lado y puede costar dinero.
- **`prompt_optimizer` va apagado**: reescribe el prompt por su cuenta, y el
  prompt es justamente lo que sujeta el "no añadas ingredientes" de §9.
- **El prompt lo fija la plataforma**, no el restaurante. Un campo de texto
  libre en el panel sería la forma más directa de acabar con una guarnición que
  el negocio no sirve — y de pagar cada intento. Vive en `IA_PROMPT` para poder
  afinarlo sin desplegar.
- Un **4xx se marca definitivo** y no se reintenta: daría el mismo error y
  gastaría otra del cupo. Los 5xx y el 429 sí se reintentan.

> ⚠ **Lo que sigue sin comprobar:** las rutas (`/models/{modelo}/predictions`,
> `/predictions/{id}`) y los nombres `status`/`output` son la API general de
> Replicate, no se pudieron verificar contra su documentación —el entorno donde
> se escribió esto tiene bloqueado `replicate.com`— y hay que verlas funcionar
> una vez. **La primera generación real es esa comprobación**, y cuesta $0,27.

**Fase 2 completa el 24/08/2026.** `colaia.js` une las tres piezas que no se
conocen entre sí —`cupo.js`, `ia.js` y `video.js`— y la ruta
`POST /api/ia/generar` la dispara. 14 pruebas más, tampoco con llamadas reales.

El resultado que confirma el §2: **`trabajos_video` no sabe que la IA existe.**
El video generado se descarga a `originales/` y se encola como cualquier otro,
así que el recorte, el master, la portada y la limpieza no cambiaron una línea.

Lo que las pruebas fijan, y que no se ve mirando cada pieza por separado:

- **El orden**: reservar → llamar → anotar el identificador. Si se llamara antes
  de reservar, el cupo no serviría; si no se anotara el identificador, un corte
  de red haría que el reintento pagara otra vez.
- **Si la llamada falla, el cupo vuelve.** No se generó nada, así que no se
  cobró nada.
- **Si la generación falla, el cupo NO vuelve.** Llegó a ejecutarse: se pagó.
  Devolverlo sería regalar dinero en cada resultado malo.
- **Si falla la descarga, tampoco vuelve.** El video existe y está cobrado; el
  fallo es nuestro al recogerlo.
- **El nombre del archivo lo pone el servidor**, no la URL del proveedor. Lo que
  llega de fuera no nombra archivos en este disco.
- **La descarga se corta por tamaño aunque la cabecera calle**, porque puede
  faltar o mentir y para entonces ya se estaría escribiendo. Con el disco lleno
  no se cae el video: se cae el servidor entero.

La cola de IA **no arranca sin `REPLICATE_API_TOKEN`**: sin él no haría más que
fallar cada veinte segundos y llenar los registros de ruido.

### Cómo probar la primera vez — cuesta $0,27

La forma de la API sigue sin comprobarse (ver el aviso de arriba), y la primera
generación real ES esa comprobación. Conviene hacerla en un restaurante de
pruebas, no en Voro ni en Indigo.

1. `REPLICATE_API_TOKEN` en las variables de Dokploy del panel, y desplegar.
2. Un restaurante de pruebas con `nav: 'video'` y un plato **con foto** — la
   foto es la entrada del modelo; sin ella no hay nada que animar.
3. `POST /api/ia/generar` con `{restaurante_id, producto_id}`.
4. Mirar los registros: `✨ generación lista y encolada` y después el
   `🎬 video listo` de la cola de siempre.

Si algo falla ahí, será en los nombres de las rutas o en `status`/`output`, que
es justo lo que no se pudo verificar. Se arregla en `ia.js` y en ningún sitio
más — para eso está separado.

**Fase 3 — Panel. Botón hecho el 24/08/2026; falta la aprobación.**

El botón vive **junto al de subir video**, no en otra pestaña: son las dos
formas de llegar al mismo sitio —un plato con video— y lo único que cambia es
de dónde sale el archivo.

Tres frenos, y ninguno sobra porque cada pulsación cuesta dinero:

1. **Solo se enseña si el plato tiene foto.** La foto *es* la entrada del
   modelo, no un adorno. Sin ella el servidor rechaza igual, y ofrecer un botón
   que va a fallar no le dice a nadie por qué.
2. **El cupo se enseña pegado al botón** ("quedan 21 de 24"), no en otra
   pantalla. Lo que queda tiene que estar donde se decide.
3. **Se pregunta antes de gastar**, diciendo que la animación se consume
   aunque el resultado no guste.

Y uno que no se ve: **si no se puede leer el cupo, el botón se apaga**. Es
preferible eso a dejar creer que hay de sobra y descubrirlo con la factura.

La espera se resuelve reutilizando lo que ya había. La generación no crea un
trabajo de video hasta que termina, así que el panel espera a que ese trabajo
**aparezca** y entonces le pasa el testigo a `vigilarVideo()`, que ya sabía
enseñar la conversión y el video final. Nada nuevo que mantener.

### El paso de aprobación — hecho el 26/08/2026

Se hizo **después** de que la primera generación real confirmara que la API
responde como se espera: montar la aprobación encima de una integración sin
estrenar habría sido construir sobre algo que quizá hubiera que mover.

Ahora el video generado llega convertido pero **no entra en la carta hasta que
alguien lo mira**. El motivo está en §9 y no es de calidad, es legal.

**Dónde se decide, y por qué ahí.** La conversión no cambió: sigue siendo la
misma cola, el mismo ffmpeg, el mismo master. Lo único que cambia es el último
paso de `procesarTrabajo()`, que antes escribía el video en el plato siempre y
ahora pregunta primero:

```js
if (esperaAprobacion(trabajo))      // generado y sin mirar → se queda esperando
else if (trabajo.producto_id)       // subido → a la carta, como siempre
```

`esperaAprobacion()` está suelta y exportada a propósito: la usan la cola, las
rutas y las pruebas, y tener esa condición escrita tres veces es exactamente
cómo acaban discrepando.

**Lo que decide `sql/09`,** con tres estados en una columna de dos valores:

| `aprobado` | qué significa |
|---|---|
| `null` | convertido, esperando que alguien lo mire |
| `true` | publicado: el plato lo enseña |
| `false` | descartado: los archivos se borraron, el plato sigue con su foto |

Sin `default` a propósito. Un `false` por defecto diría "descartado" de todo lo
que ya existía; un `true` publicaría solo lo generado. Quien decide es
`origen_tipo`, que sí lleva default `'subido'` — así **ningún video subido a
mano cambió de comportamiento** al aplicar la migración, y por eso se pudo
aplicar antes de desplegar el código.

**Los subidos a mano no se aprueban.** Quien graba su propio plato ya lo vio;
pedirle que lo apruebe sería preguntarle dos veces lo mismo.

**En el panel** el bloque de revisión sale en la ficha del plato, con el video
a tamaño de mirar y controles —no una miniatura— y dos botones. Tres decisiones
que no se ven:

- **Convive con el video ya publicado**, no lo sustituye. Un plato puede tener
  video en la carta *y* una animación nueva esperando; sin ver los dos no hay
  con qué comparar.
- **Los dos botones se apagan a la vez** al pulsar cualquiera. Publicar y
  descartar son excluyentes y ninguno tiene vuelta atrás: dejar el otro vivo
  mientras el primero viaja es invitar a pulsarlo.
- **El `<video>` se suelta al cambiar de plato.** Es el mismo elemento para
  todos; sin quitarle el `src`, el siguiente plato abre enseñando la animación
  del anterior — y se aprobaría para un plato el video de otro.

**Descartar borra los archivos en el momento**, no se los deja al limpiador: el
limpiador espera siete días de gracia y son ~7 MB entre entregable, master y
portada. La **fila no se borra**, se marca: `generaciones_ia` dice que se generó
—y que se pagó—; lo que se decidió después solo consta ahí.

**Y la animación descartada NO vuelve al cupo.** Se generó y se cobró.
Devolverla convertiría el cupo en "intentos hasta que te guste", que es
justamente el gasto sin techo que el cupo existe para impedir (§5).

Reintentar sigue sin existir: descartar libera el plato, y volver a generar es
pulsar el botón otra vez y gastar otra del cupo. Es la misma decisión de §3, y
el descarte no la cambia.

---

### El día que un plato se generó dos veces (26/08/2026)

Primera prueba en vertical, en Pizzería Pierrot. **Un mismo plato consumió dos
animaciones con 21 segundos de diferencia.** Las dos salieron bien y las dos se
pagaron. Vale la pena dejarlo escrito porque el fallo no estaba en ninguna de
las piezas: estaba en cómo se hablaban.

`refrescarCupoIA()` hacía dos cosas de más:

1. Escribía el aviso de proporción en **`iaEstado`**, el mismo elemento donde
   `generarConIA()` acababa de poner *"✨ Generando... esto tarda un par de
   minutos"*. Y se llama justo después, para actualizar el contador. Así que el
   mensaje bueno desaparecía y en su lugar quedaba un aviso naranja —*"la foto no
   tiene la proporción de la carta... la animación se gasta igual"*— que **se lee
   como un rechazo**.
2. Encendía el botón sin mirar, deshaciendo el apagado que `generarConIA()`
   acababa de hacer.

Juntas dicen exactamente lo contrario de lo que pasaba: parece que no salió, y
el botón invita a volver a pulsar. Es lo que cualquiera habría hecho.

**Lo que se arregló, en tres capas.** Ninguna sobra, porque cada una falla de
una manera distinta:

- **El aviso tiene su propio elemento** (`iaEncaje`). No puede pisar el estado
  aunque quiera.
- **El botón no se enciende solo** mientras haya algo en marcha para ese plato,
  y hay tres señales encadenadas para que no quede ningún hueco: la bandera
  `state.generandoIA` cubre los dos minutos entre pedirla y que exista el
  trabajo; `trabajoEnCursoDe()` cubre la conversión; `videoPorAprobarDe()` cubre
  el video ya convertido esperando revisión. Las dos últimas salen de los datos,
  así que **siguen en pie después de recargar la página** — la bandera no.
- **El servidor rechaza con 409** una segunda generación para un plato que ya
  tiene una en camino o una esperando revisión. Es el único freno que cuenta:
  los otros dos son la puerta bonita.

Y una consecuencia que no era del fallo pero salió con él: `videos_listos` del
resumen contaba como "video" todo trabajo en estado `'listo'`. Desde que existe
la aprobación eso miente — la lista del superadmin decía **"2 videos"** de un
restaurante cuyos platos seguían enseñando la foto. Ahora son dos cuentas
separadas (`sql/10`), porque es lo que siempre fueron.

**La lección, y es de diseño:** el aviso de proporción se escribió para ahorrar
dinero y acabó gastándolo. Un mensaje que comparte sitio con otro no es un
mensaje: es una carrera, y la gana el último que escribe.

### El segundo video no se descartó: se borró solo

Al publicar uno de los dos, el otro **desapareció sin dejar rastro** — ni fila
ni archivos. No lo descartó nadie: un descarte deja la fila marcada
(`aprobado = false`), y no había fila.

Lo hizo `purgarAnteriores()`, que borra los trabajos ya terminados del mismo
plato cuando entra uno nuevo. Correcto para un video **anterior**; destructivo
para uno que **espera revisión**: eso no es un video viejo, es una alternativa
pagada sobre la que nadie ha decidido.

La causa de fondo es un nombre que respondía a dos preguntas distintas:

| Pregunta | Función | Un descartado (`aprobado = false`) |
|---|---|---|
| ¿Puede entrar solo en la carta? | `esperaAprobacion()` | **No** — `false` no es `true` |
| ¿Nadie ha decidido todavía? | `sinRevisar()` | **Sí se decidió** — se miró y no valía |

`purgarAnteriores()` preguntaba con la primera. Con eso protegía también a los
descartados —que son justo la basura que hay que barrer— mientras el caso que
importaba quedaba tapado detrás del mismo nombre. Ahora pregunta con la
segunda, que es la suya.

Lo encontró una prueba, al escribir el caso de los tres estados juntos. Es el
tipo de fallo que no se ve mirando la función: las dos condiciones se leen igual
y solo difieren en un valor de tres.

### El aviso ahora dice qué hacer

*"La foto no tiene la proporción de la carta"* no se puede accionar, y encima
enterraba el "se puede generar igual" al final, donde se lee como un rechazo.
El texto ahora abre por ahí y da números concretos:

> Se puede generar igual. Aviso: tu foto es **2025×2700** y esta carta es
> vertical (9:16), así que al video se le recortará el **25% del ancho**. Suele
> quedar bien si el plato está centrado. Para que no se recorte nada, súbela
> recortada a **1519×2700**.

Tres cosas que antes no estaban: **si es un bloqueo o no** (primero, no al
final), **qué lado** se recorta —"pierde el 25%" no dice dónde mirar— y **a qué
medidas recortar**, que sale de la foto de verdad y se puede teclear en el
recortador del móvil.

### El freno del servidor todavía tenía un hueco (27/08/2026)

El arreglo de arriba no cerró el caso del todo, y el motivo estaba una capa más
abajo: el freno comprobaba `estado = 'generando'`, y **una reserva no nace así**.
Nace `'reservada'` —el valor por defecto de la columna— y solo pasa a
`'generando'` cuando `anotarPrediccion()` escribe el identificador, o sea después
de que Replicate acepte la petición: hasta 30 segundos (`LIMITE_CREAR_MS`).

Durante ese tramo la segunda pulsación pasaba el freno, y el otro control —el de
`trabajos_video` sin revisar— tampoco la veía, porque el trabajo todavía no
existe. Es exactamente la ventana de los 21 segundos de este mismo incidente: se
había arreglado el síntoma en dos capas y quedaba abierta la de en medio.

Ahora se cierra por dos vías, y las dos hacen falta:

1. La ruta mira los **dos** estados en curso.
2. `sql/13_una_generacion_en_curso_por_plato.sql` añade un índice único parcial
   sobre `producto_id` mientras el estado esté en curso. La comprobación de la
   ruta lee y después escribe, y entre las dos cosas cabe otra petición: eso no
   se arregla leyendo mejor, se arregla haciendo que la base no acepte la segunda
   fila. `cupo.reservar()` traduce el `23505` a la misma respuesta que da el
   freno, para que el usuario lea lo mismo llegue por donde llegue.

El índice cubre **solo** los estados en curso. Un plato puede tener muchas
generaciones `lista`, `error` o `liberada` a lo largo del tiempo y eso es normal:
el historial es justamente lo que permite contar el cupo. Se verificó
explícitamente que sigue permitiéndolo — un índice que lo hubiera bloqueado
habría roto el conteo sin que nada lo dijera.

Ver `revision-27-08-2026.md §5.1`.

---

## 9. La restricción que no es técnica

Movimiento de cámara sobre la foto real. **Sin añadir ingredientes ni cambiar la
presentación.**

El prompt en producción (afinado a mano en Replicate, 24/08/2026) es:

> *Camera slowly orbits around the dish from front to a 3/4 side angle, plate
> stays centered and completely still, steady smooth camera motion, consistent
> soft natural lighting, shallow depth of field, photorealistic food photography
> style, no other movement in the scene*

Fija tres cosas: **qué movimiento** (una órbita, no un zoom ni un barrido), que
el **plato no se mueva**, y que **nada más en la escena se mueva** — sin esto
último el modelo anima el fondo o los cubiertos.

**Lo que no fija, y hay que tenerlo presente:** que no se inventen ingredientes.
Y la órbita es precisamente lo que más lo pide, porque **al girar hacia 3/4 el
modelo tiene que rellenar el lado del plato que la foto no enseña**. Ahí es donde
puede aparecer una guarnición que el restaurante no sirve.

Está así a conciencia: es el prompt que se probó y funcionó, y añadirle cláusulas
sin volver a medir podría estropear el movimiento que costó afinar. Pero
significa que **la red que atrapa ese caso es el paso de aprobación**, no el
prompt. Desde el 26/08/2026 esa red existe: ningún video generado entra en la
carta sin que alguien lo mire (§8, fase 3).

Si en algún momento se quiere cerrar por prompt, la frase sería del tipo *"do not
add, remove or change any ingredient or garnish"* — y habría que comprobar que no
degrada la órbita.

Si el modelo agrega una guarnición que el restaurante no sirve, eso es publicidad
engañosa, y el expuesto ante la SIC es el cliente, no la plataforma. Esta
restricción va en el prompt, pero sobre todo va en el paso de aprobación: es lo
que ese paso existe para atrapar.

Queda por revisar la licencia comercial del modelo y de quién es el resultado.
