# Revisión de UX — Verificame

Documento de trabajo. Cada hallazgo va con su casilla para ir tachándolos de
uno en uno. **Nada de esto está aplicado**: es una lista de lo observado.

- **Empezada:** 9 de septiembre de 2026.
- **Dónde vive esto:** `adminmenus_restaurantes/docs/revision-ux.md`, aunque
  cubre **los tres repositorios**. Va entero y en uno solo a propósito: 40 de
  los 61 hallazgos son del panel, y partirlo rompería la lista única y las
  referencias cruzadas —B1 se apoya en que `vmenus-app` sí usa `loading="lazy"`,
  y CL2 en lo que promete la landing.
- **Método:** recorrido en el navegador sobre **producción**
  (`adminvmenus.verificame.click`), más lectura del fuente para confirmar cada
  hallazgo antes de anotarlo. Sobre los restaurantes reales, **solo mirar**: no
  se guardó ni se borró nada en ninguno. Las pasadas que sí escriben se
  hicieron contra `zz-pruebas-ux`, creado para eso.
- **Orden acordado:** primero el panel (`adminmenus_restaurantes`), después la
  carta del comensal (`vmenus-app`) y la landing (`vmenus-landing`).
- **Estado:** revisadas las tres superficies, el alta desde cero sobre
  `zz-pruebas-ux` y las cinco pestañas del cliente en móvil y en vista clara.
  **Lo que falta está listado al final**, en «Qué queda por revisar»: cuatro de
  los seis modelos de carta, la cartelera del televisor, la densidad en móvil
  con una carta real, y lo que no se pudo disparar —las subidas de archivo y
  los caminos que cuestan dinero.

## Cómo se trabaja este documento

Cada hallazgo tiene una casilla. Se marca **al aplicar el cambio**, no al
decidirlo — un pull request abierto no es un cambio aplicado.

```markdown
- [ ] Pendiente
- [x] Hecho · 2026-09-12 · PR #47
- [~] Descartado · 2026-09-12 · <el motivo, en una frase>
```

**El estado `[~]` importa tanto como el `[x]`.** Un hallazgo descartado sin
explicar vuelve a proponerse dentro de seis meses, y alguien vuelve a
investigarlo. Al descartar, escribir **por qué**: que la severidad no compensa
el riesgo, que choca con una decisión de producto, que el caso real no se da,
o que está esperando a otra cosa. Ejemplo de la casa: la nota de la sección
Apariencia, donde queda escrito que bloquearla al cliente es deliberado.

Si al aplicar un hallazgo se descubre que estaba mal planteado, **corregir el
texto del hallazgo** en vez de dejarlo tachado con una nota. Ya hay dos
correcciones así (B1 y P4), marcadas dentro del propio hallazgo.

## Cómo leer las severidades

| | Qué significa |
|---|---|
| **Alta** | Se pierde trabajo, se corrompe un dato o el usuario se queda sin salida. |
| **Media** | Fricción real y repetida, o algo que se entiende mal. |
| **Baja** | Detalle de acabado. Muchos son de un renglón. |

## Avance

| Pantalla | Estado |
|---|---|
| Login | revisada |
| Panel superadmin (lista de restaurantes) | revisada |
| Productos | revisada |
| Categorías | revisada |
| Apariencia | revisada |
| Promoción | revisada — sin hallazgos, tiene el mejor estado vacío |
| Toppings | revisada |
| Pedidos | revisada |
| Pantalla TV | revisada — sin hallazgos, es la mejor del panel |
| Importar carta | revisada — sin hallazgos |
| QR | revisada — sin hallazgos de fondo |
| Estadísticas | revisada |

Revisadas primero sobre **A Ojo Cerrado** (restaurante de prueba) y después,
por sugerencia del usuario, sobre **Bonzas Burger Grill** (97 productos, 59
fotos, en producción). La segunda pasada valió la pena: B1, B2 y B3 solo
aparecen con contenido real, y afinó E1.

---

# Transversal (afecta a todo el panel)

## T1 · El panel se descarga sin comprimir: 465 KB · **Alta**

- [ ] Pendiente

`content-encoding` vacío y `content-length: 475938` en la respuesta de
producción. No hay `compression` en `server.js` —`express.static` en la
línea 152 lo sirve tal cual— y ese dominio está fuera de Cloudflare a
propósito (`docs/servidor.md`), así que no hay nada que lo comprima por el
camino.

**Por qué importa:** hay `ETag`, así que abrir el panel dos veces seguidas sale
barato; lo que se paga entero es la primera carga del día y **cada carga
después de un despliegue**.

> **Corregido al aplicarlo (11/09/2026):** aquí se estimaron «unos 60-70 KB»
> comprimidos. Medido sobre el archivo real son **474 KB → 126 KB, un 73 %
> menos**. La mejora es grande igualmente, pero el número que había era
> optimista.

**Arreglo:** `app.use(compression())`. Es la mejor relación esfuerzo/efecto de
toda la revisión.

## T2 · El DOM del superadmin viaja al navegador de todos los clientes · **Baja**

- [ ] Pendiente

Crear restaurante, cambiar PIN, día de cobro: todo el marcado está en el
`index.html` que recibe cualquier cliente, oculto con CSS. El servidor manda
de verdad, así que no es un agujero de seguridad — pero es parte de los 465 KB
de T1 y expone los nombres de los campos de administración.

---

# Login

## L1 · No hay salida si el cliente olvida el PIN · **Alta**

- [ ] Pendiente

No hay nada en pantalla que diga qué hacer. Y no es solo que falte el enlace:
`#slugInput` lleva `autocomplete="off"` y `#pinInput` no declara nada, así que
**el gestor de contraseñas no lo guarda ni lo ofrece**. El cliente entra cada
varias semanas, no lo tiene apuntado y no lo tiene guardado. El único camino es
escribir al soporte.

Encima el sitio donde iría el aviso está ocupado: `index.html:643` dice
«Ingresa tu identificador y PIN de acceso», que repite lo que ya dicen las dos
etiquetas de arriba.

**Arreglo:** cambiar esa frase por «¿Olvidaste tu PIN? Escríbenos por WhatsApp»
con el enlace, y quitar el `autocomplete="off"`.

## L2 · El campo no recibe el foco al abrir · **Baja**

- [ ] Pendiente

`document.activeElement` es `BODY`. Lo llamativo es que la cadena de teclado ya
está montada y bien pensada —Enter en el identificador salta al PIN
(`index.html:636`), Enter en el PIN entra (`index.html:640`)—; falta solo el
`autofocus` para que el login se haga entero sin tocar el ratón.

> Nota: se comprobó expresamente que **Enter sí funciona**. El formulario no es
> un `<form>`, que es la señal habitual de que Enter no envía, pero aquí está
> resuelto con `onkeydown`. No es un hallazgo.

## L3 · «Identificador de acceso» es jerga · **Media**

- [ ] Pendiente

El que explica de verdad es el placeholder, `ej: bonzas`. El dueño piensa en el
nombre de su restaurante. «El nombre corto de tu restaurante» haría el trabajo
de la etiqueta y del placeholder a la vez.

## L4 · El PIN parece traer algo escrito · **Baja**

- [ ] Pendiente

El placeholder son cuatro puntos, `····` (`index.html:639`), que es exactamente
lo que se ve en un campo de contraseña con texto dentro.

## L5 · El login ignora la vista clara · **Baja**

- [ ] Pendiente

Forzando `prefers-color-scheme: light` sigue oscuro. El interruptor de tema solo
aparece **después** de entrar, en la barra superior.

---

# Panel superadmin (lista de restaurantes)

## S1 · `✓ Pagó` escribe en cobranza sin confirmar y sin vuelta atrás · **Alta**

- [ ] Pendiente

`marcarComoPagado` (`index.html:8841`) manda el `PATCH` con la fecha de hoy en
cuanto lo pulsas: sin confirmación, toast verde y listo. Y `ultimo_pago`
**aparece solo dos veces** en las 9.227 líneas: donde se lee para pintar el
aviso y donde se escribe aquí. No hay ninguna pantalla que lo muestre ni que lo
corrija.

**Por qué importa:** un clic mal dado marca a un cliente como pagado, el aviso
rojo de `VENCIDO DESDE…` desaparece, y con él la única señal de que ese cliente
debe. Arreglarlo es SQL contra producción.

**Lo que lo hace probable:** `✓ Pagó` es lo que pulsas nueve veces al mes,
`Eliminar` es su vecino inmediato y en móvil queda pegado justo debajo, a unos
35 px. La acción rutinaria es la que no tiene red; la excepcional es la que sí.

**Contraste:** `Eliminar` (`index.html:8852`) **sí está bien protegido** —un
`confirm()` que nombra el restaurante y enumera lo que se pierde. Eso se queda
como está.

## S2 · El rojo significa dos cosas distintas en la misma fila · **Media**

- [ ] Pendiente

`Suspender` y `Eliminar` comparten `btn-sm danger`. Una es reversible con otro
clic; la otra borra el menú, los videos, la cobranza y las estadísticas. Cuando
el color de peligro cubre las dos, deja de avisar de la que importa.

## S3 · `Activo` parece un botón y no lo es · **Media**

- [ ] Pendiente

Es un `<span class="status-badge">` dentro del mismo contenedor flex que los
botones, con la misma forma de pastilla y el mismo tamaño
(`index.html:8905`), y pegado a `Suspender`, que sí es acción. Diez
restaurantes, diez pastillas que invitan a pulsar y no responden.

## S4 · El formulario de crear ocupa la pantalla entera antes de la lista · **Media**

- [ ] Pendiente

En móvil hay que bajar seis gestos para llegar al primer restaurante. Crear uno
es cosa de una vez al mes; la lista es a lo que entras siempre.

**Arreglo:** plegarlo detrás de un `+ Nuevo restaurante`.

## S5 · Si falla la carga de la lista, es un callejón sin salida · **Media**

- [ ] Pendiente

`catch(e) { list.innerHTML='<div class="empty-state">Error cargando restaurantes</div>' }`
(`index.html:8979`). Sin motivo, sin botón de reintentar, y `e` se descarta. La
única salida es recargar la página entera — los 465 KB de T1.

## S6 · Setenta controles en una pantalla · **Baja**

- [ ] Pendiente

Siete por restaurante por diez restaurantes. Las tres de uso diario
(`Editar menú`, `Ver carta`, `✓ Pagó`) pesan lo mismo que `Cambiar PIN` o
`Eliminar`, que son de mes en mes.

## Lo que está bien y conviene no perder al tocar esto

`Ver carta ↗` es un `<a>` de verdad y no un `window.open`, con su
`rel="noopener"`, así que el clic central y «abrir en pestaña nueva» funcionan.
El comentario del fuente explica que fue deliberado, y es justo lo que necesita
quien revisa varios restaurantes seguidos.

---

# Productos

Revisada sobre **A Ojo Cerrado** (la que lleva la insignia `PRUEBA`): 100
productos y 21 categorías, así que es un buen caso real y no una carta de
juguete.

## P1 · Dos desplegables casi idénticos: uno es privado, el otro publica al instante · **Alta**

- [ ] Pendiente

A 29 px de distancia hay dos selectores de orden:

| | Etiqueta | Qué hace |
|---|---|---|
| `#sortSelect` (`index.html:757`) | «Precio: menor a mayor» | Ordena **solo la tabla del panel**. No se guarda. |
| `#ordenProductos` (`index.html:772`) | «Precio: **de** menor a mayor» | Ordena **la carta que ven los clientes**, y guarda en cuanto lo cambias. |

Las etiquetas se diferencian en una palabra, «de». El segundo llama a
`guardarOrdenProductos` (`index.html:5390`), que manda el `PATCH` en el
`onchange` y enseña «✓ Guardado» durante dos segundos y medio.

**Por qué importa:** el que parece inocente —«a ver cómo queda ordenado por
nombre»— es el que reordena la carta de un restaurante en producción. Se
deshace eligiendo otra opción, así que no se pierde nada; lo que falla es que
nada distingue lo privado de lo público.

**Arreglo:** que el de la carta diga a quién afecta («Cómo lo ven tus
clientes») y que el del panel diga que es solo tuyo («Ver aquí ordenado por»).

## P2 · Cien productos pintados de una sola vez · **Media**

- [ ] Pendiente

`#productList` tiene las 100 filas en el DOM, cada una con su miniatura, su
interruptor y sus dos botones. Sin paginación ni carga progresiva. En esta
carta ya son 100; el buscador y los filtros de categoría ayudan, pero el coste
se paga igual al entrar en la pestaña.

## P3 · Dos categorías «Hamburguesas» y «HAMBURGUESA» conviviendo · **Media**

- [ ] Pendiente

Están las dos en la lista de 21. El panel no avisa al crear una categoría casi
idéntica a otra, ni al escribirla en otra caja.

**La consecuencia real, y es la que lo convierte en un problema:** el aviso
«TODAS LAS HAMBURGUESAS VAN ACOMPAÑADAS DE PAPAS» está dentro de
`HAMBURGUESA`, no de `Hamburguesas`. Quien entre por la otra no lo ve.

## P4 · No hay forma de poner una nota en la carta, así que se usan productos de $ 0 · **Media**

- [ ] Pendiente

Los dos únicos productos con precio 0 de los 100 no son platos, son avisos:

- «TODOS LOS PERROS VAN ACOMPAÑADOS DE PAPAS» (en `PERROS`)
- «TODAS LAS HAMBURGUESAS VAN ACOMPAÑADAS DE PAPAS» (en `HAMBURGUESA`)

El dueño necesitaba decir algo que no es un plato y la única herramienta a mano
era «crear producto». No es un error suyo: es una pieza que falta.

**Y hoy funciona por casualidad.** Comprobado en la carta pública
(`aojocerrado.vmenus.co`): el orden `precio_asc` ordena **dentro de cada
categoría**, no la carta entera, así que cada aviso de $ 0 cae primero en su
propia sección y se lee como un encabezado de esa categoría. Es exactamente el
efecto que el dueño buscaba.

El día que alguien cambie ese orden a «Nombre A → Z» —el desplegable de P1, el
de al lado— «TODAS LAS HAMBURGUESAS VAN ACOMPAÑADAS DE PAPAS» se va por la T al
final de su categoría, detrás de los platos que anuncia.

## P5 · El carril de categorías esconde dos tercios · **Media**

- [ ] Pendiente

Medido: 2.321 px de pastillas dentro de un carril de 862. Con 21 categorías, 13
quedan fuera de la vista tras un scroll horizontal que en escritorio no tiene
indicación de que haya más.

## P6 · El botón de borrar es un icono sin etiqueta · **Baja**

- [ ] Pendiente

`🗑` con `title="Eliminar"` y nada más (`index.html:5186`), pegado a un `Editar`
que sí lleva texto. En una lista de 100 filas es el control que más conviene
que no se confunda.

## Lo que está bien y conviene no perder

`confirmDelete` (`index.html:5472`) **cuenta los platos que se lleva una
categoría por delante** y lo dice en el aviso («⚠ También se borrarán los 12
platos que hay dentro»), porque la clave ajena es `ON DELETE CASCADE`. El
comentario del fuente explica que el aviso anterior no lo decía. Eso es de las
cosas mejor resueltas del panel.

---

# Categorías

## C1 · Reordenar es de uno en uno, y la fila se escapa del cursor · **Media**

- [ ] Pendiente

Solo hay `↑` y `↓`, que intercambian con el vecino (`moveCat`,
`index.html:5447`). Con las 21 categorías de esta carta, subir la última hasta
arriba son **20 clics**, cada uno con su ida y vuelta al servidor y su toast
«Orden actualizado».

Y hay algo peor que el número de clics: cada clic repinta la lista, así que la
fila que estás moviendo **se aparta de debajo del cursor** y hay que perseguirla
hacia arriba.

**Arreglo:** arrastrar y soltar, o un campo de posición como el que ya tiene el
modal de categoría («Orden (número)»).

## C2 · El panel no avisa de que una categoría vacía no se ve · **Baja**

- [ ] Pendiente

`Otros` tiene 0 productos y en el panel se pinta igual que las demás. La carta
pública **sí la oculta** —`core/menu.js:62`, `if (!prods.length) return;`— así
que ningún comensal la ve; el problema es solo que el dueño no lo sabe y puede
creerla publicada.

**Y el arreglo ya está escrito:** seis líneas más arriba, en
`index.html:5156`, las categorías con horario se marcan con
`🕐 … · oculta ahora` en ámbar, y el comentario dice literalmente «para que
nadie crea que la categoría se perdió». Es el mismo aviso, aplicado a otro
motivo de ocultación.

## C3 · «3 productos · fotos» es criptico · **Baja**

- [ ] Pendiente

`index.html:5154`. El segundo dato es el modo de presentación —`fotos` o
`lista`— pero suelto detrás de un punto medio no dice de qué habla.

## Nota

Aquí se ve el duplicado de P3 con sus cifras: `Hamburguesas` con 2 productos y
`HAMBURGUESA` con 5, separadas por siete filas.

## Lo que está bien

El manejo de error de `moveCat` recarga las categorías del servidor cuando el
guardado falla, para no dejar la pantalla enseñando un orden que no existe
(`index.html:5464`). Es el detalle que casi nunca se hace.

---

# Apariencia

**Ojo al leer esta sección:** esta pestaña **no la ve ningún cliente**.
`switchTab` corta la entrada si `state.rol !== 'admin'` (`index.html:2845`), así
que el día de cobro y el interruptor de «restaurante de prueba» no se exponen a
nadie de fuera. Es una herramienta interna, y las severidades van medidas como
tal: aquí el usuario eres tú.

> **Decidido a propósito — no proponer lo contrario.** Confirmado por el
> usuario el 9 de septiembre de 2026: Apariencia está bloqueada al cliente
> **por diseño**, no por descuido. Controla ajustes sensibles que no puede
> tocar cualquiera, y la mayoría son decisiones que se toman desde el panel de
> superadmin. Hay funciones sueltas dentro que sí podrían abrirse algún día,
> pero eso es una decisión aparte y por ahora la respuesta por defecto es que
> no se abre.
>
> Ningún hallazgo de esta revisión propone exponerla. **CL1 se apoya justo en
> lo contrario**: como el cliente no va a ver Apariencia nunca, lo que hay que
> cambiar es el texto que le manda ahí, no el permiso.

## A1 · Dos botones de guardar a 3.928 px, y nada dice qué campo es de cuál · **Alta**

- [ ] Pendiente

Medido en producción: la pestaña son **4.328 px de alto (4,7 pantallas) con 39
campos**, y tiene dos guardados independientes:

| Botón | Posición | Qué guarda |
|---|---|---|
| `Guardar` | y = 477 | **Solo 4 campos**: nombre, slug, día de cobro, «es de prueba» (`guardarDatosResto`, `index.html:6002`) |
| `Guardar apariencia` | y = 4.405 | **Los otros 35**: colores, logo, fondo, tipografías, plan, modelo, redes, CSS… (`saveApariencia`, `index.html:6339`) |

`saveApariencia` manda solo `color_primario`, `color_secundario` y `atributos`
— el nombre y el slug **no van dentro**.

**Cómo se pierde trabajo:** cambias el nombre arriba, bajas, ajustas un color y
pulsas «Guardar apariencia» —el botón grande del final de la página—. El color
se guarda y el nombre se descarta sin decir nada.

## A2 · No hay control de cambios sin guardar, y cambiar de pestaña disimula · **Alta**

- [ ] Pendiente

No hay `beforeunload` ni marca de «sucio» en toda la pestaña. Y `switchTab`
(`index.html:2844`) solo alterna la clase `hidden`: **no vuelve a pintar
Apariencia al entrar**. Así que si editas un campo, te vas a Productos y
regresas, tu cambio sigue ahí en pantalla — con el mismo aspecto que si
estuviera guardado. Se pierde en silencio al recargar.

**Y el patrón ya existe en el panel:** el modal de producto tiene su
`cambiosModal` con «Hiciste cambios en este producto que todavía no has
guardado. Si sales ahora se pierden». Aquí no.

## A3 · Cuatro pantallas y media de formulario seguido · **Media**

- [ ] Pendiente

39 campos en una sola columna sin secciones plegables ni índice. Están
agrupados en tarjetas con título, que ayuda, pero para llegar al CSS
personalizado o a las redes hay que recorrerlo todo.

## A4 · Lo que no aplica al modelo se queda en pantalla, solo rotulado · **Media**

- [ ] Pendiente

De los 39 campos, 34 están visibles. Los bloques «Portada» y «Filtros y
etiquetas» llevan la nota «(solo modelo explorar)» y **siguen visibles** aunque
esta carta use el modelo Carrito. Se rotula lo que no aplica en vez de
ocultarlo, y eso engorda las 4,7 pantallas de A3 con ajustes que no hacen nada
para este restaurante.

## A5 · Dos avisos pegados que se contradicen · **Media**

- [ ] Pendiente

En «Dirección del menú», a 8 px de distancia:

- en ámbar (`index.html:1071`): «Este subdominio **no responderá** hasta que lo
  registres en Dokploy…»
- justo debajo (`index.html:1076`): «Las dos formas **funcionan siempre**, sin
  importar cuál elijas».

Cada frase es correcta en lo suyo —la segunda habla de que los enlaces ya
repartidos no se rompen— pero leídas juntas se anulan. Y de fondo queda que
esta opción se puede guardar apuntando a un subdominio que todavía no responde:
el panel lo avisa, pero no lo impide ni lo comprueba.

## Lo que está bien

Cambiar el slug lanza un `confirm()` que enseña **la ruta vieja y la nueva** y
dice que los QR ya impresos dejarán de funcionar (`index.html:6014`). Es el
mejor aviso de todo el panel.

---

# Toppings

## TP1 · Los mismos grupos se llaman distinto en las dos pantallas que hay que conectar · **Media**

- [ ] Pendiente

| Dónde | Cómo se llaman |
|---|---|
| Pestaña Toppings (`index.html:1204` y `1211`) | «Toppings **Platino** (sin costo adicional)» · «Toppings **Premium** (precio adicional)» |
| Modal del producto (`index.html:2238` y `2242`) | «Toppings **sin costo**» · «Toppings **con costo**» |

