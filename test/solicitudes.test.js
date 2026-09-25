// Las reglas de las solicitudes de alta (solicitudes.js). Las rutas, por HTTP,
// están en solicitudes-api.test.js.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../solicitudes.js');

const BUENA = {
	negocio: 'La Esquina del Sabor', contacto: 'Ana Pérez', whatsapp: '300 123 4567',
	ciudad: 'Bucaramanga', tipo_negocio: 'Restaurante', autoriza_datos: true,
};

describe('el número de WhatsApp', () => {
	test('un celular colombiano sin indicativo recibe el 57', () => {
		assert.equal(S.normalizarWhatsapp('300 123 4567'), '573001234567');
		assert.equal(S.normalizarWhatsapp('(300) 123-4567'), '573001234567');
	});
	test('con indicativo se queda como está, con + o con 00', () => {
		assert.equal(S.normalizarWhatsapp('+57 300 123 4567'), '573001234567');
		assert.equal(S.normalizarWhatsapp('0034 612 345 678'), '34612345678');
	});
	test('lo que no es un número no pasa', () => {
		for (const malo of ['', 'hola', '123', '1234567890123456789', null])
			assert.equal(S.normalizarWhatsapp(malo), null, String(malo));
	});
});

describe('validar una solicitud', () => {
	test('una buena sale lista para guardar', () => {
		const { datos, error } = S.validarSolicitud(BUENA, 'web');
		assert.equal(error, undefined);
		assert.equal(datos.whatsapp, '573001234567');
		assert.equal(datos.origen, 'web');
		assert.equal(datos.autoriza_datos, true);
		assert.ok(datos.autorizado_en);
	});

	test('con nombre de comercial es del equipo en campo', () => {
		assert.equal(S.validarSolicitud({ ...BUENA, comercial: 'Juan' }, 'web').datos.origen, 'campo');
	});

	test('lo de Meta sigue siendo de Meta aunque traiga comercial', () => {
		assert.equal(S.validarSolicitud({ ...BUENA, comercial: 'x' }, 'meta').datos.origen, 'meta');
	});

	test('sin autorización de datos no se guarda nada', () => {
		// Estrictamente true: una casilla sin marcar puede llegar de mil formas.
		for (const v of [false, 'true', 'on', 1, undefined])
			assert.match(S.validarSolicitud({ ...BUENA, autoriza_datos: v }, 'web').error, /autorización/, String(v));
	});

	test('faltan datos obligatorios', () => {
		assert.match(S.validarSolicitud({ ...BUENA, negocio: '  ' }, 'web').error, /negocio/);
		assert.match(S.validarSolicitud({ ...BUENA, contacto: '' }, 'web').error, /contacto/);
		assert.match(S.validarSolicitud({ ...BUENA, whatsapp: '12' }, 'web').error, /WhatsApp/);
	});

	test('lo demasiado largo se rechaza, no se recorta', () => {
		assert.match(S.validarSolicitud({ ...BUENA, negocio: 'x'.repeat(121) }, 'web').error, /largo/);
		assert.match(S.validarSolicitud({ ...BUENA, notas: 'x'.repeat(1001) }, 'web').error, /larg/);
	});

	test('las notas conservan los saltos de línea; lo demás se limpia', () => {
		const { datos } = S.validarSolicitud({ ...BUENA, negocio: '  La   Esquina ', notas: 'Uno\nDos' }, 'web');
		assert.equal(datos.negocio, 'La Esquina');
		assert.equal(datos.notas, 'Uno\nDos');
	});

	test('un origen que no existe no pasa', () => {
		assert.ok(S.validarSolicitud(BUENA, 'correo').error);
	});
});

describe('¿lo mandó un robot?', () => {
	const ahora = 1_000_000;
	test('una persona normal, no', () => {
		assert.equal(S.pareceRobot({ abierto_en: ahora - 20_000 }, ahora), null);
	});
	test('el campo trampa relleno, sí', () => {
		assert.equal(S.pareceRobot({ abierto_en: ahora - 20_000, sitio_web: 'http://x' }, ahora), 'campo trampa');
	});
	test('enviada en menos de lo que tarda una persona, sí', () => {
		assert.equal(S.pareceRobot({ abierto_en: ahora - 500 }, ahora), 'demasiado rápido');
	});
	test('sin la hora de apertura de la página, sí', () => {
		assert.equal(S.pareceRobot({}, ahora), 'sin hora de apertura');
	});
});

