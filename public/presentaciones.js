// Las presentaciones de un plato en la ficha: «1X $12.000 · 2X $20.000», un jugo de 500 ml y de 750 ml,
// un hojaldre sencillo o doble. Siguen siendo UN plato —su foto, su descripción, su categoría— con una
// lista de presentaciones, cada una con su nombre y su precio (docs/presentaciones.md).
//
// Dónde viven: `producto.atributos.presentaciones` (`{ id, nombre, precio_numerico }`). El servidor las
// valida, les pone ids estables y sincroniza el precio del plato con el de la más barata; aquí solo se
// editan y se le dice al restaurante lo que va a pasar.
//
// ── LO QUE CAMBIA EN LA FICHA CUANDO HAY PRESENTACIONES ───────
//  · El precio de arriba deja de escribirse: es el de la más barata («Desde»), y se ve pero no se toca.
//  · «Es gratis» y «Poner en oferta» se esconden: ninguno distingue presentaciones (docs/presentaciones.md §3).
//
// Se carga con un <script> clásico antes del script principal, como comun.js y oferta.js: comparte con ellos
// las declaraciones de nivel superior, así que no se puede repetir aquí un nombre que ya exista en otro
// archivo del panel.

const PRES_MAX = 8;
const PRES_MIN = 2;

// Las filas que se están editando: { id, nombre, precio } con el precio tal como se ve en el campo.
let presFilas = [];
let presActiva = false;

// Las presentaciones de un plato ya guardado, o [] si no llegan a dos. Es la regla de la carta
// (core/presentaciones.js) y se usa en las listas del panel.
function presentacionesDelPlato(p) {
  const lista = p?.atributos?.presentaciones;
  if (!Array.isArray(lista)) return [];
  const validas = lista.filter(x => x && String(x.nombre ?? '').trim() && Number.isFinite(Number(x.precio_numerico)));
  return validas.length >= PRES_MIN ? validas : [];
}

// Lo que dice la lista de platos del panel en la columna de precio.
function textoPrecioConPresentaciones(p) {
  const l = presentacionesDelPlato(p);
  if (!l.length) return '';
  const menor = Math.min(...l.map(x => Number(x.precio_numerico)));
  return `Desde ${formatPrecio(menor)} · ${l.length} presentaciones`;
}

// ── LA FICHA ──────────────────────────────────────────────────
const idDePres = id => document.getElementById(id);

// Se llama al abrir la ficha de un plato: con sus presentaciones, o limpia.
function presCargarEnFicha(p) {
  const lista = presentacionesDelPlato(p);
  presActiva = lista.length > 0;
  presFilas = lista.map(x => ({ id: String(x.id ?? ''), nombre: String(x.nombre), precio: formatPrecio(Number(x.precio_numerico)) }));
  presPintar();
}

function presLimpiar() {
  presActiva = false;
  presFilas = [];
  presPintar();
}

// El interruptor. Al encenderlo se parte del precio que el plato ya tenía como primera presentación, para
// no obligar a escribirlo otra vez; y se ofrece una segunda fila, que es lo mínimo para que sean presentaciones.
function presAlternar() {
  presActiva = idDePres('editPresActiva').checked;
  if (presActiva && !presFilas.length) {
    const actual = precioNumericoDe(idDePres('editPrecioNum').value);
    presFilas = [
      { id: '', nombre: '', precio: Number.isFinite(actual) && actual > 0 ? formatPrecio(actual) : '' },
      { id: '', nombre: '', precio: '' },
    ];
  }
  presPintar();
  if (presActiva) idDePres('presLista')?.querySelector('input')?.focus();
}

function presAgregar() {
  if (presFilas.length >= PRES_MAX) return;
  presFilas.push({ id: '', nombre: '', precio: '' });
  presPintar();
  const filas = idDePres('presLista')?.querySelectorAll('.pres-fila');
  filas?.[filas.length - 1]?.querySelector('input')?.focus();
}

function presQuitar(i) {
  presFilas.splice(i, 1);
  presPintar();
}

// El precio más bajo de las filas que ya tienen uno.
function presPrecioBase() {
  const precios = presFilas.map(f => precioNumericoDe(f.precio)).filter(n => Number.isFinite(n));
  return precios.length ? Math.min(...precios) : null;
}

