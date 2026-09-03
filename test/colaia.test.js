// La cola de IA: une el cupo, Replicate y la cola de conversión. Aquí se
// comprueba justo lo que no se ve al mirar cada pieza por separado — el ORDEN
// en que ocurren las cosas, que es lo que impide pagar de más.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.REPLICATE_API_TOKEN = 'token-de-pruebas';
const colaia = require('../colaia.js');

const RESTO = '11111111-1111-4111-8111-111111111111';
const PLATO = '33333333-3333-4333-8333-333333333333';
const FOTO  = 'https://panel.example.com/uploads/productos/x.jpg';

const fetchOriginal = globalThis.fetch;
let pasos = [];   // el orden real de lo que fue ocurriendo

// Supabase de mentira: apunta cada escritura en 'pasos' para poder afirmar
// sobre la secuencia, no solo sobre el resultado.
function supabaseFalso({ usadas = 0, cupoConfigurado = 24, enCurso = [], atributos = {} } = {}) {
	function tabla(nombre) {
		const st = { tabla: nombre };
		const q = {
			select(_c, opts) { if (opts?.head) st.esConteo = true; return q; },
			insert(filas) { st.op = 'insert'; st.payload = filas[0]; return q; },
			update(obj)   { st.op = 'update'; st.payload = obj;      return q; },
			eq() { return q; }, neq() { return q; }, lt() { return q; },
			order() { return q; }, limit() { return q; },
			single() { return q; }, maybeSingle() { return q; },
			then(res, rej) {
				if (st.op === 'insert') {
					pasos.push(`insert:${nombre}`);
					return Promise.resolve({ data: { id: 'gen-1', ...st.payload }, error: null }).then(res, rej);
				}
				if (st.op === 'update') {
					pasos.push(`update:${nombre}:${st.payload.estado || Object.keys(st.payload)[0]}`);
					return Promise.resolve({ data: [{ id: 'gen-1' }], error: null }).then(res, rej);
				}
				if (st.esConteo) return Promise.resolve({ count: usadas, error: null }).then(res, rej);
				if (nombre === 'restaurantes_ia')  return Promise.resolve({ data: { cupo: cupoConfigurado }, error: null }).then(res, rej);
				if (nombre === 'restaurantes')     return Promise.resolve({ data: { atributos }, error: null }).then(res, rej);
				if (nombre === 'generaciones_ia')  return Promise.resolve({ data: enCurso, error: null }).then(res, rej);
				return Promise.resolve({ data: null, error: null }).then(res, rej);
			},
		};
		return q;
	}
	// La reserva ya no es un insert suelto: desde sql/15 la decide y la escribe
	// una sola función dentro de la base, para que dos peticiones simultáneas
	// no puedan pasarse del cupo. Lo que importa aquí sigue siendo lo mismo —
	// que la fila quede escrita ANTES de llamar a Replicate— así que apunta su
	// paso igual que antes lo apuntaba el insert.
	function rpc(_nombre, args) {
		pasos.push('reservar:generaciones_ia');
		if (usadas >= cupoConfigurado) {
			return Promise.resolve({
				data: { ok: false, motivo: 'sin_cupo', cupo: cupoConfigurado, usadas },
				error: null,
			});
		}
		return Promise.resolve({
			data: {
				ok: true,
				fila: {
					id: 'gen-1',
					restaurante_id: args.p_restaurante_id,
					producto_id: args.p_producto_id,
					estado: 'reservada',
				},
			},
			error: null,
		});
	}

	return { from: tabla, rpc };
}

beforeEach(() => { pasos = []; });
afterEach(() => { globalThis.fetch = fetchOriginal; });

describe('lanzar · el orden es lo que impide pagar de más', () => {
	test('reserva ANTES de llamar, y anota el identificador después', async () => {
		// Si se llamara antes de reservar, el cupo no serviría. Si no se anotara
		// el identificador, un corte de red haría que el reintento pagara otra vez.
		globalThis.fetch = async () => {
			pasos.push('replicate:crear');
			return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'pred_1', status: 'starting' }) };
		};

		const r = await colaia.lanzar(supabaseFalso(), { restaurante_id: RESTO, producto_id: PLATO, foto_url: FOTO });

		assert.deepEqual(pasos, [
			'reservar:generaciones_ia',               // 1. reservar
			'replicate:crear',                        // 2. la llamada que cuesta
			'update:generaciones_ia:generando',       // 3. anotar el identificador
		]);
		assert.equal(r.prediction_id, 'pred_1');
	});

	test('sin cupo no se llama a Replicate', async () => {
		globalThis.fetch = async () => { pasos.push('replicate:crear'); throw new Error('no debería'); };
		await assert.rejects(
			() => colaia.lanzar(supabaseFalso({ usadas: 24 }), { restaurante_id: RESTO, foto_url: FOTO }),
			e => e.sinCupo === true);
		assert.equal(pasos.includes('replicate:crear'), false);
	});

	test('si la llamada falla, el cupo VUELVE', async () => {
		// No se generó nada, así que no se cobró nada. Dejarlo consumido le
		// costaría una animación al restaurante por un problema de red.
		globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '{}' });
		await assert.rejects(() => colaia.lanzar(supabaseFalso(), { restaurante_id: RESTO, foto_url: FOTO }));

		assert.ok(pasos.includes('update:generaciones_ia:liberada'), 'la reserva tiene que liberarse');
	});
});

