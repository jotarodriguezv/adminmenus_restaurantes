// La pestaña Inicio no guarda nada: junta señales que ya existen para que el
// restaurante no tenga que recorrer cada pestaña para descubrirlas.
//
// Rehecha el 17/09/2026 con el usuario, tras mirarla con los datos de Bonzas:
//
//   · Mentía. A Bonzas le decía «38 productos sin foto» y los 38 estaban en
//     categorías de vista lista, donde la carta no enseña fotos. El primer
//     cliente real veía, en la primera pantalla, una tarea que no existe.
//   · Callaba lo grave. Un carrito encendido sin número de WhatsApp —la carta
//     arma el pedido y no lo puede enviar— no salía por ningún lado; la lista del
//     superadmin sí lo marcaba.
//   · Lo que estaba bien pesaba igual que lo pendiente. Tres filas del mismo
//     tamaño, dos diciendo «Listo», y un «Ver» en cada una: había que leerlo todo
//     para encontrar lo único que pedía algo.
//
// Así que ahora: arriba solo lo que pide una acción, con un botón que dice qué
// hace; lo que está en orden, resumido en una línea; y las funciones de la
// carta como interruptores encendidos o apagados, que es lo que son.
//
// Las reglas —qué cuenta como pendiente, qué está encendido— van aparte del
// pintado, para poder probarlas sin navegador.

function productoGratis(producto) {
  return producto?.atributos?.precio_gratis === true;
}

