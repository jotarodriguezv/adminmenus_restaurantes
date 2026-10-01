// Las reglas de las reservas de mesa, sueltas. Las rutas están en
// reservas-api.test.js y reservas-limite.test.js.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../reservas');

// Las 10 de la mañana en Bogotá del 1 de octubre de 2026 (15:00 UTC).
const AHORA = new Date('2026-10-01T15:00:00Z');
const buena = (extra = {}) => ({ nombre: 'Ana Pérez', celular: '300 123 4567', fecha: '2026-10-05', hora: '19:30', personas: 4, ...extra });
const validar = (c, ahora = AHORA) => R.validarReserva(c, { zona: 'America/Bogota', ahora });

describe('validarReserva', () => {
	test('una buena sale lista para guardar, con el celular con indicativo', () => {
		const { datos, error } = validar(buena());
		assert.equal(error, undefined);
		assert.deepEqual(datos, { nombre: 'Ana Pérez', celular: '573001234567', fecha: '2026-10-05', hora: '19:30', personas: 4 });
	});

	test('el nombre: obligatorio, sin espacios de sobra y con tope', () => {
		assert.match(validar(buena({ nombre: '   ' })).error, /nombre/);
		assert.equal(validar(buena({ nombre: '  Ana   Pérez ' })).datos.nombre, 'Ana Pérez');
		assert.match(validar(buena({ nombre: 'x'.repeat(81) })).error, /largo/);
	});

	test('el celular tiene que parecer un número', () => {
		for (const c of ['', 'abc', '123', '1'.repeat(20)]) assert.match(validar(buena({ celular: c })).error, /celular/, c);
	});

	test('la fecha: real, de hoy en adelante y dentro de 90 días', () => {
		for (const f of ['', '5/10/2026', '2026-02-30', '2026-13-01', 'mañana']) assert.match(validar(buena({ fecha: f })).error, /fecha/i, f);
		assert.match(validar(buena({ fecha: '2026-09-30' })).error, /ya pasó/);
		assert.equal(validar(buena({ fecha: '2026-10-01' })).error, undefined, 'hoy sí');
		assert.equal(validar(buena({ fecha: '2026-12-30' })).error, undefined, 'el día 90 sí');
		assert.match(validar(buena({ fecha: '2026-12-31' })).error, /90 días/);
	});

	test('"hoy" es el del reloj del restaurante, no el de UTC', () => {
		// 9 pm del 1 de octubre en Bogotá = 02:00 UTC del 2: en UTC ya sería «ayer».
		const noche = new Date('2026-10-02T02:00:00Z');
		assert.equal(validar(buena({ fecha: '2026-10-01' }), noche).error, undefined);
		assert.match(validar(buena({ fecha: '2026-09-30' }), noche).error, /ya pasó/);
	});

	test('la hora: HH:MM de verdad', () => {
		for (const h of ['', '25:00', '19:60', '7pm', '19', '19:5']) assert.match(validar(buena({ hora: h })).error, /hora/, h);
		assert.equal(validar(buena({ hora: '07:05' })).datos.hora, '07:05');
	});

	test('las personas: un entero entre 1 y 50, no un texto', () => {
		for (const p of [0, -1, 2.5, '4', null, undefined, NaN]) assert.match(validar(buena({ personas: p })).error, /personas/, String(p));
		assert.match(validar(buena({ personas: 51 })).error, /50/);
		assert.equal(validar(buena({ personas: 50 })).error, undefined);
		assert.equal(validar(buena({ personas: 1 })).error, undefined);
	});
});

describe('las ayudas de fecha', () => {
	test('sumarDias cruza meses y años', () => {
		assert.equal(R.sumarDias('2026-12-30', 3), '2027-01-02');
		assert.equal(R.sumarDias('2026-03-01', -1), '2026-02-28');
	});
	test('fechaValida rechaza lo que no existe', () => {
		assert.equal(R.fechaValida('2028-02-29'), true);
		assert.equal(R.fechaValida('2026-02-29'), false);
	});
});

describe('el botón y el mensaje para el comensal', () => {
	test('el texto del botón: el del restaurante, recortado, o el de siempre', () => {
		assert.equal(R.textoDelBoton({}), 'Reservar mesa');
		assert.equal(R.textoDelBoton({ intro_reservas_texto: '   ' }), 'Reservar mesa');
		assert.equal(R.textoDelBoton({ intro_reservas_texto: 'Aparta tu mesa' }), 'Aparta tu mesa');
		assert.equal(R.textoDelBoton({ intro_reservas_texto: 'x'.repeat(100) }).length, 40);
	});

	test('el mensaje lleva la fecha tal cual está guardada, sin correrla de día', () => {
		const r = { nombre: 'Ana', celular: '573001234567', fecha: '2026-10-05', hora: '19:30:00', personas: 4, estado: 'confirmada' };
		assert.equal(R.mensajeParaElComensal(r, 'Bonzas'), 'Hola Ana, tu reserva en Bonzas está confirmada: 05/10/2026 a las 19:30, para 4 personas. ¡Te esperamos!');
		assert.match(R.mensajeParaElComensal({ ...r, personas: 1 }, 'Bonzas'), /para 1 persona\./);
		assert.match(R.mensajeParaElComensal({ ...r, estado: 'cancelada' }, 'Bonzas'), /no pudimos confirmar/);
	});

	test('el enlace de WhatsApp va al número del comensal con el texto codificado', () => {
		const r = { nombre: 'Ana & Co', celular: '573001234567', fecha: '2026-10-05', hora: '19:30', personas: 2, estado: 'pendiente' };
		const url = R.enlaceParaElComensal(r, 'Bonzas');
		assert.ok(url.startsWith('https://wa.me/573001234567?text='));
		assert.ok(!url.includes(' ') && !url.includes('&Co'), 'el nombre no rompe el enlace');
		assert.equal(R.enlaceParaElComensal({ ...r, celular: '' }, 'x'), null);
	});
});

describe('la purga: 90 días después de la fecha', () => {
	test('el corte es hoy menos 90 días', () => {
		assert.equal(R.corteReservas(new Date('2026-10-01T12:00:00Z')), '2026-07-03');
	});

	test('borra por fecha y devuelve cuántas', async () => {
		let filtro;
		const supabase = { from: () => ({ delete: () => ({ lte: (c, v) => { filtro = [c, v]; return { select: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }) }; } }) }) };
		const n = await R.purgarPasadas(supabase, { ahora: new Date('2026-10-01T12:00:00Z'), log: { log() {}, error() {} } });
		assert.equal(n, 2);
		assert.deepEqual(filtro, ['fecha', '2026-07-03']);
	});

	test('si la base falla devuelve null y no lanza', async () => {
		const supabase = { from: () => ({ delete: () => ({ lte: () => ({ select: async () => ({ data: null, error: { message: 'caída' } }) }) }) }) };
		assert.equal(await R.purgarPasadas(supabase, { log: { log() {}, error() {} } }), null);
	});
});
