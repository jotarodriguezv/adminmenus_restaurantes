// Hablar con la API de Anthropic para transcribir una carta. Cada llamada de
// verdad cuesta dinero, así que aquí no se llama nunca: se sustituye fetch y se
// comprueba QUÉ se le habría mandado y cómo se interpreta lo que devuelve.
//
// Lo que más se prueba es lo de VUELTA. El modelo puede devolver cualquier
// cosa, y el sitio donde deja de poder es borradorDeRespuesta().
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.ANTHROPIC_API_KEY = 'clave-de-pruebas';
const carta = require('../lectorcarta.js');

const fetchOriginal = globalThis.fetch;
let peticiones = [];

function responder(cuerpo, { ok = true, status = 200 } = {}) {
	globalThis.fetch = async (url, opts) => {
		peticiones.push({ url, ...opts, cuerpo: opts && opts.body ? JSON.parse(opts.body) : null });
		return { ok, status, text: async () => JSON.stringify(cuerpo) };
	};
}

// Una respuesta como la que devuelve la API cuando contesta por la herramienta.
function conCarta(categorias, extra = {}) {
	return {
		model: 'claude-sonnet-5',
		stop_reason: 'tool_use',
		usage: { input_tokens: 2500, output_tokens: 8000 },
		content: [{ type: 'tool_use', name: 'registrar_carta', input: { categorias } }],
		...extra,
	};
}

beforeEach(() => { peticiones = []; });
afterEach(() => { globalThis.fetch = fetchOriginal; });

describe('lo que se le pide al modelo', () => {
	test('la respuesta se pide por la herramienta, no como texto libre', () => {
		// Pedir "devuélveme JSON" obliga a adivinar dónde empieza el JSON dentro
		// de un texto que puede traer explicaciones alrededor.
		const c = carta.cuerpoDeTexto(['CALDOS']);
		assert.equal(c.tool_choice.type, 'tool');
		assert.equal(c.tool_choice.name, 'registrar_carta');
		assert.equal(c.tools[0].name, 'registrar_carta');
	});

	test('el esquema exige el nombre del plato y deja el resto suelto', () => {
		const plato = carta.HERRAMIENTA.input_schema
			.properties.categorias.items.properties.platos.items;
		assert.deepEqual(plato.required, ['nombre']);
		assert.ok(plato.properties.precio, 'el precio se pide, pero no es obligatorio');
	});

	test('las instrucciones dicen copiar y no corregir', () => {
		// Es la decisión de producto del 06/09/2026. Si alguien la cambia al
		// retocar el texto, que sea a propósito y no de pasada.
		const s = carta.cuerpoDeTexto(['x']).system;
		assert.match(s, /LITERALMENTE/);
		assert.match(s, /No traduzcas/);
		assert.match(s, /No inventes/);
	});

	test('las instrucciones dejan las fotos fuera', () => {
		assert.match(carta.cuerpoDeTexto(['x']).system, /fotografías/i);
	});

	test('las páginas van numeradas y en orden', () => {
		const c = carta.cuerpoDeTexto(['CALDOS', 'POSTRES']);
		const texto = c.messages[0].content[0].text;
		assert.match(texto, /PÁGINA 1[\s\S]*CALDOS[\s\S]*PÁGINA 2[\s\S]*POSTRES/);
	});

	test('las imágenes van en base64 con su tipo', () => {
		const c = carta.cuerpoDeImagenes([{ tipo: 'image/jpeg', datos: 'AAAA' }]);
		const imagen = c.messages[0].content.find((b) => b.type === 'image');
		assert.equal(imagen.source.type, 'base64');
		assert.equal(imagen.source.media_type, 'image/jpeg');
		assert.equal(imagen.source.data, 'AAAA');
	});

	test('no se mandan más páginas que el tope', () => {
		// Una carta no tiene cuarenta páginas, y en la vía de imagen cada una
		// se paga. Un PDF de 300 subido por error no debería costar nada.
		const muchas = Array.from({ length: 200 }, (_, i) => ({ tipo: 'image/png', datos: String(i) }));
		const c = carta.cuerpoDeImagenes(muchas);
		assert.equal(c.messages[0].content.filter((b) => b.type === 'image').length, carta.MAX_PAGINAS);
	});
});

