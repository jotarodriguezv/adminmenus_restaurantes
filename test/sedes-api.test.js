// Las rutas de las sedes, por HTTP contra el server.js de verdad y un Supabase
// simulado (sql/37, docs/sedes.md).
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const S = require('./helpers/servidor.js');
const { pedir, llamadas, reiniciar, conTabla, tokenCliente, tokenAdmin, IDS } = S;

const SEDE = '99999999-9999-4999-8999-999999999999';
const PLATO_B = '44444444-4444-4444-8444-444444444444';
const PLATO_AJENO = '55555555-5555-4555-8555-555555555555';

const escrituras = (tabla, op) => llamadas.filter(l => l.tabla === tabla && l.op === op);

// Un mundo mínimo: un restaurante, una sede de ese restaurante y dos platos.
function conMundo({ sedes = [], restaurante = { atributos: { con_sedes: true } } } = {}) {
	conTabla(st => {
		if (st.tabla === 'restaurantes') return { data: restaurante, error: null };
		if (st.tabla === 'sedes' && st.op === 'select') {
			if (st.filtros.id === SEDE) return { data: { restaurante_id: IDS.restaurante, slug: 'bucaramanga' }, error: null };
			if (st.opciones?.head) return { data: null, count: sedes.length, error: null };
			return { data: sedes, error: null };
		}
		if (st.tabla === 'sedes' && st.op === 'insert') return { data: { id: SEDE, ...st.payload[0] }, error: null };
		if (st.tabla === 'sedes' && st.op === 'update') return { data: { id: SEDE, ...st.payload }, error: null };
		if (st.tabla === 'productos' && st.op === 'select') return { data: [{ id: IDS.producto }, { id: PLATO_B }], error: null };
		return { data: null, error: null };
	});
}

beforeEach(() => reiniciar());

