// ── ELEGIR QUÉ PARTE DE LA FOTO SE ANIMA ──────────────────────
// Pedido por el usuario el 18/09/2026. Cuando la foto no tiene la proporción
// de la carta, el aviso decía «suele quedar bien si el plato está centrado», y
// no había forma de centrarlo: la IA recibía la foto entera y después ffmpeg
// cortaba la franja del medio, sobre un video ya pagado.
//
// Ahora, antes de generar, se enseña la foto con un recuadro de la proporción
// de la carta (16:9 o 9:16) que se arrastra con el ratón, el dedo o las
// flechas. El servidor recorta la foto a ese recuadro antes de mandarla al
// modelo (video.recorteCentradoEn), así que el video sale ya en la proporción
// de la carta y no se le corta nada después.
//
// Solo se manda el CENTRO del recuadro, en fracciones de la foto: el tamaño es
// siempre el más grande que cabe, y lo calcula el servidor igual que aquí.
//
// Esta ventana sustituye a la pregunta de «¿generar?» —trae la misma nota del
// coste—, para no preguntar dos veces por la misma decisión.
//
// Se usa como preguntar(), con await:
//   const encuadre = await abrirEncuadre({ src, formato, nota });
//   if (!encuadre) return;   // canceló

let encuadrePendiente = null;
let estadoEncuadre = { cx: 0.5, cy: 0.5, objetivo: 16 / 9 };

// Dónde va el recuadro, en píxeles de la foto tal como se ve. El recuadro es el
// más grande con esa proporción que cabe, y el centro pedido se ajusta al borde
// si se sale. Devuelve también el centro ya ajustado, que es el que se manda.
function marcoEncuadre(anchoVisto, altoVisto, objetivo, cx, cy) {
	const foto = anchoVisto / altoVisto;
	const w = foto > objetivo ? altoVisto * objetivo : anchoVisto;
	const h = foto > objetivo ? altoVisto : anchoVisto / objetivo;
	const dentro = (v, max) => Math.min(Math.max(v, 0), Math.max(0, max));
	const left = dentro(cx * anchoVisto - w / 2, anchoVisto - w);
	const top  = dentro(cy * altoVisto - h / 2, altoVisto - h);
	return {
		left, top, w, h,
		cx: (left + w / 2) / anchoVisto,
		cy: (top + h / 2) / altoVisto,
		// Hacia dónde se puede mover: una foto más alta que la carta solo sube
		// y baja; una más ancha, solo de lado a lado.
		eje: foto > objetivo ? 'x' : 'y',
	};
}

function abrirEncuadre({ src, formato, nota = '' }) {
	if (encuadrePendiente) responderEncuadre(null);
	const $ = id => document.getElementById(id);
	const vertical = formato === 'vertical';
	estadoEncuadre = { cx: 0.5, cy: 0.5, objetivo: vertical ? 9 / 16 : 16 / 9 };

	$('encuadreTexto').textContent =
		`Tu carta es ${vertical ? 'vertical (9:16)' : 'horizontal (16:9)'} y tu foto no tiene esa ` +
		`forma. Mueve el recuadro hasta dejar el plato dentro: la IA solo anima lo que queda dentro.`;
	$('encuadreNota').textContent = nota;

	const img = $('encuadreFoto');
	img.onload = pintarEncuadre;
	img.src = src;
	$('encuadreModal').classList.add('open');
	document.body.style.overflow = 'hidden';
	// Si la foto ya estaba en caché, onload puede no llegar.
	if (img.complete && img.naturalWidth) pintarEncuadre();
	$('encuadreMarco').focus();
	return new Promise(resolver => { encuadrePendiente = resolver; });
}

function pintarEncuadre() {
	const img = document.getElementById('encuadreFoto');
	const marco = document.getElementById('encuadreMarco');
	if (!img || !marco || !img.clientWidth || !img.clientHeight) return;
	const m = marcoEncuadre(img.clientWidth, img.clientHeight, estadoEncuadre.objetivo, estadoEncuadre.cx, estadoEncuadre.cy);
	estadoEncuadre.cx = m.cx;
	estadoEncuadre.cy = m.cy;
	estadoEncuadre.eje = m.eje;
	Object.assign(marco.style, {
		left: `${m.left}px`, top: `${m.top}px`, width: `${m.w}px`, height: `${m.h}px`,
		cursor: m.eje === 'x' ? 'ew-resize' : 'ns-resize',
	});
}

// Lleva el centro del recuadro a un punto de la foto, en píxeles vistos.
function moverEncuadreA(x, y) {
	const img = document.getElementById('encuadreFoto');
	estadoEncuadre.cx = x / img.clientWidth;
	estadoEncuadre.cy = y / img.clientHeight;
	pintarEncuadre();
}

// Arrastrar funciona igual con ratón y con dedo (pointer events). Pulsar fuera
// del recuadro también vale: lo lleva hasta ahí, que es lo que se espera.
function empezarArrastreEncuadre(e) {
	const img = document.getElementById('encuadreFoto');
	const escenario = document.getElementById('encuadreEscenario');
	if (!img.clientWidth) return;
	e.preventDefault();
	const caja = img.getBoundingClientRect();
	const marco = document.getElementById('encuadreMarco').getBoundingClientRect();
	// Si se agarró el recuadro, se mueve desde donde se agarró y no salta.
	const dentro = e.clientX >= marco.left && e.clientX <= marco.right &&
		e.clientY >= marco.top && e.clientY <= marco.bottom;
	const dx = dentro ? e.clientX - (marco.left + marco.width / 2) : 0;
	const dy = dentro ? e.clientY - (marco.top + marco.height / 2) : 0;
	const mover = ev => moverEncuadreA(ev.clientX - dx - caja.left, ev.clientY - dy - caja.top);
	mover(e);
	escenario.setPointerCapture?.(e.pointerId);
	const soltar = () => {
		escenario.removeEventListener('pointermove', mover);
		escenario.removeEventListener('pointerup', soltar);
		escenario.removeEventListener('pointercancel', soltar);
	};
	escenario.addEventListener('pointermove', mover);
	escenario.addEventListener('pointerup', soltar);
	escenario.addEventListener('pointercancel', soltar);
}

// Con teclado: las flechas mueven un 2 %, y con Mayúsculas un 10 %.
function teclaEncuadre(e) {
	const paso = e.shiftKey ? 0.10 : 0.02;
	const mov = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[e.key];
	if (!mov) return;
	e.preventDefault();
	estadoEncuadre.cx += mov[0];
	estadoEncuadre.cy += mov[1];
	pintarEncuadre();
}

function responderEncuadre(generar) {
	const resolver = encuadrePendiente;
	encuadrePendiente = null;
	document.getElementById('encuadreModal').classList.remove('open');
	// Se abre encima de la ficha del plato, que sigue abierta.
	if (!document.querySelector('.modal-bg.open')) document.body.style.overflow = '';
	if (resolver) resolver(generar ? { cx: estadoEncuadre.cx, cy: estadoEncuadre.cy } : null);
}

function hayEncuadreAbierto() {
	return !!encuadrePendiente;
}

// Si cambia el tamaño de la ventana, la foto se ve de otro tamaño y el
// recuadro tiene que seguirla. El centro, en fracciones, no cambia.
window.addEventListener('resize', () => { if (encuadrePendiente) pintarEncuadre(); });
