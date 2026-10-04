// Los pedidos del carrito con sedes (sql/40, docs/sedes.md §14): por HTTP contra el server.js
// de verdad y un Supabase simulado.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const S = require('./helpers/servidor.js');
const { pedir, llamadas, reiniciar, conTabla, ultimaEscritura, IDS } = S;

const PIE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APAGADA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const pedido = (extra = {}) => ({
	restaurante_id: IDS.restaurante, cliente_nombre: 'Ana', cliente_telefono: '3001112233',
	tipo_entrega: 'recoger', metodo_pago: 'Efectivo', total_reportado: 26000,
	items: [{ producto_id: IDS.producto, nombre: 'Burger', cantidad: 1, precio_unitario: 26000 }], ...extra,
});
const sedes = (propios = {}) => [
	{ id: PIE, nombre: 'Piedecuesta', activa: true, atributos: propios.pie ?? {} },
	{ id: BUC, nombre: 'Bucaramanga', activa: true, atributos: propios.buc ?? {} },
	{ id: APAGADA, nombre: 'Cerrada', activa: false, atributos: { whatsapp_negocio: '573009999999' } },
];
const inserciones = () => llamadas.filter(l => l.tabla === 'pedidos_carta' && l.op === 'insert');

// Un restaurante con carrito, y —según se pida— con sedes.
function conMundo({ atributos = { whatsapp_negocio: '573001112233' }, con_sedes = true, lista = sedes(), errorSedes = false } = {}) {
	conTabla(st => {
		if (st.tabla === 'restaurantes') return { data: { id: IDS.restaurante, activo: true, atributos: { carrito: true, ...atributos, ...(con_sedes ? { con_sedes: true } : {}) } }, error: null };
		if (st.tabla === 'sedes') return errorSedes ? { data: null, error: { message: 'boom' } } : { data: lista, error: null };
		return { data: null, error: null };
	});
}

beforeEach(() => reiniciar());

describe('POST /api/pedidos-publicos · la sede', () => {
	test('con sedes, un pedido a una sede activa se guarda con su id y su nombre', async () => {
		conMundo();
		const r = await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }));
		assert.equal(r.status, 201);
		const g = ultimaEscritura('pedidos_carta');
		assert.equal(g.sede_id, BUC);
		assert.equal(g.sede_nombre, 'Bucaramanga');
		assert.equal(g.restaurante_id, IDS.restaurante);
	});

	test('con sedes, sin sede no se guarda: el pedido tiene que decir para qué local es', async () => {
		conMundo();
		const r = await pedir('POST', '/api/pedidos-publicos', pedido());
		assert.equal(r.status, 400);
		assert.match(r.body.error, /sede/i);
		assert.equal(inserciones().length, 0);
	});

	test('una sede apagada, ajena, inexistente o mal formada se rechaza', async () => {
		for (const sede_id of [APAGADA, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'no-es-uuid', 12345, '', null]) {
			reiniciar(); conMundo();
			const r = await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id }));
			assert.equal(r.status, 400, String(sede_id));
		}
		assert.equal(inserciones().length, 0);
	});

	test('sin el interruptor «Varias sedes», el campo se ignora y el pedido es el de siempre', async () => {
		conMundo({ con_sedes: false });
		const r = await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }));
		assert.equal(r.status, 201);
		const g = ultimaEscritura('pedidos_carta');
		assert.equal('sede_id' in g, false, 'sin sedes ni siquiera viajan las columnas nuevas');
		assert.equal('sede_nombre' in g, false);
	});

	test('con el interruptor encendido pero ninguna sede activa, tampoco se exige', async () => {
		conMundo({ lista: [{ id: APAGADA, nombre: 'Cerrada', activa: false, atributos: {} }] });
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido())).status, 201);
	});

	test('si no se pueden leer las sedes, 500 y nada guardado', async () => {
		conMundo({ errorSedes: true });
		const r = await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }));
		assert.equal(r.status, 500);
		assert.equal(inserciones().length, 0);
	});
});

describe('POST /api/pedidos-publicos · el WhatsApp que cuenta es el de la sede', () => {
	test('con un número por sede y el del restaurante VACÍO, el pedido se registra', async () => {
		// El caso real: dos locales, cada uno con su WhatsApp, y nada en el general. Comprobar el general
		// rechazaba todos los pedidos en silencio.
		conMundo({ atributos: {}, lista: sedes({ pie: { whatsapp_negocio: '573001111111' }, buc: { whatsapp_negocio: '573002222222' } }) });
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }))).status, 201);
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: PIE }))).status, 201);
	});

	test('una sede sin número y sin número general: ESA sede no recibe, la otra sí', async () => {
		conMundo({ atributos: {}, lista: sedes({ pie: { whatsapp_negocio: '573001111111' }, buc: {} }) });
		const buc = await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }));
		assert.equal(buc.status, 400);
		assert.match(buc.body.error, /no recibe pedidos/);
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: PIE }))).status, 201);
	});

	test('una sede sin el suyo hereda el del restaurante', async () => {
		conMundo({ atributos: { whatsapp_negocio: '573009998877' }, lista: sedes() });
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }))).status, 201);
	});

	test("un '' de la sede es «no hay» y NO hereda el del restaurante", async () => {
		conMundo({ atributos: { whatsapp_negocio: '573009998877' }, lista: sedes({ buc: { whatsapp_negocio: '' } }) });
		const r = await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }));
		assert.equal(r.status, 400, 'mandaría el pedido de un local al teléfono de otro');
	});

	test('sin sedes, sigue mandando el número del restaurante', async () => {
		conMundo({ con_sedes: false, atributos: {} });
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido())).status, 400);
		reiniciar(); conMundo({ con_sedes: false });
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido())).status, 201);
	});

	test('el carrito apagado sigue rechazando, con sedes o sin ellas', async () => {
		conTabla(st => st.tabla === 'restaurantes'
			? { data: { id: IDS.restaurante, activo: true, atributos: { carrito: false, con_sedes: true, whatsapp_negocio: '573001112233' } }, error: null }
			: { data: sedes(), error: null });
		assert.equal((await pedir('POST', '/api/pedidos-publicos', pedido({ sede_id: BUC }))).status, 400);
	});
});
