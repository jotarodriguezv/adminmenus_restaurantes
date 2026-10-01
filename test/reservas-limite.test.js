// El tope por IP de POST /api/reservas, aparte porque necesita pasarse de 10
// peticiones y cada archivo de prueba es un proceso con su propio contador.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/servidor.js');
const { pedir, llamadas, conTabla, IDS } = S;

test('a la petición 11 de la misma IP en una hora, 429 antes de tocar la base', async () => {
	conTabla(() => ({ data: null, error: null }));
	const cuerpo = { restaurante_id: IDS.restaurante, nombre: 'Ana', celular: '3001234567', fecha: '2030-01-01', hora: '19:00', personas: 2, abierto_en: Date.now() - 60_000 };
	for (let i = 0; i < 10; i++) assert.notEqual((await pedir('POST', '/api/reservas', cuerpo)).status, 429, `la ${i + 1} aún pasa`);
	const antes = llamadas.length;
	const r = await pedir('POST', '/api/reservas', cuerpo);
	assert.equal(r.status, 429);
	assert.equal(llamadas.length, antes, 'no consultó nada');
});
