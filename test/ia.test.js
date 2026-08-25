// Hablar con Replicate. Cada llamada de verdad cuesta dinero, así que aquí no
// se llama nunca: se sustituye fetch y se comprueba QUÉ se le habría mandado y
// cómo se interpreta lo que devuelve.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.REPLICATE_API_TOKEN = 'token-de-pruebas';
const ia = require('../ia.js');

const FOTO = 'https://panel.example.com/uploads/productos/1756-abc.jpg';

// Sustituto de fetch: apunta lo que se le pidió y devuelve lo que se le diga.
const fetchOriginal = globalThis.fetch;
let peticiones = [];

function responder(cuerpo, { ok = true, status = 200 } = {}) {
	globalThis.fetch = async (url, opts) => {
		peticiones.push({ url, ...opts, cuerpo: opts?.body ? JSON.parse(opts.body) : null });
		return { ok, status, text: async () => JSON.stringify(cuerpo) };
	};
}

beforeEach(() => { peticiones = []; });
afterEach(() => { globalThis.fetch = fetchOriginal; });

describe('entradaDe · lo que se le pide al modelo', () => {
	test('manda la foto en first_frame_image', () => {
		// El nombre sale del editor JSON del propio modelo. Si cambiara, todas
		// las generaciones fallarían igual, así que conviene fijarlo.
		assert.equal(ia.entradaDe(FOTO).first_frame_image, FOTO);
	});

	test('la duración y la resolución son las decididas', () => {
		const e = ia.entradaDe(FOTO);
		assert.equal(e.duration, 6, '6 s por coste; se sube cuando haya clientes que lo paguen');
		assert.equal(e.resolution, '768p', 'el entregable es 720p: 1080p sería pagar por lo que ffmpeg tira');
	});

	test('el optimizador de prompt va apagado', () => {
		// El texto se afinó a mano hasta dar con el movimiento que se quería;
		// dejar que el modelo lo reescriba es perder justo eso.
		assert.equal(ia.entradaDe(FOTO).prompt_optimizer, false);
	});

	test('el prompt fija el movimiento, no lo deja al modelo', () => {
		// Sin decir QUÉ movimiento, cada generación sale distinta y la carta
		// queda con seis videos que no se parecen entre sí. Este es el texto que
		// se probó a mano en Replicate y dio buen resultado.
		assert.match(ia.PROMPT, /orbits around the dish/i);
	});

	test('el prompt mantiene el plato quieto y el resto de la escena también', () => {
		// Las dos mitades del mismo problema: sin la primera el plato flota, y
		// sin la segunda el modelo anima el fondo o los cubiertos.
		assert.match(ia.PROMPT, /completely still/i);
		assert.match(ia.PROMPT, /no other movement/i);
	});

	// ⚠ Lo que este prompt NO fija: que no se inventen ingredientes. Y la
	// órbita es justo lo que más lo pide, porque al girar hacia 3/4 el modelo
	// tiene que rellenar el lado del plato que la foto no enseña.
	//
	// No hay prueba de eso porque no sería verdad: el texto no lo dice. Poner
	// una que pasara igualmente sería peor que no tenerla — daría por cubierto
	// algo que está abierto. Lo cubre el paso de aprobación de la fase 3.
	test('el prompt pide fotorrealismo, no una interpretación', () => {
		assert.match(ia.PROMPT, /photorealistic/i);
	});

	test('no se manda proporción porque el modelo no la acepta', () => {
		// La hereda de la foto. El recorte al formato del restaurante lo sigue
		// haciendo ffmpeg después, igual que con un video grabado.
		const e = ia.entradaDe(FOTO);
		assert.equal('aspect_ratio' in e, false);
	});

	test('se puede pasar otro prompt sin tocar el resto', () => {
		assert.equal(ia.entradaDe(FOTO, 'otra cosa').prompt, 'otra cosa');
	});
});

