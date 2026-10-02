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
