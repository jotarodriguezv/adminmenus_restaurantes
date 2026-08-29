// ── DISEÑADOR DE CÓDIGOS QR ───────────────────────────────────
// Genera y personaliza el QR que lleva al menú público del
// restaurante (ver urlPublica() en index.html).
//
// vendor/qrcode.js (MIT, Kazuhiko Arase) solo codifica el texto en una
// matriz de módulos. Todo el dibujo se hace aquí, porque necesitamos
// la matriz cruda para poder darle forma a los puntos, estilizar las
// tres esquinas por separado y abrir hueco para el logo.
//
// El diseño se guarda en restaurantes.atributos.qr y se exporta a
// PNG (suelto o dentro de un cartel para imprimir) y a SVG.

const QR_DEFAULTS = {
	fg: '#000000',        // color de los módulos
	ojos: '',             // color de las 3 esquinas ('' = igual que fg)
	bg: '#ffffff',        // color de fondo
	transparente: false,  // fondo transparente
	punto: 'cuadrado',    // 'cuadrado' | 'redondo' | 'circulo'
	ojo: 'cuadrado',      // 'cuadrado' | 'redondo' | 'circulo'
	logo: false,          // logo del restaurante al centro
	logo_tam: 22,         // % del ancho del QR
	margen: 4,            // módulos de zona de silencio alrededor
	cartel_titulo: 'ESCANEA PARA VER EL MENÚ',
	cartel_pie: '',       // vacío = nombre del restaurante
	cartel_bg: '#111111',
	cartel_fg: '#ffffff'
};

let qrCfg      = { ...QR_DEFAULTS };
let qrLogoImg  = null;   // HTMLImageElement ya cargado, o null
let qrMatriz   = null;   // { count, isDark(r,c) }

// ── DATOS BASE ────────────────────────────────────────────────
// La forma del enlace (ruta o subdominio) se configura por restaurante
// en Apariencia. El menú responde por ambas, así que cambiarla no
// invalida los códigos ya impresos — solo cambia los que se generen
// de aquí en adelante.
function qrEnlace() {
	return urlPublica(state.restaurante);
}

