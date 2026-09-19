// Vigila el arreglo del fallo intermitente de CI: el porqué entero está en
// test/helpers/consola-a-stderr.js. Si alguien quita el --require de
// package.json, o la precarga deja de hacer efecto, el fallo vuelve sin avisar
// —es intermitente— y tarda semanas en notarse. Estas pruebas lo notan ya.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('en las pruebas, la consola no escribe en stdout', () => {
	test('npm test carga la precarga en cada archivo', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
		assert.match(pkg.scripts.test, /--require \.\/test\/helpers\/consola-a-stderr\.js/);
	});

	test('console.log, info y debug van a stderr, no a stdout', (t) => {
		// Fuera de `npm test` —un archivo suelto con node --test sin la
		// precarga— no hay nada que comprobar.
		if (process.env.NODE_TEST_CONTEXT !== 'child-v8') return t.skip('sin la precarga de npm test');

		const escrito = { stdout: '', stderr: '' };
		const originales = { stdout: process.stdout.write, stderr: process.stderr.write };
		process.stdout.write = (d, ...r) => { escrito.stdout += d; return true; };
		process.stderr.write = (d, ...r) => { escrito.stderr += d; return true; };
		try {
			console.log('🎬 prueba de consola');
			console.info('✅ prueba de consola');
			console.debug('🧹 prueba de consola');
		} finally {
			process.stdout.write = originales.stdout;
			process.stderr.write = originales.stderr;
		}
		// Por stdout solo pueden viajar los mensajes del ejecutor.
		assert.equal(escrito.stdout, '');
		assert.match(escrito.stderr, /🎬 prueba de consola/);
		assert.match(escrito.stderr, /✅ prueba de consola/);
		assert.match(escrito.stderr, /🧹 prueba de consola/);
	});
});
