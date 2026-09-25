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
  // 4,5 y no 3: además del nombre grande, van sobre el fondo títulos pequeños
  // como «ENTRANTES» y el subtítulo «CARTA EN VIDEO». Visto con la paleta del
  // logo de Lobster Boat, que pasaba contra la base oscura y no contra su fondo.
  { a: 'primario',   b: 'fondo',      min: 4.5, que: 'títulos pequeños sobre el fondo de la página' },
  { a: 'secundario', b: 'oscuro',     min: 4.5, que: 'subtítulo sobre el fondo oscuro' },
  { a: 'secundario', b: 'fondo',      min: 4.5, que: 'subtítulo sobre el fondo de la página' },
  { a: 'blanco',     b: 'secundario', min: 3,   que: 'letra blanca en los botones del secundario' },
  { a: 'secundario', b: 'tarjeta',    min: 3,   que: 'totales del carrito sobre las tarjetas' },
  { a: 'texto',      b: 'tarjeta',    min: 4.5, que: 'nombre del plato sobre la tarjeta' },
  { a: 'gris',       b: 'tarjeta',    min: 4.5, que: 'descripción del plato sobre la tarjeta' },
  { a: 'gris',       b: 'superficie', min: 4.5, que: 'textos del menú y del encabezado' },
  { a: 'texto',      b: 'fondo',      min: 4.5, que: 'texto sobre el fondo de la página' },
];

const PALETAS = [
  { id: 'clasica',     nombre: 'Clásica VMenus', para: 'la de siempre',              primario: '#cdfefe', secundario: '#a374af', superficie: '#12111a', tarjeta: '#1a1825', fondo: '#0a0a0f' },
  { id: 'brasa',       nombre: 'Brasa',          para: 'parrilla y hamburguesas',    primario: '#ff8a4c', secundario: '#d9442b', superficie: '#17100d', tarjeta: '#221713', fondo: '#110906' },
  { id: 'marisqueria', nombre: 'Marisquería',    para: 'mar y mariscos',             primario: '#e8454b', secundario: '#1f9e9a', superficie: '#141b33', tarjeta: '#1c2544', fondo: '#0f182f' },
  { id: 'huerta',      nombre: 'Huerta',         para: 'saludable y vegetariano',    primario: '#8bd17c', secundario: '#3f9b5b', superficie: '#101a12', tarjeta: '#17251a', fondo: '#0d1a10' },
  { id: 'cafe',        nombre: 'Café',           para: 'cafetería y panadería',      primario: '#e3b27a', secundario: '#b5651d', superficie: '#17110c', tarjeta: '#221912', fondo: '#0f0a07' },
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
function fallosDeContraste(colores, reglas = REGLAS_COLOR) {
  const todos = { ...COLORES_FIJOS_CARTA, ...colores };
  return reglas
    .map(r => ({ ...r, valor: contrasteColores(todos[r.a], todos[r.b]) }))
    .filter(r => r.valor < r.min);
}

// ── LA PALETA DEL LOGO ────────────────────────────────────────
// Pedido por el usuario el 24/09/2026: casi todo restaurante sube su logo y
// quiere la carta con los colores de su negocio. Se leen del propio logo, en
// el navegador y sin servicios externos: el logo vive en /uploads del mismo
// dominio que el panel, así que el canvas se puede leer.
//
// Los colores de un logo casi nunca sirven TAL CUAL: el azul marino de Lobster
// Boat como color de títulos no se vería sobre la base oscura. Así que a cada
// color se le da el papel que puede cumplir y se le mueve SOLO la luminosidad,
// conservando el tono, hasta que cumpla REGLAS_COLOR:
//   · el más vivo            → primario (títulos, precios)
//   · el más oscuro del resto → fondo, superficie y tarjeta, muy oscurecidos
//   · otro, o ese mismo       → secundario, llevado a tono medio
// Si el logo no tiene colores de marca (blanco y negro, grises), no hay
// paleta del logo y quedan las fijas.

let paletaDelLogo = null;   // { url, paleta } del logo leído por última vez

// 'state' vive en comun.js; con typeof, las pruebas que cargan solo este
// archivo no revientan por un nombre que no existe.
function logoActual() {
  return (typeof state === 'undefined' ? null : state?.restaurante?.logo_url) || null;
}

function hexARgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function rgbAHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

function rgbAHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslAHex([h, s, l]) {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbAHex([f(0), f(8), f(4)].map(v => v * 255));
}

// Los colores de marca de una imagen, del que más pesa al que menos, a partir
// de sus píxeles RGBA. Fuera lo transparente y lo neutro (blancos, negros y
// grises): son el fondo y las letras, no la marca. Se agrupa por tono en
// tramos de 20°, que junta los matices de un mismo color.
function coloresDeImagen(px) {
  const tramos = new Map();
  let opacos = 0, conColor = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    opacos++;
    const [h, s, l] = rgbAHsl([px[i], px[i + 1], px[i + 2]]);
    if (s < 0.25 || l < 0.08 || l > 0.92) continue;
    conColor++;
    const k = Math.round(h / 20) % 18;
    const t = tramos.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    t.n++; t.r += px[i]; t.g += px[i + 1]; t.b += px[i + 2];
    tramos.set(k, t);
  }
  // Unos pocos píxeles de color en un logo blanco y negro son bordes
  // suavizados, no una marca.
  if (!opacos || conColor / opacos < 0.03) return [];
  return [...tramos.values()]
    .map(t => ({ hex: rgbAHex([t.r / t.n, t.g / t.n, t.b / t.n]), peso: t.n / conColor }))
    .filter(c => c.peso >= 0.05)
    .sort((a, b) => b.peso - a.peso);
}