describe('la credencial', () => {
	test('sin ANTHROPIC_API_KEY no se llama a nadie', async () => {
		const antes = process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		responder(conCarta([]));
		await assert.rejects(() => carta.extraer({ paginas: ['x'] }), /ANTHROPIC_API_KEY/);
		assert.equal(peticiones.length, 0, 'ni siquiera se intenta la petición');
		process.env.ANTHROPIC_API_KEY = antes;
	});

	test('viaja en la cabecera y no en la URL', async () => {
		// En la URL acabaría en los registros del intermediario.
		responder(conCarta([]));
		await carta.extraer({ paginas: ['x'] });
		assert.equal(peticiones[0].headers['x-api-key'], 'clave-de-pruebas');
		assert.doesNotMatch(peticiones[0].url, /clave-de-pruebas/);
	});

	test('el error por credencial ausente no dice cuál era el valor', async () => {
		const antes = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = 'sk-secreto-de-verdad';
		delete process.env.ANTHROPIC_API_KEY;
		try {
			await carta.extraer({ paginas: ['x'] });
			assert.fail('tenía que fallar');
		} catch (e) {
			assert.doesNotMatch(e.message, /sk-secreto/);
		}
		process.env.ANTHROPIC_API_KEY = antes;
	});
});

describe('el borrador que sale', () => {
	const unaCarta = [{
		nombre: 'CALDOS',
		platos: [
			{ nombre: 'CALDO DE COSTILLA', descripcion: 'CON AREPA', precio: '$ 10.000' },
			{ nombre: 'CALDO DE HUEVO', precio: '8.000' },
		],
	}];

	test('los dos campos de precio salen coherentes', async () => {
		// 'precio' es lo que ve el comensal y 'precio_numerico' con lo que se
		// suma el carrito. Separados, la carta muestra uno y el carrito cobra
		// otro: ya pasó una vez.
		responder(conCarta(unaCarta));
		const r = await carta.extraer({ paginas: ['x'] });
		const p = r.borrador.categorias[0].platos[0];
		assert.equal(p.precio_numerico, 10000);
		assert.equal(p.precio, '$ 10.000');
	});

	test('un precio sin símbolo se entiende igual', () => {
		const b = carta.borradorDeRespuesta({ categorias: unaCarta });
		assert.equal(b.categorias[0].platos[1].precio_numerico, 8000);
	});

	test('un plato sin precio se queda sin precio, no en cero', () => {
		// Cero es un precio, y un plato a cero pesos en la carta es peor que
		// uno sin precio: el segundo se ve y se corrige.
		const b = carta.borradorDeRespuesta({ categorias: [{ nombre: 'X', platos: [{ nombre: 'SOPA' }] }] });
		assert.equal(b.categorias[0].platos[0].precio_numerico, null);
		assert.equal(b.categorias[0].platos[0].precio, null);
	});

	test('se cuentan los platos', () => {
		assert.equal(carta.borradorDeRespuesta({ categorias: unaCarta }).total_platos, 2);
	});

	test('se respeta el orden de las categorías y de los platos', () => {
		const b = carta.borradorDeRespuesta({
			categorias: [
				{ nombre: 'ENTRADAS', platos: [{ nombre: 'A' }, { nombre: 'B' }] },
				{ nombre: 'POSTRES', platos: [{ nombre: 'C' }] },
			],
		});
		assert.deepEqual(b.categorias.map((c) => c.nombre), ['ENTRADAS', 'POSTRES']);
		assert.deepEqual(b.categorias[0].platos.map((p) => p.nombre), ['A', 'B']);
	});

	test('se informa de qué vía se usó y de lo que costó', async () => {
		// Sin estos números, "la vía de texto es más barata" se queda en una
		// opinión y nunca se sabe si se puede bajar de modelo.
		responder(conCarta(unaCarta));
		const r = await carta.extraer({ paginas: ['x'] });
		assert.equal(r.via, 'texto');
		assert.equal(r.tokens_entrada, 2500);
		assert.equal(r.tokens_salida, 8000);
		assert.equal(r.modelo, 'claude-sonnet-5');
	});

	test('por imágenes la vía se marca como vision', async () => {
		responder(conCarta(unaCarta));
		const r = await carta.extraer({ imagenes: [{ tipo: 'image/png', datos: 'AA' }] });
		assert.equal(r.via, 'vision');
	});
});