describe('POST /api/sedes', () => {
	const cuerpo = (extra = {}) => ({ restaurante_id: IDS.restaurante, nombre: 'Bucaramanga', ...extra });

	test('solo el administrador crea sedes', async () => {
		conMundo();
		assert.equal((await pedir('POST', '/api/sedes', cuerpo(), tokenCliente)).status, 403);
		assert.equal((await pedir('POST', '/api/sedes', cuerpo())).status, 401);
		assert.equal(escrituras('sedes', 'insert').length, 0);
	});

	test('crea la sede con el enlace sacado del nombre, y no toca el restaurante', async () => {
		conMundo();
		const r = await pedir('POST', '/api/sedes', cuerpo({ nombre: 'Cañaveral Ruitoque' }), tokenAdmin);
		assert.equal(r.status, 200);
		const fila = escrituras('sedes', 'insert')[0].payload[0];
		assert.equal(fila.slug, 'canaveral-ruitoque');
		assert.equal(fila.restaurante_id, IDS.restaurante);
		// El interruptor es del superadmin (Superadmin → Varias sedes): crear una sede no lo enciende.
		assert.equal(escrituras('restaurantes', 'update').length, 0);
	});

	test('con el interruptor «Varias sedes» apagado no se crea ninguna', async () => {
		for (const atributos of [{}, { con_sedes: false }, { con_sedes: 'true' }]) {
			reiniciar();
			conMundo({ restaurante: { atributos } });
			const r = await pedir('POST', '/api/sedes', cuerpo(), tokenAdmin);
			assert.equal(r.status, 409, JSON.stringify(atributos));
			assert.match(r.body.error, /Varias sedes/);
			assert.equal(escrituras('sedes', 'insert').length, 0);
		}
	});

	test('rechaza enlaces mal formados y el reservado de la cartelera', async () => {
		conMundo();
		for (const slug of ['Con Mayusculas', 'a_b', '-x', 'tv', '']) {
			if (slug === '') continue; // vacío cae al que sale del nombre
			const r = await pedir('POST', '/api/sedes', cuerpo({ slug }), tokenAdmin);
			assert.equal(r.status, 400, slug);
		}
		assert.equal(escrituras('sedes', 'insert').length, 0);
	});

	describe('el tope de sedes lo fija el superadmin', () => {
		const sedesExistentes = n => Array.from({ length: n }, (_, i) => ({ id: 'e' + i, slug: 'sede-' + i }));

		test('sin max_sedes puesto, el tope es dos', async () => {
			conMundo({ sedes: sedesExistentes(2), restaurante: { atributos: { con_sedes: true } } });
			const r = await pedir('POST', '/api/sedes', cuerpo({ nombre: 'Tercera' }), tokenAdmin);
			assert.equal(r.status, 409);
			assert.match(r.body.error, /contratadas 2 sedes/);
			assert.equal(escrituras('sedes', 'insert').length, 0);
		});

		test('con dos creadas y max_sedes 2, la segunda entra y la tercera no', async () => {
			conMundo({ sedes: sedesExistentes(1), restaurante: { atributos: { con_sedes: true, max_sedes: 2 } } });
			assert.equal((await pedir('POST', '/api/sedes', cuerpo({ nombre: 'Segunda' }), tokenAdmin)).status, 200);
			reiniciar();
			conMundo({ sedes: sedesExistentes(2), restaurante: { atributos: { con_sedes: true, max_sedes: 2 } } });
			assert.equal((await pedir('POST', '/api/sedes', cuerpo({ nombre: 'Tercera' }), tokenAdmin)).status, 409);
		});

		test('subir el tope deja crear más', async () => {
			conMundo({ sedes: sedesExistentes(2), restaurante: { atributos: { con_sedes: true, max_sedes: 3 } } });
			assert.equal((await pedir('POST', '/api/sedes', cuerpo({ nombre: 'Tercera' }), tokenAdmin)).status, 200);
		});

		test('un tope que no es un entero válido cae al de por defecto, no a «sin límite»', async () => {
			for (const max_sedes of ['muchas', -3, 0, 1.5, null]) {
				reiniciar();
				conMundo({ sedes: sedesExistentes(2), restaurante: { atributos: { con_sedes: true, max_sedes } } });
				const r = await pedir('POST', '/api/sedes', cuerpo({ nombre: 'Tercera' }), tokenAdmin);
				assert.equal(r.status, 409, String(max_sedes));
			}
		});

		test('el techo absoluto de 20 sigue valiendo aunque el tope diga más', async () => {
			conMundo({ sedes: sedesExistentes(20), restaurante: { atributos: { con_sedes: true, max_sedes: 99 } } });
			assert.equal((await pedir('POST', '/api/sedes', cuerpo({ nombre: 'Vigesimoprimera' }), tokenAdmin)).status, 409);
		});
	});

	test('rechaza un nombre vacío', async () => {
		conMundo();
		assert.equal((await pedir('POST', '/api/sedes', cuerpo({ nombre: '  ' }), tokenAdmin)).status, 400);
	});

	test('rechaza un enlace repetido en el mismo restaurante', async () => {
		conMundo({ sedes: [{ id: 'x', slug: 'bucaramanga' }] });
		assert.equal((await pedir('POST', '/api/sedes', cuerpo(), tokenAdmin)).status, 409);
	});

	test('valida los datos del negocio con las reglas de siempre y descarta lo ajeno', async () => {
		conMundo();
		const malo = await pedir('POST', '/api/sedes', cuerpo({ atributos: { whatsapp_negocio: '123' } }), tokenAdmin);
		assert.equal(malo.status, 400);
		const mapa = await pedir('POST', '/api/sedes', cuerpo({ atributos: { mapa_url: 'https://evil.example/x' } }), tokenAdmin);
		assert.equal(mapa.status, 400, 'el mapa tiene que ser de Google');

		const bueno = await pedir('POST', '/api/sedes', cuerpo({
			atributos: { whatsapp_negocio: '+57 300 123 4567', direccion: '  Calle 1 ', css_custom: 'body{}', color_dark: '#000' },
		}), tokenAdmin);
		assert.equal(bueno.status, 200);
		const guardado = escrituras('sedes', 'insert').pop().payload[0].atributos;
		assert.deepEqual(guardado, { whatsapp_negocio: '573001234567', direccion: 'Calle 1' });
	});
});