// El color de ese tono y esa saturación más parecido al original que cumpla
// 'cumple', moviendo solo la luminosidad. null si ninguna luminosidad sirve.
function acercarLuminosidad([h, s, l], cumple) {
  for (let d = 0; d <= 1; d += 0.005) {
    for (const prueba of [l + d, l - d]) {
      if (prueba < 0 || prueba > 1) continue;
      const hex = hslAHex([h, s, prueba]);
      if (cumple(hex)) return hex;
    }
  }
  return null;
}

function paletaDesdeColores(colores) {
  if (!colores?.length) return null;
  const c = colores.map(x => ({ ...x, hsl: rgbAHsl(hexARgb(x.hex)) }));
  // La base de los fondos es el color OSCURO del logo, que es el que ya hace
  // de fondo en la marca (el marino de Lobster Boat, el morado de un logo
  // morado y dorado). Si no tiene ninguno oscuro, el que más pesa.
  const oscuros = c.filter(x => x.hsl[2] <= 0.45);
  const base = oscuros.length ? oscuros.reduce((m, x) => (x.hsl[2] < m.hsl[2] ? x : m)) : c[0];
  // Para títulos, el más vivo de los demás, con algo de ventaja al que más se
  // ve. Con un solo color, ese mismo.
  const otros = c.filter(x => x !== base);
  const pesan = otros.filter(x => x.peso >= 0.10);
  const prim = otros.length
    ? (pesan.length ? pesan : otros).reduce((m, x) => (x.hsl[1] * (0.5 + x.peso) > m.hsl[1] * (0.5 + m.peso) ? x : m))
    : base;
  const sec = otros.find(x => x !== prim) || base;

  const f = COLORES_FIJOS_CARTA;
  // Saturación contenida: un fondo muy saturado y oscuro sale turbio.
  const oscuroDe = l => {
    const [h, s] = base.hsl;
    return acercarLuminosidad([h, Math.min(s, 0.4), l], hex =>
      contrasteColores(f.texto, hex) >= 4.5 && contrasteColores(f.gris, hex) >= 4.5);
  };
  const fondo = oscuroDe(0.11), superficie = oscuroDe(0.14), tarjeta = oscuroDe(0.18);
  if (!fondo || !superficie || !tarjeta) return null;

  const primario = acercarLuminosidad(prim.hsl, hex =>
    contrasteColores(hex, f.oscuro) >= 4.5 && contrasteColores(hex, tarjeta) >= 3 && contrasteColores(hex, fondo) >= 4.5);
  const secundario = acercarLuminosidad(sec.hsl, hex =>
    contrasteColores(hex, f.oscuro) >= 4.5 && contrasteColores(hex, fondo) >= 4.5 &&
    contrasteColores(f.blanco, hex) >= 3 && contrasteColores(hex, tarjeta) >= 3);
  if (!primario || !secundario) return null;

  const p = { primario, secundario, superficie, tarjeta, fondo };
  // Última red: si algo se escapó, mejor ninguna paleta que una que no se lee.
  if (fallosDeContraste(p).length) return null;
  const movido = (orig, nuevo) => Math.abs(rgbAHsl(hexARgb(nuevo))[2] - orig.hsl[2]) > 0.06;
  return {
    id: 'logo', nombre: 'De tu logo', ...p,
    para: movido(prim, primario) || movido(sec, secundario)
      ? 'sus colores, ajustados para que se lean'
      : 'los colores de tu logo',
    origen: c.map(x => x.hex),
  };
}