describe('lo que devuelve el modelo no se cree sin más', () => {
	test('un plato sin nombre se descarta', () => {
		const b = carta.borradorDeRespuesta({
			categorias: [{ nombre: 'X', platos: [{ precio: '$ 1.000' }, { nombre: '  ' }, { nombre: 'SOPA' }] }],
		});
		assert.deepEqual(b.categorias[0].platos.map((p) => p.nombre), ['SOPA']);
	});

	test('una categoría que se queda sin platos no llega a la revisión', () => {
		const b = carta.borradorDeRespuesta({ categorias: [{ nombre: 'VACIA', platos: [] }] });
		assert.deepEqual(b.categorias, []);
	});

	test('basura en lugar de la lista no rompe nada', () => {
		for (const entrada of [null, undefined, {}, { categorias: 'no' }, { categorias: [null, 3, 'x'] }])
			assert.deepEqual(carta.borradorDeRespuesta(entrada).categorias, []);
	});

	test('los textos larguísimos se recortan', () => {
		const b = carta.borradorDeRespuesta({
			categorias: [{ nombre: 'X', platos: [{ nombre: 'A'.repeat(5000), descripcion: 'B'.repeat(9000) }] }],
		});
		const p = b.categorias[0].platos[0];
		assert.equal(p.nombre.length, 200);
		assert.equal(p.descripcion.length, 1000);
	});

	test('no se aceptan más platos que el tope', () => {
		const platos = Array.from({ length: 2000 }, (_, i) => ({ nombre: `P${i}` }));
		const b = carta.borradorDeRespuesta({ categorias: [{ nombre: 'X', platos }] });
		assert.equal(b.total_platos, carta.MAX_PLATOS);
	});

	test('no se aceptan más categorías que el tope', () => {
		const categorias = Array.from({ length: 500 }, (_, i) => ({ nombre: `C${i}`, platos: [{ nombre: 'P' }] }));
		const b = carta.borradorDeRespuesta({ categorias });
		assert.equal(b.categorias.length, carta.MAX_CATEGORIAS);
	});

	test('una categoría sin nombre se acepta: son los platos sueltos', () => {
		const b = carta.borradorDeRespuesta({ categorias: [{ platos: [{ nombre: 'SOPA' }] }] });
		assert.equal(b.categorias[0].nombre, '');
		assert.equal(b.categorias[0].platos.length, 1);
	});
});

describe('cuando la cosa sale mal', () => {
	test('una carta cortada por el tope de tokens se rechaza en vez de entregarse a medias', async () => {
		// Es EL fallo silencioso de esta pieza: faltarían las últimas
		// categorías y nada lo diría. Mejor un error que una carta incompleta
		// que alguien aprueba sin notarlo.
		responder(conCarta([{ nombre: 'CALDOS', platos: [{ nombre: 'A' }] }], { stop_reason: 'max_tokens' }));
		await assert.rejects(() => carta.extraer({ paginas: ['x'] }), /demasiado larga/);
	});

	test('si contesta con texto y no con la herramienta, se avisa', async () => {
		responder({ content: [{ type: 'text', text: 'Claro, aquí tienes la carta...' }] });
		await assert.rejects(() => carta.extraer({ paginas: ['x'] }), /no devolvió la carta/);
	});

	test('un 4xx es definitivo: repetir daría lo mismo', async () => {
		responder({ error: { message: 'invalid image' } }, { ok: false, status: 400 });
		await assert.rejects(() => carta.extraer({ paginas: ['x'] }), (e) => {
			assert.equal(e.estado, 400);
			assert.equal(e.definitivo, true);
			return true;
		});
	});

	test('un 429 NO es definitivo: es "ahora no", no "nunca"', async () => {
		responder({ error: { message: 'rate limited' } }, { ok: false, status: 429 });
		await assert.rejects(() => carta.extraer({ paginas: ['x'] }), (e) => {
			assert.equal(e.definitivo, false);
			return true;
		});
	});

	test('un 529 tampoco: el servicio está saturado, no roto', async () => {
		responder({ error: { message: 'overloaded' } }, { ok: false, status: 529 });
		await assert.rejects(() => carta.extraer({ paginas: ['x'] }), (e) => {
			assert.equal(e.definitivo, false);
			return true;
		});
	});

	test('una respuesta que no es JSON no tumba el proceso', async () => {
		globalThis.fetch = async () => ({ ok: false, status: 502, text: async () => '<html>Bad Gateway</html>' });
		await assert.rejects(() => carta.extraer({ paginas: ['x'] }), /502/);
	});
});