// Con el logo tapando el centro hace falta la corrección de errores
// más alta (H, ~30% recuperable). Sin logo basta M, que deja un patrón
// menos denso y por tanto más fácil de escanear impreso en pequeño.
function qrCalcularMatriz() {
	const qr = qrcode(0, qrCfg.logo && qrLogoImg ? 'H' : 'M');
	qr.addData(qrEnlace());
	qr.make();
	return { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

// Las tres esquinas (patrones de localización) ocupan 7x7 módulos y se
// dibujan aparte para poder darles su propio estilo y color.
function qrEsOjo(r, c, n) {
	return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
}

// ── GEOMETRÍA ─────────────────────────────────────────────────
// Se construye una lista de formas neutra (ni canvas ni SVG) para que
// el PNG y el SVG salgan idénticos sin duplicar la lógica de dibujo.
function qrFormas(size) {
	const m     = qrMatriz;
	const total = m.count + qrCfg.margen * 2;
	const cell  = size / total;
	const off   = qrCfg.margen * cell;
	const colorOjo = qrCfg.ojos || qrCfg.fg;
	const formas = [];

	if (!qrCfg.transparente)
		formas.push({ t: 'rect', x: 0, y: 0, w: size, h: size, r: 0, fill: qrCfg.bg });

	for (let r = 0; r < m.count; r++) {
		for (let c = 0; c < m.count; c++) {
			if (qrEsOjo(r, c, m.count) || !m.isDark(r, c)) continue;
			const x = off + c * cell, y = off + r * cell;
			// Los círculos van tangentes (radio = medio módulo) a propósito:
			// con radios menores se ve más "aireado" pero los lectores pierden
			// la trama al escanear en alta resolución. Verificado con jsQR.
			if (qrCfg.punto === 'circulo')
				formas.push({ t: 'circle', cx: x + cell / 2, cy: y + cell / 2, r: cell * 0.5, fill: qrCfg.fg });
			else
				formas.push({ t: 'rect', x, y, w: cell, h: cell, r: qrCfg.punto === 'redondo' ? cell * 0.3 : 0, fill: qrCfg.fg });
		}
	}

	[[0, 0], [0, m.count - 7], [m.count - 7, 0]].forEach(([r, c]) => {
		formas.push(...qrFormasOjo(off + c * cell, off + r * cell, cell, colorOjo));
	});

	return { formas, cell };
}

function qrFormasOjo(x, y, cell, color) {
	const s = cell * 7;
	if (qrCfg.ojo === 'circulo') {
		return [
			{ t: 'anilloCirculo', cx: x + s / 2, cy: y + s / 2, r: s / 2, r2: s / 2 - cell, fill: color },
			{ t: 'circle', cx: x + s / 2, cy: y + s / 2, r: cell * 1.5, fill: color }
		];
	}
	const rad = qrCfg.ojo === 'redondo' ? cell * 1.75 : 0;
	return [
		{
			t: 'anilloRect', fill: color,
			x, y, w: s, h: s, r: rad,
			x2: x + cell, y2: y + cell, w2: s - cell * 2, h2: s - cell * 2, r2: Math.max(0, rad - cell * 0.5)
		},
		{ t: 'rect', x: x + cell * 2, y: y + cell * 2, w: cell * 3, h: cell * 3, r: Math.max(0, rad - cell * 1.2), fill: color }
	];
}

// ── DIBUJO EN CANVAS ──────────────────────────────────────────
function qrRutaRect(ctx, x, y, w, h, r) {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

function qrPintarFormas(ctx, formas) {
	formas.forEach(f => {
		ctx.fillStyle = f.fill;
		ctx.beginPath();
		if (f.t === 'rect') qrRutaRect(ctx, f.x, f.y, f.w, f.h, f.r);
		else if (f.t === 'circle') ctx.arc(f.cx, f.cy, f.r, 0, Math.PI * 2);
		else if (f.t === 'anilloRect') {
			qrRutaRect(ctx, f.x, f.y, f.w, f.h, f.r);
			qrRutaRect(ctx, f.x2, f.y2, f.w2, f.h2, f.r2);
		} else if (f.t === 'anilloCirculo') {
			ctx.arc(f.cx, f.cy, f.r, 0, Math.PI * 2);
			ctx.moveTo(f.cx + f.r2, f.cy);
			ctx.arc(f.cx, f.cy, f.r2, 0, Math.PI * 2);
		}
		ctx.fill('evenodd');
	});
}

// El logo va sobre una placa del color de fondo: sin ella los módulos
// que quedan debajo se confunden con el logo y el lector falla.
function qrPintarLogo(ctx, size, cell) {
	if (!qrCfg.logo || !qrLogoImg) return;
	const lado = size * (qrCfg.logo_tam / 100);
	const pad  = cell * 0.7;
	const x    = (size - lado) / 2;
	ctx.fillStyle = qrCfg.transparente ? '#ffffff' : qrCfg.bg;
	ctx.beginPath();
	qrRutaRect(ctx, x - pad, x - pad, lado + pad * 2, lado + pad * 2, cell);
	ctx.fill();
	// "contain": el logo nunca se deforma, quepa como quepa
	const escala = Math.min(lado / qrLogoImg.naturalWidth, lado / qrLogoImg.naturalHeight);
	const w = qrLogoImg.naturalWidth * escala, h = qrLogoImg.naturalHeight * escala;
	ctx.drawImage(qrLogoImg, (size - w) / 2, (size - h) / 2, w, h);
}

function qrRenderizarEn(canvas, size) {
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, size, size);
	const { formas, cell } = qrFormas(size);
	qrPintarFormas(ctx, formas);
	qrPintarLogo(ctx, size, cell);
}

// ── EXPORTAR A SVG ────────────────────────────────────────────
const qrN = v => Math.round(v * 100) / 100;

function qrSvgRect(x, y, w, h, r) {
	const rr = Math.min(r, w / 2, h / 2);
	if (!rr) return `M${qrN(x)} ${qrN(y)}H${qrN(x + w)}V${qrN(y + h)}H${qrN(x)}Z`;
	return `M${qrN(x + rr)} ${qrN(y)}` +
		`H${qrN(x + w - rr)}A${qrN(rr)} ${qrN(rr)} 0 0 1 ${qrN(x + w)} ${qrN(y + rr)}` +
		`V${qrN(y + h - rr)}A${qrN(rr)} ${qrN(rr)} 0 0 1 ${qrN(x + w - rr)} ${qrN(y + h)}` +
		`H${qrN(x + rr)}A${qrN(rr)} ${qrN(rr)} 0 0 1 ${qrN(x)} ${qrN(y + h - rr)}` +
		`V${qrN(y + rr)}A${qrN(rr)} ${qrN(rr)} 0 0 1 ${qrN(x + rr)} ${qrN(y)}Z`;
}

function qrSvgCirculo(cx, cy, r) {
	return `M${qrN(cx - r)} ${qrN(cy)}a${qrN(r)} ${qrN(r)} 0 1 0 ${qrN(r * 2)} 0a${qrN(r)} ${qrN(r)} 0 1 0 ${qrN(-r * 2)} 0Z`;
}

function qrLogoDataURL() {
	if (!qrLogoImg) return null;
	const c = document.createElement('canvas');
	c.width = qrLogoImg.naturalWidth;
	c.height = qrLogoImg.naturalHeight;
	c.getContext('2d').drawImage(qrLogoImg, 0, 0);
	try { return c.toDataURL('image/png'); } catch { return null; }
}

function qrComoSVG(size) {
	const { formas, cell } = qrFormas(size);
	const partes = formas.map(f => {
		if (f.t === 'rect')
			return `<rect x="${qrN(f.x)}" y="${qrN(f.y)}" width="${qrN(f.w)}" height="${qrN(f.h)}" rx="${qrN(f.r)}" fill="${f.fill}"/>`;
		if (f.t === 'circle')
			return `<circle cx="${qrN(f.cx)}" cy="${qrN(f.cy)}" r="${qrN(f.r)}" fill="${f.fill}"/>`;
		if (f.t === 'anilloRect')
			return `<path fill-rule="evenodd" fill="${f.fill}" d="${qrSvgRect(f.x, f.y, f.w, f.h, f.r)}${qrSvgRect(f.x2, f.y2, f.w2, f.h2, f.r2)}"/>`;
		if (f.t === 'anilloCirculo')
			return `<path fill-rule="evenodd" fill="${f.fill}" d="${qrSvgCirculo(f.cx, f.cy, f.r)}${qrSvgCirculo(f.cx, f.cy, f.r2)}"/>`;
		return '';
	});

	if (qrCfg.logo && qrLogoImg) {
		const data = qrLogoDataURL();
		if (data) {
			const lado = size * (qrCfg.logo_tam / 100);
			const pad  = cell * 0.7;
			const x    = (size - lado) / 2;
			partes.push(`<rect x="${qrN(x - pad)}" y="${qrN(x - pad)}" width="${qrN(lado + pad * 2)}" height="${qrN(lado + pad * 2)}" rx="${qrN(cell)}" fill="${qrCfg.transparente ? '#ffffff' : qrCfg.bg}"/>`);
			partes.push(`<image x="${qrN(x)}" y="${qrN(x)}" width="${qrN(lado)}" height="${qrN(lado)}" preserveAspectRatio="xMidYMid meet" href="${data}"/>`);
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${partes.join('')}</svg>`;
}

// ── CARTEL PARA IMPRIMIR ──────────────────────────────────────
// Proporción A4 (1:1.414) para que salga bien en una hoja normal.
function qrTextoEnLineas(ctx, texto, maxAncho) {
	const lineas = [];
	let linea = '';
	texto.split(/\s+/).filter(Boolean).forEach(palabra => {
		const prueba = linea ? `${linea} ${palabra}` : palabra;
		if (ctx.measureText(prueba).width > maxAncho && linea) { lineas.push(linea); linea = palabra; }
		else linea = prueba;
	});
	if (linea) lineas.push(linea);
	return lineas;
}

function qrRenderizarCartel(canvas, escala) {
	const W = 1000 * escala, H = 1414 * escala;
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext('2d');

	ctx.fillStyle = qrCfg.cartel_bg;
	ctx.fillRect(0, 0, W, H);

	// Título
	ctx.fillStyle = qrCfg.cartel_fg;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	ctx.font = `700 ${58 * escala}px 'DM Sans', sans-serif`;
	const lineas = qrTextoEnLineas(ctx, qrCfg.cartel_titulo || '', 820 * escala);
	lineas.slice(0, 3).forEach((l, i) => ctx.fillText(l, W / 2, (130 + i * 72) * escala));

	// Placa blanca detrás del QR: si el usuario eligió fondo transparente
	// u oscuro, sin esto el QR no escanea sobre el color del cartel.
	const lado = 640 * escala;
	const qx = (W - lado) / 2, qy = 370 * escala, pad = 26 * escala;
	ctx.fillStyle = qrCfg.transparente ? '#ffffff' : qrCfg.bg;
	ctx.beginPath();
	qrRutaRect(ctx, qx - pad, qy - pad, lado + pad * 2, lado + pad * 2, 20 * escala);
	ctx.fill();

	const tmp = document.createElement('canvas');
	qrRenderizarEn(tmp, lado);
	ctx.drawImage(tmp, qx, qy);

	// Pie: nombre del negocio + enlace legible para quien no pueda escanear
	ctx.fillStyle = qrCfg.cartel_fg;
	ctx.font = `700 ${46 * escala}px 'DM Sans', sans-serif`;
	ctx.fillText(qrCfg.cartel_pie || state.restaurante.nombre, W / 2, 1120 * escala);
	ctx.globalAlpha = 0.65;
	ctx.font = `400 ${28 * escala}px 'Space Mono', monospace`;
	ctx.fillText(qrEnlace().replace(/^https?:\/\//, ''), W / 2, 1205 * escala);
	ctx.globalAlpha = 1;
}

// ── AVISOS DE ESCANEABILIDAD ──────────────────────────────────
// Los campos de color son de texto libre: nadie rechaza un '#12345' o un
// 'rojo'. Canvas ignora en silencio un fillStyle inválido y se queda con el
// que tenía —que es el del fondo, porque el fondo se pinta primero—, así que
// el QR sale invisible y el chequeo de contraste ni se entera: una luminancia
// que no se puede calcular vale 0, o sea negro, y todo parece correcto.
const QR_HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// La norma del QR pide 4 módulos de zona de silencio alrededor. Con menos,
// muchos lectores fallan, sobre todo impreso pegado a otros elementos. El
// deslizador llega hasta 0, así que se puede generar un código que no escanea
// y mandarlo a imprimir sin enterarse.
const QR_MARGEN_MINIMO = 4;

// Colores escritos pero mal formados, para avisar de ellos.
let qrColoresInvalidos = [];

function qrHexRGB(hex) {
	let h = (hex || '').replace('#', '');
	if (h.length === 3) h = h.split('').map(c => c + c).join('');
	const n = parseInt(h, 16);
	if (h.length !== 6 || isNaN(n)) return null;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function qrLuminancia(hex) {
	const rgb = qrHexRGB(hex);
	if (!rgb) return 0;
	const [r, g, b] = rgb.map(v => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function qrRevisarAvisos() {
	const aviso = document.getElementById('qrAviso');
	if (!aviso) return;
	const msgs = [];

	// Va primero: si un color no se entiende, lo que se ve en la vista previa
	// no es lo que el usuario cree haber puesto, y avisar del contraste de un
	// color que no existe solo despista.
	if (qrColoresInvalidos.length)
		msgs.push(`⚠ Color no válido en ${qrColoresInvalidos.join(' y ')}: escríbelo como #000000. Se mantiene el último válido.`);

	if (qrCfg.margen < QR_MARGEN_MINIMO)
		msgs.push(`⚠ Margen de ${qrCfg.margen} ${qrCfg.margen === 1 ? 'módulo' : 'módulos'}: la norma pide ${QR_MARGEN_MINIMO}. Con menos, muchos lectores fallan al escanearlo impreso.`);

	// Con fondo transparente el QR acaba sobre algo claro casi siempre,
	// así que se evalúa contra blanco.
	const fondo = qrCfg.transparente ? '#ffffff' : qrCfg.bg;
	const lf = qrLuminancia(qrCfg.fg), lb = qrLuminancia(fondo);
	const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);

	if (lf > lb) msgs.push('⚠ QR claro sobre fondo oscuro: muchos lectores no lo reconocen. Invierte los colores.');
	else if (ratio < 3) msgs.push('⚠ Muy poco contraste entre los puntos y el fondo: es probable que no escanee.');
	else if (ratio < 5) msgs.push('⚠ Contraste justo. Prueba a escanearlo antes de mandarlo a imprimir.');

	aviso.textContent = msgs.join('\n');
	aviso.style.whiteSpace = 'pre-line';
	aviso.style.display = msgs.length ? 'block' : 'none';
}

// ── CONTROLES ─────────────────────────────────────────────────
function qrLeerControles() {
	const v = id => document.getElementById(id).value.trim();
	const c = id => document.getElementById(id).checked;

	// Un color mal escrito no se acepta ni se convierte en negro por su
	// cuenta: se conserva el último válido y se apunta para avisar. Cambiarlo
	// a un color por defecto sería peor, porque el usuario vería cambiar el
	// diseño sin entender por qué.
	qrColoresInvalidos = [];
	const color = (id, campo, porDefecto, etiqueta) => {
		const bruto = v(id);
		if (!bruto) return porDefecto;
		if (QR_HEX_RE.test(bruto)) return bruto;
		qrColoresInvalidos.push(etiqueta);
		return qrCfg[campo] || porDefecto;
	};

	qrCfg.fg            = color('qrColorFg',   'fg',   '#000000', 'los puntos');
	qrCfg.ojos          = color('qrColorOjos', 'ojos', '',        'las esquinas');
	qrCfg.bg            = color('qrColorBg',   'bg',   '#ffffff', 'el fondo');
	qrCfg.transparente  = c('qrTransparente');
	qrCfg.logo          = c('qrUsarLogo');
	qrCfg.logo_tam      = parseInt(v('qrLogoTam'), 10) || 22;
	qrCfg.margen        = parseInt(v('qrMargen'), 10) || 0;
	qrCfg.cartel_titulo = document.getElementById('qrCartelTitulo').value;
	qrCfg.cartel_pie    = document.getElementById('qrCartelPie').value;
	qrCfg.cartel_bg     = color('qrCartelBg', 'cartel_bg', '#111111', 'el fondo del cartel');
	qrCfg.cartel_fg     = color('qrCartelFg', 'cartel_fg', '#ffffff', 'el texto del cartel');
}

// ── SELECTOR DE COLOR ─────────────────────────────────────────
// El cuadrito de vista previa es un <input type="color">: el navegador pone
// la paleta y siempre devuelve un hex válido, así que por esa vía no se puede
// escribir un color mal. El campo de texto se conserva porque sigue siendo la
// forma cómoda de pegar el hex exacto de una marca.
// hex6() y colorDesdeSelector() viven en el script principal de index.html:
// son de todo el panel, no solo del QR. Duplicarlos aquí es justo lo que hizo
// que el escapado de HTML acabara aplicándose en un tema y no en los otros.
function qrSyncColor(idSelector, idTexto) {
	colorDesdeSelector(idSelector, idTexto);
	qrActualizar();
}

function qrElegirEstilo(campo, valor, btn) {
	qrCfg[campo] = valor;
	btn.parentNode.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
	btn.classList.add('active');
	qrActualizar();
}

// El nivel de corrección de errores cambia con el logo, así que la
// matriz se recalcula en cada actualización en vez de cachearse.
function qrActualizar() {
	if (!state.restaurante) return;
	qrLeerControles();

	document.getElementById('qrLogoTamWrap').style.display = qrCfg.logo ? 'block' : 'none';
	document.getElementById('qrLogoTamVal').textContent = `${qrCfg.logo_tam}%`;
	document.getElementById('qrMargenVal').textContent = qrCfg.margen;
	// Los cuadritos ahora son selectores de color: se les asigna el valor, no
	// el fondo. El de las esquinas muestra el color efectivo —el de los puntos
	// cuando está vacío— para que enseñe lo que realmente se está dibujando.
	['qrPrevFg', 'qrPrevOjos', 'qrPrevBg', 'qrPrevCartelBg', 'qrPrevCartelFg'].forEach(id => {
		const src = { qrPrevFg: qrCfg.fg, qrPrevOjos: qrCfg.ojos || qrCfg.fg, qrPrevBg: qrCfg.bg, qrPrevCartelBg: qrCfg.cartel_bg, qrPrevCartelFg: qrCfg.cartel_fg }[id];
		const el = document.getElementById(id);
		if (el) el.value = hex6(src);
	});

	qrMatriz = qrCalcularMatriz();
	qrRenderizarEn(document.getElementById('qrPreview'), 640);
	qrRevisarAvisos();
}

function qrCargarLogo(url) {
	return new Promise(resolve => {
		if (!url) return resolve(null);
		const img = new Image();
		// Los uploads salen del mismo servidor con CORS abierto: esto evita
		// que el canvas quede "tainted" y rompa la descarga.
		img.crossOrigin = 'anonymous';
		img.onload  = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = url;
	});
}

// Vuelca qrCfg sobre los controles del formulario.
function qrAplicarAControles() {
	document.getElementById('qrEnlace').value        = qrEnlace();
	document.getElementById('qrColorFg').value       = qrCfg.fg;
	document.getElementById('qrColorOjos').value     = qrCfg.ojos;
	document.getElementById('qrColorBg').value       = qrCfg.bg;
	document.getElementById('qrTransparente').checked = qrCfg.transparente;
	document.getElementById('qrUsarLogo').checked    = qrCfg.logo;
	document.getElementById('qrLogoTam').value       = qrCfg.logo_tam;
	document.getElementById('qrMargen').value        = qrCfg.margen;
	document.getElementById('qrCartelTitulo').value  = qrCfg.cartel_titulo;
	document.getElementById('qrCartelPie').value     = qrCfg.cartel_pie;
	document.getElementById('qrCartelBg').value      = qrCfg.cartel_bg;
	document.getElementById('qrCartelFg').value      = qrCfg.cartel_fg;
	document.getElementById('qrCartelPie').placeholder = state.restaurante.nombre;

	[['punto', 'qrChipsPunto'], ['ojo', 'qrChipsOjo']].forEach(([campo, wrap]) => {
		document.querySelectorAll(`#${wrap} .cat-chip`).forEach(b => {
			b.classList.toggle('active', b.dataset.valor === qrCfg[campo]);
		});
	});
}

async function renderQR() {
	if (!state.restaurante) return;
	qrCfg = { ...QR_DEFAULTS, ...(state.restaurante.atributos?.qr || {}) };
	qrAplicarAControles();

	// Sin logo cargado no tiene sentido ofrecer la opción
	qrLogoImg = await qrCargarLogo(state.restaurante.logo_url);
	const wrapLogo = document.getElementById('qrLogoOpcion');
	wrapLogo.style.display = qrLogoImg ? 'flex' : 'none';
	document.getElementById('qrSinLogo').style.display = qrLogoImg ? 'none' : 'block';
	if (!qrLogoImg) qrCfg.logo = document.getElementById('qrUsarLogo').checked = false;

	qrActualizar();
}

// ── ACCIONES ──────────────────────────────────────────────────
function qrDescargar(blob, nombre) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombre;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function qrDescargarPNG() {
	qrActualizar();
	const c = document.createElement('canvas');
	qrRenderizarEn(c, 2048);
	c.toBlob(b => qrDescargar(b, `qr-${state.restaurante.slug}.png`), 'image/png');
}

function qrDescargarSVG() {
	qrActualizar();
	const svg = qrComoSVG(1024);
	qrDescargar(new Blob([svg], { type: 'image/svg+xml' }), `qr-${state.restaurante.slug}.svg`);
}

function qrDescargarCartel() {
	qrActualizar();
	const c = document.createElement('canvas');
	qrRenderizarCartel(c, 2);
	c.toBlob(b => qrDescargar(b, `cartel-${state.restaurante.slug}.png`), 'image/png');
}

function qrVistaPreviaCartel() {
	qrActualizar();
	const c = document.getElementById('qrCartelPreview');
	qrRenderizarCartel(c, 0.75);
	openModal('qrCartelModal');
}

function qrCopiarEnlace() {
	navigator.clipboard.writeText(qrEnlace())
		.then(() => showToast('Enlace copiado', 'success'))
		.catch(() => showToast('No se pudo copiar', 'error'));
}

function qrUsarColoresMarca() {
	document.getElementById('qrColorFg').value = state.restaurante.color_primario || '#000000';
	document.getElementById('qrColorOjos').value = state.restaurante.color_secundario || '';
	qrActualizar();
}

// Solo devuelve el formulario a los valores por defecto. Lo guardado en
// la base de datos no cambia hasta que el usuario le dé a Guardar.
function qrRestablecer() {
	qrCfg = { ...QR_DEFAULTS };
	qrAplicarAControles();
	qrActualizar();
}

async function qrGuardarDiseno() {
	qrLeerControles();
	const st = document.getElementById('qrStatus');
	try {
		// Solo su clave. Aquí se mandaba el objeto ENTERO fundido sobre la copia
		// que el panel cargó al entrar, con el razonamiento de que el servidor
		// solo fundía para el rol cliente. Dejó de ser cierto el 27/08/2026:
		// funde para los dos, y las cinco pantallas de index.html se cambiaron
		// ese día para mandar solo lo suyo. Esta se quedó fuera por estar en
		// otro archivo.
		//
		// Mientras tanto, guardar el diseño del QR devolvía TODO 'atributos' a
		// la copia de al entrar: si alguien había cambiado el WhatsApp de
		// pedidos, los toppings o los métodos de pago desde otra sesión, se
		// perdían sin aviso y sin nada en los registros.
		const atributos = { qr: qrCfg };
		const data = await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`, { atributos });
		state.restaurante = data;
		st.textContent = '✓ Guardado';
		st.style.color = 'var(--success)';
		showToast('Diseño del QR guardado', 'success');
	} catch (e) {
		st.textContent = 'Error al guardar';
		st.style.color = 'var(--danger)';
		showToast('Error: ' + e.message, 'error');
	}
}