// Lee el logo en un canvas pequeño: para saber sus colores no hace falta más.
async function leerColoresDelLogo(url) {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const N = 64, lienzo = document.createElement('canvas');
    lienzo.width = N; lienzo.height = N;
    const ctx = lienzo.getContext('2d');
    ctx.drawImage(img, 0, 0, N, N);
    return coloresDeImagen(ctx.getImageData(0, 0, N, N).data);
  } catch {
    // Un logo en otro dominio sin permisos, o que no carga: sin paleta del logo.
    return [];
  }
}

function todasLasPaletas() {
  const logo = paletaDelLogo?.url === logoActual() ? paletaDelLogo.paleta : null;
  return logo ? [logo, ...PALETAS] : PALETAS;
}

function aplicarPaleta(id) {
  const p = todasLasPaletas().find(x => x.id === id);
  if (!p) return;
  for (const [clave, [texto, muestra]] of Object.entries(CAMPOS_PALETA)) {
    document.getElementById(texto).value = p[clave];
    colorDesdeTexto(texto, muestra);
  }
  marcarPaletaActual();
  revisarContraste();
}

// Cuál de las paletas coincide con lo que hay en los campos, para marcarla.
// Si se retocó un color a mano ya no es esa paleta, y no se marca ninguna.
function paletaActual() {
  const valor = id => (document.getElementById(id)?.value || '').trim().toLowerCase();
  return todasLasPaletas().find(p => Object.entries(CAMPOS_PALETA).every(([c, [texto]]) => valor(texto) === p[c])) || null;
}

function marcarPaletaActual() {
  const actual = paletaActual();
  document.querySelectorAll('#apPaletas .paleta').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.paleta === actual?.id)));
}

function botonPaleta(p, alPulsar = () => aplicarPaleta(p.id)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = p.id === 'logo' ? 'paleta paleta-logo' : 'paleta';
  b.dataset.paleta = p.id;
  b.setAttribute('aria-pressed', 'false');
  b.title = `${p.nombre} — ${p.para}`;
  b.onclick = alPulsar;

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
}

function renderPaletas() {
  const cont = document.getElementById('apPaletas');
  if (!cont) return;
  // p => botonPaleta(p) y no botonPaleta a secas: .map también pasa el índice,
  // que ocuparía el segundo parámetro (alPulsar) en vez de su valor por
  // defecto, y dejaba el onclick de cada botón apuntando a un número.
  cont.replaceChildren(...todasLasPaletas().map(p => botonPaleta(p)));
  // Al retocar un color a mano deja de ser esa paleta. addEventListener con la
  // misma función no la duplica, así que llamar a esto en cada visita a
  // Superadmin no acumula escuchas (lo que pasó en P5).
  for (const ids of Object.values(CAMPOS_PALETA))
    for (const id of ids) {
      document.getElementById(id)?.addEventListener('input', marcarPaletaActual);
      document.getElementById(id)?.addEventListener('input', revisarContraste);
    }
  marcarPaletaActual();
  revisarContraste();

  // La del logo se calcula aparte y se pinta cuando llega. Si ya se había
  // leído ese mismo logo, salió arriba con las demás.
  const url = logoActual();
  if (url && paletaDelLogo?.url !== url) {
    leerColoresDelLogo(url).then(colores => {
      paletaDelLogo = { url, paleta: paletaDesdeColores(colores) };
      // Si mientras tanto se cambió de restaurante o de logo, no se pinta.
      if (logoActual() === url && paletaDelLogo.paleta) renderPaletas();
    });
  }
}

// ── EL AVISO AL ELEGIR COLORES A MANO ─────────────────────────
// Pedido por el usuario el 24/09/2026, después de las paletas. Las paletas
// cubren a quien elige una; esto cubre a quien retoca un color suelto, que es
// justo como Lobster Boat acabó con el título negro sobre fondo oscuro.
//
// Solo AVISA: un restaurante puede insistir en su color de marca. Y propone,
// para cada color que falla, el más parecido que sí se lee (mismo tono, otra
// luminosidad), a un clic.