describe('el aviso para n8n y Telegram', () => {
	const s = { id: 'x1', origen: 'campo', comercial: 'Juan', negocio: 'La Esquina', contacto: 'Ana',
		whatsapp: '573001234567', ciudad: 'Bucaramanga', tipo_negocio: 'Restaurante', notas: null, creado_en: '2026-09-19T10:00:00Z' };

	test('el texto trae lo que hace falta para llamar ya', () => {
		const t = S.textoDelAviso(s, 'https://panel.test');
		assert.match(t, /La Esquina/);
		assert.match(t, /https:\/\/wa\.me\/573001234567/);
		assert.match(t, /Equipo en campo \(Juan\)/);
		assert.match(t, /Revisarla: https:\/\/panel\.test/);
	});

	test('lo que se manda a n8n lleva los datos sueltos y el texto', () => {
		const a = S.avisoParaN8n(s, null);
		assert.equal(a.evento, 'solicitud_nueva');
		assert.equal(a.whatsapp_enlace, 'https://wa.me/573001234567');
		assert.equal(a.enlace_panel, null);
		assert.equal(typeof a.texto, 'string');
	});

	test('avisar a n8n manda la clave y nunca lanza', async () => {
		const pedidos = [];
		const ok = await S.avisarN8n(s, { url: 'https://n8n.test/hook', clave: 'k', fetchFn: async (url, op) => { pedidos.push({ url, op }); return { ok: true }; } });
		assert.equal(ok, true);
		assert.equal(pedidos[0].op.headers['x-clave-solicitudes'], 'k');
		assert.equal(JSON.parse(pedidos[0].op.body).negocio, 'La Esquina');

		// Si n8n está caído, se registra y ya: la solicitud sigue guardada.
		const errores = [];
		const fallo = await S.avisarN8n(s, { url: 'https://n8n.test/hook', fetchFn: async () => { throw new Error('caído'); }, log: { error: m => errores.push(m) } });
		assert.equal(fallo, false);
		assert.match(errores[0], /quedó guardada/);
	});

	test('sin dirección de n8n no se intenta nada', async () => {
		assert.equal(await S.avisarN8n(s, { url: '', fetchFn: () => { throw new Error('no'); } }), false);
	});
});

describe('las descartadas se borran a los seis meses', () => {
	// Lo promete la política de privacidad (cláusula 05). Si esto deja de
	// borrar, se incumple, así que se comprueba qué borra y qué NO.
	const falso = (respuesta = { data: [{ id: 'a' }, { id: 'b' }], error: null }) => {
		const hecho = { filtros: [] };
		const q = {
			delete() { hecho.borra = true; return q; },
			eq(c, v) { hecho.filtros.push(['eq', c, v]); return q; },
			lte(c, v) { hecho.filtros.push(['lte', c, v]); return q; },
			select() { return Promise.resolve(respuesta); },
		};
		return { hecho, supabase: { from(t) { hecho.tabla = t; return q; } } };
	};
	const silencio = { log() {}, error() {} };

	test('el corte son seis meses antes de ahora', () => {
		assert.equal(S.MESES_DESCARTADAS, 6);
		assert.equal(S.corteDescartadas(new Date('2026-09-24T12:00:00Z')).toISOString(), '2026-03-24T12:00:00.000Z');
	});

	test('borra solo descartadas, y solo si se descartaron antes del corte', async () => {
		const { hecho, supabase } = falso();
		const n = await S.purgarDescartadas(supabase, { ahora: new Date('2026-09-24T12:00:00Z'), log: silencio });
		assert.equal(n, 2);
		assert.equal(hecho.tabla, 'solicitudes');
		assert.equal(hecho.borra, true);
		assert.deepEqual(hecho.filtros, [
			['eq', 'estado', 'descartada'],
			['lte', 'descartada_en', '2026-03-24T12:00:00.000Z'],
		]);
	});

	test('cuenta desde descartada_en, no desde actualizado_en', async () => {
		// Con actualizado_en, cada nota escrita después correría el plazo.
		const { hecho, supabase } = falso();
		await S.purgarDescartadas(supabase, { log: silencio });
		assert.equal(hecho.filtros.some(([, c]) => c === 'actualizado_en' || c === 'creado_en'), false);
	});

	test('si la base falla, no lanza: corre en un temporizador', async () => {
		const errores = [];
		const { supabase } = falso({ data: null, error: { message: 'sin conexión' } });
		const n = await S.purgarDescartadas(supabase, { log: { log() {}, error: m => errores.push(m) } });
		assert.equal(n, null);
		assert.match(errores[0], /sin conexión/);
	});
});
