// Las rutas de las solicitudes de alta, por HTTP contra el server.js de verdad
// y un Supabase simulado. Las reglas sueltas están en solicitudes.test.js.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Antes de require: sin captcha ni n8n, salvo en las pruebas que los ponen.
delete process.env.TURNSTILE_SECRET;
delete process.env.SOLICITUDES_CLAVE;
delete process.env.N8N_SOLICITUDES_WEBHOOK;

const S = require('./helpers/servidor.js');
const { pedir, llamadas, ultimaEscritura, reiniciar, conTabla, tokenCliente, tokenAdmin } = S;

const ID = '66666666-6666-4666-8666-666666666666';
// Abierta hace un minuto: pasa la comprobación de tiempo.
const buena = (extra = {}) => ({
	negocio: 'La Esquina', contacto: 'Ana', whatsapp: '300 123 4567', autoriza_datos: true,
	abierto_en: Date.now() - 60_000, ...extra,
});
const inserciones = () => llamadas.filter(l => l.tabla === 'solicitudes' && l.op === 'insert');

// El puerto del panel, guardado la primera vez. S.servidor() devuelve el último
// servidor que llamó a listen(), y una prueba de abajo levanta un n8n falso.
let puertoPanel = null;
async function puerto() {
	if (!puertoPanel) { await pedir('GET', '/api/solicitudes/config'); puertoPanel = S.servidor().address().port; }
	return puertoPanel;
}

// pedir() no deja poner cabeceras, y la entrada de n8n va con una.
async function pedirConClave(ruta, cuerpo, clave) {
	const p = await puerto();
	const res = await fetch(`http://127.0.0.1:${p}${ruta}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(clave !== undefined ? { 'x-clave-solicitudes': clave } : {}) },
		body: JSON.stringify(cuerpo),
	});
	return { status: res.status, body: await res.json().catch(() => null) };
}

beforeEach(() => {
	reiniciar();
	delete process.env.SOLICITUDES_CLAVE;
	delete process.env.N8N_SOLICITUDES_WEBHOOK;
});

describe('la página /solicitud', () => {
	test('se sirve sin iniciar sesión', async () => {
		const res = await fetch(`http://127.0.0.1:${await puerto()}/solicitud`);
		assert.equal(res.status, 200);
		assert.match(await res.text(), /Solicita tu carta digital/);
	});

	test('la configuración no enseña nada secreto', async () => {
		process.env.TURNSTILE_SITE_KEY = 'publica';
		const r = await pedir('GET', '/api/solicitudes/config');
		delete process.env.TURNSTILE_SITE_KEY;
		assert.deepEqual(Object.keys(r.body).sort(), ['politica', 'turnstile']);
		assert.equal(r.body.turnstile, 'publica');
	});
});

describe('POST /api/solicitudes · la página pública', () => {
	test('una buena se guarda, con el número normalizado', async () => {
		const r = await pedir('POST', '/api/solicitudes', buena({ comercial: 'Juan' }));
		assert.equal(r.status, 200);
		const g = ultimaEscritura('solicitudes');
		assert.equal(g.whatsapp, '573001234567');
		assert.equal(g.origen, 'campo');
		assert.equal(g.estado, undefined, 'el estado lo pone la base: nueva');
	});

	test('un robot recibe «ok» y no se guarda nada', async () => {
		// No se le dice que se le detectó, para que no aprenda a esquivarlo.
		for (const cuerpo of [buena({ sitio_web: 'spam' }), buena({ abierto_en: Date.now() })]) {
			const r = await pedir('POST', '/api/solicitudes', cuerpo);
			assert.equal(r.status, 200);
			assert.equal(r.body.ok, true);
		}
		assert.equal(inserciones().length, 0);
	});

	test('sin autorización de datos, 400 y nada guardado', async () => {
		const r = await pedir('POST', '/api/solicitudes', buena({ autoriza_datos: false }));
		assert.equal(r.status, 400);
		assert.match(r.body.error, /autorización/);
		assert.equal(inserciones().length, 0);
	});

	test('un número con una solicitud abierta no se guarda otra vez', async () => {
		conTabla(st => (st.tabla === 'solicitudes' && st.op === 'select') ? { data: [{ id: ID }], error: null } : { data: null, error: null });
		const r = await pedir('POST', '/api/solicitudes', buena());
		assert.equal(r.status, 200, 'a quien la envía se le contesta igual');
		assert.equal(inserciones().length, 0);
	});

	test('guarda primero y avisa a n8n después, con la clave', async () => {
		const recibidos = [];
		const n8n = http.createServer((req, res) => {
			let cuerpo = '';
			req.on('data', d => cuerpo += d);
			req.on('end', () => { recibidos.push({ clave: req.headers['x-clave-solicitudes'], cuerpo: JSON.parse(cuerpo) }); res.end('ok'); });
		});
		await new Promise(r => n8n.listen(0, '127.0.0.1', r));
		process.env.N8N_SOLICITUDES_WEBHOOK = `http://127.0.0.1:${n8n.address().port}/hook`;
		process.env.SOLICITUDES_CLAVE = 'secreta';
		conTabla(st => (st.tabla === 'solicitudes' && st.op === 'insert')
			? { data: { id: ID, origen: 'web', negocio: 'La Esquina', contacto: 'Ana', whatsapp: '573001234567', creado_en: '2026-09-19T10:00:00Z' }, error: null }
			: { data: null, error: null });
		try {
			await pedir('POST', '/api/solicitudes', buena());
			for (let i = 0; i < 50 && !recibidos.length; i++) await new Promise(r => setTimeout(r, 20));
			assert.equal(recibidos.length, 1);
			assert.equal(recibidos[0].clave, 'secreta');
			assert.equal(recibidos[0].cuerpo.whatsapp_enlace, 'https://wa.me/573001234567');
			assert.match(recibidos[0].cuerpo.texto, /La Esquina/);
		} finally {
			n8n.close();
		}
	});

	test('si n8n no contesta, la solicitud queda guardada igual', async () => {
		process.env.N8N_SOLICITUDES_WEBHOOK = 'http://127.0.0.1:9/nada';
		conTabla(st => (st.tabla === 'solicitudes' && st.op === 'insert') ? { data: { id: ID, origen: 'web', negocio: 'x', contacto: 'y', whatsapp: '573001234567' }, error: null } : { data: null, error: null });
		const r = await pedir('POST', '/api/solicitudes', buena());
		assert.equal(r.status, 200);
		assert.equal(inserciones().length, 1);
	});
});