// Los que usa la carta cuando el campo está vacío (vmenus-app/core/loader.js).
// Un campo vacío no es «sin color»: es este, y hay que medirlo.
const PREDETERMINADOS_CARTA = {
  primario: '#cdfefe', secundario: '#a374af', superficie: '#12111a', tarjeta: '#1a1825', fondo: '#0a0a0f',
};

// Con el nombre que tiene cada campo en Superadmin, para que se encuentre.
const NOMBRE_COLOR = {
  primario: 'Color primario', secundario: 'Color secundario',
  superficie: 'Menú / encabezado / carrito', tarjeta: 'Cajas de producto', fondo: 'Color de fondo',
};

function hexCompleto(v) {
  let h = String(v || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : null;
}

function coloresEnCampos() {
  const valor = id => hexCompleto(document.getElementById(id)?.value);
  return Object.fromEntries(Object.entries(CAMPOS_PALETA)
    .map(([rol, [texto]]) => [rol, valor(texto) || PREDETERMINADOS_CARTA[rol]]));
}

// El color de fondo solo se usa si no hay imagen de fondo: con imagen, sus
// reglas no dicen nada de lo que verá el comensal.
function reglasQueAplican() {
  const conImagen = typeof state !== 'undefined' && !!state?.restaurante?.fondo_url;
  return conImagen ? REGLAS_COLOR.filter(r => r.a !== 'fondo' && r.b !== 'fondo') : REGLAS_COLOR;
}

// De cada regla que falla, cuál de los colores elegibles hay que cambiar. En
// «primario sobre tarjeta» se toca el primario: la tarjeta la cuidan sus
// propias reglas con el texto.
function rolAjustable(regla) {
  return regla.a in CAMPOS_PALETA ? regla.a : regla.b;
}

// Por cada color con problemas: qué falla y el más parecido que lo arregla,
// dejando los demás como están. sugerido es null si ninguno sirve.
function sugerenciasDeContraste(colores, reglas = REGLAS_COLOR) {
  const fallos = fallosDeContraste(colores, reglas);
  const arreglar = (rol, base) => acercarLuminosidad(rgbAHsl(hexARgb(colores[rol])), hex =>
    !fallosDeContraste({ ...base, [rol]: hex }, reglas).some(f => rolAjustable(f) === rol));

  const primera = Object.keys(CAMPOS_PALETA)
    .map(rol => ({ rol, fallos: fallos.filter(f => rolAjustable(f) === rol) }))
    .filter(s => s.fallos.length)
    .map(s => ({ ...s, sugerido: arreglar(s.rol, colores) }));

  // Cuando ningún tono sirve, casi siempre es porque OTRO color lo impide:
  // un secundario negro con unas tarjetas oliva no tiene arreglo hasta que se
  // oscurecen las tarjetas. Se averigua cuál, para decírselo a la persona en
  // vez de dejarla sin salida: primero con los demás ya arreglados, y si no,
  // con el fondo más oscuro posible.
  const conLosDemas = { ...colores };
  for (const s of primera) if (s.sugerido) conLosDemas[s.rol] = s.sugerido;
  return primera.map(s => {
    if (s.sugerido) return s;
    const otros = primera.filter(o => o.sugerido && o.rol !== s.rol);
    // Si basta con arreglar uno, se nombra solo ese: nombrar los tres confunde.
    const uno = otros.find(o => arreglar(s.rol, { ...colores, [o.rol]: o.sugerido }));
    if (uno) return { ...s, antes: [uno.rol] };
    if (otros.length && arreglar(s.rol, conLosDemas)) return { ...s, antes: otros.map(o => o.rol) };
    const fondoOscuro = s.rol !== 'fondo' && reglas.some(r => r.a === 'fondo' || r.b === 'fondo')
      && arreglar(s.rol, { ...conLosDemas, fondo: COLORES_FIJOS_CARTA.oscuro });
    return { ...s, antes: [], fondoOscuro: !!fondoOscuro };
  });
}

function usarColorSugerido(rol, hex) {
  const [texto, muestra] = CAMPOS_PALETA[rol];
  document.getElementById(texto).value = hex;
  colorDesdeTexto(texto, muestra);
  marcarPaletaActual();
  revisarContraste();
}

const numeroConComa = n => n.toFixed(1).replace('.', ',');

function revisarContraste() {
  const cont = document.getElementById('apAvisoContraste');
  if (!cont) return;
  const sugerencias = sugerenciasDeContraste(coloresEnCampos(), reglasQueAplican());
  cont.hidden = !sugerencias.length;
  if (!sugerencias.length) { cont.replaceChildren(); return; }

  const titulo = document.createElement('div');
  titulo.className = 'aviso-contraste-titulo';
  titulo.textContent = '⚠ Con estos colores hay partes de la carta que no se van a leer bien';
  cont.replaceChildren(titulo, ...sugerencias.map(s => {
    const item = document.createElement('div');
    item.className = 'aviso-contraste-item';
    const nombre = document.createElement('strong');
    nombre.textContent = NOMBRE_COLOR[s.rol];
    const lista = document.createElement('ul');
    for (const f of s.fallos) {
      const li = document.createElement('li');
      li.textContent = `${f.que}: contraste ${numeroConComa(f.valor)}, el mínimo es ${numeroConComa(f.min)}`;
      lista.appendChild(li);
    }
    item.append(nombre, lista);
    if (s.sugerido) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-sm aviso-contraste-usar';
      const muestra = document.createElement('span');
      muestra.className = 'aviso-contraste-muestra';
      muestra.style.background = s.sugerido;
      b.append(muestra, `Usar ${s.sugerido}`);
      b.title = 'El más parecido al que elegiste que sí se lee';
      b.onclick = () => usarColorSugerido(s.rol, s.sugerido);
      item.appendChild(b);
    } else {
      // Pasa, por ejemplo, con un secundario sobre un fondo de tono medio: no
      // hay luminosidad que aguante a la vez la letra blanca encima y el fondo
      // detrás. El que hay que cambiar es otro color, y hay que decirlo.
      const pista = document.createElement('div');
      pista.className = 'aviso-contraste-pista';
      pista.textContent = s.antes?.length
        ? `Arregla primero ${s.antes.map(r => `«${NOMBRE_COLOR[r]}»`).join(' y ')}: mientras siga así, ningún tono de este color se lee bien.`
        : s.fondoOscuro
          ? 'Ningún tono de este color se lee bien con el color de fondo actual. Prueba con un fondo más oscuro o con una de las paletas de arriba.'
          : 'Ningún tono de este color se lee bien con los demás tal como están. Prueba con una de las paletas de arriba.';
      item.appendChild(pista);
    }
    return item;
  }));
}

