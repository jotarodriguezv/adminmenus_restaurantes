// Lo que cada plato tiene marcado, visible desde la lista de Productos.
//
// Pedido el 17/09/2026: para saber si un plato ofrece toppings o cumple algún
// filtro había que abrir su ficha, uno por uno. En una carta de 97 platos eso
// es noventa y siete ventanas para responder «¿a cuáles les puse picante?».
//
// Son marcas de SOLO LECTURA: se cambian en la ficha, que es donde se puede
// elegir. Aquí solo se dice lo que hay, porque la lista es para mirar.
//
// Se lee con las mismas funciones que la ficha —personalizacionDe sobre
// catalogoDe— y no contando las claves del plato a mano: un plato de antes del
// catálogo del negocio guarda NOMBRES y no identificadores, así que contar sin
// pasar por ahí daría números distintos en la lista y en la ficha.
//
// Se carga con un <script> clásico, como comun.js: no se puede repetir aquí un
// nombre que ya exista en otro archivo del panel.

// Cuántas marcas de cada clase se enseñan antes de resumir. Tres caben en una
// línea de móvil; a partir de ahí la fila empieza a competir con el nombre del
// plato, que es lo que se viene a leer.
const MAXIMO_MARCAS_VISIBLES = 3;

// Los filtros que cumple el plato, ya con su etiqueta y su emoji. Solo los que
// el restaurante tiene configurados: un plato puede seguir nombrando uno que se
// quitó del catálogo, y ese no se puede pintar —no tiene ni nombre ni emoji—.
function filtrosDePlato(p, disponibles = state.restaurante?.atributos?.filtros_disponibles) {
  const catalogo = Array.isArray(disponibles) ? disponibles : [];
  const suyos = new Set((p?.atributos?.filtros || []).map(String));
  return catalogo.filter(f => suyos.has(String(f.id)));
}

// Cómo se llama cada grupo en pantalla, y con qué se reconoce de un vistazo.
// Un solo sitio: la ficha del plato y Ajustes dicen lo mismo con las mismas
// palabras, y el día que cambien, cambian aquí.
const GRUPOS_ADICIONALES = [
  ['platino', '🧀', 'sin costo', 'Adicionales sin costo'],
  ['premium', '💲', 'con costo', 'Adicionales con costo'],
  ['salsas', '🥫', 'salsa', 'Salsas'],
];

// Qué adicionales ofrece el plato, por grupo. Sin carrito no se cuentan: la
// carta no los enseña, y decir «5» de un plato cuyos comensales no ven ninguno
// es la misma mentira que ya se quitó de la ficha.
function toppingsDePlato(p, atributos = state.restaurante?.atributos, plan = planActual()) {
  const vacio = { platino: [], premium: [], salsas: [], total: 0 };
  if (!cartaTieneCarrito(atributos, plan)) return vacio;
  const catalogo = catalogoDe(atributos);
  const marcados = personalizacionDe(p, catalogo);
  const nombreDe = grupo => catalogo[grupo].filter(t => marcados[grupo].includes(t.id)).map(t => t.nombre);
  const porGrupo = { platino: nombreDe('platino'), premium: nombreDe('premium'), salsas: nombreDe('salsas') };
  return { ...porGrupo, total: porGrupo.platino.length + porGrupo.premium.length + porGrupo.salsas.length };
}

// Las marcas de un plato, ya resueltas: qué se escribe y qué dice al pasar el
// ratón. Aparte de pintarlas para poder probarlo sin navegador.
function marcasDePlato(p) {
  const marcas = [];
  // Primero, porque explica por qué ese plato no tiene foto: sin la marca, en la
  // lista no se distingue un olvido de una decisión (18/09/2026).
  if (p?.atributos?.sin_foto === true && !p.imagen_url) {
    marcas.push({ texto: '📷 sin foto a propósito', titulo: 'Marcado en su ficha: este plato no lleva foto. No cuenta como pendiente.' });
  }
  const filtros = filtrosDePlato(p);
  for (const f of filtros.slice(0, MAXIMO_MARCAS_VISIBLES)) {
    marcas.push({ texto: `${f.emoji || ''} ${f.label}`.trim(), titulo: `Filtro: ${f.label}` });
  }
  if (filtros.length > MAXIMO_MARCAS_VISIBLES) {
    const resto = filtros.slice(MAXIMO_MARCAS_VISIBLES);
    marcas.push({
      texto: `+${resto.length}`,
      titulo: 'También cumple: ' + resto.map(f => f.label).join(', '),
    });
  }
  // Una marca por grupo y no un número solo. «🧀 23» obligaba a pasar el ratón
  // para saber siquiera de qué hablaba; separado se lee sin tocar nada, que es
  // de lo que iba enseñarlo en la lista (probado con perroscriollos el
  // 17/09/2026). Los NOMBRES siguen en el título: son hasta catorce por plato y
  // escritos taparían el nombre del plato, que es lo que se viene a leer.
  const adicionales = toppingsDePlato(p);
  for (const [grupo, emoji, corto, largo] of GRUPOS_ADICIONALES) {
    const nombres = adicionales[grupo];
    if (!nombres.length) continue;
    marcas.push({
      texto: `${emoji} ${nombres.length} ${grupo === 'salsas' && nombres.length !== 1 ? 'salsas' : corto}`,
      titulo: `${largo}: ${nombres.join(', ')}`,
    });
  }
  return marcas;
}

// La fila que va bajo el nombre del plato. Devuelve null cuando no hay nada que
// decir: una fila vacía sube la altura de todas las tarjetas para nada.
function filaDeMarcas(p) {
  const marcas = marcasDePlato(p);
  if (!marcas.length) return null;
  const fila = document.createElement('div');
  fila.className = 'prod-marcas';
  for (const { texto, titulo } of marcas) {
    const marca = document.createElement('span');
    marca.className = 'prod-marca';
    // textContent: el nombre de un filtro lo escribe el restaurante.
    marca.textContent = texto;
    marca.title = titulo;
    fila.appendChild(marca);
  }
  return fila;
}