function presPintar() {
  const caja = idDePres('editPresActiva');
  if (!caja) return;
  caja.checked = presActiva;
  idDePres('presCampos').hidden = !presActiva;

  const lista = idDePres('presLista');
  lista.replaceChildren();
  presFilas.forEach((f, i) => {
    const fila = document.createElement('div');
    fila.className = 'pres-fila';
    const nombre = document.createElement('input');
    nombre.type = 'text'; nombre.className = 'form-input pres-nombre'; nombre.maxLength = 40;
    nombre.placeholder = i === 0 ? 'Por ejemplo: 1X' : i === 1 ? 'Por ejemplo: 2X' : 'Nombre';
    nombre.value = f.nombre;
    nombre.setAttribute('aria-label', `Nombre de la presentación ${i + 1}`);
    nombre.oninput = () => { f.nombre = nombre.value; presActualizarResumen(); };
    const precio = document.createElement('input');
    precio.type = 'text'; precio.inputMode = 'numeric'; precio.className = 'form-input pres-precio'; precio.placeholder = '$ 0';
    precio.value = f.precio;
    precio.setAttribute('aria-label', `Precio de la presentación ${i + 1}`);
    precio.oninput = () => { formatearPrecioAlEscribir(precio); f.precio = precio.value; presSincronizarPrecio(); presActualizarResumen(); };
    const quitar = document.createElement('button');
    quitar.type = 'button'; quitar.className = 'btn-sm pres-quitar'; quitar.textContent = 'Quitar';
    quitar.setAttribute('aria-label', `Quitar la presentación ${i + 1}`);
    quitar.onclick = () => presQuitar(i);
    fila.append(nombre, precio, quitar);
    lista.appendChild(fila);
  });
  idDePres('presAgregar').disabled = presFilas.length >= PRES_MAX;

  // Con presentaciones, el precio, «Es gratis» y la oferta dejan de ser de este formulario.
  const gratis = idDePres('editPrecioGratis');
  if (presActiva) gratis.checked = false;
  gratis.disabled = presActiva;
  const bloqueOferta = idDePres('ofertaBloque');
  if (bloqueOferta) bloqueOferta.hidden = presActiva;
  const precioCampo = idDePres('editPrecioNum');
  precioCampo.readOnly = presActiva;
  precioCampo.classList.toggle('pres-precio-derivado', presActiva);
  presSincronizarPrecio();
  presActualizarResumen();
}

// El precio de arriba muestra «Desde» (el más bajo) mientras hay presentaciones.
function presSincronizarPrecio() {
  if (!presActiva) return;
  const base = presPrecioBase();
  idDePres('editPrecioNum').value = base === null ? '' : formatPrecio(base);
  const vista = idDePres('precioPreview');
  if (vista) vista.textContent = base === null ? '—' : `Desde ${formatPrecio(base)}`;
}

// Cómo lo leerá el cliente, con las mismas palabras que la carta.
function presActualizarResumen() {
  const resumen = idDePres('presResumen');
  if (!resumen) return;
  const hechas = presFilas.filter(f => f.nombre.trim() && Number.isFinite(precioNumericoDe(f.precio)));
  if (hechas.length < PRES_MIN) { resumen.textContent = 'Escribe al menos dos presentaciones, cada una con su nombre y su precio.'; resumen.style.color = 'var(--text-muted)'; return; }
  const textos = hechas.map(f => `${f.nombre.trim()} ${formatPrecio(precioNumericoDe(f.precio))}`);
  resumen.textContent = hechas.length > 3
    ? `Tus clientes leen: Desde ${formatPrecio(presPrecioBase())}, y eligen al pedir.`
    : `Tus clientes leen: ${textos.join(' · ')}`;
  resumen.style.color = 'var(--accent)';
}

// Lo que se guarda y el error, si lo hay. Apagado, una lista vacía: es como se le dice al servidor que las
// quite. Es una función aparte para poder probarla sin la ficha.
function presLeerFilas(activa, filas) {
  if (!activa) return { lista: [] };
  const lista = [];
  const vistos = new Set();
  for (const f of filas) {
    const nombre = String(f.nombre ?? '').replace(/\s+/g, ' ').trim();
    const precio = precioNumericoDe(f.precio);
    if (!nombre && !String(f.precio ?? '').trim()) continue;   // una fila en blanco se ignora, no es un error
    if (!nombre) return { error: 'Cada presentación necesita un nombre, por ejemplo «1X» o «500 ml»' };
    if (!Number.isFinite(precio)) return { error: `Escribe el precio de «${nombre}», solo el número` };
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) return { error: `Dos presentaciones se llaman «${nombre}»` };
    vistos.add(clave);
    lista.push({ ...(f.id ? { id: f.id } : {}), nombre, precio_numerico: precio });
  }
  if (lista.length < PRES_MIN) return { error: 'Una sola presentación no es una presentación: añade otra, o apaga «Viene en varias presentaciones»' };
  return { lista };
}

function presLeerDeFicha() { return presLeerFilas(presActiva, presFilas); }