Son los mismos dos grupos. Y «Platino/Premium» además invierte la intuición:
Platino suena a más que Premium, pero aquí Platino es el gratis.

**Arreglo:** quedarse con los nombres del modal —«sin costo» y «con costo»—,
que son los que se explican solos, y usarlos en los dos sitios.

## TP2 · El estado vacío no dice para qué sirve esto · **Media**

- [ ] Pendiente

Tres bloques con «Sin elementos» y nada más. El modal del producto sí guía en
la otra dirección («Este negocio todavía no tiene toppings. Créalos en la
pestaña Toppings y vuelve aquí»), pero al llegar aquí no hay nada que diga que
un topping no aparece en ninguna carta hasta que se le asigna a un plato.

Comparar con el estado vacío de **Promoción**, que es el mejor del panel.

---

# Pedidos

## PE1 · Se puede encender el carrito sin número de WhatsApp, y el cliente se enterá al final · **Alta**

- [ ] Pendiente

Estado real de esta carta ahora mismo: modelo **Carrito**, insignia **pedidos**
activa y el campo «WhatsApp para recibir pedidos» **vacío**. El panel no avisa
de la combinación.

Lo que le pasa al comensal, en `vmenus-app/core/carrito.js:674`: arma el
pedido, escribe su nombre, su dirección, elige método de pago, pulsa enviar
— y **ahí** recibe un `alert()` del navegador que dice «Este restaurante no
tiene configurado un número de WhatsApp para pedidos». Todo el trabajo hecho y
ningún camino hacia adelante.

**Arreglo, por orden de valor:**
1. Que el panel no deje encender pedidos sin número, o que lo marque en rojo
   junto al interruptor.
2. Que la carta esconda el botón de enviar —o el carrito entero— cuando no hay
   número, en vez de fallar en el último paso.

## PE2 · Otra vez dos guardados en una pantalla · **Baja**

- [ ] Pendiente

`GUARDAR` para el número y `GUARDAR MÉTODOS DE PAGO` para los interruptores.
Mismo patrón que A1, pero aquí están cerca y los dos bloques se distinguen
bien, así que el riesgo es mucho menor. Se anota para decidirlo de una vez
junto con A1 y no dos veces.

## Lo que está bien

En `carrito.js`, si el navegador bloquea la ventana de WhatsApp **no se vacía
el carrito**: se le ofrece el enlace a mano. El comentario explica que antes se
le borraba al cliente todo lo que había armado. Y el número se limpia con el
mismo `soloDigitos` que usa la barra social, «para que no se arregle en un
sitio y se quede roto en el otro».

---

# Importar carta

**Sin hallazgos.** El texto dice qué se importa, qué no («las fotos de los
platos no se importan») y que hay revisión antes de crear nada. El selector de
modelo **no se le pinta al restaurante**: el servidor le manda la lista vacía a
propósito, y el comentario de `index.html:6690` explica el motivo —«no enseñar
un mando que no acciona nada»—. Iba a reportarlo como fuga de detalle interno y
está resuelto.

---

# QR

**Sin hallazgos de fondo.** La vista previa a la izquierda y los controles a la
derecha funcionan, los avisos son buenos («El QR apunta siempre aquí. Si
cambias el slug hay que volver a imprimirlo», «Por debajo de 3 puede fallar»,
«Este restaurante no tiene logo. Súbelo en la pestaña Apariencia»).

Comprobado además lo que temía por A5: el enlace de esta carta usa la forma de
subdominio, `https://aojocerrado.vmenus.co`, y **responde** —la carta carga—,
así que el QR no apunta a nada roto.

---

# Estadísticas

## E1 · «Tasa de interacción: 125%» · **Media**

- [ ] Pendiente

Es `totalClics / totalVisitas * 100` (`server.js:2123`). En esta carta: 5 clics
entre 4 visitas = 125%.

**Por qué está mal planteado, no mal calculado:** el nombre dice «tasa» y la
unidad dice «%», y las dos cosas prometen una proporción que no puede pasar de
100. Pero la cantidad no está acotada: pasa de 100% en cuanto un comensal mira
dos platos, que es lo normal y lo deseable.

**Y lo peor no es cuando se pasa de 100.** En Bonzas, con tráfico real, marca
**70,4%** (27 visitas, 19 clics). Ahí parece un porcentaje perfectamente
sano y se lee como «el 70% de mis visitantes interactuó» — que es falso: son
0,70 clics por visita, y un solo comensal muy curioso puede producirlo. El
indicador engaña **también cuando parece correcto**, que es la forma peor.

**Arreglo:** enseñarlo como lo que es, «1,25 clics por visita». Mismo dato, sin
el signo de porcentaje que lo desmiente.

## E2 · Porcentajes calculados sobre cuatro visitas · **Media**

- [ ] Pendiente

«MÁS AGREGADOS AL CARRITO» dice «5 en total · 100% de las fichas abiertas» y
pinta a SUPREMA con una barra llena al «100% de 5». No hay mínimo de muestra:
con cinco eventos ya se enseñan porcentajes redondos que invitan a concluir
cosas.

**Arreglo:** por debajo de un umbral, enseñar el número absoluto y callar el
porcentaje.

## E3 · No hay estado de «todavía no hay datos» · **Baja**

- [ ] Pendiente

Con 4 visitas, «VISITAS POR DÍA» es una barra alta y cinco rayas, sin escala ni
valores, y «PRODUCTOS CON MÁS CLICS» es una lista de un elemento con su
alternador Gráfica/Lista. Todo se pinta igual que si hubiera mil visitas.

## Lo que está bien

El rango «Todo» tiene un tope de barras razonado: el comentario de
`index.html:7261` cuenta que arrancando en 2020 saldrían 2.431 barras y unos
41.000 px de scroll «que nadie va a recorrer».

---

# Pantalla TV

Revisada sobre **Bonzas Burger Grill**, que sí tiene el plan que la incluye
(en A Ojo Cerrado la pestaña no existe).

**Sin hallazgos. Es la pantalla mejor hecha del panel,** y conviene tenerla
como referencia de a qué debería parecerse el resto:

- Dice qué es y, sobre todo, **«el enlace no cambia nunca»**, que es justo la
  duda de quien va a dejar una pestaña abierta en un televisor para siempre.
- «Cómo llevarlo a la pantalla, **de más a menos estable**»: tres opciones
  ordenadas por fiabilidad, cada una con su pega, y la recomendación del
  aparato HDMI barato para el televisor sin navegador.
- Y lo mejor: **«59 platos · 20 pantallas + 6 intercaladas · la vuelta dura
  4 min 20 s»**. Traduce los ajustes al único dato que le importa al dueño
  —cuánto tarda en repetirse— en vez de dejarle sumar.
- Los estados vacíos dicen qué implica el vacío: «Sin horarios: la pantalla
  enseña siempre lo mismo».

---

# Hallazgos sueltos, fuera de pestaña

## X1 · La insignia `🛒 pedidos` dice capacidad y se lee como estado · **Baja**

- [ ] Pendiente

En la lista del superadmin se pinta con `if (plan.carrito)`
(`index.html:8756`), o sea **lo que el plan permite**, no si el carrito está
encendido. Bonzas la lleva, tiene el modelo `topnav` y el carrito apagado, así
que `ajustarPestanasAlModelo` (`index.html:6809`) ni le pinta la pestaña
Pedidos. La insignia afirma algo que el propio panel desmiente.

**Y el criterio correcto ya está escrito seis líneas más abajo**, en el
comentario de la insignia de IA: «el silencio se leería como "no la tiene", y
son cosas distintas». Ese mismo razonamiento aplicado aquí distinguiría
«puede tener pedidos» de «tiene pedidos».

## X2 · Cambiar de restaurante conserva el scroll · **Baja**

- [ ] Pendiente

Entrando a Bonzas desde la lista se aterriza **en mitad de la tabla de
productos**, donde estaba el scroll de la carta anterior. `entrarARestaurante`
(`index.html:9072`) no lleva la página arriba.

---

# Resumen para priorizar

**68 hallazgos** en las tres superficies. Si hay que empezar por algo, este es
el orden que yo seguiría:

| # | Hallazgo | Por qué primero |
|---|---|---|
| 0 | **LP1** · la landing publicada en borrador, con los dos WhatsApp rotos | Está por encima de todo lo demás: se lleva por delante a cada posible cliente que llegue, y ni te enteras de que llegó. |
| 1 | **T1 + B1** · gzip y las fotos sin `lazy` | Las dos son de una línea y las nota todo el mundo. Juntas son 8,3 MB por apertura. |
| 2 | **S1** · `✓ Pagó` sin confirmar ni deshacer | Es el único que corrompe un dato sin dejar rastro ni forma de arreglarlo desde el panel. |
| 3 | **PE1** · carrito sin WhatsApp | Es el único que le rompe la experiencia a un **comensal**, y en el último paso. |
| 4 | **A1 + A2** · los dos guardados de Apariencia | Se pierde trabajo tuyo en silencio, y van juntos. |
| 5 | **F1 + F3 + CL2** · el primer día de un restaurante | Los tres son el mismo momento: «Sin productos», sin poder crear uno hasta descubrir las categorías, y sin que se le ofrezca importar la carta — que es lo que la landing le prometió. |
| 6 | **L1** · sin salida si se olvida el PIN | Cada caso es una llamada a soporte. |
| 7 | **P1** · los dos desplegables de orden | Publica un cambio a clientes creyendo que es una vista. |
| 8 | **V1 + V2** · zoom desactivado y carta sin teclado | Es el público general, no clientes tuyos: cualquiera que escanee un QR. |
| 9 | **V4 + V5** · el checkout sin autocompletado y el carrito que se vacía antes de tiempo | Es la ruta que genera ingresos. |

Lo demás es acabado y se puede ir tachando sin prisa.

## Una observación sobre el código, no sobre la UX

De las cosas que fui a comprobar esperando un fallo, **cinco estaban ya
resueltas a propósito y explicadas en un comentario**: que Enter no enviara el
login, que el día de cobro se le expusiera al cliente, que el selector de
modelo de IA le llegara al restaurante, que borrar una categoría no avisara de
los platos que se lleva, y que el QR de subdominio apuntara a un dominio
muerto.

Eso cambia cómo hay que leer esta lista: casi nada de lo que queda es
descuido. Y en cuatro hallazgos —**C2**, **A2**, **TP2** y **X1**— el arreglo
consiste en aplicar un patrón que el panel **ya usa en otro sitio**, a veces a
pocas líneas de distancia.

---

# Segunda pasada: Bonzas Burger Grill (carta real, en producción)

A Ojo Cerrado enseñaba sobre todo estados vacíos —sin fotos, sin promociones,
sin toppings, sin WhatsApp—. Bonzas tiene 97 productos, 59 con foto, y sale
cosas que la otra no podía enseñar.

## B1 · Abrir la pestaña Productos descarga 7,8 MB de fotos · **Alta**

- [ ] Pendiente

Medido en producción sobre Bonzas:

| | |
|---|---|
| Productos | 97 (59 con foto, 38 sin) |
| Peticiones a `/uploads/productos/` | 61 |
| **Total descargado** | **7,8 MB** |
| Media por foto | 131 KB (la mayor, 395 KB) |
| Tamaño en que se pintan | **66 × 66 px** |
| Tamaño real de los archivos | hasta **800 × 1203 px** |
| Imágenes con `loading="lazy"` | **0 de 59** |

Se descarga la foto entera de cada plato para pintar un cuadradito de 66 px, y
las 59 a la vez al entrar en la pestaña.

> **Corregido al aplicarlo (11/09/2026):** aquí se decía además que «la tabla
> da saltos según van llegando» por no declarar `width`/`height`. **Es falso.**
> El CSS ya fija `.prod-img` en 68 px —54 en móvil—, así que la caja está
> reservada antes de que llegue la imagen y no hay ningún salto. Declarar los
> atributos no habría servido de nada, y en móvil habrían contradicho al CSS.

Y esto viaja por el dominio **sin CDN**: `docs/servidor.md` dice que
`adminvmenus.verificame.click` sirve «fotos y videos — los megabytes» desde el
VPS, sin Cloudflare delante.

**Lo que lo vuelve fácil de arreglar: la carta pública ya lo hace bien.**
`vmenus-app` pone `loading="lazy"` en sus cinco sitios —`core/menu.js:119`,
`core/reproduccion.js:54`, `temas/carrito.js:100`, `temas/explorar.js:322`— y
medido en móvil sobre la misma carta, de 61 imágenes solo pide 2 al abrir. **El
comensal no sufre esto; solo lo sufre el dueño en su panel.**

**Matiz importante, comprobado después:** las fotos **no** son originales de
cámara. `compressImage` las reduce en el navegador antes de subir —máximo 800 px
de ancho, calidad 0,82, en WebP cuando el navegador sabe
(`index.html:4020` y `6958`)—, y esa parte está muy bien hecha, con detección
real del soporte de WebP porque `toBlob()` devuelve PNG en silencio cuando no
puede.

O sea que 131 KB por foto de 800 px es un tamaño razonable. **El problema no es
el peso de cada archivo: es pedir las 59 de golpe para pintarlas a 66 px.**

**Arreglo, por orden:**
1. **Una línea** en `index.html:2943`: `im.loading='lazy'`, puesta **antes**
   del `src` —después no surte efecto, el navegador ya arrancó la descarga—.
   Con esto basta.
2. Solo si después sigue molestando: generar miniaturas al subir. No hay
   dependencia de imagen en `package.json` —`uploads/miniaturas/` es solo para
   los fotogramas de portada de los vídeos— así que es trabajo de verdad, y
   no hace falta para resolver lo de arriba.

## B2 · «Activa» manda sobre los otros dos y tiene exactamente su misma pinta · **Media**

- [ ] Pendiente

Cada promoción trae tres interruptores en fila: `Activa`, `En la carta`,
`En el televisor`. Comprobado en el DOM: los tres son independientes, ninguno
deshabilita ni atenúa a los otros, y los tres se ven igual.

Pero no son iguales. En `vmenus-app/core/promociones.js:40` el filtro es
`p.activa && p.imagen_url && p[donde]`: **`Activa` es un interruptor maestro**.
Apagándolo, la promoción no sale en ningún sitio — y la pantalla se queda
enseñando «En la carta» y «En el televisor» encendidos, afirmando algo que ya
no es verdad.

**Arreglo:** que los dos destinos dependan visualmente del maestro —atenuados o
deshabilitados cuando `Activa` está apagada.

## B3 · «Platos que nadie abrió» mezcla el problema con lo normal · **Media**

- [ ] Pendiente

Con 27 visitas en 7 días dice «86 en total» sobre 97 productos. Dos cosas lo
hacen poco accionable:

1. **La muestra.** Con 27 visitas, que 86 platos no se abrieran es aritmética,
   no una señal sobre los platos. Es el mismo problema que E2.
2. **Lo que llena la lista.** Los grupos que la encabezan son `ADICIONALES`
   (jalapeño, pepinillos, tocineta), `BEBIDAS` (agua, gaseosa), `CERVEZAS`
   (Águila, Corona, Póker) y `CÓCTELES`. **Nadie abre la ficha de una cerveza**
   — se pide y ya. Para esos productos, no ser abiertos es el comportamiento
   normal, no un síntoma.

Leído tal cual, el panel está sugiriendo revisar 86 platos de los que la mayoría
no tiene nada que revisar.

**Arreglo:** exigir un mínimo de visitas antes de enseñar la sección, y dejar
fuera las categorías que el propio dueño marque como «no se abren» (o las que
van en modo lista, que ya declaran que no tienen ficha con foto).

## Lo que está bien, y es mucho

**El bloque «AHORA MISMO» de Promoción es el mejor patrón del panel.** Enseña
—con fecha, hora y zona horaria del restaurante: «miércoles 2026-09-09 · 19:53
(hora de Bogotá)»— exactamente qué promoción está viendo un comensal en este
instante, separada por dónde sale: «En la carta / Cada cliente ve esta» y «En
el televisor / Sale esta, cada tantas pantallas de platos».

Es la respuesta a la pregunta que el dueño se hace de verdad —«¿qué está
viendo mi cliente ahora mismo?»— y es justo lo que le falta a Apariencia, donde
hay que pulsar «Vista previa» para averiguarlo.

En Estadísticas, «Horas de mayor tráfico» remata la gráfica con la frase
**«Hora punta: 20:00 · 6 visitas y 13 clics»**: nombra la conclusión en vez de
dejarte leer 24 barras.

---
---

# vmenus-app — la carta del comensal

Revisada en **móvil (375 × 812)** sobre `menu.vmenus.co/bonzas`, que es como
entra casi todo el mundo. Aquí el usuario no es un cliente tuyo: es cualquiera
que escanee un QR en una mesa, con el móvil que tenga y la vista que tenga.

> Comprobado y descartado: la carta **no desborda** en horizontal (375 px
> justos) y los enlaces de redes **sí llevan texto visible** con su nombre, así
> que tienen nombre accesible. Las dos cosas parecían fallos en la captura y en
> el árbol de accesibilidad, y no lo son.

## V1 · El `meta viewport` desactiva el pellizco para ampliar · **Alta**

- [ ] Pendiente

`index.html:5`:

```
<meta name="viewport" content="width=device-width, initial-scale=1.0,
      maximum-scale=1.0, user-scalable=no">
```

`maximum-scale=1.0` y `user-scalable=no` **prohíben ampliar con los dedos**.

**Por qué importa aquí más que en otro sitio:** esto es una carta de
restaurante. Los nombres van a 14 px y los precios a 13 px, y quien la abre
puede tener 60 años, estar en un local con poca luz o querer acercarse a la
foto del plato. Ampliar es exactamente lo que va a intentar hacer.

Safari en iOS lo ignora desde iOS 10, así que en iPhone se puede ampliar igual;
**en Android Chrome se respeta** salvo que la persona haya activado a mano el
«forzar zoom» de accesibilidad. O sea que afecta justo a la mitad del público
que menos probablemente lo tenga configurado.

**Arreglo:** quitar `maximum-scale` y `user-scalable`. Se dejó de usar hace
años; hoy no hace falta para evitar el zoom al enfocar un campo.

`tv.html` no lo lleva, y ahí está bien: en un televisor no hay pellizco.

## V2 · No se puede recorrer la carta con el teclado · **Alta**

- [ ] Pendiente

La tarjeta de cada plato es un `<div>` con `card.onclick`
(`core/menu.js:113`). En **todo el repositorio** —`index.html`, `core/` y los
seis temas— hay:

| | |
|---|---|
| `tabindex` | **0** |
| `role` | **0** |
| `aria-*` | **6** (cinco en `temas/explorar.js`, uno en el botón del carrito) |
| `onclick` sobre elementos que no son botones | **21**, repartidos por los 6 temas |

Los nombres y los precios sí se leen —son texto—, pero **la ficha del plato es
inalcanzable sin puntero**: la descripción, las fotos extra, los toppings y el
botón de añadir al pedido.

**Y lo que lo vuelve absurdo:** el teclado **ya está resuelto dentro del
modal**. `core/menu.js:324` escucha Escape para cerrar y las flechas ←/→ para
pasar de plato en plato, y hay swipe en táctil. Todo eso está construido,
funciona, y está encerrado detrás de una tarjeta que solo se abre con el dedo o
el ratón.

**Arreglo:** que la tarjeta sea un `<button>` (o `tabindex="0"` +
`role="button"` + Enter/Espacio). Con eso se desbloquea lo que ya existe.

## V3 · Ocho controles por debajo del tamaño mínimo de toque, y los peores son los de cerrar · **Media**

- [ ] Pendiente

Medido en la carta real, a 375 px:

| Control | Tamaño | |
|---|---|---|
| `close-checkout` ✕ | **18 × 30** | cerrar la pantalla de pedido |
| `close-cart` ✕ | 20 × 32 | cerrar el carrito |
| `custom-close` ✕ | 20 × 32 | cerrar la personalización |
| `custom-qty-btn` − / + | 34 × 34 | cantidad, se pulsa muchas veces |
| `modal-close-btn`, `modal-nav` ‹ › | 36 × 36 | cerrar y pasar de plato |

La referencia es 44 × 44 (Apple) o 48 × 48 (Android); el mínimo AA de la WCAG
es 24 × 24, y **`close-checkout` no llega ni a eso**.

Que los tres más pequeños sean los de **cerrar** es lo de menos defender: es el
control de «sácame de aquí», pulsado con el pulgar, en la pantalla donde el
comensal ya está a punto de mandar un pedido.

Las tarjetas de plato, en cambio, están holgadas (231 × 171) y la barra social
también (52 × 56).

## V4 · El único formulario que llena un comensal no tiene etiquetas asociadas ni autocompletado · **Media**

- [ ] Pendiente

En todo `index.html` (1.921 líneas):

| | |
|---|---|
| `<label>` | **3** — nombre, dirección, método de pago |
| `<label for=...>` | **0** |
| `autocomplete` | **0** |

Las etiquetas van sueltas (`index.html:1733`): `<label>👤 Tu Nombre</label>` y
el `<input>` como hermano, sin `for` y sin anidar. Consecuencias:

- **El campo no tiene nombre accesible.** Un lector de pantalla anuncia «cuadro
  de texto», sin más. El emoji, además, se lee en voz alta.
- Tocar la etiqueta no lleva el foco al campo.
- **Sin `autocomplete`, el móvil no ofrece rellenar el nombre ni la
  dirección.** Escribir «Calle 10 # 20-30» con el pulgar, cada vez que se pide,
  es justo lo que el autocompletado existe para evitar — y esto está en el paso
  final de un pedido, que es donde la gente abandona.

**Arreglo:** `for`/`id` en los tres, `autocomplete="name"` y
`autocomplete="street-address"`. Es media hora y toca la ruta que genera
ingresos.

Lo que sí está bien: es un `<form>` de verdad con `onsubmit`, los tres campos
son `required` y no se pide teléfono —viene del propio WhatsApp—, que es la
decisión correcta.

## V5 · El carrito se vacía al abrir WhatsApp, no al enviar el pedido · **Media**

