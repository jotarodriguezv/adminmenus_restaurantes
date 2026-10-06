// La oferta de precio de un plato: el bloque «Poner en oferta» de la ficha y la
// marca que sale en la lista de Productos.
//
// No es la «promoción» (promocion.js): aquella es una imagen que sale al abrir
// la carta o en la cartelera y no toca ningún precio. Esta baja el precio de un
// plato, con fechas opcionales, y la carta enseña el de siempre tachado. Por eso
// todo aquí empieza por `oferta` y no por `promo`.
//
// ── LA REGLA VIVE EN TRES SITIOS ──────────────────────────────
// Este archivo es el ESPEJO del panel de la regla que aplican la carta
// (vmenus-app) y la cartelera. Sirve para decirle al restaurante si su oferta
// rige HOY, y para avisarle de las que ya terminaron. Quien decide de verdad es
// la carta. `test/casos-oferta.json` —duplicado en los dos repositorios— es lo
// único que impide que se separen, igual que con la programación de categorías.
//
// ── LO QUE SE GUARDA ──────────────────────────────────────────
// Solo el precio de oferta, como número. El porcentaje es una comodidad de la
// pantalla: se escribe uno u otro y el otro se calcula, pero lo que viaja al
// servidor es el precio, para que el carrito nunca tenga que recalcular nada.
//
// Se carga con un <script> clásico: no se puede repetir aquí ningún nombre que
// ya exista en otro archivo del panel.

// Un 15 % de $ 24.900 son $ 21.165: nadie pone ese precio en una carta. El
// precio que sale de un porcentaje se redondea a la centena, y como el campo
// del precio queda a la vista, se puede ajustar a mano.
const REDONDEO_OFERTA = 100;

const MESES_CORTOS_OFERTA = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

// 'AAAA-MM-DD' → «24 dic». Se lee a mano y no con Date: new Date('2026-12-24')
// es medianoche UTC, y en Colombia eso es el 23.
function ofertaFechaCorta(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? `${parseInt(m[3], 10)} ${MESES_CORTOS_OFERTA[parseInt(m[2], 10) - 1]}` : '';
}

// En qué punto está la oferta de un plato, mirada contra 'hoy' (AAAA-MM-DD en
// la zona del restaurante; en ese formato comparar fechas es comparar cadenas).
//
//   'sin'         no tiene, está apagada o no es un precio menor
//   'programada'  encendida, pero todavía no empieza
//   'vigente'     rige ahora
//   'terminada'   encendida, pero su último día ya pasó
//
// Una oferta que no es menor que el precio normal se ignora: ante la duda, la
// carta enseña el precio de siempre.
function ofertaEstado(p, hoy) {
  if (!p || p.oferta_activa !== true) return 'sin';
  const o = Number(p.oferta_precio_numerico);
  if (p.oferta_precio_numerico === null || p.oferta_precio_numerico === undefined || !Number.isFinite(o)) return 'sin';
  if (!(o < Number(p.precio_numerico))) return 'sin';
  if (p.oferta_desde && hoy < p.oferta_desde) return 'programada';
  if (p.oferta_hasta && hoy > p.oferta_hasta) return 'terminada';
  return 'vigente';
}

function ofertaHoy() {
  return ahoraEnZona(zonaRestaurante()).fecha;
}

// El precio que paga el cliente hoy.
function ofertaPrecioVigente(p, hoy = ofertaHoy()) {
  return ofertaEstado(p, hoy) === 'vigente' ? Number(p.oferta_precio_numerico) : Number(p.precio_numerico);
}

// «-20 %» o null si no hay forma de calcularlo.
function ofertaPorcentajeDe(normal, oferta) {
  if (!(normal > 0) || !Number.isFinite(oferta) || oferta < 0 || oferta >= normal) return null;
  return Math.round((1 - oferta / normal) * 100);
}

// El precio que sale de rebajar 'porc' % del normal, o null. Un 0 % no es una
// oferta, y un 100 % es regalarlo —eso ya tiene su casilla, «Es gratis»—.
function ofertaPrecioPorPorcentaje(normal, porc) {
  if (!(normal > 0) || !Number.isInteger(porc) || porc < 1 || porc > 99) return null;
  const r = Math.round(normal * (1 - porc / 100) / REDONDEO_OFERTA) * REDONDEO_OFERTA;
  // En un plato barato el redondeo puede dejarlo igual al normal: no es rebaja.
  return r < normal ? r : null;
}

// Lo que se avisa antes de guardar. El servidor comprueba lo mismo; esto solo
// evita el viaje y pone el mensaje donde se mira.
function ofertaErrores(normal, d) {
  if (d.oferta_desde && d.oferta_hasta && d.oferta_desde > d.oferta_hasta)
    return 'La oferta no puede terminar antes de empezar.';
  if (d.oferta_activa !== true) return null;
  if (d.oferta_precio_numerico === null) return 'Escribe el precio de la oferta o el porcentaje de rebaja.';
  if (normal > 0 && d.oferta_precio_numerico >= normal) return 'El precio de la oferta tiene que ser menor que el precio normal.';
  return null;
}

// La marca de la lista de Productos: dice en qué punto está, con el dato que
// hace falta para entenderla. null si el plato no tiene nada que decir.
function ofertaEtiqueta(p, hoy = ofertaHoy()) {
  const e = ofertaEstado(p, hoy);
  if (e === 'vigente') return { texto: p.oferta_hasta ? `En oferta · hasta el ${ofertaFechaCorta(p.oferta_hasta)}` : 'En oferta', tono: 'ok' };
  if (e === 'programada') return { texto: `Oferta desde el ${ofertaFechaCorta(p.oferta_desde)}`, tono: 'espera' };
  // La que avisa: terminó sola y, si nadie mira, el precio vuelve a subir sin
  // que el restaurante se entere.
  if (e === 'terminada') return { texto: `Oferta terminada el ${ofertaFechaCorta(p.oferta_hasta)}`, tono: 'aviso' };
  return null;
}

