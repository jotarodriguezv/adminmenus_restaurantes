# Pruebas a mano de la revisión de UX

**Creado el 14/09/2026.** Todo lo que cambió al aplicar
`docs/revision-ux.md`, ordenado por **dónde mirarlo** y no por código de
hallazgo. Cada línea dice qué hacer y qué debería pasar; entre corchetes, el
hallazgo y el pull request, por si algo no cuadra y hay que ir al detalle.

Las pruebas automáticas ya cubren la lógica. Esto es para verlo con los ojos y
con los dedos, en el despliegue de verdad, que es lo que ninguna prueba hace.

```markdown
- [ ] Sin mirar
- [x] Bien · 2026-09-15
- [!] No cuadra · 2026-09-15 · lo que pasó
```

## Antes de empezar

- **No enviar pedidos a restaurantes reales.** El pedido llega al WhatsApp del
  local. Para probar el carrito de punta a punta, poner **tu** número en
  Pedidos de `zz-pruebas-ux` y cambiarle el modelo a Carrito.
- **No lanzar los caminos que cuestan dinero**: importar una carta y generar un
  video con IA. Mirar su pantalla, no pulsar el botón final.
- Probar **en un móvil de verdad** además del computador: muchos cambios son de
  tamaño de toque, zoom y teclado del teléfono.
- Qué restaurante usar para cada modelo de carta: Topnav → `bonzas` ·
  Sidebar → `malparados` · Carrito → `aojocerrado`, `perroscriollos` ·
  Explorar → `sanjavier` · Vertical → `indigo` · Video → `juanmar`.
- Cartelera de televisor: `bonzas`, `malparados`, `perroscriollos`.

---

## 1. El login