- [ ] Pendiente

En `core/carrito.js:698`, el camino normal es: se abre `wa.me` en otra pestaña
y **acto seguido** se vacía el carrito, se cierra el checkout y se borran el
nombre y la dirección.

Pero abrir `wa.me` solo **prepara** el mensaje: el comensal todavía tiene que
darle a enviar dentro de WhatsApp. Si no lo hace —se lo piensa, no tiene
WhatsApp instalado, se distrae, vuelve atrás— al regresar a la pestaña de la
carta no queda nada: ni el pedido, ni el nombre, ni la dirección. Y sin
autocompletado (V4), rehacerlo es teclearlo todo otra vez.

**Lo que lo hace claramente un descuido y no una decisión:** el código ya
razona justo así para el otro camino. Cuando el navegador bloquea el emergente,
el comentario dice «vaciar el carrito aquí le borraba al cliente todo lo que
había armado y lo obligaba a empezar de cero: se conserva y se le da otra
vía» — y se conserva. El mismo argumento vale para el camino habitual, donde
abrir la pestaña se está tratando como si fuera haber enviado.

**Arreglo:** no vaciar al abrir. Dejar el carrito y enseñar «¿Enviaste tu
pedido?» con «Sí, listo» (vacía) y «Todavía no» (lo deja), o simplemente
conservarlo hasta que la persona vuelva y lo vacíe ella.

## Lo que está bien, y es de lo mejor de los dos repos

`mostrarEnlaceManual` (`core/carrito.js:718`): cuando el navegador bloquea el
emergente, avisa con palabras claras («Tu navegador bloqueó la apertura de
WhatsApp. **Tu pedido sigue guardado**»), ofrece un `<a>` de verdad —porque el
gesto del usuario es lo que exigen los bloqueadores, y el comentario lo
explica— y solo entonces vacía el carrito.

También: `soloDigitos` se usa en el carrito y en la barra social «para que no
se arregle en un sitio y se quede roto en el otro», y las imágenes llevan
`loading="lazy"` en los cinco sitios donde se pintan (ver B1).

---
---

# vmenus-landing — la página de venta

Revisada en vivo sobre `https://vmenus.co` y contra el clon local (rama
`fix/documento-html`, limpia: dice lo mismo que lo desplegado).

**La página está bien construida.** Sin desbordamiento horizontal, jerarquía de
encabezados correcta (un `h1`, `h2` por sección, `h3` en los pasos),
`meta description`, 6 etiquetas Open Graph y **cero imágenes** — todo es texto y
CSS, que es por lo que pesa nada. Su `meta viewport` además **sí deja
ampliar**, lo que confirma que el `user-scalable=no` de la carta (V1) es un
descuido y no una costumbre de la casa.

El problema no es cómo está hecha. Es que está publicada a medio terminar.

## LP1 · La página de venta está en producción en estado de borrador, con los dos botones de contacto rotos · **Alta — lo más urgente de toda la revisión**

- [ ] Pendiente

Ahora mismo, entrando a `vmenus.co`:

1. **Lo primero que se lee**, en una franja naranja a todo el ancho por encima
   del logo: «Borrador — falta poner el número de WhatsApp y decidir los
   precios antes de publicar».
2. **Los dos botones «Hablemos por WhatsApp» apuntan a
   `https://wa.me/57XXXXXXXXXX`**, el marcador de posición. WhatsApp responde
   que el número no es válido.

La página tiene **4 enlaces en total**. Dos son «Ver una carta de verdad» y
funcionan (`menu.vmenus.co/bonzas`). Los otros dos son los que generan negocio
y **están muertos**.

Es decir: quien llegue hoy a la página lee que es un borrador, lee que los
precios no están decididos, y si aun así quiere contratar, el botón no le lleva
a ninguna parte.

**Esto está por encima de cualquier hallazgo del panel.** Lo del panel es
fricción para clientes que ya son tuyos; esto se lleva por delante a cada
posible cliente que llegue, y no deja rastro de que llegó.

**Arreglo** —está descrito en `vmenus-landing/CLAUDE.md`, sección «Antes de
publicar»—: poner el número real en los dos botones y borrar entero el `<div
class="borrador">` de `index.html:276`. Lo que hay que decidir antes es el
tema de los precios, que es tuyo y no mío.

## LP2 · Nada impide que el borrador se indexe · **Media**

- [ ] Pendiente

No hay `<meta name="robots" content="noindex">` en `index.html` ni ninguna
regla en `nginx.conf`. El `robots.txt` que responde `vmenus.co` es el de
Cloudflare por defecto —el de señales de contenido para IA— y no prohíbe nada.

Así que la versión con la franja de «Borrador» y los enlaces rotos es
rastreable e indexable, y una vez indexada tarda en desaparecer aunque se
arregle mañana.

**Arreglo:** si LP1 se resuelve ya, esto se cae solo y no hace falta tocar
nada. Si va a seguir en borrador más de unos días, un `noindex` mientras tanto.

---
---

# Tercera pasada: el alta desde cero (restaurante `zz-pruebas-ux`)

Hecha sobre un restaurante creado para esto, con permiso para escribir. Es la
parte que el recorrido de solo mirar no podía alcanzar, y salió lo más caro de
toda la revisión en términos de clientes nuevos: **el primer día de un
restaurante en el panel**.

## F1 · La trampa del primer producto · **Alta**

- [ ] Pendiente

Recorrido tal cual, sin atajos, en un restaurante recién creado:

1. Aterrizas en Productos. Dice **«Sin productos»** y nada más.
2. Pulsas **«+ Nuevo producto»**, que es lo único que invita a pulsar.
3. Rellenas el nombre, la foto, la descripción.
4. Guardar → toast **«Selecciona una categoría»**.
5. Abres el desplegable de categoría: **está vacío**. Solo
   «— Selecciona categoría —», cero opciones.
6. Nada en pantalla dice que las categorías se crean en otra pestaña. Para ir
   hay que salir del modal, y el aviso de cambios sin guardar te confirma que
   pierdes lo escrito.

**Lo que lo convierte en un descuido claro:** el patrón correcto ya está **en
este mismo modal, dos veces**:

- «Este negocio todavía no tiene toppings. Créalos en la pestaña Toppings y
  vuelve aquí.»
- «Sin filtros activados. Actívalos en Apariencia → Filtros y etiquetas.»

Las dos son para cosas **opcionales**. La categoría, que es la única
obligatoria y la única que bloquea el guardado, no lo tiene.

**Arreglo:** la misma frase, para el caso que sí importa. Y mejor aún, dejar
crear la categoría desde el propio desplegable.

## F2 · El error de categoría no lleva el foco al campo; los otros dos sí · **Media**

- [ ] Pendiente

En `saveProduct` (`index.html:4816`), las tres comprobaciones obligatorias:

| Campo | Aviso | ¿Lleva el foco? |
|---|---|---|
| Categoría (4821) | toast | **No** |
| Nombre (4834) | toast | Sí, `.focus()` |
| Precio (4841) | toast | Sí, `.focus()` |

La que no lo hace es **la primera con la que se choca** y la única cuyo arreglo
está en otra pestaña. Además el aviso sale como toast abajo a la derecha,
lejos del desplegable, que se queda sin marcar: ni borde rojo ni mensaje al
lado.

Y las tres son `return` seguidos, así que los problemas se descubren **de uno
en uno**: guardas, corriges, guardas, corriges.

## F3 · Los estados vacíos del primer día no dicen nada · **Media**

- [ ] Pendiente

| Pantalla | Lo que dice |
|---|---|
| Productos, recién creado | «Sin productos» |
| Categorías, recién creado | «Sin categorías» |

Y encima Productos enseña, sobre cero productos, un **buscador**, un selector
de **orden de la tabla** y otro de **«Orden en el menú»** — tres controles para
ordenar y filtrar nada.

Es justo la pantalla donde **Promoción** sí explica qué es una promoción, dónde
sale y qué pasa si hay varias. El mejor estado vacío del panel está en la
pestaña que se usa de vez en cuando; el peor, en la primera pantalla que ve un
restaurante nuevo.

## F4 · Crear un restaurante no lleva a ninguna parte · **Baja**

- [ ] Pendiente

`crearRestaurante` (`index.html:9027`) limpia el formulario, enseña
«✓ Restaurante creado correctamente» y recarga la lista. No desplaza hasta el
nuevo, no lo resalta y no ofrece entrar a montarlo.

Medido al crear `zz-pruebas-ux`: quedó a **1.552 px por debajo** de lo que se
ve, el último de once. Te dicen que salió bien y te toca ir a buscarlo — y cada
restaurante nuevo lo empeora.

La validación previa, en cambio, está bien: nombre y slug obligatorios, formato
del slug comprobado y PIN de mínimo 4, cada uno con su mensaje.

## Lo que no se pudo probar, y por qué

**Las subidas de archivo.** El navegador que uso no tiene acción para
seleccionar un archivo, así que no pude disparar una subida real ni provocar
los errores de tamaño o de formato. Lo revisado es el código, y de ahí sale que
**esa parte está de las mejores del panel**:

- `compressImage` (`6958`) comprime antes de subir y **pregunta** si el
  navegador sabe hacer WebP en vez de darlo por hecho, porque `toBlob()`
  devuelve un PNG en silencio cuando no puede —y un PNG de una foto pesa varias
  veces más—. Safari no lo hace hasta la 16.4.
- La promesa rechaza de verdad ante un archivo corrupto o renombrado. El
  comentario cuenta que antes no se resolvía nunca: se quedaba en «Subiendo…»
  para siempre y había que recargar. `accept="image/*"` no protege de eso
  porque mira el nombre, no el contenido.
- En el video: detecta el `.mov` en HEVC del iPhone —que el navegador no
  reproduce aunque ffmpeg sí lo convierta—, lo explica y **deja subir igual**.
  Y «elegir no es subir»: al elegir archivo, solo el botón que continúa el
  trabajo se pinta como principal, porque antes los tres se veían iguales y la
  gente cerraba la ficha creyendo que ya estaba subido.

Si quieres que se prueben de verdad, hace falta que las hagas tú con un archivo
enorme y otro renombrado, y me digas qué salió.

---
---

# Cuarta pasada: el panel visto por el cliente

Con sesión iniciada como `zz-pruebas-ux`, no como superadmin. Es la vista que
usa el restaurante a diario y la que no se había mirado en toda la revisión.

**Lo que está bien de entrada:** la insignia dice `EDITOR` y no `SUPERADMIN`,
no aparece el botón «← Restaurantes», y el reparto de pestañas funciona:

| Ve | No ve |
|---|---|
| Productos · Categorías · Promoción · QR · Estadísticas | Apariencia · Toppings · Pedidos · Pantalla TV · Importar carta |

## CL1 · Tres mensajes mandan al cliente a pestañas que no existen para él · **Media**

- [ ] Pendiente

Recorriendo la sesión del cliente y cruzando cada mensaje con las pestañas que
tiene ocultas:

| Dónde | Qué le dice | La pestaña… |
|---|---|---|
| QR → Logo al centro | «Este restaurante no tiene logo. **Súbelo en la pestaña Apariencia**.» | no la ve |
| Modal de producto → Personalización | «Este negocio todavía no tiene toppings. **Créalos en la pestaña Toppings** y vuelve aquí.» | no la ve |
| Modal de producto → Filtros | «Sin filtros activados. **Actívalos en Apariencia → Filtros y etiquetas**.» | no la ve |

Lo irónico es que **son los mensajes buenos** — el patrón que se echa en falta
en F1. Están bien escritos y dicen exactamente dónde ir; el problema es que
mandan a una puerta que para ese usuario no existe. El cliente se queda
buscando una pestaña que no está, y acaba escribiéndote.

**Arreglo:** cuando el destino está oculto para quien mira, cambiar la frase
por lo que sí puede hacer: «Pídenos que subamos tu logo» o directamente el
enlace de WhatsApp de soporte.

**Lo que NO es el arreglo:** enseñarle Apariencia. Está bloqueada a propósito
(ver la nota de la sección Apariencia). Por eso este hallazgo es de **texto**,
no de permisos: si el destino nunca va a estar disponible, la frase que lleva
a él está mal escrita, y lo estará siempre.

## CL2 · Al restaurante nuevo no se le ofrece importar su carta · **Alta**

- [ ] Pendiente

La pestaña «Importar carta» y el atajo de Productos dependen los dos de
`puede_importar`, que el servidor calcula a partir del interruptor «Dejar que
este restaurante escanee su carta» — que está **apagado por defecto** y vive en
**Apariencia**, que el cliente no ve. (Comprobado: `zz-pruebas-ux` se creó con
los valores por defecto y en su sesión no aparece ni la pestaña ni el atajo.)

Así que el primer día de un restaurante es: «Sin productos», sin ninguna
indicación (F3), sin poder crear un producto hasta descubrir que antes hacen
falta categorías (F1), y **sin que se le ofrezca la única función que le
ahorra teclear la carta entera**.

**Y es justo lo que vende la landing**, con etiqueta de NOVEDAD: «Sube el PDF
de tu carta y se llena sola… Montar una carta a mano son entre cuarenta y
ciento setenta fichas, y ahí es donde la gente lo deja», con sus 98 platos y 9
páginas medidos. La página promete lo que el panel no le da salvo que tú te
acuerdes de encendérselo.

**Arreglo:** encenderlo por defecto en los planes que lo incluyen. Si tiene que
seguir siendo manual, que al menos forme parte de la lista de cosas que haces
al dar de alta a un cliente.

## CL3 · El cliente no puede cambiar su propio PIN · **Media**

- [ ] Pendiente

`cambiarPin` solo se llama desde el botón de la ficha en la lista del
superadmin (`index.html:8960`). En la sesión del cliente no hay ninguna forma
de cambiarlo.

Junto con **L1** cierra el círculo: no lo puede cambiar, no lo puede recuperar,
el login no le dice a quién pedirlo, y el `autocomplete="off"` impide que el
gestor de contraseñas se lo haya guardado. Cualquier problema con el acceso
termina, sin excepción, en una llamada a soporte.

---
---

# Quinta pasada: el panel del cliente en móvil (375 px)

Con la sesión de `zz-pruebas-ux`. **Parcial:** los clics del navegador dejaron
de responder a mitad, así que solo se recorrió QR a fondo; lo demás se midió
sin interacción. Y el restaurante tiene 1 producto y 1 categoría, así que **la
densidad no está probada**: haría falta una carta real.

## M1 · La navegación principal se sale de la pantalla y esconde su barra de desplazamiento · **Media**

- [ ] Pendiente

Medido a 375 px con la sesión del cliente:

| | |
|---|---|
| Ancho de la barra de pestañas | **519 px** en una pantalla de 375 |
| Última pestaña («Estadísticas») | termina **124 px fuera** |
| Pestañas de este cliente | 5 |

Y no hay ninguna señal de que haya más. `.tabs` (`index.html:112`) lleva
`overflow-x:auto` con **`scrollbar-width:none`** y
**`::-webkit-scrollbar{display:none}`**: la barra está escondida a propósito.
Tampoco hay `scrollIntoView` en las 9.227 líneas, así que la pestaña activa no
se trae a la vista.

**Lo que lo deja claro es la incoherencia dentro del mismo archivo:**

| Carril | Línea | Barra |
|---|---|---|
| `.cat-filter` (categorías) | 129 | **visible** — 3 px, pulgar propio, y `cursor:grab` para decir que se arrastra |
| `.tabs` (navegación principal) | 112 | **escondida a mano** |

El carril secundario avisa de que scrollea; el principal no. Y esto es con
cinco pestañas: **un cliente de Plan Completo tiene ocho** —se le suman
Toppings, Pedidos y Pantalla TV— así que se le queda fuera casi la mitad del
panel sin nada que lo insinúe.

## M2 · El cliente no puede leer la dirección de su propia carta · **Baja**

- [ ] Pendiente

En QR, el campo del enlace mide 232 px y el valor son 35 caracteres:
se ve `https://menu.vmenus.co/zz-pr` y ahí se corta. El botón `COPIAR` al lado
salva el uso práctico, pero para leerla —dictarla por teléfono, comprobar que
el slug es el que se acordó— hay que seleccionar y arrastrar dentro del campo.

## Lo que está bien

La fila de producto **está rediseñada para móvil, no encogida**
(`index.html:505`): pasa a una rejilla de dos filas —foto, nombre e
interruptor arriba; precio, editar y borrar abajo, separados por un borde—, y
el precio se pinta con una clase propia (`.prod-precio-movil`) porque la celda
de escritorio se oculta. Es trabajo de verdad y se nota.

Y en QR, el orden en móvil es el correcto: primero la vista previa del código,
después `DESCARGAR PNG` a todo el ancho como acción principal, y el enlace
debajo.

## Pendiente de esta pasada

Sin recorrer en móvil: **Productos, Categorías, Promoción y Estadísticas** con
la sesión del cliente, y la densidad de una carta real (97 productos, 21
categorías) en pantalla pequeña.

---

# Sexta pasada: la vista clara (móvil, sesión de cliente)

Todo el recorrido anterior fue en vista oscura. Esta es la primera medición en
claro, sobre Productos a 375 px.

> **Corrección de una impresión mía.** A ojo el verde sobre blanco parecía
> lavado y estuve a punto de anotar «la vista clara tiene mal contraste».
> Medido, **es falso**: casi todo pasa con holgura y solo falla un elemento.
> Los números van abajo precisamente para que no se toque lo que está bien.

## CL4 · El chip de categoría seleccionado se lee peor que los no seleccionados · **Media**

- [ ] Pendiente

Contrastes reales en vista clara, componiendo los fondos semitransparentes
sobre el blanco:

| Elemento | Color sobre fondo | Tamaño | Contraste | |
|---|---|---|---|---|
| **Chip de categoría activo** | `#0b8850` sobre `#dbebe3` | 12 px | **3,65** | **falla AA** (mínimo 4,5) |
| Chip inactivo | `#4a5c4e` sobre `#f2f6f3` | 12 px | 6,57 | pasa |
| Precio del plato | `#0b8850` sobre blanco | 13 px | 4,51 | pasa raspando |
| Pestaña activa | `#0b8850` sobre blanco | 10 px | 4,51 | pasa raspando |
| Pestaña inactiva · botón Editar · categoría | `#4a5c4e` sobre blanco | 10-12 px | 7,16 | pasa |
| Nombre del plato | `#142017` sobre blanco | 13 px | 16,82 | de sobra |

**Lo que hace que esto importe y no sea una nota de purista:** el chip activo
es el que dice **qué filtro está puesto**, y es el único elemento de la
pantalla que no llega al mínimo — con **casi la mitad de contraste que los
chips que no están seleccionados** (3,65 contra 6,57). El estado seleccionado
es el menos legible de los dos.

**Arreglo:** oscurecer el verde del texto del chip activo, o subir la opacidad
del fondo para que el contraste suba en vez de bajar. Con llevarlo a 4,5 basta.

Los dos de 4,51 —precio y pestaña activa— cumplen, pero sin margen: cualquier
retoque del verde de marca los deja por debajo. Conviene saberlo antes de
tocar la paleta, no después.

## Pendiente de esta pasada

**Categorías, Promoción y Estadísticas** en móvil siguen sin recorrer: los
clics del navegador dejaron de responder (las capturas y las mediciones sí
funcionan). Y la **densidad** —97 productos y 21 categorías en pantalla de
teléfono— sigue sin probar, porque `zz-pruebas-ux` tiene un producto.

## M3 · La fila de categoría no tiene adaptación de móvil, y su botón de borrar encoge · **Media**

- [ ] Pendiente

Medido a 375 px en la sesión del cliente:

| | |
|---|---|
| Contenido de la fila | **326 px** dentro de una caja de **307** |
| Botón 🗑 borrar | **28 × 26 px** |
| Flechas ↑ ↓ de reordenar | 29 × 33 px |
| Botón «+ Nueva categoría» | 120 × 40, con el texto partido en varias líneas |
| Cabecera «Categorías del restaurante» | partida en dos líneas |

La página no desborda, pero **la fila sí desborda su propia tarjeta**: se
queda contenido recortado dentro del recuadro.

**La causa está en el CSS y es una omisión, no un criterio.** `.cat-row`
(`index.html:209`) es un `flex` con `gap:12px` y **sin `flex-wrap`**, y **no
aparece ni una vez** en el bloque `@media(max-width:680px)`. Ese bloque
dedica **siete reglas** a rediseñar `.product-row` para móvil —la parte que
está bien hecha y que ya se elogió— y a la fila de categoría, ninguna.

Y encima le llega de rebote la única regla que sí la toca:
`.btn-del { padding:6px 9px; font-size:12px }` (`index.html:530`), que **hace
el botón de borrar más pequeño en móvil que en escritorio**. Justo al revés de
lo que pide un dedo, y justo en el control destructivo.

**Y se junta con C1:** reordenar categorías es de una en una, así que en la
carta de 21 categorías de A Ojo Cerrado son 20 toques sobre dianas de 29 px,
persiguiendo una fila que se mueve.

**Arreglo:** meter `.cat-row` en el bloque de móvil con el mismo criterio que
`.product-row` —dos filas, controles abajo con su separador— y dejar de
encoger `.btn-del` ahí.

## M4 · En móvil, el estado vacío de Promoción se queda sin su única instrucción · **Media**

- [ ] Pendiente

En móvil, el recuadro dice **solo** «Todavía no tienes promociones.». En
escritorio dice además «Pulsa «Añadir promoción» o arrastra una imagen aquí».

**El mecanismo está bien hecho y no es lo que falla.** `.pista-arrastre`
(`index.html:564`) se oculta por defecto y solo aparece bajo
`@media (hover: hover) and (pointer: fine)` — se pregunta por el ratón, no por
el ancho, y el comentario explica por qué: «un portátil pequeño y una tablet
con teclado caerían del lado equivocado». Es la implementación correcta.

**Lo que falla es qué se metió dentro del span.** El propio comentario escribe
la regla:

> «aquí dentro va SOLO lo que sobra sin ratón. Si un texto que hace falta desde
> un teléfono entra en un `.pista-arrastre`, ese usuario deja de verlo. Lo
> comprueba una prueba.»