describe('PATCH y DELETE /api/sedes/:id', () => {
	test('un cliente no cambia ni borra sedes', async () => {
		conMundo();
		assert.equal((await pedir('PATCH', `/api/sedes/${SEDE}`, { nombre: 'x' }, tokenCliente)).status, 403);
		assert.equal((await pedir('DELETE', `/api/sedes/${SEDE}`, null, tokenCliente)).status, 403);
	});

	test('no se puede mover una sede a otro restaurante mandándolo en el cuerpo', async () => {
		conMundo();
		const r = await pedir('PATCH', `/api/sedes/${SEDE}`, { nombre: 'Nueva', restaurante_id: 'otro' }, tokenAdmin);
		assert.equal(r.status, 200);
		const fila = escrituras('sedes', 'update')[0].payload;
		assert.equal(fila.nombre, 'Nueva');
		assert.equal('restaurante_id' in fila, false);
	});

	test('apagar una sede', async () => {
		conMundo();
		await pedir('PATCH', `/api/sedes/${SEDE}`, { activa: false }, tokenAdmin);
		assert.equal(escrituras('sedes', 'update')[0].payload.activa, false);
	});

	test('borrar la última sede NO apaga «Varias sedes»: el interruptor es del superadmin', async () => {
		conMundo({ sedes: [], restaurante: { atributos: { con_sedes: true } } });
		assert.equal((await pedir('DELETE', `/api/sedes/${SEDE}`, null, tokenAdmin)).status, 200);
		assert.equal(escrituras('restaurantes', 'update').length, 0);
	});
});

describe('GET /api/sedes', () => {
	test('el dueño ve las de su restaurante y no las de otro', async () => {
		conMundo({ sedes: [{ id: 'a' }] });
		const propia = await pedir('GET', `/api/sedes?restaurante_id=${IDS.restaurante}`, null, tokenCliente);
		assert.equal(propia.status, 200);
		const ajena = await pedir('GET', '/api/sedes?restaurante_id=otro', null, tokenCliente);
		assert.equal(ajena.status, 403);
	});
});

describe('PUT /api/productos-sedes · precios y disponibilidad por sede', () => {
	const put = (filas, token = tokenCliente) => pedir('PUT', '/api/productos-sedes', { sede_id: SEDE, filas }, token);

	test('el dueño guarda precios propios y el texto sale del número', async () => {
		conMundo();
		const r = await put([{ producto_id: IDS.producto, precio_numerico: 31000 }]);
		assert.equal(r.status, 200);
		assert.deepEqual(r.body, { guardados: 1, quitados: 0 });
		const fila = escrituras('productos_sedes', 'upsert')[0].payload[0];
		assert.equal(fila.precio_numerico, 31000);
		assert.equal(fila.precio, '$ 31.000');
		assert.equal(fila.disponible, null);
		assert.equal(fila.sede_id, SEDE);
	});

	test('«no se sirve aquí» se guarda como disponible=false, sin precio', async () => {
		conMundo();
		await put([{ producto_id: IDS.producto, disponible: false }]);
		const fila = escrituras('productos_sedes', 'upsert')[0].payload[0];
		assert.equal(fila.disponible, false);
		assert.equal(fila.precio_numerico, null);
	});

	test('una fila que no cambia nada se borra: la tabla solo guarda excepciones', async () => {
		conMundo();
		const r = await put([{ producto_id: IDS.producto, precio_numerico: null }, { producto_id: PLATO_B, disponible: true }]);
		assert.deepEqual(r.body, { guardados: 0, quitados: 2 });
		assert.equal(escrituras('productos_sedes', 'upsert').length, 0);
		assert.equal(escrituras('productos_sedes', 'delete').length, 1);
	});

	test('un plato de otro restaurante se rechaza y no se guarda nada', async () => {
		conMundo();
		const r = await put([{ producto_id: IDS.producto, precio_numerico: 1 }, { producto_id: PLATO_AJENO, precio_numerico: 1 }]);
		assert.equal(r.status, 400);
		assert.equal(escrituras('productos_sedes', 'upsert').length, 0);
	});

	test('un precio inválido se rechaza', async () => {
		conMundo();
		for (const precio_numerico of [-5, 'abc']) {
			assert.equal((await put([{ producto_id: IDS.producto, precio_numerico }])).status, 400);
		}
		assert.equal(escrituras('productos_sedes', 'upsert').length, 0);
	});

	test('sin sesión, 401; con una sede de otro restaurante, 403', async () => {
		conMundo();
		assert.equal((await pedir('PUT', '/api/productos-sedes', { sede_id: SEDE, filas: [] })).status, 401);
		reiniciar();
		conTabla(st => st.tabla === 'sedes' ? { data: { restaurante_id: 'otro' }, error: null } : { data: null, error: null });
		assert.equal((await put([])).status, 403);
	});

	test('pide sede_id y una lista', async () => {
		conMundo();
		assert.equal((await pedir('PUT', '/api/productos-sedes', { filas: [] }, tokenCliente)).status, 400);
		assert.equal((await pedir('PUT', '/api/productos-sedes', { sede_id: SEDE }, tokenCliente)).status, 400);
	});
});