// El precio de la lista: si hay oferta vigente, el de siempre tachado y el
// nuevo al lado. Por DOM, no por innerHTML: aquí hay datos de un restaurante.
function ofertaPintarPrecio(el, p, hoy = ofertaHoy()) {
  el.textContent = '';
  // Con presentaciones, la lista dice «Desde $X · N presentaciones»; la oferta no distingue cuál rebaja.
  const conPres = typeof textoPrecioConPresentaciones === 'function' ? textoPrecioConPresentaciones(p) : '';
  if (conPres) { el.textContent = conPres; return; }
  if (ofertaEstado(p, hoy) !== 'vigente') { el.textContent = p.precio || formatPrecio(p.precio_numerico); return; }
  const antes = document.createElement('s');
  antes.textContent = p.precio || formatPrecio(p.precio_numerico);
  antes.className = 'oferta-precio-antes';
  const ahora = document.createElement('span');
  ahora.textContent = formatPrecio(p.oferta_precio_numerico);
  el.append(antes, ' ', ahora);
}

// ── LA FICHA ──────────────────────────────────────────────────
const idDeOferta = (id) => document.getElementById(id);

function ofertaNormalDeFicha() {
  const n = precioNumericoDe(idDeOferta('editPrecioNum').value);
  return Number.isFinite(n) ? n : 0;
}

// Lo que dice la ficha ahora mismo, en la forma que guarda el servidor.
function ofertaLeerDeFicha() {
  const precio = precioNumericoDe(idDeOferta('editOfertaPrecio').value);
  return {
    oferta_activa: idDeOferta('editOfertaActiva').checked,
    oferta_precio_numerico: Number.isFinite(precio) ? precio : null,
    oferta_desde: idDeOferta('editOfertaDesde').value || null,
    oferta_hasta: idDeOferta('editOfertaHasta').value || null,
  };
}

function ofertaPintarEnFicha(p) {
  const tiene = p && p.oferta_activa === true;
  idDeOferta('editOfertaActiva').checked = !!tiene;
  // Aunque esté apagada se conserva lo escrito: apagarla no es borrarla.
  idDeOferta('editOfertaPrecio').value = p && p.oferta_precio_numerico != null ? formatPrecio(p.oferta_precio_numerico) : '';
  idDeOferta('editOfertaDesde').value = (p && p.oferta_desde) || '';
  idDeOferta('editOfertaHasta').value = (p && p.oferta_hasta) || '';
  idDeOferta('editOfertaPorc').value = '';
  ofertaActualizarResumen(true);
}

function ofertaAlternar() {
  ofertaActualizarResumen(true);
  if (idDeOferta('editOfertaActiva').checked) idDeOferta('editOfertaPrecio').focus();
}

// Se escribió el precio de la oferta: el porcentaje se deduce.
function ofertaAlEscribirPrecio() {
  formatearPrecioAlEscribir(idDeOferta('editOfertaPrecio'));
  idDeOferta('editOfertaPorc').value = '';
  ofertaActualizarResumen(true);
}

// Se escribió el porcentaje: el precio se deduce, ya redondeado.
function ofertaAlEscribirPorcentaje() {
  const campo = idDeOferta('editOfertaPorc');
  campo.value = campo.value.replace(/\D/g, '').slice(0, 2);
  const precio = ofertaPrecioPorPorcentaje(ofertaNormalDeFicha(), campo.value === '' ? NaN : parseInt(campo.value, 10));
  idDeOferta('editOfertaPrecio').value = precio === null ? '' : formatPrecio(precio);
  ofertaActualizarResumen(false);
}

// Qué verá el cliente, dicho con las mismas palabras que la carta. Se llama
// también al cambiar el precio normal, que es de otro campo.
//
// 'derivarPorcentaje': el porcentaje se rellena solo cuando lo que se escribió
// fue el precio. Si lo escribió la persona, no se le reescribe debajo de los dedos.
function ofertaActualizarResumen(derivarPorcentaje = true) {
  const d = ofertaLeerDeFicha();
  const normal = ofertaNormalDeFicha();
  idDeOferta('ofertaCampos').hidden = !d.oferta_activa;
  if (derivarPorcentaje && d.oferta_precio_numerico !== null) {
    const pc = ofertaPorcentajeDe(normal, d.oferta_precio_numerico);
    idDeOferta('editOfertaPorc').value = pc === null ? '' : String(pc);
  }
  const resumen = idDeOferta('ofertaResumen');
  const aviso = idDeOferta('ofertaAviso');
  resumen.textContent = '';
  aviso.textContent = '';
  if (!d.oferta_activa) return;

  const error = ofertaErrores(normal, d);
  const valido = d.oferta_precio_numerico !== null && !error;
  if (valido) {
    const pc = ofertaPorcentajeDe(normal, d.oferta_precio_numerico);
    const antes = document.createElement('s');
    antes.textContent = formatPrecio(normal);
    resumen.append('En la carta: ', antes, ` ${formatPrecio(d.oferta_precio_numerico)}`, pc === null ? '' : ` (-${pc} %)`);
  }
  // Mientras no hay precio todavía no es un error que gritar: es un campo vacío.
  if (error && d.oferta_precio_numerico !== null) aviso.textContent = error;
  else if (!d.oferta_desde && !d.oferta_hasta) aviso.textContent = 'Sin fechas: la oferta rige hasta que la apagues.';
  else if (d.oferta_hasta && d.oferta_hasta < ofertaHoy()) aviso.textContent = 'Ese último día ya pasó: la oferta no se verá.';
}