Extraídas las nueve pistas del archivo:

| | Contenido del span |
|---|---|
| 8 de 9 | solo el arrastre: «o arrástralo aquí», «También puedes arrastrar las imágenes aquí»… Su «Haz clic para subir» vive **fuera**, así que el móvil lo sigue viendo. |
| **1 de 9** (`index.html:1281`) | **«Pulsa «Añadir promoción» o arrastra una imagen aquí.»** — la frase entera, instrucción incluida. |

Así que en la única pantalla donde el estado vacío tenía que decir qué hacer,
el móvil se queda sin ello.

## M5 · La prueba que vigila esto no lo detecta, por una palabra · **Media**

- [ ] Pendiente

`test/navegador.test.js:3291`, «dentro de la pista solo va lo que sobra sin
ratón»:

```js
assert.match(texto, /arrastr|arrástra/i);
assert.doesNotMatch(texto, /clic/i);
```

El texto de M4 dice **«Pulsa»**, no «clic». Contiene «arrastra», así que pasa
la primera comprobación; no contiene «clic», así que pasa la segunda.

**Ejecutada:** `node --test` sobre ese archivo da **15 pruebas, 0 fallos**. La
guardia aprueba el caso que existe para impedir.

Y tiene su ironía: la lista negra busca la palabra de escritorio —«clic»— y el
texto que se cuela usa **«Pulsa»**, que es precisamente el verbo correcto para
un teléfono. La redacción más apropiada para móvil es la que esquiva la
comprobación pensada para proteger al móvil.

**Arreglo, las dos mitades:**
1. Sacar «Pulsa «Añadir promoción»» fuera del `<span>`, como en las otras ocho.
2. Cambiar la lista negra por una lista blanca: en vez de prohibir «clic»,
   exigir que la pista **solo** hable de arrastrar. Una lista negra de palabras
   hay que ampliarla cada vez que alguien usa un sinónimo, y ese es justo el
   fallo que se acaba de ver.

## M6 · Con cero visitas, «Platos que nadie abrió» acusa a toda la carta · **Media**

- [ ] Pendiente

Visto en `zz-pruebas-ux` recién creado: **0 visitas, 0 clics, 1 plato**. La
sección dice:

> **PLATOS QUE NADIE ABRIÓ** · 1 en total
> ENTRADAS · 1 — «Papas a la francesa»

Es cierto y es inútil: nadie pudo abrirlo porque la carta no se ha visitado
nunca. A un restaurante que acaba de entrar le está diciendo que su único plato
está siendo ignorado.

**Lo que lo convierte en un arreglo evidente:** sus dos secciones vecinas **sí**
lo resuelven bien en el mismo estado —«Horas de mayor tráfico» dice «Sin datos
en este rango» y «Categorías más miradas» dice «Sin clics registrados en este
rango»—. Esta no, porque se calcula por **ausencia**: con cero datos, «nadie lo
abrió» es verdad para todo, así que la sección se pinta llena en vez de vacía.

Y lo mismo con el indicador de arriba: **«Tasa de interacción: 0%»** con cero
visitas. `server.js:2123` protege bien la división por cero, pero enseñar un
0% rotundo donde no hay nada medido dice algo distinto de «todavía no hay
datos» (ver E1 y E2 — este es el tercer caso de la misma familia).

**Arreglo:** darle a esta sección la misma guardia que ya tienen sus vecinas.
Por debajo de un mínimo de visitas, «Sin datos en este rango» y nada más.

## M7 · El rango libre de fechas se parte en dos filas · **Baja**

- [ ] Pendiente

A 375 px, los dos campos de fecha caen en filas distintas (medido: uno a 197 px
y el otro a 239) y el guion que los une queda huérfano al final de la primera.
Se lee «03/09/2026 —» y debajo «09/09/2026», que parece un rango incompleto.

Los atajos de al lado —Hoy · 7 días · 30 días · Todo— sí se reparten bien.

## Cierre de la pasada de móvil

Recorridas con sesión de cliente a 375 px: **Productos, Categorías, Promoción,
QR y Estadísticas** — las cinco que ve un cliente. Queda sin probar la
**densidad**: `zz-pruebas-ux` tiene un producto y una categoría, y lo que
interesa mirar es una carta de 97 productos y 21 categorías en un teléfono.
Eso necesita la sesión de un cliente real o volver a entrar como superadmin.

---
---

# Séptima pasada: los cuatro modelos de carta que faltaban

Revisados en móvil (375 px) sobre las cartas reales: **Sidebar** (Galé),
**Explorar** (San Javier), **Video** (Voro) y **Vertical** (Pizzería Pierrot).

**El resultado, dicho de frente: los modelos están mejor construidos que el
panel.** Solo salen dos hallazgos nuevos. El resto de lo que se fue a buscar
—contraste sobre fotos, vídeos comiéndose los datos, barras fijas tapando
contenido, botones flotantes pisándose— estaba resuelto, y en varios casos
mejor de lo que se suele ver.

> **Limitación de esta pasada:** los clics del navegador dejaron de responder,
> así que se revisó **el primer render de cada modelo** más el fuente de su
> tema. No se pudieron abrir el menú lateral, la ficha de un plato, el panel de
> filtros ni el buscador. Lo que dependa de esos estados sigue sin mirar.

## MD1 · El botón del menú lateral no tiene nombre accesible · **Media**

- [ ] Pendiente

Modelo **Sidebar**. El marcado (`vmenus-app/index.html:1669`) es:

```html
<button class="menu-toggle" id="menuToggle">
  <span></span><span></span><span></span>
</button>
```

Tres `<span>` vacíos dibujados como barras con CSS. **El botón no contiene
texto, ni `aria-label`, ni `title`**, así que su nombre accesible está vacío:
un lector de pantalla anuncia «botón» y nada más.

Las categorías siguen alcanzables bajando por la página —los títulos están en
el texto—, así que no se pierde la carta; lo que queda tras un botón sin nombre
es **el salto rápido entre categorías**, que en una carta larga es la razón de
ser de este modelo.

Mide además **40 × 33**, por debajo de los 44 × 44 de referencia.

**Y el patrón ya está en la casa:** el botón del carrito lleva
`aria-label="Ver el pedido"` (`index.html:1702`) y `temas/explorar.js` tiene
cinco etiquetas más. Esta se quedó fuera.

## MD2 · El botón de limpiar la búsqueda mide 16 × 16 · **Media**

- [ ] Pendiente

Modelo **Explorar**, `temas/explorar.js:109`. Es el **control más pequeño de
toda la aplicación**: por debajo incluso del mínimo AA de 24 × 24, y menos de
la mitad de los 44 recomendados.

Está bien hecho en lo demás —es un `<button>` de verdad con
`aria-label="Limpiar"`— pero es una diana de 16 px para un pulgar, dentro de un
campo de búsqueda que se usa con el teclado abierto y media pantalla ocupada.

## Lo que se fue a buscar y estaba bien

**Vídeo sobre datos móviles (modelo Video).** Es lo mejor construido de los dos
repositorios. Cuatro vídeos en el DOM y **una sola petición**: cada `<video>`
lleva `preload="none"`, `poster`, `muted`, `loop` y `playsinline`, y
`core/reproduccion.js` usa **dos** `IntersectionObserver` — uno que solo asigna
el `src` cuando el plato está a dos pantallas de distancia
(`rootMargin: '200% 0px'`) y otro que reparte la reproducción al más visible.
Y pausa con la pestaña en segundo plano, «no tiene sentido gastar batería».

**Texto sobre foto (modelo Vertical).** Dos mecanismos a la vez: un velo
`.ver-velo` con degradado negro al 40 % y `text-shadow` en el nombre del plato.
Además solo hay **2 diapositivas en el DOM** —no se pinta la carta entera— y el
desplazamiento usa `scroll-snap-type: y mandatory` con
**`scroll-snap-stop: always`**, comentado como «no se saltan platos de un
manotazo».

**Contraste (Sidebar y Explorar).** Medido: nombre 13,3 · precio 10,8 ·
categoría 13,9 en Sidebar, y descripción 9,1 en Explorar. Muy por encima del
mínimo. Ninguno de los dos desborda en horizontal.

**Botones flotantes (modelo Video).** Los tres —carrito, WhatsApp y subir— están
colocados sin pisarse, comprobado por rectángulos, y el contenido lleva
`padding-bottom: 100px` para que no los tape.

## Lo que esta pasada confirma de hallazgos ya anotados

**V2 vale para los cuatro.** La tarjeta de plato de Explorar también es
`div.onclick` (`temas/explorar.js:337`). Ningún modelo aporta teclado.

**V3 vale para los cuatro.** Los controles pequeños —`close-checkout` 18 × 30,
`close-cart` 20 × 32, `custom-qty-btn` 34 × 34— viven en `index.html`, que es
común a todos los temas, así que aparecen igual en los cuatro modelos.

## Dos errores de medición de esta pasada, corregidos

Se anotan porque los dos llevaban a conclusiones falsas y podrían repetirse:

1. **«San Javier no tiene elementos fijos».** Falso. El filtro exigía
   `offsetParent !== null`, y `offsetParent` **es `null` justamente para los
   elementos `position: fixed`**. Con el filtro corregido aparecen once.
2. **«El modelo Vertical no usa scroll-snap».** Falso. Se midió
   `document.scrollingElement`, y el snap está en un contenedor interno
   (`index.html:1198`).

---
---

# Octava pasada: la cartelera del televisor (`tv.html`)

Revisada a 1280 × 720 sobre `menu.vmenus.co/bonzas/tv`, con la configuración
real de Bonzas: 3 platos por pantalla, 59 platos, 20 pantallas más 6
intercaladas.

Es la última superficie que quedaba sin mirar, y **sale con un solo hallazgo**.
Para funcionar sola durante horas es lo más robusto de los dos repositorios.

## TV1 · Nada impide que la pantalla se apague sola · **Media**

- [ ] Pendiente

No hay ninguna llamada a la **Wake Lock API** en `tv.html` —ni
`navigator.wakeLock`, ni ninguna alternativa—, así que la página no pide
mantener la pantalla encendida.

**Por qué importa justo aquí:** el panel recomienda, como primera opción y
textualmente «lo más seguro», **«Cable HDMI desde un computador»**. Y un
computador apaga la pantalla por ahorro de energía a los diez o quince minutos
de fábrica. O sea que el método que se recomienda como el más estable es
precisamente el que se queda en negro solo — y el dueño no tiene forma de
relacionar una cosa con la otra.

Comprobado además que **no está documentado como paso manual**:
`docs/pantalla-tv.md` no menciona el salvapantallas, ni el apagado de pantalla,
ni los ajustes de energía. Su única línea al respecto da por hecho que «el
televisor se enciende al abrir el local y se apaga al cerrar».

**Arreglo:** pedir `navigator.wakeLock.request('screen')` al arrancar y volver
a pedirlo en `visibilitychange` —el bloqueo se suelta solo al cambiar de
pestaña—. Donde no exista la API no pasa nada, se ignora. Y añadir a
`docs/pantalla-tv.md` la nota de desactivar el apagado de pantalla en el
computador, para los navegadores que no la soportan.