// ── LAS PALETAS AL CREAR UN RESTAURANTE ───────────────────────
// El formulario de «Nuevo restaurante» solo pedía primario y secundario, y el
// resto nacía con los colores por defecto de la carta: justo cinco colores
// sueltos sin nadie que los pensara juntos, que es lo que las paletas evitan.
//
// Elegir una aquí pone el primario y el secundario en sus campos (se pueden
// retocar) y deja apuntados superficie, tarjeta y fondo, que ese formulario no
// tiene: crearRestaurante() los manda al servidor. Lo último que se elige gana:
// «Copiar apariencia de» suelta la paleta, porque trae sus propios colores.
let paletaNuevoResto = null;   // id de la paleta elegida, o null

function elegirPaletaNuevoResto(id) {
  const p = PALETAS.find(x => x.id === id);
  if (!p) return;
  document.getElementById('newRestoColor1').value = p.primario;
  colorDesdeTexto('newRestoColor1', 'prevColor1');
  document.getElementById('newRestoColor2').value = p.secundario;
  colorDesdeTexto('newRestoColor2', 'prevColor2');
  paletaNuevoResto = id;
  marcarPaletaNuevoResto();
}

function soltarPaletaNuevoResto() {
  paletaNuevoResto = null;
  marcarPaletaNuevoResto();
}

function marcarPaletaNuevoResto() {
  document.querySelectorAll('#newRestoPaletas .paleta').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.paleta === paletaNuevoResto)));
}

// Lo que añade la paleta a lo que ya manda el formulario. Vacío sin paleta: el
// restaurante nace con los colores por defecto, como hasta ahora.
function coloresPaletaNuevoResto() {
  const p = PALETAS.find(x => x.id === paletaNuevoResto);
  return p ? { color_surface: p.superficie, color_card: p.tarjeta, fondo_color: p.fondo } : {};
}

function renderPaletasNuevoResto() {
  const cont = document.getElementById('newRestoPaletas');
  if (!cont) return;
  cont.replaceChildren(...PALETAS.map(p => botonPaleta(p, () => elegirPaletaNuevoResto(p.id))));
  marcarPaletaNuevoResto();
}