describe('POST /api/solicitudes/meta · la entrada de n8n', () => {
	test('sin clave configurada, la puerta está cerrada', async () => {
		const r = await pedirConClave('/api/solicitudes/meta', buena(), 'lo-que-sea');
		assert.equal(r.status, 503);
	});

	test('con la clave equivocada, o sin ella, 401', async () => {
		process.env.SOLICITUDES_CLAVE = 'secreta';
		assert.equal((await pedirConClave('/api/solicitudes/meta', buena(), 'otra')).status, 401);
		assert.equal((await pedirConClave('/api/solicitudes/meta', buena())).status, 401);
		assert.equal(inserciones().length, 0);
	});

	test('con la clave se guarda como de Meta, con su lead y su campaña', async () => {
		process.env.SOLICITUDES_CLAVE = 'secreta';
		const r = await pedirConClave('/api/solicitudes/meta',
			{ ...buena(), abierto_en: undefined, meta_lead_id: 'lead-123', campana: 'Lanzamiento', otra_cosa: 'no' }, 'secreta');
		assert.equal(r.status, 200);
		const g = ultimaEscritura('solicitudes');
		assert.equal(g.origen, 'meta');
		assert.equal(g.meta_lead_id, 'lead-123');
		assert.deepEqual(g.datos_origen, { campana: 'Lanzamiento' }, 'solo las claves conocidas');
	});

	test('el mismo lead dos veces (n8n reintentó) no es un error', async () => {
		process.env.SOLICITUDES_CLAVE = 'secreta';
		conTabla(st => (st.tabla === 'solicitudes' && st.op === 'insert') ? { data: null, error: { code: '23505', message: 'duplicate' } } : { data: null, error: null });
		const r = await pedirConClave('/api/solicitudes/meta', { ...buena(), meta_lead_id: 'lead-123' }, 'secreta');
		assert.equal(r.status, 200);
		assert.equal(r.body.repetida, true);
	});
});

describe('la bandeja · solo el superadmin', () => {
	test('un restaurante no puede ver las solicitudes', async () => {
		assert.equal((await pedir('GET', '/api/solicitudes', null, tokenCliente)).status, 403);
		assert.equal((await pedir('GET', '/api/solicitudes')).status, 401);
	});

	test('el superadmin las ve', async () => {
		conTabla(() => ({ data: [{ id: ID, negocio: 'La Esquina' }], error: null }));
		const r = await pedir('GET', '/api/solicitudes', null, tokenAdmin);
		assert.equal(r.status, 200);
		assert.equal(r.body[0].negocio, 'La Esquina');
	});

	test('cambiar el estado: solo a uno que existe', async () => {
		assert.equal((await pedir('PATCH', `/api/solicitudes/${ID}`, { estado: 'borrada' }, tokenAdmin)).status, 400);
		assert.equal((await pedir('PATCH', `/api/solicitudes/${ID}`, { estado: 'aprobada', restaurante_id: ID }, tokenAdmin)).status, 200);
		assert.deepEqual({ ...ultimaEscritura('solicitudes') }, { estado: 'aprobada', restaurante_id: ID });
		assert.equal((await pedir('PATCH', `/api/solicitudes/${ID}`, { estado: 'nueva' }, tokenCliente)).status, 403);
	});

	test('descartar varias de golpe, solo identificadores válidos', async () => {
		const r = await pedir('POST', '/api/solicitudes/descartar', { ids: [ID, 'no-es-un-id'] }, tokenAdmin);
		assert.equal(r.status, 200);
		assert.equal(r.body.descartadas, 1);
		assert.deepEqual({ ...ultimaEscritura('solicitudes') }, { estado: 'descartada' });
	});
});

describe('el límite por IP', () => {
	// La última a propósito: el contador es del proceso, y agotarlo antes
	// estropearía las demás pruebas de este archivo.
	test('pasado el límite por hora, 429', async () => {
		let ultimo;
		for (let i = 0; i < 25; i++) ultimo = await pedir('POST', '/api/solicitudes', buena({ sitio_web: 'x' }));
		assert.equal(ultimo.status, 429);
	});
});
