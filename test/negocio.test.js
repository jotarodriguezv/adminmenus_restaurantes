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
		assert.equal((html.match(/irADatosDelNegocio\('/g) || []).length, 3, 'un enlace por dato');
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
			{ direccion: 'ENVIGADO', intro_mapa_url: 'https://maps.app.goo.gl/v', intro_resena_url: 'https://g.page/r/a/review' });
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
