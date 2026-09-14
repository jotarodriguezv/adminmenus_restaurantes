// PATCH /api/mi-pin: el cliente cambia su propio PIN (CL3 en docs/revision-ux.md).
//
// Archivo aparte a propósito: el límite de intentos cuenta por IP y todas las
// pruebas salen de 127.0.0.1. Cada archivo corre en su propio proceso, así que
// aquí el contador empieza a cero y no se mezcla con el de api.test.js.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const S = require('./helpers/servidor.js');

const { IDS, tokenCliente, tokenAdmin } = S;
const HASH_1234 = bcrypt.hashSync('1234', 4);

beforeEach(() => {
	S.reiniciar();
	S.conTabla(st => (st.tabla === 'restaurantes_privado' && st.op === 'select'
		? { data: { pin_hash: HASH_1234 }, error: null }
		: { data: null, error: null }));
});

const cambiar = (cuerpo, token = tokenCliente) => S.pedir('PATCH', '/api/mi-pin', cuerpo, token);

describe('PATCH /api/mi-pin · el cliente cambia su PIN', () => {
	test('con el PIN actual bueno guarda el nuevo, cifrado y en SU restaurante', async () => {
		const r = await cambiar({ actual: '1234', nuevo: ' 5678 ' });
		assert.equal(r.status, 200);
		const w = S.llamadas.find(l => l.tabla === 'restaurantes_privado' && l.op === 'update');
		assert.ok(w, 'no escribió el PIN');
		assert.equal(w.filtros.restaurante_id, IDS.restaurante);
		assert.notEqual(w.payload.pin_hash, '5678', 'el PIN no puede guardarse en claro');
		assert.ok(bcrypt.compareSync('5678', w.payload.pin_hash), 'el nuevo se guarda sin los espacios');
	});

	test('con el PIN actual equivocado no escribe nada', async () => {
		const r = await cambiar({ actual: '0000', nuevo: '5678' });
		// 403 y no 401: el panel cierra la sesión ante cualquier 401.
		assert.equal(r.status, 403);
		assert.match(r.body.error, /actual/);
		assert.equal(S.llamadas.some(l => l.op === 'update' || l.op === 'upsert'), false);
	});

	test('un PIN nuevo corto o sin PIN actual se rechaza antes de ir a la base', async () => {
		for (const cuerpo of [{ actual: '1234', nuevo: '12' }, { actual: '1234', nuevo: '12345678901' }, { actual: '1234', nuevo: '    ' }, { nuevo: '5678' }, { actual: '1234' }]) {
			const r = await cambiar(cuerpo);
			assert.equal(r.status, 400, JSON.stringify(cuerpo));
		}
		assert.equal(S.llamadas.length, 0);
	});

	test('el superadmin no usa esta ruta: la suya no pide el actual', async () => {
		const r = await cambiar({ actual: '1234', nuevo: '5678' }, tokenAdmin);
		assert.equal(r.status, 403);
	});

	test('sin sesión, nada', async () => {
		const r = await S.pedir('PATCH', '/api/mi-pin', { actual: '1234', nuevo: '5678' });
		assert.equal(r.status, 401);
	});

	test('el superadmin sigue pudiendo poner un PIN sin conocer el actual', async () => {
		const r = await S.pedir('PATCH', `/api/restaurantes/${IDS.restaurante}/pin`, { pin: '4321' }, tokenAdmin);
		assert.equal(r.status, 200);
		assert.ok(bcrypt.compareSync('4321', S.ultimaEscritura('restaurantes_privado').pin_hash));
	});

	// Al final: deja el contador de esta IP agotado.
	test('los fallos cuentan en el límite del login: no sirve para probar PINs', async () => {
		// Un acierto deja el contador a cero, sin depender de las pruebas de arriba.
		assert.equal((await cambiar({ actual: '1234', nuevo: '5678' })).status, 200);
		for (let i = 0; i < 10; i++) assert.equal((await cambiar({ actual: '0000', nuevo: '5678' })).status, 403);
		const r = await cambiar({ actual: '1234', nuevo: '5678' });
		assert.equal(r.status, 429, 'bloqueado aunque ahora acierte');
		const login = await S.pedir('POST', '/api/login', { slug: 'admin', pin: '9999' });
		assert.equal(login.status, 429, 'y el login desde esa IP también');
	});
});
