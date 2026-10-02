// Los datos del negocio: el WhatsApp único y su botón (negocio.js, el panel y la
// API). La carta lo lee con la misma regla en otro repositorio.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./helpers/servidor.js');
const negocio = require('../negocio.js');

const { IDS, tokenCliente, tokenAdmin } = S;
const PUBLIC = path.join(__dirname, '..', 'public');
const CASOS = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos-negocio.json'), 'utf8'));
beforeEach(() => S.reiniciar());

// ═══════════════════════════════════════════════════════════════
describe('la regla · el mismo juego de casos en el servidor, el panel y la carta', () => {
	// La regla vive en TRES sitios y ninguno puede importar a los otros. Si se
	// separan, el panel dice que la carta recibe pedidos y la carta rechaza el
	// pedido de un cliente.
	const panel = () => {
		const ctx = vm.createContext({ String });
		vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8'), ctx);
		return ctx;
	};

	test('hay casos que correr', () => assert.ok(CASOS.casos.length >= 10));

	for (const c of CASOS.casos) {
		test(`servidor · ${c.nombre}`, () => {
			assert.equal(negocio.whatsappDelNegocio(c.at), c.numero);
			assert.equal(negocio.botonWhatsappActivo(c.at), c.boton);
		});
		test(`panel · ${c.nombre}`, () => {
			const p = panel();
			assert.equal(p.whatsappDelNegocio(c.at), c.numero);
			assert.equal(p.botonWhatsappActivo(c.at), c.boton);
		});
	}
});

// ═══════════════════════════════════════════════════════════════
describe('los enlaces y la dirección · el mismo juego de casos (paso 2)', () => {
	// El panel y la carta leen el mapa y las reseñas con la misma regla. La
	// dirección no tiene clave vieja, pero se recorta igual en los dos.
	const ctxPanel = () => {
		const ctx = vm.createContext({ String });
		vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8'), ctx);
		return ctx;
	};

	test('hay casos que correr', () => assert.ok(CASOS.enlaces.length >= 6));

	for (const c of CASOS.enlaces) {
		test(`panel · ${c.nombre}`, () => {
			const p = ctxPanel();
			assert.equal(p.direccionDelNegocio(c.at), c.direccion);
			assert.equal(p.mapaDelNegocio(c.at), c.mapa);
			assert.equal(p.resenaDelNegocio(c.at), c.resena);
		});
	}
});

