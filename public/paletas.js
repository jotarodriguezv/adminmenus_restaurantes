// ── PALETAS DE COLORES PROBADAS ───────────────────────────────
// Pedido por el usuario el 24/09/2026, al ver Lobster Boat: el diseño estaba
// bien y los colores lo estropeaban. Primario y secundario en negro sobre el
// fondo oscuro dejaban el nombre, los títulos y la categoría elegida casi
// invisibles (1,06:1), y las tarjetas color oliva no se leían ni combinaban.
//
// Elegir cinco colores sueltos es trabajo de diseñador. Elegir una paleta, no.
// Aquí se ofrecen combinaciones que ya se leen bien, y cada color se puede
// retocar después a mano en los campos de siempre.
//
// ── POR QUÉ SIRVEN PARA LOS CINCO MODELOS ─────────────────────
// Todas las plantillas de vmenus-app comparten el mismo esqueleto oscuro: el
// texto es siempre claro (#f0edf8, y #b0b0b0 en las descripciones) y la base
// siempre #0a0a0f (vmenus-app/index.html, :root). Nadie los elige. Por eso cada
// color que sí se elige tiene una sola regla, y es la misma en todos:
//
//   · primario   — letra sobre fondo oscuro (títulos, nombre, precios) y
//                  fondo de botón con letra OSCURA encima. Tiene que ser claro.
//   · secundario — letra sobre fondo oscuro (subtítulo, totales del carrito) y
//                  fondo de botón con letra BLANCA (subir, + y −, contador del
//                  carrito). Tiene que ser de tono medio: ni muy claro ni muy
//                  oscuro. Un crema falla aquí, y pasó con Lobster Boat.
//   · superficie y tarjeta — fondos para letra clara. Tienen que ser oscuros.
//   · fondo      — el color de la página; lleva letra clara encima.
//
// REGLAS_COLOR las comprueba una prueba sobre cada paleta: una paleta nueva
// que no las cumpla hace fallar la suite antes de llegar a un restaurante.

const COLORES_FIJOS_CARTA = { oscuro: '#0a0a0f', texto: '#f0edf8', gris: '#b0b0b0', blanco: '#ffffff' };

// Mínimos de WCAG: 4,5 para texto normal y 3 para texto grande o en negrita
// (títulos, precios) y para iconos de botón.
const REGLAS_COLOR = [
  { a: 'primario',   b: 'oscuro',     min: 4.5, que: 'títulos y precios sobre el fondo oscuro' },
  { a: 'primario',   b: 'tarjeta',    min: 3,   que: 'precios sobre las tarjetas' },
  { a: 'primario',   b: 'fondo',      min: 3,   que: 'títulos sobre el fondo de la página' },
  { a: 'secundario', b: 'oscuro',     min: 4.5, que: 'subtítulo sobre el fondo oscuro' },
  { a: 'blanco',     b: 'secundario', min: 3,   que: 'letra blanca en los botones del secundario' },
  { a: 'secundario', b: 'tarjeta',    min: 3,   que: 'totales del carrito sobre las tarjetas' },
  { a: 'texto',      b: 'tarjeta',    min: 4.5, que: 'nombre del plato sobre la tarjeta' },
  { a: 'gris',       b: 'tarjeta',    min: 4.5, que: 'descripción del plato sobre la tarjeta' },
  { a: 'gris',       b: 'superficie', min: 4.5, que: 'textos del menú y del encabezado' },
  { a: 'texto',      b: 'fondo',      min: 4.5, que: 'texto sobre el fondo de la página' },
];