function abrirDesdeInicio(tab) {
  const botones = {
    productos: 'tabBtnProductos', categorias: 'tabBtnCategorias',
    promo: 'tabBtnPromo', tv: 'tabBtnTv', ajustes: 'tabBtnAjustes',
  };
  const boton = document.getElementById(botones[tab]);
  if (boton) switchTab(tab, boton);
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// ── QUÉ PIDE UNA ACCIÓN ───────────────────────────────────────
// Devuelve dos listas: lo pendiente, ya ordenado por gravedad, y lo que está en
// orden, solo con su nombre corto para resumirlo en una línea.
//
// 'grave' es lo que hace perder un pedido o enseña algo roto al comensal; lo
// demás mejora la carta pero no la rompe.
function revisionDeInicio({ productos = [], categorias = [], atributos = {}, plan = {} } = {}) {
  const pendientes = [];
  const enOrden = [];

  // 1. El carrito que no puede enviar. Es lo único de esta pantalla que hace
  //    perder dinero: el comensal arma el pedido y el botón no lo manda.
  if (cartaTieneCarrito(atributos, plan) && !recibePedidos(atributos)) {
    pendientes.push({
      clave: 'whatsapp', grave: true,
      titulo: 'Tu carrito no puede recibir pedidos',
      nota: 'Está encendido, pero falta el número de WhatsApp al que llegan. Tus clientes arman el pedido y no lo pueden enviar.',
      boton: 'Poner el número', tab: 'ajustes',
    });
  }

  // 2. Las fotos, solo donde la carta las enseña. En una categoría de vista
  //    lista no hay hueco para la foto, y en un modelo de video lo que se ve es
  //    el video: pedir foto ahí es pedir algo que nadie va a ver.
  const deVideo = esModeloDeVideo(atributos.nav || MODELO_POR_DEFECTO);
  const conFotos = new Set(categorias.filter(c => !c.sin_fotos).map(c => c.id));
  const dondeSeVe = productos.filter(p => conFotos.has(p.categoria_id));
  const sinImagen = deVideo
    ? dondeSeVe.filter(p => !p.atributos?.video?.url).length
    : dondeSeVe.filter(p => !p.imagen_url).length;
  if (sinImagen) {
    pendientes.push({
      clave: 'imagen',
      titulo: deVideo ? plural(sinImagen, 'plato sin video', 'platos sin video') : plural(sinImagen, 'plato sin foto', 'platos sin foto'),
      nota: deVideo
        ? 'Tu carta es de video: sin él, esos platos salen solo con la foto de respaldo.'
        : 'Salen con un recuadro vacío en la carta. Una foto ayuda a que se antojen.',
      boton: 'Verlos', tab: 'productos',
    });
  } else enOrden.push(deVideo ? 'videos' : 'fotos');

  // 3. Precio en cero sin marcar «Gratis». Un cero anterior no se interpreta:
  //    solo el interruptor explícito dice gratis, así nadie publica una cortesía
  //    por accidente al actualizar.
  const precioPendiente = productos.filter(p => Number(p.precio_numerico) === 0 && !productoGratis(p)).length;
  if (precioPendiente) {
    pendientes.push({
      clave: 'precio',
      titulo: plural(precioPendiente, 'plato con precio en cero', 'platos con precio en cero'),
      nota: 'En la carta salen a $0. Pon el precio, o marca «Gratis» si de verdad no cuesta nada.',
      boton: 'Revisarlos', tab: 'productos',
    });
  } else enOrden.push('precios');

  // 4. Categorías vacías: en la carta no salen, pero en el panel estorban y
  //    suelen ser una categoría a medio montar.
  const vacias = categorias.filter(c => !productos.some(p => p.categoria_id === c.id)).length;
  if (vacias) {
    pendientes.push({
      clave: 'categorias',
      titulo: plural(vacias, 'categoría vacía', 'categorías vacías'),
      nota: 'No salen en tu carta hasta que tengan algún plato. Añádeles uno o bórralas si ya no las usas.',
      boton: 'Verlas', tab: 'categorias',
    });
  } else enOrden.push('categorías');

  pendientes.sort((a, b) => Number(!!b.grave) - Number(!!a.grave));
  return { pendientes, enOrden };
}

// ── QUÉ TIENE ENCENDIDO LA CARTA ──────────────────────────────
// Con la MISMA regla que la carta o que la lista del superadmin, no con el
// interruptor a secas: un buscador encendido en una carta de cinco platos no
// sale, y decirle «encendido» al restaurante es prometerle algo que no ve.
function funcionesDeInicio({ productos = [], promociones = [], atributos = {}, plan = {} } = {}) {
  const destacados = promociones.filter(p => p.activa && (p.en_popup || p.en_tv)).length;
  const carrito = cartaTieneCarrito(atributos, plan);
  const nFiltros = Array.isArray(atributos.filtros_disponibles) ? atributos.filtros_disponibles.length : 0;
  const filtros = nFiltros > 0 && atributos.filtros_activos !== false;
  const buscador = atributos.buscador !== false && productos.length >= MINIMO_PLATOS_BUSCADOR;

  return [
    { clave: 'carrito', titulo: 'Carrito de pedidos', tab: 'ajustes', encendido: carrito,
      detalle: carrito ? (recibePedidos(atributos) ? 'Los pedidos te llegan por WhatsApp.' : 'Falta el número de WhatsApp.')
                       : 'Tu carta funciona como catálogo.' },
    { clave: 'destacados', titulo: 'Destacados', tab: 'promo', encendido: destacados > 0,
      detalle: destacados ? `${plural(destacados, 'publicado', 'publicados')}.` : 'Ninguno publicado.' },
    { clave: 'tv', titulo: 'Pantalla de TV', tab: 'tv', encendido: !!atributos.tv?.activa,
      detalle: atributos.tv?.activa ? 'Tu cartelera está encendida.' : 'La cartelera está apagada.' },
    { clave: 'buscador', titulo: 'Buscador de platos', tab: 'ajustes', encendido: buscador,
      detalle: atributos.buscador === false ? 'Lo apagaste en Ajustes.'
             : buscador ? 'Tus clientes pueden buscar un plato por su nombre.'
             : `Sale a partir de ${MINIMO_PLATOS_BUSCADOR} platos.` },
    { clave: 'filtros', titulo: 'Filtros', tab: 'ajustes', encendido: filtros,
      detalle: filtros ? `${plural(nFiltros, 'filtro', 'filtros')} para tus clientes.` : 'Sin filtros en tu carta.' },
  ];
}

// ── PINTAR ────────────────────────────────────────────────────
function el(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto != null) n.textContent = texto;
  return n;
}

