// Reservas por sede (sql/38, docs/sedes.md §10): por HTTP contra el server.js de verdad
// y un Supabase simulado. El tope por IP se sube para poder hacer muchas peticiones.
process.env.RESERVAS_MAX_POR_HORA = '1000';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const S = require('./helpers/servidor.js');
const R = require('../reservas.js');
const { pedir, llamadas, reiniciar, conTabla, ultimaEscritura, IDS } = S;

const PIE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APAGADA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const manana = () => new Date(Date.now() + 36 * 3600e3).toISOString().slice(0, 10);
const buena = (extra = {}) => ({
	restaurante_id: IDS.restaurante, nombre: 'Ana', celular: '300 123 4567', fecha: manana(), hora: '19:30', personas: 4,
	abierto_en: Date.now() - 60_000, ...extra,
});
const SEDES = [
	{ id: PIE, nombre: 'Piedecuesta', activa: true },
	{ id: BUC, nombre: 'Bucaramanga', activa: true },
	{ id: APAGADA, nombre: 'Cerrada', activa: false },
];
const inserciones = () => llamadas.filter(l => l.tabla === 'reservas' && l.op === 'insert');

// Un restaurante con las reservas encendidas y, según se pida, con sedes.
function conMundo({ con_sedes = true, sedes = SEDES, errorSedes = false } = {}) {
	conTabla(st => {
		if (st.tabla === 'restaurantes') return { data: { id: IDS.restaurante, activo: true, atributos: { intro_reservas_activo: true, ...(con_sedes ? { con_sedes: true } : {}) } }, error: null };
		if (st.tabla === 'sedes') return errorSedes ? { data: null, error: { message: 'boom' } } : { data: sedes, error: null };
		if (st.tabla === 'reservas' && st.op === 'select') return { data: null, count: 0, error: null };
		return { data: null, error: null };
	});
}

beforeEach(() => reiniciar());

describe('POST /api/reservas · la sede', () => {
	test('con sedes, una reserva a una sede activa se guarda con su id y su nombre', async () => {
		conMundo();
		const r = await pedir('POST', '/api/reservas', buena({ sede_id: BUC }));
		assert.equal(r.status, 201);
		const g = ultimaEscritura('reservas');
		assert.equal(g.sede_id, BUC);
		assert.equal(g.sede_nombre, 'Bucaramanga');
		assert.equal(g.restaurante_id, IDS.restaurante);
	});

	test('con sedes, sin sede no se guarda: la reserva tiene que decir para qué local es', async () => {
		conMundo();
		const r = await pedir('POST', '/api/reservas', buena());
		assert.equal(r.status, 400);
		assert.match(r.body.error, /sede/i);
		assert.equal(inserciones().length, 0);
	});

	test('una sede apagada, ajena, inexistente o mal formada se rechaza', async () => {
		for (const sede_id of [APAGADA, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'no-es-uuid', 12345, '', null]) {
			reiniciar(); conMundo();
			const r = await pedir('POST', '/api/reservas', buena({ sede_id }));
			assert.equal(r.status, 400, String(sede_id));
		}
		assert.equal(inserciones().length, 0);
	});

	test('sin el interruptor «Varias sedes», el campo se ignora y la reserva es la de siempre', async () => {
		conMundo({ con_sedes: false });
		const r = await pedir('POST', '/api/reservas', buena({ sede_id: BUC }));
		assert.equal(r.status, 201);
		const g = ultimaEscritura('reservas');
		assert.equal('sede_id' in g, false, 'sin sedes, ni siquiera viajan las columnas nuevas');
		assert.equal('sede_nombre' in g, false);
	});

	test('con el interruptor encendido pero ninguna sede activa, tampoco se exige', async () => {
		conMundo({ sedes: [{ id: APAGADA, nombre: 'Cerrada', activa: false }] });
		const r = await pedir('POST', '/api/reservas', buena());
		assert.equal(r.status, 201);
		assert.equal('sede_id' in ultimaEscritura('reservas'), false);
	});

	test('si no se pueden leer las sedes, 500 y nada guardado (no se adivina)', async () => {
		conMundo({ errorSedes: true });
		const r = await pedir('POST', '/api/reservas', buena({ sede_id: BUC }));
		assert.equal(r.status, 500);
		assert.equal(inserciones().length, 0);
	});

	test('una reserva con datos malos se rechaza antes de mirar las sedes', async () => {
		conMundo();
		const r = await pedir('POST', '/api/reservas', buena({ sede_id: BUC, nombre: '' }));
		assert.equal(r.status, 400);
		assert.equal(llamadas.filter(l => l.tabla === 'sedes').length, 0, 'no se gasta una consulta en lo que ya iba a fallar');
	});
});

describe('el mensaje al comensal nombra la sede', () => {
	const r = { nombre: 'Ana', fecha: '2026-10-05', hora: '19:30:00', personas: 4, estado: 'confirmada', celular: '573001234567' };

	test('con sede: «en Enchulados (Bucaramanga)»', () => {
		assert.match(R.mensajeParaElComensal({ ...r, sede_nombre: 'Bucaramanga' }, 'Enchulados'), /tu reserva en Enchulados \(Bucaramanga\) está confirmada/);
		assert.match(R.mensajeParaElComensal({ ...r, sede_nombre: 'Bucaramanga', estado: 'cancelada' }, 'Enchulados'), /reserva en Enchulados \(Bucaramanga\) para el/);
	});

	test('sin sede, el mensaje es exactamente el de siempre', () => {
		assert.equal(R.mensajeParaElComensal(r, 'Bonzas'), 'Hola Ana, tu reserva en Bonzas está confirmada: 05/10/2026 a las 19:30, para 4 personas. ¡Te esperamos!');
		assert.equal(R.mensajeParaElComensal({ ...r, sede_nombre: null }, 'Bonzas'), R.mensajeParaElComensal(r, 'Bonzas'));
	});
});