describe('crearPrediccion', () => {
	test('devuelve el identificador, que es lo que hay que guardar', async () => {
		responder({ id: 'pred_abc', status: 'starting' });
		const r = await ia.crearPrediccion(FOTO);

		assert.deepEqual(r, { id: 'pred_abc', estado: 'starting' });
		assert.match(peticiones[0].url, /\/models\/minimax\/hailuo-02\/predictions$/);
		assert.equal(peticiones[0].method, 'POST');
		assert.equal(peticiones[0].headers.Authorization, 'Bearer token-de-pruebas');
		assert.equal(peticiones[0].cuerpo.input.first_frame_image, FOTO);
	});

	test('una foto sin URL pública no llega a salir', async () => {
		// Replicate tiene que poder DESCARGAR la foto. Una ruta relativa o un
		// data: la haría fallar del otro lado, y ese fallo puede costar dinero.
		responder({ id: 'no-deberia-llamarse' });
		for (const mala of ['uploads/productos/x.jpg', '', null, 'data:image/png;base64,AAA'])
			await assert.rejects(() => ia.crearPrediccion(mala), e => e.definitivo === true);

		assert.equal(peticiones.length, 0, 'no se puede gastar una llamada en algo que ya se sabe malo');
	});

	test('un 4xx se marca definitivo y un 5xx no', async () => {
		// Repetir un 4xx daría el mismo error y gastaría un intento del cupo;
		// un 5xx sí puede ser pasajero.
		responder({ detail: 'input inválido' }, { ok: false, status: 422 });
		await assert.rejects(() => ia.crearPrediccion(FOTO), e => e.definitivo === true);

		responder({ detail: 'ups' }, { ok: false, status: 503 });
		await assert.rejects(() => ia.crearPrediccion(FOTO), e => e.definitivo === false);
	});

	test('un 429 no es definitivo: es "espera"', async () => {
		responder({ detail: 'demasiadas' }, { ok: false, status: 429 });
		await assert.rejects(() => ia.crearPrediccion(FOTO), e => e.definitivo === false);
	});

	test('una respuesta sin identificador se trata como fallo', async () => {
		// Sin id no hay forma de preguntar por ella después: si se diera por
		// buena, se habría pagado algo que nadie puede recoger.
		responder({ status: 'starting' });
		await assert.rejects(() => ia.crearPrediccion(FOTO), /no devolvió identificador/);
	});

	test('sin token no se llama a nadie', async () => {
		const antes = process.env.REPLICATE_API_TOKEN;
		delete process.env.REPLICATE_API_TOKEN;
		responder({ id: 'x' });
		await assert.rejects(() => ia.crearPrediccion(FOTO), /REPLICATE_API_TOKEN/);
		assert.equal(peticiones.length, 0);
		process.env.REPLICATE_API_TOKEN = antes;
	});
});

describe('consultarPrediccion · y quién paga cada final', () => {
	test('mientras se genera, sigue en curso', async () => {
		for (const s of ['starting', 'processing']) {
			responder({ status: s });
			const r = await ia.consultarPrediccion('pred_abc');
			assert.equal(r.estado, 'generando');
			assert.equal(r.url, null);
		}
	});

	test('terminada, devuelve la URL del video', async () => {
		responder({ status: 'succeeded', output: 'https://replicate.delivery/x.mp4' });
		const r = await ia.consultarPrediccion('pred_abc');
		assert.equal(r.estado, 'lista');
		assert.equal(r.url, 'https://replicate.delivery/x.mp4');
	});

	test('el output también puede venir en lista', async () => {
		// Según el modelo llega como cadena o como array; no se da por hecho una.
		responder({ status: 'succeeded', output: ['https://replicate.delivery/y.mp4'] });
		assert.equal((await ia.consultarPrediccion('p')).url, 'https://replicate.delivery/y.mp4');
	});

	test('una generación que falló SÍ se pagó', async () => {
		// Llegó a ejecutarse. Devolver el cupo aquí sería regalar dinero en cada
		// resultado malo.
		responder({ status: 'failed', error: 'el modelo se atragantó' });
		const r = await ia.consultarPrediccion('pred_abc');
		assert.equal(r.estado, 'error');
		assert.equal(r.cobrada, true);
	});

	test('una cancelada NO se pagó, y devuelve el cupo', async () => {
		responder({ status: 'canceled' });
		const r = await ia.consultarPrediccion('pred_abc');
		assert.equal(r.estado, 'error');
		assert.equal(r.cobrada, false);
	});

	test('el identificador se escapa en la URL', async () => {
		responder({ status: 'processing' });
		await ia.consultarPrediccion('con/barra');
		assert.match(peticiones[0].url, /predictions\/con%2Fbarra$/);
	});
});
