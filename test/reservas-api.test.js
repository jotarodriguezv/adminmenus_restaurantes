// Las rutas de las reservas, por HTTP contra el server.js de verdad y un
// Supabase simulado. El tope por IP (10 por hora) se sube aquí para poder hacer
// muchas peticiones; el tope en sí se prueba aparte, en reservas-limite.test.js.
process.env.RESERVAS_MAX_POR_HORA = "1000";
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const S = require('./helpers/servidor.js');
const { pedir, llamadas, ultimaEscritura, reiniciar, conTabla, tokenCliente, tokenAdmin, IDS } = S;

const OTRO = '77777777-7777-4777-8777-777777777777';
const RESERVA = '88888888-8888-4888-8888-888888888888';
const manana = () => new Date(Date.now() + 36 * 3600e3).toISOString().slice(0, 10);
// Abierta hace un minuto: pasa la comprobación de tiempo.
const buena = (extra = {}) => ({
	restaurante_id: IDS.restaurante, nombre: 'Ana', celular: '300 123 4567', fecha: manana(), hora: '19:30', personas: 4,
	abierto_en: Date.now() - 60_000, ...extra,
});
const inserciones = () => llamadas.filter(l => l.tabla === 'reservas' && l.op === 'insert');
const conReservas = (atributos = { intro_reservas_activo: true }, { activo = true, pendientes = 0 } = {}) =>
	conTabla(st => {
		if (st.tabla === 'restaurantes') return { data: { id: IDS.restaurante, activo, atributos }, error: null };
		if (st.tabla === 'reservas' && st.op === 'select') return { data: null, count: pendientes, error: null };
		return { data: null, error: null };
	});

beforeEach(() => reiniciar());

describe('POST /api/reservas · el comensal', () => {
	test('una buena se guarda con el celular normalizado, sin pedir sesión', async () => {
		conReservas();
		const r = await pedir('POST', '/api/reservas', buena());
		assert.equal(r.status, 201);
		const g = ultimaEscritura('reservas');
		assert.equal(g.restaurante_id, IDS.restaurante);
		assert.equal(g.celular, '573001234567');
		assert.equal(g.personas, 4);
		assert.equal(g.estado, undefined, 'el estado lo pone la base: pendiente');
	});

	test('un robot recibe «ok» y no se guarda nada', async () => {
		conReservas();
		for (const cuerpo of [buena({ sitio_web: 'spam' }), buena({ abierto_en: Date.now() })]) {
			const r = await pedir('POST', '/api/reservas', cuerpo);
			assert.equal(r.status, 201);
		}
		assert.equal(inserciones().length, 0);
	});

	test('si el restaurante no las tiene encendidas, 400 y nada guardado', async () => {
		for (const atributos of [{}, { intro_reservas_activo: false }, { intro_reservas_activo: 'true' }]) {
			reiniciar(); conReservas(atributos);
			const r = await pedir('POST', '/api/reservas', buena());
			assert.equal(r.status, 400, JSON.stringify(atributos));
			assert.equal(inserciones().length, 0);
		}
	});

	test('un restaurante suspendido no recibe reservas', async () => {
		conReservas({ intro_reservas_activo: true }, { activo: false });
		assert.equal((await pedir('POST', '/api/reservas', buena())).status, 400);
		assert.equal(inserciones().length, 0);
	});

	test('un restaurante que no existe, o un id que no es UUID, no llega a la base', async () => {
		conTabla(() => ({ data: null, error: null }));
		assert.equal((await pedir('POST', '/api/reservas', buena())).status, 400);
		reiniciar();
		assert.equal((await pedir('POST', '/api/reservas', buena({ restaurante_id: 'no-es-uuid' }))).status, 400);
		assert.equal(llamadas.length, 0);
	});

	test('datos malos: 400 con el motivo y nada guardado', async () => {
		conReservas();
		const casos = [[{ nombre: '' }, /nombre/], [{ celular: '12' }, /celular/], [{ fecha: '2020-01-01' }, /ya pasó/], [{ hora: '99:99' }, /hora/], [{ personas: 0 }, /personas/]];
		for (const [extra, motivo] of casos) {
			const r = await pedir('POST', '/api/reservas', buena(extra));
			assert.equal(r.status, 400, JSON.stringify(extra));
			assert.match(r.body.error, motivo);
		}
		assert.equal(inserciones().length, 0);
	});

	test('no se puede meter un estado ni un id por el cuerpo', async () => {
		conReservas();
		const r = await pedir('POST', '/api/reservas', buena({ estado: 'confirmada', id: RESERVA, creado_en: '2000-01-01' }));
		assert.equal(r.status, 201);
		const g = ultimaEscritura('reservas');
		assert.deepEqual(Object.keys(g).sort(), ['celular', 'fecha', 'hora', 'nombre', 'personas', 'restaurante_id']);
	});

	test('con tres pendientes del mismo celular, 429 y nada guardado', async () => {
		conReservas({ intro_reservas_activo: true }, { pendientes: 3 });
		const r = await pedir('POST', '/api/reservas', buena());
		assert.equal(r.status, 429);
		assert.equal(inserciones().length, 0);
	});

	test('si la base falla al guardar, 500 sin enseñar el error de Postgres', async () => {
		conTabla(st => {
			if (st.tabla === 'restaurantes') return { data: { id: IDS.restaurante, activo: true, atributos: { intro_reservas_activo: true } }, error: null };
			if (st.op === 'insert') return { data: null, error: { message: 'duplicate key value violates constraint reservas_pkey' } };
			return { data: null, count: 0, error: null };
		});
		const r = await pedir('POST', '/api/reservas', buena());
		assert.equal(r.status, 500);
		assert.ok(!/constraint|pkey/.test(JSON.stringify(r.body)));
	});
});