describe('recoger · quién paga cada final', () => {
	const gen = { id: 'gen-1', restaurante_id: RESTO, producto_id: PLATO,
	              prediction_id: 'pred_1', creado_en: new Date().toISOString() };

	test('mientras se genera no se toca nada', async () => {
		globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'processing' }) });
		assert.equal(await colaia.recoger(supabaseFalso(), gen), false);
		assert.deepEqual(pasos, [], 'no hay nada que escribir todavía');
	});

	test('una generación fallida se marca cobrada', async () => {
		// Llegó a ejecutarse: se pagó. Devolver el cupo sería regalar dinero en
		// cada resultado malo.
		globalThis.fetch = async () => ({ ok: true, status: 200,
			text: async () => JSON.stringify({ status: 'failed', error: 'se atragantó' }) });

		await colaia.recoger(supabaseFalso(), gen);
		assert.ok(pasos.includes('update:generaciones_ia:error'));
		assert.equal(pasos.includes('update:generaciones_ia:liberada'), false);
	});

	test('una cancelada devuelve el cupo', async () => {
		globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'canceled' }) });
		await colaia.recoger(supabaseFalso(), gen);
		assert.ok(pasos.includes('update:generaciones_ia:liberada'));
	});

	test('la que tarda demasiado se abandona, pero se da por pagada', async () => {
		globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'processing' }) });
		const vieja = { ...gen, creado_en: new Date(Date.now() - colaia.LIMITE_GENERACION_MS - 1000).toISOString() };

		await colaia.recoger(supabaseFalso(), vieja);
		assert.ok(pasos.includes('update:generaciones_ia:error'));
	});

	test('el margen para abandonar es holgado', async () => {
		// Darla por muerta antes de tiempo sería pagar una que iba a salir bien.
		assert.ok(colaia.LIMITE_GENERACION_MS >= 15 * 60 * 1000);
	});
});

describe('recoger · el camino bueno acaba en la cola de siempre', () => {
	const gen = { id: 'gen-1', restaurante_id: RESTO, producto_id: PLATO,
	              prediction_id: 'pred_1', creado_en: new Date().toISOString() };

	function conVideo(bytes = Buffer.from('video-de-mentira')) {
		globalThis.fetch = async url => {
			if (String(url).includes('/predictions/'))
				return { ok: true, status: 200,
					text: async () => JSON.stringify({ status: 'succeeded', output: 'https://replicate.delivery/v.mp4' }) };
			// La descarga
			return {
				ok: true, status: 200,
				headers: new Map([['content-length', String(bytes.length)]]),
				body: (async function* () { yield bytes; })(),
			};
		};
	}

	test('descarga el video y lo encola como uno más', async () => {
		conVideo();
		const ok = await colaia.recoger(supabaseFalso(), gen);

		assert.equal(ok, true);
		// La prueba de que la IA no necesita su propia tubería: acaba en
		// trabajos_video igual que un video subido desde un móvil.
		assert.ok(pasos.includes('insert:trabajos_video'));
		assert.ok(pasos.includes('update:generaciones_ia:lista'));
	});

	test('el formato sale del modelo del restaurante, no del proveedor', async () => {
		// El modelo no acepta proporción, así que el recorte lo sigue haciendo
		// ffmpeg: un restaurante vertical tiene que encolar en vertical.
		conVideo();
		await colaia.recoger(supabaseFalso({ atributos: { nav: 'vertical' } }), gen);
		assert.ok(pasos.includes('insert:trabajos_video'));
	});

	test('si la descarga falla, se da por pagada', async () => {
		// El video existe y está cobrado; el fallo es nuestro al recogerlo.
		globalThis.fetch = async url => {
			if (String(url).includes('/predictions/'))
				return { ok: true, status: 200,
					text: async () => JSON.stringify({ status: 'succeeded', output: 'https://replicate.delivery/v.mp4' }) };
			return { ok: false, status: 404, headers: new Map(), body: null };
		};

		assert.equal(await colaia.recoger(supabaseFalso(), gen), false);
		assert.ok(pasos.includes('update:generaciones_ia:error'));
		assert.equal(pasos.includes('insert:trabajos_video'), false, 'no se encola algo que no se descargó');
	});
});

describe('descargar · lo que llega de un tercero', () => {
	const destino = path.join(__dirname, '..', 'uploads', 'originales', 'prueba-descarga.mp4');
	afterEach(() => { try { fs.unlinkSync(destino); } catch {} });

	test('un video vacío no se da por bueno', async () => {
		globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map(),
			body: (async function* () { })() });
		await assert.rejects(() => colaia.descargar('https://x/v.mp4', destino), /llegó vacío/);
	});

	test('se corta si pasa del tope aunque la cabecera calle', async () => {
		// La cabecera puede faltar o mentir, y para entonces ya se estaría
		// escribiendo. Con el disco lleno no se cae el video: se cae el servidor.
		const enorme = Buffer.alloc(2 * 1024 * 1024);
		globalThis.fetch = async () => ({
			ok: true, status: 200, headers: new Map(),
			body: (async function* () { for (let i = 0; i < 60; i++) yield enorme; })(),
		});
		await assert.rejects(() => colaia.descargar('https://x/v.mp4', destino), /pasa de \d+ MB/);
	});

	test('el nombre lo pone el servidor, no la URL del proveedor', async () => {
		// Lo que llega de fuera no nombra archivos en este disco.
		globalThis.fetch = async () => ({ ok: true, status: 200,
			headers: new Map([['content-length', '5']]),
			body: (async function* () { yield Buffer.from('hola!'); })() });

		const bytes = await colaia.descargar('https://x/../../etc/passwd', destino);
		assert.equal(bytes, 5);
		assert.equal(fs.readFileSync(destino, 'utf8'), 'hola!');
	});
});