function pintarMetricas(productos, categorias) {
  const resumen = document.getElementById('inicioResumen');
  resumen.replaceChildren();
  const visibles = productos.filter(p => p.disponible).length;
  // «Disponibles» y no «con foto»: las fotos ya tienen su aviso abajo cuando
  // faltan donde se ven, y aquí contaban también las de vista lista.
  for (const [numero, etiqueta] of [
    [productos.length, productos.length === 1 ? 'plato' : 'platos'],
    [categorias.length, categorias.length === 1 ? 'categoría' : 'categorías'],
    [visibles, visibles === 1 ? 'disponible hoy' : 'disponibles hoy'],
  ]) {
    const m = el('div', 'inicio-metrica');
    m.append(el('div', 'inicio-metrica-numero', String(numero)), el('div', 'inicio-metrica-etiqueta', etiqueta));
    resumen.appendChild(m);
  }
}

function pintarPendientes({ pendientes, enOrden }) {
  const caja = document.getElementById('inicioPendientes');
  caja.replaceChildren();
  document.getElementById('inicioPendientesCuenta').textContent = pendientes.length ? String(pendientes.length) : '';

  if (!pendientes.length) {
    const ok = el('div', 'inicio-todo-bien');
    ok.append(el('div', 'inicio-todo-bien-marca', '✓'),
              el('div', '', 'Todo en orden. Tu carta no tiene nada pendiente.'));
    caja.appendChild(ok);
  }
  for (const p of pendientes) {
    const fila = el('div', 'inicio-pendiente' + (p.grave ? ' grave' : ''));
    const texto = el('div', 'inicio-pendiente-texto');
    texto.append(el('div', 'inicio-pendiente-titulo', p.titulo), el('div', 'inicio-pendiente-nota', p.nota));
    const b = el('button', 'btn-sm' + (p.grave ? ' eliminar' : ' accent'), p.boton);
    b.type = 'button';
    b.onclick = () => abrirDesdeInicio(p.tab);
    fila.append(texto, b);
    caja.appendChild(fila);
  }
  // Lo que está bien, en una línea. Sigue diciéndose —saber que las fotos
  // están completas también es información— pero ya no ocupa lo mismo que
  // lo que pide trabajo.
  if (pendientes.length && enOrden.length) {
    caja.appendChild(el('div', 'inicio-en-orden', `✓ En orden: ${enOrden.join(', ')}.`));
  }
}

function pintarFunciones(funciones) {
  const caja = document.getElementById('inicioFunciones');
  caja.replaceChildren();
  for (const f of funciones) {
    // La fila entera lleva a donde se configura: un «Ver» en cada una era el
    // mismo botón repetido cinco veces.
    const fila = el('button', 'inicio-funcion');
    fila.type = 'button';
    fila.onclick = () => abrirDesdeInicio(f.tab);
    fila.setAttribute('aria-label', `${f.titulo}: ${f.encendido ? 'encendido' : 'apagado'}. ${f.detalle} Abrir.`);
    const texto = el('div', 'inicio-funcion-texto');
    texto.append(el('div', 'inicio-funcion-titulo', f.titulo), el('div', 'inicio-funcion-detalle', f.detalle));
    fila.append(texto, el('span', 'inicio-pastilla' + (f.encendido ? ' encendida' : ''), f.encendido ? 'Encendido' : 'Apagado'));
    caja.appendChild(fila);
  }
}

function renderInicio() {
  if (!document.getElementById('inicioResumen') || !state.restaurante) return;
  const datos = {
    productos: state.productos || [],
    categorias: state.categorias || [],
    promociones: state.promociones || [],
    atributos: state.restaurante.atributos || {},
    plan: planActual(),
  };
  const nombre = document.getElementById('inicioNombre');
  if (nombre) nombre.textContent = state.restaurante.nombre || 'tu carta';
  // El enlace a la carta publicada: es la comprobación que más se hace —cambias
  // algo y quieres verlo como lo ve el cliente—, y hasta ahora no estaba aquí.
  const enlace = document.getElementById('inicioVerCarta');
  if (enlace) enlace.href = urlPublica(state.restaurante);

  pintarMetricas(datos.productos, datos.categorias);
  pintarPendientes(revisionDeInicio(datos));
  pintarFunciones(funcionesDeInicio(datos));
}