describe('GET y PATCH /api/reservas · el panel', () => {
	test('sin sesión, 401', async () => {
		assert.equal((await pedir('GET', `/api/reservas?restaurante_id=${IDS.restaurante}`)).status, 401);
		assert.equal((await pedir('PATCH', `/api/reservas/${RESERVA}`, { estado: 'confirmada' })).status, 401);
	});

	test('un restaurante lista las suyas y no las de otro', async () => {
		conTabla(() => ({ data: [{ id: RESERVA }], error: null }));
		const r = await pedir('GET', `/api/reservas?restaurante_id=${IDS.restaurante}`, undefined, tokenCliente);
		assert.equal(r.status, 200);
		assert.equal(llamadas.find(l => l.tabla === 'reservas').filtros.restaurante_id, IDS.restaurante);
		assert.equal((await pedir('GET', `/api/reservas?restaurante_id=${OTRO}`, undefined, tokenCliente)).status, 403);
		assert.equal((await pedir('GET', '/api/reservas', undefined, tokenCliente)).status, 403);
	});

	test('el superadmin puede ver las de cualquiera', async () => {
		conTabla(() => ({ data: [], error: null }));
		assert.equal((await pedir('GET', `/api/reservas?restaurante_id=${OTRO}`, undefined, tokenAdmin)).status, 200);
	});

	test('confirmar y cancelar: solo estados que existen', async () => {
		conTabla(st => st.op === 'select' ? { data: { restaurante_id: IDS.restaurante }, error: null } : { data: null, error: null });
		for (const estado of ['confirmada', 'cancelada', 'pendiente']) {
			const r = await pedir('PATCH', `/api/reservas/${RESERVA}`, { estado }, tokenCliente);
			assert.equal(r.status, 200, estado);
			assert.equal(ultimaEscritura('reservas').estado, estado);
		}
		assert.equal((await pedir('PATCH', `/api/reservas/${RESERVA}`, { estado: 'borrada' }, tokenCliente)).status, 400);
		assert.equal((await pedir('PATCH', '/api/reservas/no-uuid', { estado: 'confirmada' }, tokenCliente)).status, 400);
	});

	test('no se toca la reserva de otro restaurante', async () => {
		conTabla(st => st.op === 'select' ? { data: { restaurante_id: OTRO }, error: null } : { data: null, error: null });
		const r = await pedir('PATCH', `/api/reservas/${RESERVA}`, { estado: 'confirmada' }, tokenCliente);
		assert.equal(r.status, 403);
		assert.equal(llamadas.filter(l => l.tabla === 'reservas' && l.op === 'update').length, 0);
	});
});