const PALETAS = [
  { id: 'clasica',     nombre: 'Clásica VMenus', para: 'la de siempre',              primario: '#cdfefe', secundario: '#a374af', superficie: '#12111a', tarjeta: '#1a1825', fondo: '#0a0a0f' },
  { id: 'brasa',       nombre: 'Brasa',          para: 'parrilla y hamburguesas',    primario: '#ff8a4c', secundario: '#d9442b', superficie: '#17100d', tarjeta: '#221713', fondo: '#1c0f0a' },
  { id: 'marisqueria', nombre: 'Marisquería',    para: 'mar y mariscos',             primario: '#e8454b', secundario: '#1f9e9a', superficie: '#141b33', tarjeta: '#1c2544', fondo: '#101a33' },
  { id: 'huerta',      nombre: 'Huerta',         para: 'saludable y vegetariano',    primario: '#8bd17c', secundario: '#3f9b5b', superficie: '#101a12', tarjeta: '#17251a', fondo: '#0d1a10' },
  { id: 'cafe',        nombre: 'Café',           para: 'cafetería y panadería',      primario: '#e3b27a', secundario: '#b5651d', superficie: '#17110c', tarjeta: '#221912', fondo: '#140e09' },
  { id: 'noche',       nombre: 'Noche',          para: 'bar y coctelería',           primario: '#c792ea', secundario: '#8e6cff', superficie: '#120f1c', tarjeta: '#1c1830', fondo: '#0f0b1f' },
  { id: 'dorada',      nombre: 'Dorada',         para: 'restaurante elegante',       primario: '#e6c36a', secundario: '#d35400', superficie: '#141210', tarjeta: '#1f1b16', fondo: '#100e0b' },
  { id: 'picante',     nombre: 'Picante',        para: 'mexicano y comida rápida',   primario: '#ffc857', secundario: '#e4572e', superficie: '#1a1410', tarjeta: '#261c15', fondo: '#1a0d08' },
];

// Los campos de Superadmin que llena cada color, con su cuadrito de muestra.
const CAMPOS_PALETA = {
  primario:   ['apColor1', 'apPrevColor1'],
  secundario: ['apColor2', 'apPrevColor2'],
  superficie: ['apColorSurface', 'apPrevColorSurface'],
  tarjeta:    ['apColorCard', 'apPrevColorCard'],
  fondo:      ['apFondoColor', 'apPrevFondoColor'],
};

function luminanciaColor(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((suma, v, i) => suma + v * [0.2126, 0.7152, 0.0722][i], 0);
}

function contrasteColores(a, b) {
  const [claro, oscuro] = [luminanciaColor(a), luminanciaColor(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

// Las reglas que una combinación no cumple. Vacío si se lee bien entera.
function fallosDeContraste(colores) {
  const todos = { ...COLORES_FIJOS_CARTA, ...colores };
  return REGLAS_COLOR
    .map(r => ({ ...r, valor: contrasteColores(todos[r.a], todos[r.b]) }))
    .filter(r => r.valor < r.min);
}

function aplicarPaleta(id) {
  const p = PALETAS.find(x => x.id === id);
  if (!p) return;
  for (const [clave, [texto, muestra]] of Object.entries(CAMPOS_PALETA)) {
    document.getElementById(texto).value = p[clave];
    colorDesdeTexto(texto, muestra);
  }
  marcarPaletaActual();
}

// Cuál de las paletas coincide con lo que hay en los campos, para marcarla.
// Si se retocó un color a mano ya no es esa paleta, y no se marca ninguna.
function paletaActual() {
  const valor = id => (document.getElementById(id)?.value || '').trim().toLowerCase();
  return PALETAS.find(p => Object.entries(CAMPOS_PALETA).every(([c, [texto]]) => valor(texto) === p[c])) || null;
}

function marcarPaletaActual() {
  const actual = paletaActual();
  document.querySelectorAll('#apPaletas .paleta').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.paleta === actual?.id)));
}

function renderPaletas() {
  const cont = document.getElementById('apPaletas');
  if (!cont) return;
  cont.replaceChildren(...PALETAS.map(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paleta';
    b.dataset.paleta = p.id;
    b.setAttribute('aria-pressed', 'false');
    b.title = `${p.nombre} — ${p.para}`;
    b.onclick = () => aplicarPaleta(p.id);

    const tiras = document.createElement('span');
    tiras.className = 'paleta-tiras';
    tiras.setAttribute('aria-hidden', 'true');
    for (const clave of ['fondo', 'tarjeta', 'primario', 'secundario']) {
      const t = document.createElement('span');
      t.style.background = p[clave];
      tiras.appendChild(t);
    }
    const nombre = document.createElement('span');
    nombre.className = 'paleta-nombre';
    nombre.textContent = p.nombre;
    const para = document.createElement('span');
    para.className = 'paleta-para';
    para.textContent = p.para;

    b.append(tiras, nombre, para);
    return b;
  }));
  // Al retocar un color a mano deja de ser esa paleta. addEventListener con la
  // misma función no la duplica, así que llamar a esto en cada visita a
  // Superadmin no acumula escuchas (lo que pasó en P5).
  for (const ids of Object.values(CAMPOS_PALETA))
    for (const id of ids) document.getElementById(id)?.addEventListener('input', marcarPaletaActual);
  marcarPaletaActual();
}
