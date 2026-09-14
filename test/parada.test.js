// La parada ordenada. Cada despliegue para el contenedor, y hasta el 14/09/2026
// el panel moría siempre por SIGKILL: una conversión a medias se quedaba en
// "convirtiendo" hasta hora y media. Ver la cabecera de parada.js.
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const { pararOrdenadamente } = require('../parada.js');
const video = require('../video.js');

const RAIZ = path.join(__dirname, '..', 'uploads');

// Un servidor HTTP de verdad en un puerto libre.
async function servidorDePrueba(manejador = (req, res) => res.end('ok')) {
	const s = http.createServer(manejador);
	await new Promise(r => s.listen(0, '127.0.0.1', r));
	return s;
}

// ═══════════════════════════════════════════════════════════════
describe('pararOrdenadamente · el orden y el plazo', () => {
	test('cierra el servidor, espera a las colas y sale con 0', async () => {
		const s = await servidorDePrueba();
		const orden = [];
		let codigo = null;

		const parar = pararOrdenadamente({
			servidor: s,
			colas: [async () => { orden.push('cola'); }],
			plazoMs: 2000,
			salir: c => { codigo = c; orden.push('salir'); },
			log: () => {},
		});
		await parar('SIGTERM');

		assert.equal(s.listening, false, 'no debe seguir aceptando conexiones');
		assert.deepEqual(orden, ['cola', 'salir'], 'sale después de que la cola suelte su trabajo');
		assert.equal(codigo, 0);
	});

	test('deja terminar una petición que ya estaba en curso', async () => {
		// Lo que se cortaba en seco: alguien guardando un plato justo al desplegar.
		let responder;
		const s = await servidorDePrueba((req, res) => { responder = () => res.end('terminada'); });
		const { port } = s.address();

		const respuesta = new Promise((ok, mal) => {
			http.get({ host: '127.0.0.1', port, agent: false }, res => {
				let cuerpo = '';
				res.on('data', d => cuerpo += d);
				res.on('end', () => ok(cuerpo));
			}).on('error', mal);
		});
		while (!responder) await new Promise(r => setTimeout(r, 5));

		let salio = false;
		const parada = pararOrdenadamente({ servidor: s, plazoMs: 2000, salir: () => { salio = true; }, log: () => {} })('SIGTERM');

		await new Promise(r => setTimeout(r, 50));
		assert.equal(salio, false, 'no sale con una petición a medias');

		responder();
		assert.equal(await respuesta, 'terminada');
		await parada;
		assert.equal(salio, true);
	});

	test('si una cola se cuelga, sale igual al vencer el plazo', async () => {
		// Docker mata a los 10 s con SIGKILL, que no deja registrar nada. Mejor
		// salir antes aunque quede algo sin soltar.
		const s = await servidorDePrueba();
		let codigo = null;
		const inicio = Date.now();

		await pararOrdenadamente({
			servidor: s,
			colas: [() => new Promise(() => {})],
			plazoMs: 150,
			salir: c => { codigo = c; },
			log: () => {},
		})('SIGTERM');

		assert.equal(codigo, 0);
		assert.ok(Date.now() - inicio < 1000, 'no espera más que el plazo');
	});

	test('una cola que falla no impide salir', async () => {
		const s = await servidorDePrueba();
		let salio = false;
		await pararOrdenadamente({
			servidor: s,
			colas: [() => { throw new Error('boom'); }],
			plazoMs: 1000,
			salir: () => { salio = true; },
			log: () => {},
		})('SIGTERM');
		assert.equal(salio, true);
	});

	test('una segunda señal no vuelve a empezar la parada', async () => {
		const s = await servidorDePrueba();
		let salidas = 0;
		const parar = pararOrdenadamente({ servidor: s, plazoMs: 1000, salir: () => { salidas++; }, log: () => {} });
		await Promise.all([parar('SIGTERM'), parar('SIGTERM'), parar('SIGINT')]);
		assert.equal(salidas, 1);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('cola de video · soltar el trabajo al parar', () => {
	afterEach(() => video._reiniciarParada());

	// Apunta cada update con sus filtros, para comprobar qué se escribió y sobre qué fila.
	const supabaseFalso = () => {
		const escrituras = [];
		const q = {
			update(obj) {
				const e = { obj, filtros: {} };
				escrituras.push(e);
				const cadena = {
					eq(col, valor) { e.filtros[col] = valor; return cadena; },
					then(ok) { return Promise.resolve({ error: null }).then(ok); },
				};
				return cadena;
			},
		};
		return { escrituras, from: () => q };
	};

	test('devolverALaCola lo deja pendiente, sin gastar intento, y borra lo que estaba a medias', async () => {
		const base = 'prueba-parada-' + Date.now();
		const aMedias = [
			path.join(RAIZ, 'videos', `${base}.mp4`),
			path.join(RAIZ, 'masters', `${base}-master.mp4`),
		];
		for (const abs of aMedias) {
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, 'truncado');
		}

		const sb = supabaseFalso();
		try {
			await video.devolverALaCola(sb, { id: 't1', intentos: 2 }, aMedias);

			for (const abs of aMedias) assert.equal(fs.existsSync(abs), false, `${path.basename(abs)} debe borrarse`);
			assert.equal(sb.escrituras.length, 1);
			const { obj, filtros } = sb.escrituras[0];
			assert.deepEqual(obj, { estado: 'pendiente', error: null });
			// Tres despliegues durante una conversión no pueden dejar un video
			// perfecto marcado como 'error'.
			assert.equal('intentos' in obj, false, 'no debe tocar los intentos');
			// Un trabajo que ya terminó no se pisa.
			assert.deepEqual(filtros, { id: 't1', estado: 'procesando' });
		} finally {
			for (const abs of aMedias) { try { fs.unlinkSync(abs); } catch {} }
		}
	});

	test('con la parada en marcha, un trabajo no se cuenta como fallo', async () => {
		// Si la parada llega entre dos pasos de ffmpeg, no hay proceso que
		// cortar: el paso siguiente tiene que negarse a arrancar y el trabajo
		// volver a la cola, no sumar un intento.
		const origen = path.join('originales', 'prueba-parada-' + Date.now() + '.mp4');
		const abs = path.join(RAIZ, origen);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, 'x');

		const sb = supabaseFalso();
		try {
			await video.detener();
			await video.procesarTrabajo(sb, { id: 't2', origen, intentos: 0, formato: 'horizontal' });

			assert.equal(sb.escrituras.length, 1);
			assert.deepEqual(sb.escrituras[0].obj, { estado: 'pendiente', error: null });
			assert.equal(fs.existsSync(abs), true, 'el original no se toca: el trabajo lo necesita para volver a empezar');
		} finally {
			try { fs.unlinkSync(abs); } catch {}
		}
	});

	test('detener corta el proceso en marcha', async () => {
		// Un proceso cualquiera en lugar de ffmpeg, que no está en todas las máquinas.
		const hijo = video.vigilarHijo(video.ejecutar(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']));
		const inicio = Date.now();

		await video.detener();
		await assert.rejects(hijo, 'el proceso cortado rechaza, y eso es lo que lleva al catch que lo devuelve');
		assert.ok(Date.now() - inicio < 5000, 'no espera al minuto del proceso');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('server.js · la señal de verdad', () => {
	// En Windows, kill('SIGTERM') termina el proceso sin entregarle la señal,
	// así que esto solo se puede comprobar en Linux, que es donde corre el
	// panel y donde corren las pruebas de GitHub Actions.
	test('con SIGTERM sale con 0, no por la fuerza', { skip: process.platform === 'win32' && 'Windows no entrega SIGTERM' }, async () => {
		const hijo = spawn(process.execPath, ['server.js'], {
			cwd: path.join(__dirname, '..'),
			env: {
				...process.env,
				PORT: '0',
				SUPABASE_URL: 'http://127.0.0.1:9',
				SUPABASE_SERVICE_KEY: 'clave-de-prueba',
				VIDEO_WORKER: '0',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let salida = '';
		hijo.stdout.on('data', d => salida += d);
		hijo.stderr.on('data', d => salida += d);

		try {
			for (let i = 0; i < 200 && !salida.includes('Panel corriendo'); i++)
				await new Promise(r => setTimeout(r, 25));
			assert.ok(salida.includes('Panel corriendo'), `el panel no arrancó:\n${salida}`);

			const fin = new Promise(r => hijo.on('exit', (codigo, senal) => r({ codigo, senal })));
			hijo.kill('SIGTERM');
			const { codigo, senal } = await fin;

			assert.equal(senal, null, 'no debe morir por la señal');
			assert.equal(codigo, 0, `debe salir con 0:\n${salida}`);
			assert.match(salida, /panel parado/);
		} finally {
			if (hijo.exitCode === null) hijo.kill('SIGKILL');
		}
	});
});