describe('PATCH /api/restaurantes/:id · el interruptor «Varias sedes»', () => {
	const guardar = (atributos, token) => pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`, { atributos }, token);
	const conRestaurante = (atributos = {}) => conTabla(st => (st.tabla === 'restaurantes' && st.op === 'select' ? { data: { atributos }, error: null } : { data: { id: IDS.restaurante, atributos: {} }, error: null }));

	test('el superadmin lo enciende y se guarda como booleano de verdad', async () => {
		conRestaurante({ nav: 'topnav' });
		const r = await guardar({ con_sedes: true }, tokenAdmin);
		assert.equal(r.status, 200);
		const a = escrituras('restaurantes', 'update').pop().payload.atributos;
		assert.equal(a.con_sedes, true);
		assert.equal(a.nav, 'topnav', 'se funde con lo guardado');
	});

	test('un valor que no es booleano de verdad deja las sedes apagadas', async () => {
		conRestaurante();
		await guardar({ con_sedes: 'false' }, tokenAdmin);
		assert.equal(escrituras('restaurantes', 'update').pop().payload.atributos.con_sedes, false);
	});

	test('el dueño del restaurante no puede encenderlo', async () => {
		conRestaurante();
		await guardar({ con_sedes: true }, tokenCliente);
		const guardado = escrituras('restaurantes', 'update').pop()?.payload.atributos || {};
		assert.equal('con_sedes' in guardado, false);
	});
});

describe('PATCH /api/restaurantes/:id · max_sedes', () => {
	const guardar = (atributos, token = tokenAdmin) => pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`, { atributos }, token);
	const conRestaurante = () => conTabla(st => (st.tabla === 'restaurantes' && st.op === 'select' ? { data: { atributos: {} }, error: null } : { data: { id: IDS.restaurante, atributos: {} }, error: null }));
	const guardado = () => escrituras('restaurantes', 'update').pop().payload.atributos.max_sedes;

	test('se guarda como entero entre 1 y 20', async () => {
		conRestaurante();
		await guardar({ max_sedes: 3 });
		assert.equal(guardado(), 3);
		await guardar({ max_sedes: '4' });
		assert.equal(guardado(), 4, 'un número escrito como texto se entiende');
		await guardar({ max_sedes: 2.6 });
		assert.equal(guardado(), 3);
		await guardar({ max_sedes: 500 });
		assert.equal(guardado(), 20);
		await guardar({ max_sedes: 0 });
		assert.equal(guardado(), 1);
	});

	test('lo que no es un número se queda en dos, no en NaN', async () => {
		conRestaurante();
		await guardar({ max_sedes: 'muchas' });
		assert.equal(guardado(), 2);
	});

	test('el dueño no puede subirse el tope', async () => {
		conRestaurante();
		await guardar({ max_sedes: 10 }, tokenCliente);
		const g = escrituras('restaurantes', 'update').pop()?.payload.atributos || {};
		assert.equal('max_sedes' in g, false);
	});
});