// ═══════════════════════════════════════════════════════════════
describe('PATCH /api/restaurantes · la ubicación y las reseñas del negocio', () => {
	const guardar = (atributos, token = tokenCliente) => {
		S.reiniciar();
		S.conTabla(() => ({ data: { id: IDS.restaurante, atributos: { nav: 'topnav' } }, error: null }));
		return S.pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`, { atributos }, token);
	};

	test('el restaurante guarda dirección, ubicación y reseñas, recortadas', async () => {
		const r = await guardar({
			direccion: '  Cra 7 # 12-34, Bogotá ',
			mapa_url: ' https://maps.app.goo.gl/abc ',
			resena_url: 'https://g.page/r/CabC123/review',
		});
		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('restaurantes').atributos;
		assert.equal(g.direccion, 'Cra 7 # 12-34, Bogotá');
		assert.equal(g.mapa_url, 'https://maps.app.goo.gl/abc');
		assert.equal(g.resena_url, 'https://g.page/r/CabC123/review');
		assert.equal(g.nav, 'topnav', 'lo demás de atributos se conserva');
	});

	test('el superadmin también', async () => {
		assert.equal((await guardar({ mapa_url: 'https://maps.app.goo.gl/abc' }, tokenAdmin)).status, 200);
	});

	test('vacío es válido: es como se quita', async () => {
		const r = await guardar({ mapa_url: '', resena_url: '', direccion: '' });
		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('restaurantes').atributos;
		assert.equal(g.mapa_url, '');
		assert.equal(g.resena_url, '');
	});

	test('solo https y solo dominios de Google, igual que antes en la bienvenida', async () => {
		// Es lo que se le pone en la mano a un desconocido: un enlace cualquiera
		// sería un botón con el nombre del restaurante que lleva adonde quiera quien lo edite.
		for (const clave of ['mapa_url', 'resena_url']) {
			for (const url of ['http://maps.app.goo.gl/abc', 'https://evil.example.com/maps', 'javascript:alert(1)', 'maps.google.com', 'https://google.com.evil.com/x']) {
				const r = await guardar({ [clave]: url });
				assert.equal(r.status, 400, `${clave}: ${url}`);
			}
		}
	});

	test('el mensaje dice de qué enlace se trata', async () => {
		assert.match((await guardar({ mapa_url: 'https://evil.example.com/' })).body?.error || '', /ubicación.*Google Maps/);
		assert.match((await guardar({ resena_url: 'https://evil.example.com/' })).body?.error || '', /reseñas.*Google/);
	});

	test('los nombres viejos siguen aceptándose mientras haya paneles con la página vieja', async () => {
		assert.equal((await guardar({ intro_mapa_url: 'https://maps.app.goo.gl/abc', intro_resena_url: 'https://g.page/r/abc/review' })).status, 200);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la bienvenida toma lo del negocio (paso 2)', () => {
	const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	const bien = fs.readFileSync(path.join(PUBLIC, 'bienvenida.js'), 'utf8');
	const sinComentarios = t => t.replace(/^\s*\/\/.*$/gm, '');

	test('la tarjeta de Datos del negocio pide dirección, ubicación y reseñas', () => {
		for (const id of ['ajNegocioDireccion', 'ajNegocioMapa', 'ajNegocioResena'])
			assert.ok(html.includes(`id="${id}"`), id);
		assert.match(html, /id="ajNegocioDireccion"[^>]*maxlength="120"/);
	});

	test('el formulario de la bienvenida ya NO los pide: dice cuál es cada uno y lleva a donde se cambia', () => {
		for (const id of ['apDireccion', 'apIntroMapaUrl', 'apIntroResenaUrl'])
			assert.ok(!html.includes(`id="${id}"`), `${id} no debería seguir en la bienvenida`);
		for (const id of ['apDireccionTexto', 'apIntroMapaUrlTexto', 'apIntroResenaUrlTexto'])
			assert.ok(html.includes(`id="${id}"`), id);
		// Los tres de siempre (dirección, mapa, reseñas) y, desde el paso 4, el horario y el correo.
		assert.equal((html.match(/irADatosDelNegocio\('/g) || []).length, 5, 'un enlace por dato');
	});

	test('los enlaces de «Cambiarlo» apuntan a campos que existen', () => {
		for (const m of html.matchAll(/irADatosDelNegocio\('(\w+)'\)/g))
			assert.ok(html.includes(`id="${m[1]}"`), `falta id="${m[1]}"`);
	});

	test('la bienvenida no escribe los datos del negocio al guardar', () => {
		// Si los dos formularios escribieran `direccion`, el último en guardar
		// pisaría al otro: justo lo que el servidor resolvió al fundir atributos.
		const valores = sinComentarios(bien.match(/function valoresBienvenida\(\) \{[\s\S]*?\n\}/)[0]);
		assert.doesNotMatch(valores, /direccion|intro_mapa_url|intro_resena_url/);
		const aspecto = sinComentarios(fs.readFileSync(path.join(PUBLIC, 'aspecto.js'), 'utf8'));
		assert.doesNotMatch(aspecto, /apDireccion/);
	});

	test('su vista previa lee lo guardado del negocio', () => {
		const ctx = vm.createContext({ String, state: { restaurante: { atributos: { direccion: 'ENVIGADO', intro_mapa_url: 'https://maps.app.goo.gl/v', resena_url: 'https://g.page/r/a/review' } } } });
		vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8'), ctx);
		assert.deepEqual(JSON.parse(JSON.stringify(ctx.datosDelNegocioParaLaVista())),
			{ direccion: 'ENVIGADO', intro_mapa_url: 'https://maps.app.goo.gl/v', intro_resena_url: 'https://g.page/r/a/review', horario_texto: '', correo: '' });
	});

	test('«Restaurar valores predeterminados» no puede vaciar los datos del negocio', () => {
		const base = sinComentarios(bien.match(/const VALORES_BIENVENIDA = \{[\s\S]*?\n\};/)[0]);
		assert.doesNotMatch(base, /direccion|intro_mapa_url|intro_resena_url/);
	});

	test('al abrir la pestaña se pintan los tres', () => {
		assert.match(bien, /pintarDatosEnBienvenida\(\)/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el horario de atención · cómo se dice (paso 4)', () => {
	// La carta lo dice con la misma función en otro repositorio.
	const ctxPanel = () => {
		const ctx = vm.createContext({ String });
		vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8'), ctx);
		return ctx;
	};

	test('hay casos que correr', () => assert.ok(CASOS.horario.length >= 10));

	for (const c of CASOS.horario) {
		test(c.nombre, () => {
			assert.equal(ctxPanel().textoHorarioAtencion(c.franjas), c.texto);
		});
	}
});

describe('el horario de atención y el correo · lo que comprueba el panel es lo que comprueba el servidor', () => {
	const ctxPanel = () => {
		const ctx = vm.createContext({ String });
		vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8'), ctx);
		return ctx;
	};
	const MALOS = [
		[{ dias: [], desde: '11:00', hasta: '22:00' }],
		[{ dias: [7], desde: '11:00', hasta: '22:00' }],
		[{ dias: [1.5], desde: '', hasta: '' }],
		[{ dias: [1], desde: '11:00', hasta: '' }],
		[{ dias: [1], desde: '', hasta: '22:00' }],
		[{ dias: [1], desde: '25:00', hasta: '22:00' }],
		[{ dias: [1], desde: '11:00', hasta: '11:00' }],
		Array.from({ length: 8 }, () => ({ dias: [1], desde: '', hasta: '' })),
	];
	const BUENOS = [
		[],
		[{ dias: [1, 2, 3], desde: '11:00', hasta: '22:00' }],
		[{ dias: [0], desde: '', hasta: '' }],
		[{ dias: [5, 6], desde: '18:00', hasta: '02:00' }],
		Array.from({ length: 7 }, () => ({ dias: [1], desde: '', hasta: '' })),
	];

	test('lo malo lo rechazan los dos', () => {
		const p = ctxPanel();
		for (const lista of MALOS) {
			assert.ok(p.errorDeHorarioAtencion(lista), 'panel: ' + JSON.stringify(lista));
			assert.ok(negocio.validarFranjas(lista).error, 'servidor: ' + JSON.stringify(lista));
		}
	});

	test('lo bueno lo aceptan los dos', () => {
		const p = ctxPanel();
		for (const lista of BUENOS) {
			assert.equal(p.errorDeHorarioAtencion(lista), null, 'panel: ' + JSON.stringify(lista));
			assert.ok(!negocio.validarFranjas(lista).error, 'servidor: ' + JSON.stringify(lista));
		}
	});

	test('el correo: lo mismo en los dos', () => {
		const p = ctxPanel();
		for (const c of ['hola@turestaurante.com', 'a.b+c@mi-sitio.co', '', '  hola@x.co  ']) {
			assert.equal(p.errorDeCorreoNegocio(c), null, c);
			assert.equal(negocio.CORREO.test(c.trim()) || c.trim() === '', true, c);
		}
		for (const c of ['hola', 'hola@', '@x.com', 'a b@x.com', 'a@x', 'a@x.c', 'a"b@x.com', '<a>@x.com', 'a@x.com,b@y.com', 'a'.repeat(121) + '@x.com']) {
			assert.ok(p.errorDeCorreoNegocio(c), 'panel: ' + c);
			assert.equal(negocio.CORREO.test(c) && c.length <= 120, false, 'servidor: ' + c);
		}
	});
});

// ═══════════════════════════════════════════════════════════════
describe('PATCH /api/restaurantes · el horario de atención y el correo', () => {
	const guardar = (atributos, token = tokenCliente) => {
		S.reiniciar();
		S.conTabla(() => ({ data: { id: IDS.restaurante, atributos: { nav: 'topnav' } }, error: null }));
		return S.pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`, { atributos }, token);
	};

	test('el restaurante guarda su horario, con los días únicos y ordenados', async () => {
		const r = await guardar({ horario_atencion: [
			{ dias: [5, 1, 1, 3], desde: '11:00', hasta: '22:00' },
			{ dias: [0, 6], desde: '', hasta: '' },
		] });
		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('restaurantes').atributos;
		assert.deepEqual(g.horario_atencion, [
			{ dias: [1, 3, 5], desde: '11:00', hasta: '22:00' },
			{ dias: [0, 6], desde: '', hasta: '' },
		]);
		assert.equal(g.nav, 'topnav', 'lo demás de atributos se conserva');
	});

	test('solo se guardan las claves de una franja: lo demás se descarta', async () => {
		await guardar({ horario_atencion: [{ dias: [1], desde: '', hasta: '', url: 'https://x', __proto__: { a: 1 } }] });
		assert.deepEqual(Object.keys(S.ultimaEscritura('restaurantes').atributos.horario_atencion[0]).sort(), ['desde', 'dias', 'hasta']);
	});

	test('el superadmin también', async () => {
		assert.equal((await guardar({ horario_atencion: [{ dias: [1], desde: '', hasta: '' }] }, tokenAdmin)).status, 200);
	});

	test('vacío o nulo es «sin horario»: es como se quita', async () => {
		for (const v of [[], null, '']) {
			const r = await guardar({ horario_atencion: v });
			assert.equal(r.status, 200);
			assert.deepEqual(S.ultimaEscritura('restaurantes').atributos.horario_atencion, []);
		}
	});

	test('lo que no es un horario se rechaza, diciendo qué falta', async () => {
		for (const [v, msg] of [
			['lunes a viernes', /no es válido/],
			[[{ dias: [] }], /al menos un día/],
			[[{ dias: [8], desde: '', hasta: '' }], /día.*no es válido/],
			[[{ dias: [1], desde: '11:00', hasta: '' }], /apertura y la de cierre/],
			[[{ dias: [1], desde: '9:00', hasta: '22:00' }], /como 11:00/],
			[[{ dias: [1], desde: '11:00', hasta: '11:00' }], /distinta/],
			[Array.from({ length: 8 }, () => ({ dias: [1] })), /hasta 7/],
		]) {
			const r = await guardar({ horario_atencion: v });
			assert.equal(r.status, 400, JSON.stringify(v));
			assert.match(r.body?.error || '', msg, JSON.stringify(v));
		}
	});

	test('el correo se guarda recortado', async () => {
		assert.equal((await guardar({ correo: '  hola@turestaurante.com ' })).status, 200);
		assert.equal(S.ultimaEscritura('restaurantes').atributos.correo, 'hola@turestaurante.com');
	});

	test('un correo que no lo parece, o que podría romper un enlace, se rechaza', async () => {
		for (const c of ['hola', 'a b@x.com', 'a"b@x.com', '<a>@x.com', 'javascript:alert(1)', 'a@x.com,b@y.com']) {
			const r = await guardar({ correo: c });
			assert.equal(r.status, 400, c);
			assert.match(r.body?.error || '', /correo/);
		}
	});

	test('vacío es válido: es como se quita el correo', async () => {
		assert.equal((await guardar({ correo: '' })).status, 200);
	});

	test('los interruptores de la bienvenida se guardan como booleano de verdad', async () => {
		await guardar({ intro_horario_activo: 'false', intro_correo_activo: true });
		const g = S.ultimaEscritura('restaurantes').atributos;
		assert.equal(g.intro_horario_activo, false, 'el texto «false» es verdadero para cualquier if');
		assert.equal(g.intro_correo_activo, true);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el editor del horario (horario-atencion.js)', () => {
	// Un DOM de juguete: solo lo que el editor toca.
	function nodo(etiqueta) {
		const n = {
			etiqueta, hijos: [], className: '', textContent: '', style: {}, value: '', checked: false, disabled: false, type: '',
			title: '', onclick: null, atributos: {}, escuchas: {},
			setAttribute(k, v) { this.atributos[k] = v; },
			addEventListener(ev, f) { this.escuchas[ev] = f; },
			appendChild(h) { this.hijos.push(h); return h; },
			append(...xs) { for (const x of xs) this.hijos.push(x); },
			replaceChildren() { this.hijos = []; },
		};
		return n;
	}
	function montar(franjas = []) {
		const ids = {};
		const $ = id => (ids[id] ||= nodo('#' + id));
		const ctx = vm.createContext({
			document: { getElementById: $, createElement: nodo },
			DIAS_CORTOS: ['D', 'L', 'M', 'X', 'J', 'V', 'S'], DIAS_LARGOS: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
			opcionesDeHora: () => { const o = []; for (let m = 0; m < 1440; m += 30) o.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')); return o; },
			String, Set, Array, Number,
		});
		vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8'), ctx);
		vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'horario-atencion.js'), 'utf8'), ctx);
		vm.runInContext('franjasEnEdicion = ' + JSON.stringify(franjas), ctx);
		return { ctx, $ };
	}
	const todos = (n, sal = []) => { sal.push(n); for (const h of n.hijos || []) if (h && typeof h === 'object') todos(h, sal); return sal; };
	const fichas = (n) => todos(n).filter(x => x.className?.startsWith('cat-chip'));
	const dias = (ctx) => vm.runInContext('JSON.stringify(franjasEnEdicion.map(f => f.dias))', ctx);

	test('dibuja una fila por franja, con siete fichas de días', () => {
		const { ctx, $ } = montar([{ dias: [1, 2], desde: '11:00', hasta: '22:00' }, { dias: [0], desde: '', hasta: '' }]);
		ctx.renderHorarioAtencion();
		const filas = $('ajHorarioFranjas').hijos;
		assert.equal(filas.length, 2);
		assert.equal(fichas(filas[0]).length, 7);
		assert.equal(fichas(filas[0]).filter(f => f.className.includes('active')).length, 2, 'lunes y martes marcados');
		assert.deepEqual(fichas(filas[0]).map(f => f.textContent), ['L', 'M', 'X', 'J', 'V', 'S', 'D'], 'de lunes a domingo');
	});

	test('pulsar una ficha marca o desmarca el día', () => {
		const { ctx, $ } = montar([{ dias: [1], desde: '11:00', hasta: '22:00' }]);
		ctx.renderHorarioAtencion();
		fichas($('ajHorarioFranjas').hijos[0]).find(f => f.title === 'martes').onclick();
		assert.equal(dias(ctx), '[[1,2]]');
		fichas($('ajHorarioFranjas').hijos[0]).find(f => f.title === 'lunes').onclick();
		assert.equal(dias(ctx), '[[2]]');
	});

	test('«Añadir un horario»: la primera franja es de lunes a viernes; las siguientes, los días que faltan', () => {
		const { ctx } = montar([]);
		ctx.renderHorarioAtencion();
		ctx.agregarFranjaDeAtencion();
		assert.equal(dias(ctx), '[[1,2,3,4,5]]');
		ctx.agregarFranjaDeAtencion();
		assert.equal(dias(ctx), '[[1,2,3,4,5],[6,0]]');
	});

	test('no deja pasar de siete franjas', () => {
		const { ctx, $ } = montar([]);
		for (let i = 0; i < 12; i++) ctx.agregarFranjaDeAtencion();
		assert.equal(vm.runInContext('franjasEnEdicion.length', ctx), 7);
		assert.equal($('ajHorarioAgregar').disabled, true);
	});

	test('«Todo el día» borra las horas, y quitarlo ofrece una franja corriente', () => {
		const { ctx, $ } = montar([{ dias: [1], desde: '11:00', hasta: '22:00' }]);
		ctx.renderHorarioAtencion();
		const caja = () => todos($('ajHorarioFranjas').hijos[0]).find(x => x.type === 'checkbox');
		caja().checked = true; caja().escuchas.change();
		assert.equal(vm.runInContext('JSON.stringify(franjasEnEdicion[0])', ctx), '{"dias":[1],"desde":"","hasta":""}');
		assert.equal(todos($('ajHorarioFranjas').hijos[0]).filter(x => x.etiqueta === 'select').length, 0, 'sin selectores de hora');
		caja().checked = false; caja().escuchas.change();
		assert.equal(vm.runInContext('JSON.stringify(franjasEnEdicion[0])', ctx), '{"dias":[1],"desde":"11:00","hasta":"22:00"}');
		assert.equal(todos($('ajHorarioFranjas').hijos[0]).filter(x => x.etiqueta === 'select').length, 2);
	});

	test('cambiar una hora la guarda en la copia de trabajo', () => {
		const { ctx, $ } = montar([{ dias: [1], desde: '11:00', hasta: '22:00' }]);
		ctx.renderHorarioAtencion();
		const sel = todos($('ajHorarioFranjas').hijos[0]).filter(x => x.etiqueta === 'select');
		sel[1].value = '23:30'; sel[1].escuchas.change();
		assert.equal(vm.runInContext('franjasEnEdicion[0].hasta', ctx), '23:30');
	});

	test('una hora guardada fuera de la rejilla no desaparece del selector', () => {
		// De otra versión o escrita a mano: abrir y guardar sin tocar nada no puede cambiar el horario.
		const { ctx, $ } = montar([{ dias: [1], desde: '11:15', hasta: '22:00' }]);
		ctx.renderHorarioAtencion();
		const abre = todos($('ajHorarioFranjas').hijos[0]).filter(x => x.etiqueta === 'select')[0];
		assert.ok(abre.hijos.some(o => o.value === '11:15'));
		assert.equal(abre.value, '11:15');
	});

	test('«Quitar» saca la franja', () => {
		const { ctx, $ } = montar([{ dias: [1], desde: '', hasta: '' }, { dias: [2], desde: '', hasta: '' }]);
		ctx.renderHorarioAtencion();
		todos($('ajHorarioFranjas').hijos[0]).find(x => x.className?.includes('horario-quitar')).onclick();
		assert.equal(dias(ctx), '[[2]]');
	});

	test('el resumen dice cómo lo leerá el cliente, o qué falta', () => {
		const { ctx, $ } = montar([{ dias: [1, 2, 3, 4, 5], desde: '11:00', hasta: '22:00' }]);
		ctx.renderHorarioAtencion();
		assert.equal($('ajHorarioResumen').textContent, 'Tus clientes leen: Lun a Vie 11:00–22:00');
		vm.runInContext('franjasEnEdicion = []', ctx); ctx.renderHorarioAtencion();
		assert.match($('ajHorarioResumen').textContent, /Sin horario/);
		vm.runInContext('franjasEnEdicion = [{ dias: [], desde: "", hasta: "" }]', ctx); ctx.renderHorarioAtencion();
		assert.match($('ajHorarioResumen').textContent, /no tiene días/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Ajustes y la bienvenida con el horario y el correo (paso 4)', () => {
	const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	const bien = fs.readFileSync(path.join(PUBLIC, 'bienvenida.js'), 'utf8');

	test('la pantalla tiene todo lo que usa', () => {
		for (const id of ['ajNegocioCorreo', 'ajHorarioBloque', 'ajHorarioFranjas', 'ajHorarioAgregar', 'ajHorarioResumen',
			'apIntroHorarioActivo', 'apIntroCorreoActivo', 'apHorarioTexto', 'apCorreoTexto', 'apIntroPreviewHorario', 'apIntroPreviewCorreo'])
			assert.ok(html.includes(`id="${id}"`), id);
		assert.match(html, /id="ajNegocioCorreo"[^>]*type="email"|type="email"[^>]*id="ajNegocioCorreo"/);
	});

	test('horario-atencion.js se carga después de negocio.js y antes que el script principal', () => {
		const a = html.indexOf('<script src="negocio.js">'), b = html.indexOf('<script src="horario-atencion.js">');
		assert.ok(a > -1 && b > a);
		assert.ok(b < html.indexOf('<script src="ajustes.js">'));
	});

	test('el correo y el horario viajan con lo demás de Ajustes', () => {
		const neg = fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8');
		const recoger = neg.match(/function recolectarDatosNegocio\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(recoger, /correo:/);
		assert.match(recoger, /horario_atencion: franjasNormalizadas\(franjasEnEdicion\)/);
	});

	test('la bienvenida guarda SOLO los interruptores, no el horario ni el correo', () => {
		const valores = bien.match(/function valoresBienvenida\(\) \{[\s\S]*?\n\}/)[0].replace(/^\s*\/\/.*$/gm, '');
		assert.match(valores, /intro_horario_activo:/);
		assert.match(valores, /intro_correo_activo:/);
		assert.doesNotMatch(valores, /horario_atencion|\bcorreo:/);
	});

	test('los dos interruptores nacen encendidos: ausente es encendido', () => {
		const base = bien.match(/const VALORES_BIENVENIDA = \{[\s\S]*?\n\};/)[0];
		assert.match(base, /intro_horario_activo: true, intro_correo_activo: true/);
		assert.match(bien, /marcar\('apIntroHorarioActivo', datos\.intro_horario_activo !== false\)/);
	});

	test('la vista previa de la bienvenida enseña las dos líneas con el estilo de la dirección', () => {
		assert.match(bien, /horario: 'apIntroPreviewHorario', correo: 'apIntroPreviewCorreo'/);
		assert.match(bien, /tipo === 'horario' \|\| tipo === 'correo' \? 'direccion' : tipo/);
	});

	test('el servidor deja escribir las claves nuevas al restaurante', () => {
		const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
		const lista = servidor.match(/const ATRIBUTOS_CLIENTE_PERMITIDOS = \[[\s\S]*?\];/)[0];
		for (const clave of ['horario_atencion', 'correo', 'intro_horario_activo', 'intro_correo_activo'])
			assert.ok(lista.includes("'" + clave + "'"), clave);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('PATCH /api/restaurantes · el WhatsApp del negocio', () => {
	const guardar = (atributos, token = tokenCliente) => {
		S.reiniciar();
		S.conTabla(() => ({ data: { id: IDS.restaurante, atributos: { nav: 'topnav' } }, error: null }));
		return S.pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`, { atributos }, token);
	};

	test('el restaurante lo guarda, y se queda con los dígitos', async () => {
		const r = await guardar({ whatsapp_negocio: '+57 318 526 7015', whatsapp_boton: true });
		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('restaurantes').atributos;
		assert.equal(g.whatsapp_negocio, '573185267015');
		assert.equal(g.whatsapp_boton, true);
		assert.equal(g.nav, 'topnav', 'lo demás de atributos se conserva');
	});

	test('el superadmin también', async () => {
		const r = await guardar({ whatsapp_negocio: '573185267015' }, tokenAdmin);
		assert.equal(r.status, 200);
	});

	test('vacío es válido: es como se quita el número', async () => {
		const r = await guardar({ whatsapp_negocio: '' });
		assert.equal(r.status, 200);
		assert.equal(S.ultimaEscritura('restaurantes').atributos.whatsapp_negocio, '');
	});

	test('un número demasiado corto o largo se rechaza, diciendo qué falta', async () => {
		for (const n of ['3001', '1234567', '1234567890123456']) {
			const r = await guardar({ whatsapp_negocio: n });
			assert.equal(r.status, 400, n);
			assert.match(r.body?.error || '', /código de país/);
		}
	});

	test('el botón se guarda como booleano de verdad', async () => {
		// El texto «false» es verdadero para cualquier if.
		await guardar({ whatsapp_negocio: '573185267015', whatsapp_boton: 'false' });
		assert.equal(S.ultimaEscritura('restaurantes').atributos.whatsapp_boton, false);
		await guardar({ whatsapp_boton: 'true' });
		assert.equal(S.ultimaEscritura('restaurantes').atributos.whatsapp_boton, false, '«true» de texto tampoco lo enciende');
	});

	test('las claves viejas se siguen aceptando mientras haya paneles con la página vieja', async () => {
		const r = await guardar({ whatsapp_pedidos: '573185267015', social_whatsapp: '573185267015' });
		assert.equal(r.status, 200);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('POST /api/pedidos-publicos · quién recibe pedidos', () => {
	// La puerta pública de los pedidos decide con la MISMA regla que el panel y la
	// carta: si dijera otra cosa, la carta dejaría armar un pedido que el servidor
	// rechaza —o al revés—.
	const pedido = {
		restaurante_id: IDS.restaurante, cliente_nombre: 'Ana', cliente_telefono: '3001112233',
		tipo_entrega: 'recoger', metodo_pago: 'Efectivo', total_reportado: 20000,
		items: [{ producto_id: IDS.producto, nombre: 'Arepa', cantidad: 1, precio_unitario: 20000 }],
	};
	const enviar = (atributos) => {
		S.reiniciar();
		S.conTabla(st => st.tabla === 'restaurantes' && st.op === 'select'
			? { data: { id: IDS.restaurante, activo: true, atributos }, error: null }
			: { data: null, error: null });
		return S.pedir('POST', '/api/pedidos-publicos', pedido);
	};

	test('con el WhatsApp del negocio, recibe', async () => {
		assert.equal((await enviar({ carrito: true, whatsapp_negocio: '573185267015' })).status, 201);
	});

	test('con solo el número viejo de pedidos, también (mientras dure la transición)', async () => {
		assert.equal((await enviar({ carrito: true, whatsapp_pedidos: '573185267015' })).status, 201);
	});

	test('sin número no recibe', async () => {
		const r = await enviar({ carrito: true });
		assert.equal(r.status, 400);
		assert.match(r.body?.error || '', /no recibe pedidos/);
	});

	test('si borró el número, el viejo no lo resucita', async () => {
		const r = await enviar({ carrito: true, whatsapp_negocio: '', whatsapp_pedidos: '573185267015' });
		assert.equal(r.status, 400);
	});

	test('sin carrito no recibe, aunque tenga número', async () => {
		assert.equal((await enviar({ carrito: false, whatsapp_negocio: '573185267015' })).status, 400);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la pantalla de Ajustes', () => {
	const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('negocio.js se carga antes que ajustes.js', () => {
		const i = html.indexOf('<script src="negocio.js">');
		assert.ok(i > -1);
		assert.ok(i < html.indexOf('<script src="ajustes.js">'));
	});

	test('cada id que usa negocio.js existe en la pantalla', () => {
		const js = fs.readFileSync(path.join(PUBLIC, 'negocio.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
		const ids = new Set([...js.matchAll(/getElementById\('(\w+)'\)/g)].map(m => m[1]));
		assert.ok(ids.size >= 3);
		for (const id of ids) assert.ok(html.includes(`id="${id}"`), `falta id="${id}" en index.html`);
	});

	test('el WhatsApp se pide una sola vez', () => {
		// Estaba en la tarjeta del carrito y en la de redes.
		assert.equal((html.match(/type="(?:tel|text)"[^>]*id="(?:ajNegocioWhatsapp|pedidosWhatsapp|ajSocialWhatsapp)"/g) || []).length, 1);
		assert.ok(!html.includes('id="ajSocialWhatsapp"') && !html.includes('id="pedidosWhatsapp"'));
	});
});