## Lo que está bien, que es casi todo

Esta página está pensada para quedarse sola, y se nota:

**El sondeo no reinicia el ciclo.** Pregunta por cambios cada 5 minutos, pero
`sondear()` (`tv.html:1340`) compara antes de aplicar y **solo reconstruye si
algo cambió de verdad** — porque rehacer los slides en cada sondeo reiniciaría
la vuelta cada cinco minutos y «el cliente vería siempre los mismos primeros
platos». Es un detalle que solo se ve pensando en la pantalla, no en el código.

**La recarga de seguridad no interrumpe.** A las 18 horas recarga, pero
**dentro de `avanzar()`, en la transición entre pantallas y nunca a media
animación** (`tv.html:1191`). El comentario explica el porqué: el televisor se
apaga al cerrar el local, pero un computador por HDMI puede quedarse encendido
días, y ahí se acumulan las fugas.

**Arranca sin internet.** Pinta primero la caché de lo último conocido, «para
que un arranque sin internet —el local abre y el router todavía no levantó—
enseñe algo igualmente».

**No se queda en blanco nunca.** Si falla la carga conserva lo que había, con
el comentario que lo resume mejor que yo: «una pantalla que sigue enseñando la
carta de hace diez minutos es infinitamente mejor que una pantalla en blanco en
la pared de un local». Y si la cartelera está apagada o no hay platos, muestra
el logo y el nombre del restaurante, no un vacío.

**El aviso de fallo está calibrado para el personal, no para el comensal.**
`#sinRed` va en la esquina a 1,8 vmin con 45 % de opacidad, y sus textos son
cortos y en español: «sin conexión», «respuesta ilegible», «error 400».

**El tamaño de letra no es un hallazgo.** El nombre del plato ocupa el 2,9 %
del alto de la pantalla y el precio el 2,67 %, que se queda corto para leer
desde el fondo de un local — pero es consecuencia directa del ajuste «platos a
la vez», que el panel ya explica sin adornos: «4 — caben más, se ven pequeños».
Bonzas eligió 3. Es una decisión del restaurante, no un defecto.

---
---

# Novena pasada: las subidas de archivo (probadas a mano)

Las hizo el usuario el 10 de septiembre de 2026, porque el navegador de la
revisión no puede seleccionar archivos. **Los cuatro casos probados:** dos
salieron correctos y se cierran, dos son hallazgo.

## Comprobado: el archivo renombrado ya no cuelga la ficha · **cerrado**

- [x] Verificado en producción · 2026-09-10

Se subió un PDF renombrado a `.jpg` al recuadro de imagen de un producto.
`accept="image/*"` lo deja pasar porque mira el nombre y no el contenido.

**Resultado: el mensaje esperado, en rojo** — «Ese archivo no es una imagen que
el navegador pueda abrir».

Esto importa más de lo que parece: el comentario de `compressImage`
(`index.html:6958`) cuenta que **antes la promesa no se resolvía nunca**, el
estado se quedaba en «Subiendo…» para siempre y no había más salida que
recargar la página entera. **Queda verificado en producción que ese fallo está
arreglado**, no solo leído en el código.

## SU1 · Una foto de iPhone en HEIC muere en un mensaje sin salida · **Media**

- [ ] Pendiente

Probado: una foto **sin convertir, en `.heic`**, devuelve «Ese archivo no es una
imagen que el navegador pueda abrir».

El rechazo en sí está bien —el navegador no puede decodificarlo, y colgarse
sería mucho peor—. **El problema es el mensaje.** A quien tiene el teléfono en
la mano le dice que su foto no es una foto, cuando la ve perfectamente en su
carrete y la ha mandado por WhatsApp mil veces. No le dice qué formato es, ni
qué hacer, ni que tiene arreglo en diez segundos. La conclusión razonable desde
el otro lado es «el panel está roto» o «la foto está dañada», y la llamada cae
en soporte.

**Con qué frecuencia pasa de verdad**, para no exagerarlo: cuando el iPhone
abre el selector de **fotos**, transcodifica a JPG él solo, así que el camino
más común no falla. El HEIC llega cuando se elige desde **Archivos**, cuando la
foto se pasó antes a un computador y se sube desde ahí, o cuando llegó como
documento por correo o WhatsApp. No es el caso mayoritario, pero está a un paso
del mayoritario y es el formato por defecto de todos los iPhone desde 2017.

**Comprobado además que no está contemplado en ninguna parte:** «heic» y
«heif» no aparecen ni una vez en `public/index.html`, ni en `server.js`, ni en
ningún documento de `docs/`.

**Arreglo:** mirar la extensión o el tipo antes de rendirse y dar el mensaje
que corresponde. Algo como: «Esa foto está en formato HEIC, el que usan los
iPhone. Ábrela y guárdala como JPG, o mándatela por WhatsApp a ti mismo y sube
la que llega». Es un `if` y una frase, y convierte un callejón sin salida en
una instrucción.

## SU2 · Una foto corrupta se acepta, se sube y se anuncia en verde · **Media**

- [ ] Pendiente

Probado con `2-truncado.jpg`. **Resultado: «✓ Lista para guardar», en verde** —
no el error que se esperaba.

Qué es ese archivo, medido: JPEG **baseline (SOF0)**, 800 × 1203 declarados,
con **9.000 de 86.173 bytes — el 10,4 %**, y sin marca de fin (`FFD9`). Un JPEG
baseline se decodifica de arriba abajo, así que sobrevive **la décima parte
superior** de la foto y el resto queda en blanco.

El navegador no falla al abrirlo: decodifica lo que puede, `img.onload`
dispara, el lienzo pinta esa décima parte y `toBlob` devuelve un archivo
perfectamente válido… de una foto rota. `compressImage` solo se protege de los
archivos que **no** decodifican (SU1, el renombrado); un decodificado **parcial**
le parece un éxito.

**Lo que agrava el caso:** `handleProductImgUpload` (`index.html:4021`) llama a
`uploadImg` **antes** de que nadie pulse Guardar. «Lista para guardar» quiere
decir que el archivo roto **ya está subido al servidor**; lo único que falta es
apuntarlo en el producto. Si se cierra la ficha, queda un huérfano en
`uploads/` hasta que pase `limpieza.js`.

**Lo que lo modera:** la vista previa enseña el resultado, y una foto que es
90 % blanco se ve rota a simple vista. La información está delante de quien
sube. Lo que está mal es que **el panel afirme lo contrario en verde**: «✓
Lista para guardar» es una aserción de que el archivo está bien, justo encima
de la prueba de que no lo está.

**Arreglo:** después de dibujar en el lienzo, comprobar que la imagen trae
datos hasta abajo —muestrear las últimas filas de píxeles y ver si son todas
del mismo valor vacío— y avisar en ámbar: «Esta foto parece incompleta, se ve
cortada. Súbela otra vez». No hace falta bloquearla; basta con no cantar
victoria.

## Comprobado: una imagen enorme no tumba el navegador · **cerrado**

- [x] Verificado en producción · 2026-09-10

Probado con `3-enorme.png`: 5000 × 3500, 2,4 MB en disco pero **67 MB al
decodificar**, que es lo que agota la memoria de un teléfono.

**Resultado: «✓ Lista para guardar».** Ni cuelgue, ni pestaña cerrada. La
reducción a 800 px de `compressImage` aguanta el caso.

---
---

# Décima pasada: los estados interactivos (los clics volvieron)

El navegador recuperó los clics, así que se pudo abrir por fin el menú lateral
del modelo **Sidebar**, que en la séptima pasada quedó pendiente.

## MD3 · Escape cierra tres capas pero no el menú lateral · **Media**

- [ ] Pendiente

Probado en la carta de Galé: con el lateral abierto se pulsa Escape y **sigue
abierto** (`class="sidebar open"`).

El manejador global (`core/menu.js:325`) sí atiende Escape, y cierra tres
cosas: el modal del plato, la lupa de la foto y la promoción. **El lateral es
la única capa que se queda fuera de esa lista** — y es una capa que tapa la
pantalla entera en móvil.

Cerrarlo sí se puede: con la ✕ o tocando el velo. Lo que falla es que la tecla
que ya cierra todo lo demás aquí no haga nada, que es peor que si no
funcionara en ningún sitio: enseña una regla y luego la rompe.

**Arreglo:** añadir `closeSidebar()` a esa misma línea.

## MD4 · Al abrir el lateral, el foco se queda fuera · **Baja**

- [ ] Pendiente

Con el panel abierto, `document.activeElement` sigue siendo el botón
`menu-toggle`, **fuera del lateral**. No se mueve el foco al panel ni se
retiene dentro: tabulando se sale del menú mientras sigue cubriendo la página.

Y su botón de cerrar (`#closeMenu`) mide **20 × 32** y no tiene `aria-label`;
su único contenido es «✕». Es el mismo problema que MD1 en el botón de abrir, y
del mismo tamaño que los cierres globales de V3.

**Arreglo:** llevar el foco al panel al abrirlo, devolverlo al botón al
cerrarlo, y ponerle nombre a la ✕.

## Lo que está bien

**Los 21 elementos del menú son `<button>` de verdad**, así que esta parte sí
se recorre con teclado — bastante mejor que las tarjetas de plato de V2, que
son `div` con `onclick`. Y hay velo que cierra al tocarlo.

---
---

# Qué queda por revisar

Actualizado tras la décima pasada. Nada de esto está mirado.

## Lo que se puede hacer sin interacción

**La vista clara del resto del panel.** Solo se midió Productos (CL4). Las
demás pantallas se recorrieron en oscuro.

## Lo que necesita clics

Los clics del navegador dejaron de responder a mitad de la revisión, así que
todo lo que sigue quedó fuera:

**Los estados interactivos que faltan**: la ficha de un plato, el panel de
filtros y el buscador (Explorar). El menú lateral ya está hecho — ver la
décima pasada. Los clics del navegador volvieron a funcionar, así que esto ya
no está bloqueado.

**El flujo de pedido completo** sobre un restaurante que sí tenga número de
WhatsApp, con toppings y personalización. Lo revisado es el código (V4, V5,
PE1), no un pedido de principio a fin.

**Las promociones con horario**: el interruptor «Solo en ciertos días u horas»,
y cómo queda el bloque «AHORA MISMO» cuando ninguna está vigente.

**Los horarios por categoría** y su estado «oculta ahora».

## Lo que necesita otra sesión

**La densidad del panel en móvil.** Las cinco pestañas del cliente se
recorrieron sobre `zz-pruebas-ux`, que tiene 1 producto y 1 categoría. Falta
verlas con una carta real —97 productos, 21 categorías—, que es donde M1 y M3
deberían ponerse peores. Hace falta la sesión de un cliente real o volver a
entrar como superadmin.

## Lo que necesita a una persona

**Las subidas de archivo: los cuatro casos hechos** (novena pasada). Dos
cerrados como correctos, dos convertidos en hallazgo (SU1 y SU2).

**Los caminos que cuestan dinero**, excluidos a propósito: importar una carta
(gasta cupo de la API de Anthropic) y generar video con IA (se paga en
Replicate). Se revisó su interfaz sin lanzar el proceso.

---
---

---
---

---
---

---
---