describe('PATCH /api/restaurantes/:id · la sede de cada pantalla de TV', () => {
	const SEDES = [{ slug: 'piedecuesta', activa: true }, { slug: 'bucaramanga', activa: true }, { slug: 'cerrada', activa: false }];
	// El restaurante tal como está guardado, y las sedes que tiene.
	const conMundoTv = ({ guardado = { con_sedes: true }, sedes = SEDES, errorSedes = false } = {}) => conTabla(st => {
		if (st.tabla === 'restaurantes' && st.op === 'select') return { data: { atributos: guardado }, error: null };
		if (st.tabla === 'sedes') return errorSedes ? { data: null, error: { message: 'boom' } } : { data: sedes, error: null };
		return { data: { id: IDS.restaurante, atributos: {} }, error: null };
	});
	const guardar = atributos => pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`, { atributos }, tokenAdmin);
	const consultoSedes = () => llamadas.some(l => l.tabla === 'sedes');

	test('una pantalla encendida con una sede que existe se guarda', async () => {
		conMundoTv();
		const r = await guardar({ tv: { activa: true, sede: 'bucaramanga' } });
		assert.equal(r.status, 200);
		assert.equal(escrituras('restaurantes', 'update').pop().payload.atributos.tv.sede, 'bucaramanga');
	});

	test('con sedes, una pantalla ENCENDIDA sin sede se rechaza y dice cuál', async () => {
		conMundoTv();
		const r = await guardar({ tv: { activa: true } });
		assert.equal(r.status, 400);
		assert.match(r.body.error, /sede de la pantalla 1/);
		assert.equal(escrituras('restaurantes', 'update').length, 0);
	});

	test('una pantalla apagada sin sede sí se puede guardar (borrador)', async () => {
		conMundoTv();
		assert.equal((await guardar({ tv: { activa: false } })).status, 200);
	});

	test('una sede que no existe se rechaza, y una apagada pero existente no', async () => {
		conMundoTv();
		const r = await guardar({ tv: { activa: true, sede: 'cali' } });
		assert.equal(r.status, 400);
		assert.match(r.body.error, /ya no existe/);
		reiniciar(); conMundoTv();
		assert.equal((await guardar({ tv: { activa: true, sede: 'cerrada' } })).status, 200);
	});

	test('al guardar la pantalla 2 se mira también lo que hay en la 3, y el mensaje la nombra', async () => {
		conMundoTv();
		const r = await guardar({ tv_pantallas: { 2: { activa: true, sede: 'piedecuesta' }, 3: { activa: true } } });
		assert.equal(r.status, 400);
		assert.match(r.body.error, /pantalla 3/);
	});

	test('lo ya guardado cuenta: no se salta la regla mandando solo la otra pantalla', async () => {
		conMundoTv({ guardado: { con_sedes: true, tv: { activa: true } } });
		const r = await guardar({ tv_pantallas: { 2: { activa: true, sede: 'piedecuesta' } } });
		assert.equal(r.status, 400);
		assert.match(r.body.error, /pantalla 1/);
	});

	test('sin el interruptor «Varias sedes», la sede se ignora y no se consulta nada', async () => {
		conMundoTv({ guardado: {} });
		assert.equal((await guardar({ tv: { activa: true } })).status, 200);
		assert.equal((await guardar({ tv: { activa: true, sede: 'cualquiera' } })).status, 200);
		assert.equal(consultoSedes(), false);
	});

	test('encendido pero sin ninguna sede activa, no se exige', async () => {
		conMundoTv({ sedes: [{ slug: 'cerrada', activa: false }] });
		assert.equal((await guardar({ tv: { activa: true } })).status, 200);
	});

	test('la forma se valida siempre, con o sin sedes: un slug o vacío', async () => {
		for (const sede of ['Con Mayusculas', 'a b', 5, { x: 1 }, 'a_b']) {
			reiniciar(); conMundoTv({ guardado: {} });
			const r = await guardar({ tv: { activa: false, sede } });
			assert.equal(r.status, 400, JSON.stringify(sede));
			assert.match(r.body.error, /no es válida/);
		}
		reiniciar(); conMundoTv({ guardado: {} });
		assert.equal((await guardar({ tv: { activa: false, sede: '' } })).status, 200);
	});

	test('si no se pueden leer las sedes, 500 y nada guardado', async () => {
		conMundoTv({ errorSedes: true });
		const r = await guardar({ tv: { activa: true, sede: 'bucaramanga' } });
		assert.equal(r.status, 500);
		assert.equal(escrituras('restaurantes', 'update').length, 0);
	});

	test('un guardado que no toca las pantallas no consulta las sedes', async () => {
		conMundoTv();
		assert.equal((await guardar({ subtitulo: 'Carta Digital' })).status, 200);
		assert.equal(consultoSedes(), false);
	});
});