- [ ] Al abrir el panel, el cursor ya está en el primer campo, sin tocar nada. [L2 · #75]
- [ ] Los textos se entienden sin jerga: el primer campo dice «Nombre corto de tu restaurante», no «slug». [L3 · #102]
- [ ] El PIN se escribe con puntos, no en claro. [L4 · #102]
- [ ] Debajo del botón dice a quién pedir el PIN si se olvidó, con enlace a WhatsApp. [L1 · #82]
- [ ] En el móvil, el gestor de contraseñas ofrece guardar el usuario y el PIN, y los rellena la vez siguiente. [L1 · #82]
- [ ] Con el teléfono en modo oscuro el panel sale oscuro, y en claro sale claro, mientras no se haya pulsado el botón de tema. Después de pulsarlo, recuerda lo elegido. [L5 · #102]

## 2. El panel del superadmin (la lista de restaurantes)

- [ ] «+ Nuevo restaurante ▾» sale **plegado**; la lista está arriba. Al pulsarlo se abre el formulario. [S4 · #117]
- [ ] Al crear un restaurante, el formulario se pliega, la página baja hasta la tarjeta nueva, que queda resaltada, y el aviso ofrece «Montar la carta». [F4 · #105, S4 · #117]
- [ ] El PIN al crear no deja escribir más de 10 caracteres. [S4 · #117]
- [ ] «Cambiar PIN» desde la lista pone un PIN nuevo **sin pedir el actual**, y no deja más de 10 caracteres. [CL3 · #112]
- [ ] Solo «Eliminar» es rojo, y se ve sin pasar el ratón por encima. Desde S6 está dentro de «⋯ Más». [S2 · #103]
- [ ] Cada restaurante enseña solo **Editar menú, Ver carta y ✓ Pagó**; Suspender, IA, Cambiar PIN y Eliminar están en **«⋯ Más»**. Abrir el de otro restaurante cierra el anterior, y pulsar fuera o Escape lo cierra. En el móvil el menú no se sale de la pantalla. [S6]
- [ ] «● Activo» / «● Suspendido» es un texto junto al nombre, no parece un botón. [S3 · #103]
- [ ] «✓ Pagó» registra el pago y el aviso ofrece **Deshacer**; deshacer lo devuelve a como estaba. [S1 · #78]
- [ ] La insignia «🛒 pedidos» solo sale en los restaurantes cuya carta tiene carrito. [X1 · #106]
- [ ] Al entrar a un restaurante desde abajo de la lista, el panel empieza arriba, no a media página. [X2 · #106]
- [ ] Sin conexión (modo avión un momento), la lista dice por qué no carga y ofrece **Reintentar**. [S5 · #104]

## 3. La barra superior y las pestañas

- [ ] Como cliente (entrar con el nombre corto y el PIN de un restaurante): hay un botón **Cambiar PIN**, que en el móvil dice «PIN». [CL3 · #112]
  - [ ] Con el PIN actual equivocado, el aviso sale dentro de la ventana y **no te saca del panel**.
  - [ ] Si los dos PIN nuevos no coinciden, lo dice y no guarda.
  - [ ] Con todo bien, dice «PIN cambiado» y la sesión sigue abierta. **Salir y entrar con el PIN nuevo.**
  - [ ] Como superadmin dentro de un restaurante, ese botón **no** aparece.
- [ ] En el móvil, las pestañas que no caben se ven difuminadas en el borde, y la pestaña activa queda a la vista. [M1 · #95]
- [ ] En la sesión de un cliente, ningún aviso le manda a una pestaña que no tiene (por ejemplo, a Apariencia). [CL1 · #90]
- [ ] La pestaña **Pedidos** solo aparece si la carta tiene carrito: sí en `aojocerrado`, no en `bonzas`. [PE3 · #86]

## 4. Productos

- [ ] En un restaurante sin categorías ni platos (`zz-pruebas-ux` vaciado, o uno recién creado), la pantalla explica qué hacer y ofrece crear la primera categoría; al crearla, sigue con el primer plato. [F1 + F3 · #81]
- [ ] Una búsqueda sin resultados dice que no hay resultados, **no** que el restaurante no tiene productos. [F1 · #81]
- [ ] El carril de categorías (con muchas, por ejemplo en `bonzas`) se ve difuminado donde hay más, y la categoría que eliges se desplaza hasta verse entera. [P5 · #109]
- [ ] Después de guardar cinco o seis platos seguidos, la rueda del ratón sobre ese carril sigue desplazando lo normal, no cada vez más rápido. [P5 · #109]
- [ ] Los dos desplegables de orden explican qué ordena cada uno («Ver aquí» / en la carta), y cambiar el orden de la carta ofrece **Deshacer**. [P1 · #83]
- [ ] En la ficha de un plato, guardar con varios errores (sin nombre, sin precio, sin categoría) los enseña **todos a la vez**, cada uno en su campo. [F2 · #99]
- [ ] El botón de borrar de cada plato dice qué plato borra (se ve al pasar el ratón o con lector de pantalla). [P6 · #99]
- [ ] Subir una foto HEIC (la de iPhone) da un mensaje que explica qué hacer. [SU1 · #76]
- [ ] Una foto cortada (descarga a medias) se rechaza **antes** de subir, con un mensaje claro, en vez de anunciarse en verde. [SU2 · #88]
- [ ] La lista de platos abre rápido y las fotos van apareciendo al bajar. [B1 · #74]

## 5. Categorías

- [ ] Cada fila dice cuántos platos tiene, cómo se ve (con fotos / en lista) y **si sale en la carta**: una sin platos, o con todos agotados, avisa de que no sale. [C2 + C3 · #100]
- [ ] En el móvil, la fila no se sale de su tarjeta: datos arriba y botones abajo. [M3 · #96]
- [ ] **Arrastrar desde el asa ⠿** mueve la categoría; al soltar dice «Orden actualizado» **una sola vez**. Comprobar en la carta que quedó en ese orden. [C1 · #114]
  - [ ] Con el dedo en el móvil, arrastrar desde el asa mueve la fila, y deslizar por el resto de la fila desplaza la página.
  - [ ] Pulsar Escape a mitad de arrastre devuelve todo a su sitio.
  - [ ] Las flechas ↑ ↓ siguen funcionando, y después de pulsar una se puede seguir pulsando (el foco se queda en la fila movida).
- [ ] Al escribir el nombre de una categoría casi igual a otra («Hamburguesa» si ya hay «HAMBURGUESAS»), sale un aviso con la otra y cuántos platos tiene. No impide guardar. [P3 · #113]
- [ ] Casilla **«Se pide sin abrir la ficha»**: se guarda, y al volver a abrir la categoría sigue marcada. [B3 · #115]
- [ ] Campo **Nota**: escribir «Todas van con papas», guardar, y verla bajo el título en la carta. Vaciarla y comprobar que desaparece. [P4 · #116 y vmenus-app#27]

## 6. Apariencia (superadmin)

- [ ] Cambiar un color **sin guardar**, subir una imagen de fondo o de logo: el color cambiado **sigue ahí**. [A1 + A2 · #80]
- [ ] Salir de Apariencia con cambios sin guardar sigue avisando («Seguir editando» / «Salir sin guardar»). [A1 + A2 · #80]
- [ ] Cambiar el modelo de página: la **Portada** solo aparece con Explorar; **Mostrar mensaje de bienvenida**, solo con Sidebar y Carrito; **Filtros y etiquetas**, siempre. [A4 · #118]
- [ ] Los avisos de la dirección de la carta no se contradicen, y la dirección es un enlace que abre la carta para comprobarla. [A5 · #107]

## 7. Toppings

- [ ] Cada grupo dice qué es y cómo se llama en la carta: «Toppings sin costo (en la carta: «Toppings Platino»)». [TP1 · #101]
- [ ] Con la pestaña vacía, explica para qué sirve y cómo empezar. [TP2 · #101]

## 8. Pedidos

- [ ] Hay **un solo botón de guardar** para el número de WhatsApp y los métodos de pago. [PE2 · #108]
- [ ] Activar Nequi sin sus datos y guardar: dice «Faltan los datos de Nequi» y no guarda nada. [PE2 · #108]
- [ ] Con carrito y sin número de WhatsApp, avisa de que no recibe pedidos: en la pestaña Pedidos y en su tarjeta de la lista del superadmin («⚠ carrito sin WhatsApp · no recibe pedidos»). [PE1 · #79]

## 9. Promoción

- [ ] Con el interruptor **Activa** apagado, los destinos (carta, televisor) se ven atenuados pero se pueden preparar. [B2 · #91]
- [ ] En el móvil, con la pestaña vacía, se lee la instrucción para añadir la primera promoción. [M4 + M5 · #97]

## 10. QR

- [ ] En el móvil, la dirección de la carta se lee **entera** (en dos líneas si hace falta), y al tocarla abre la carta. «Copiar» sigue funcionando. [M2 · #110]

## 11. Estadísticas

- [ ] Dice «clics por visita», no un porcentaje que pase de 100. [E1 · #92]
- [ ] Con pocas visitas en el rango, avisa de que los números son una pista, no una conclusión. [E2 + E3 · #92]
- [ ] En un restaurante sin visitas, «Platos que nadie abrió» no acusa a toda la carta. [M6 · #92]
- [ ] Con menos visitas que platos, en vez de la lista dice cuántas visitas hacen falta. Probar `bonzas` con 7 días (no sale) y con «Todo» (sí sale). [B3 · #92]
- [ ] Marcar «Se pide sin abrir la ficha» en Cervezas, Bebidas y Adicionales de `bonzas`: salen de la lista y el resumen dice qué se dejó fuera. [B3 · #115]
- [ ] En el móvil, el selector de fechas no se parte. [M7 · #98]
- [ ] En vista clara, los chips y botones de color de acento se leen bien. [CL4 · #98]

## 12. Pantalla TV

- [ ] **En el televisor de verdad:** dejar la cartelera puesta más tiempo del que tarda en apagarse la pantalla normalmente. No debe apagarse. [TV1 · vmenus-app#23]
- [ ] El panel explica lo de la pantalla que se apaga, en la pestaña Pantalla TV. [TV1 · #89]

## 13. La carta pública (vmenus-app), en el móvil

- [ ] Se puede **ampliar con dos dedos** (antes estaba bloqueado). [V1 · vmenus-app#20]
- [ ] Los botones pequeños (cerrar, flechas, menú, carrito) se aciertan con el dedo sin esfuerzo. [V3 + MD2 · vmenus-app#24]
- [ ] **Modelo Carrito** (`perroscriollos`, o `zz-pruebas-ux` con tu número):
  - [ ] Al rellenar el pedido, el teléfono ofrece autocompletar nombre, teléfono y dirección, y el iPhone **no** hace zoom al tocar un campo. [V4 · vmenus-app#21]
  - [ ] Después de pulsar enviar, pregunta **«¿Enviaste el pedido?»**. El carrito solo se vacía si se confirma. [V5 · vmenus-app#21]
  - [ ] En un restaurante con carrito pero sin WhatsApp configurado, avisa **antes** de pedir los datos. [PE1 · vmenus-app#19]
- [ ] La nota de una categoría sale bajo su título en los seis modelos (en Vertical, solo en el primer plato de la categoría). [P4 · vmenus-app#27]

## 14. La carta pública con teclado (en el computador)

Solo con Tab, Enter y Escape, sin ratón:

- [ ] Tab recorre los platos, y **Enter** abre la ficha. [V2 · vmenus-app#20]
- [ ] Con la ficha abierta, Tab no se sale de ella; **Escape** la cierra y el foco vuelve al plato. [V2 · vmenus-app#22]
- [ ] Modelo Sidebar (`malparados`): el botón del menú lateral tiene nombre; al abrirlo el foco entra en las categorías; **Escape** lo cierra y el foco vuelve al botón. [MD1 + MD4 · vmenus-app#25, MD3 · vmenus-app#18]
- [ ] Con todo cerrado, Tab **nunca** cae en un botón invisible (el de la promoción cerrada, el de la foto ampliada, el menú lateral cerrado). [V6 · vmenus-app#26]

## 15. Lo que no se ve pero conviene confirmar

- [ ] El panel arranca y carga un restaurante después del despliegue con `@supabase/supabase-js` 2.116.0. [#58]
- [ ] La carta y el panel responden igual de rápido o más: las respuestas van comprimidas. [T1 · #73]
- [ ] La landing `vmenus.co` está publicada, con el WhatsApp real en los dos botones y sin franja de borrador. [LP1 · vmenus-landing#3]
