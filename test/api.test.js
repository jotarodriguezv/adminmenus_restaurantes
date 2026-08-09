// Endpoints del panel, probados por HTTP contra el server.js real.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/servidor.js');

const { IDS, tokenCliente, tokenAdmin } = S;
beforeEach(() => S.reiniciar());

// ═══════════════════════════════════════════════════════════════
describe('POST /api/track · analítica del menú público', () => {
	test('un evento válido se registra sin devolver cuerpo', async () => {
		const r = await S.pedir('POST', '/api/track', { restaurante_id: IDS.restaurante, tipo: 'visita' });
		assert.equal(r.status, 204);
	});

	test('rechaza lo que no tiene forma de evento', async () => {
		const malos = [
			[{ restaurante_id: 'no-es-uuid', tipo: 'visita' }, 'id que no es UUID'],
			[{ restaurante_id: IDS.restaurante, tipo: 'borrar_todo' }, 'tipo inventado'],
			[{ restaurante_id: IDS.restaurante, tipo: 'clic' }, 'clic sin producto'],
			[{ tipo: 'visita' }, 'sin restaurante'],
		];
		for (const [cuerpo, etiqueta] of malos) {
			const r = await S.pedir('POST', '/api/track', cuerpo);
			assert.equal(r.status, 400, etiqueta);
		}
	});

	test('valida la forma del UUID antes de ir a la base', async () => {
		// Una petición basura no debe gastar una consulta.
		await S.pedir('POST', '/api/track', { restaurante_id: 'basura', tipo: 'visita' });
		assert.equal(S.llamadas.length, 0, 'no debería haber tocado la base');
	});

	test('el mensaje de error de Postgres no sale al exterior', async () => {
		// El endpoint es público: esos textos exponen tablas y restricciones.
		S.conTabla(() => ({ data: null, error: { message: 'insert violates foreign key constraint "eventos_analitica_..."' } }));
		const r = await S.pedir('POST', '/api/track', { restaurante_id: IDS.restaurante, tipo: 'visita' });
		assert.equal(r.status, 500);
		assert.doesNotMatch(JSON.stringify(r.body), /constraint|eventos_analitica/);
	});

	test('el límite por minuto corta el abuso', async () => {
		// Holgado a propósito: un restaurante lleno comparte una sola IP de
		// wifi, y perder eventos reales sería peor que el abuso que evita.
		let aceptadas = 0, limitadas = 0;
		for (let i = 0; i < 140; i++) {
			const r = await S.pedir('POST', '/api/track', { restaurante_id: IDS.restaurante, tipo: 'visita' });
			if (r.status === 204) aceptadas++; else if (r.status === 429) limitadas++;
		}
		assert.ok(limitadas > 0, 'el límite debe activarse');
		assert.ok(aceptadas <= 120, `no debe dejar pasar más de 120/min (pasaron ${aceptadas})`);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('PATCH y POST /api/productos · precio coherente', () => {
	beforeEach(() => S.conTabla(st =>
		st.tabla === 'productos' && st.op === 'select'
			? { data: { restaurante_id: IDS.restaurante }, error: null }
			: { data: { id: IDS.producto }, error: null }));

	test('el texto se deriva del número, no se confía en el que llega', async () => {
		// El fallo real: dos productos mostraban un precio y el carrito
		// sumaba otro, uno de ellos con un cero de más.
		await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ precio: '$ 4.500', precio_numerico: 45000 }, tokenCliente);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.precio, '$ 45.000');
		assert.equal(g.precio_numerico, 45000);
	});

	test('no se puede mostrar un precio y cobrar otro', async () => {
		await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ precio: '$ 1', precio_numerico: 50000 }, tokenCliente);
		assert.equal(S.ultimaEscritura('productos').precio, '$ 50.000');
	});

	test('si solo llega el texto, el número se deduce de sus dígitos', async () => {
		await S.pedir('PATCH', `/api/productos/${IDS.producto}`, { precio: '$ 12.000' }, tokenCliente);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.precio_numerico, 12000);
		assert.equal(g.precio, '$ 12.000');
	});

	test('una edición que no toca el precio no lo inventa', async () => {
		await S.pedir('PATCH', `/api/productos/${IDS.producto}`, { nombre: 'Arepa de huevo' }, tokenCliente);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.precio, undefined);
		assert.equal(g.precio_numerico, undefined);
	});

	test('un precio imposible se rechaza', async () => {
		for (const cuerpo of [{ precio_numerico: -100 }, { precio_numerico: 'abc' }, { precio: 'sin dígitos' }]) {
			const r = await S.pedir('PATCH', `/api/productos/${IDS.producto}`, cuerpo, tokenCliente);
			assert.equal(r.status, 400, JSON.stringify(cuerpo));
		}
	});

	test('el alta sin precio queda en $ 0, no en nulo', async () => {
		const r = await S.pedir('POST', '/api/productos',
			{ restaurante_id: IDS.restaurante, categoria_id: IDS.categoria, nombre: 'Sin precio' }, tokenCliente);
		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.precio, '$ 0');
		assert.equal(g.precio_numerico, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('PATCH /api/categorias · los horarios dependen del plan', () => {
	const HORARIO = { activo: true, dias: [1, 2, 3], desde: '11:00', hasta: '15:00' };
	const conPlan = (plan, horarioGuardado) => S.conTabla(st => {
		if (st.tabla === 'categorias' && st.op === 'select')
			return { data: { restaurante_id: IDS.restaurante, atributos: horarioGuardado ? { horario: horarioGuardado, imagen_cabecera: 'x.jpg' } : { imagen_cabecera: 'x.jpg' } }, error: null };
		if (st.tabla === 'restaurantes') return { data: { atributos: { plan } }, error: null };
		return { data: { id: IDS.categoria }, error: null };
	});

	test('un plan sin horarios no puede ponerlos por llamada directa', async () => {
		// Esconder el interruptor en el panel no impide llamar a la API.
		conPlan('vitrina');
		await S.pedir('PATCH', `/api/categorias/${IDS.categoria}`,
			{ atributos: { horario: HORARIO, imagen_cabecera: 'x.jpg' } }, tokenCliente);
		const g = S.ultimaEscritura('categorias');
		assert.equal(g.atributos.horario, undefined);
		assert.equal(g.atributos.imagen_cabecera, 'x.jpg', 'lo permitido sí se conserva');
	});

	test('un plan con horarios sí puede', async () => {
		conPlan('completo');
		await S.pedir('PATCH', `/api/categorias/${IDS.categoria}`, { atributos: { horario: HORARIO } }, tokenCliente);
		assert.deepEqual(S.ultimaEscritura('categorias').atributos.horario, HORARIO);
	});

	test('bajar de plan no destruye el horario ya configurado', async () => {
		conPlan('vitrina', HORARIO);
		await S.pedir('PATCH', `/api/categorias/${IDS.categoria}`, { atributos: { imagen_cabecera: 'y.jpg' } }, tokenCliente);
		assert.deepEqual(S.ultimaEscritura('categorias').atributos.horario, HORARIO, 'se conserva lo que ya había');
	});

	test('apagar el horario sigue funcionando', async () => {
		// El panel lo apaga BORRANDO la clave, así que esto es un reemplazo
		// filtrado y no una mezcla con lo guardado.
		conPlan('completo', HORARIO);
		await S.pedir('PATCH', `/api/categorias/${IDS.categoria}`, { atributos: { imagen_cabecera: 'x.jpg' } }, tokenCliente);
		assert.equal(S.ultimaEscritura('categorias').atributos.horario, undefined);
	});

	test('las claves ajenas se descartan', async () => {
		conPlan('completo');
		await S.pedir('PATCH', `/api/categorias/${IDS.categoria}`,
			{ atributos: { horario: HORARIO, css_custom: 'body{display:none}', plan: 'completo' } }, tokenCliente);
		const at = S.ultimaEscritura('categorias').atributos;
		assert.equal(at.css_custom, undefined);
		assert.equal(at.plan, undefined, 'nadie puede ascenderse de plan solo');
	});

	test('el superadmin no queda limitado por el plan', async () => {
		conPlan('vitrina');
		await S.pedir('PATCH', `/api/categorias/${IDS.categoria}`, { atributos: { horario: HORARIO } }, tokenAdmin);
		assert.notEqual(S.ultimaEscritura('categorias').atributos.horario, undefined);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('GET /api/estadisticas', () => {
	const AGREGADO = {
		totalVisitas: 127, totalClics: 141,
		visitasPorDia: { '2026-08-07': 61, '2026-08-08': 14 },
		rankingProductos: [{ producto_id: 'p1', nombre: 'HAMBURGUESA', clics: 20 }],
	};
	const conPlanYZona = (plan, zona) => S.conTabla(() => ({ data: { atributos: { plan, zona_horaria: zona } }, error: null }));

	test('el rango se convierte a instantes de la zona del restaurante', async () => {
		// 'desde' y 'hasta' son días del calendario del restaurante. Sin
		// convertirlos, Postgres los leía como UTC y el rango se corría
		// cinco horas: más de la mitad de los eventos caían en otro día.
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: AGREGADO, error: null }));
		await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-08-01&hasta=2026-08-08`, null, tokenCliente);

		const rpc = S.llamadas.find(l => l.tipo === 'rpc');
		assert.equal(rpc.nombre, 'estadisticas_restaurante');
		assert.equal(rpc.params.p_desde, '2026-08-01T05:00:00.000Z', 'medianoche en Bogotá = 05:00 UTC');
		assert.equal(rpc.params.p_hasta, '2026-08-09T04:59:59.000Z');
		assert.equal(rpc.params.p_zona, 'America/Bogota');
	});

	test('devuelve los nueve campos que consume el panel', async () => {
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: AGREGADO, error: null }));
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-08-01&hasta=2026-08-08`, null, tokenCliente);

		assert.equal(r.status, 200);
		assert.deepEqual(Object.keys(r.body).sort(), [
			'nuncaAbiertos', 'porCategoria', 'porHora', 'rankingProductos',
			'tasaInteraccion', 'totalClics', 'totalVisitas', 'visitasPorDia', 'zona',
		].sort());
		assert.equal(r.body.totalVisitas, 127);
		assert.equal(r.body.tasaInteraccion, 111);
	});

	test('los bloques de analítica llegan tal cual desde SQL', async () => {
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: {
			...AGREGADO,
			porHora: [{ hora: 12, visitas: 19, clics: 75 }, { hora: 19, visitas: 43, clics: 61 }],
			porCategoria: [{ nombre: 'Hamburguesas', emoji: '🍔', clics: 79 }],
			nuncaAbiertos: [{ nombre: 'PERRO SENCILLO', categoria: 'Hot Dogs' }],
		}, error: null }));
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-08-01&hasta=2026-08-08`, null, tokenCliente);

		assert.equal(r.body.porHora.length, 2);
		assert.equal(r.body.porHora[1].hora, 19, 'la hora punta de la cena');
		assert.equal(r.body.porCategoria[0].nombre, 'Hamburguesas');
		assert.equal(r.body.nuncaAbiertos[0].nombre, 'PERRO SENCILLO');
	});

	test('una versión antigua de la función SQL no rompe el panel', async () => {
		// Si el código se despliega antes que la migración, los bloques
		// nuevos no vienen. Deben salir vacíos, no undefined: el panel los
		// recorre con .map y reventaría.
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: AGREGADO, error: null }));   // sin porHora ni el resto
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-08-01&hasta=2026-08-08`, null, tokenCliente);

		assert.deepEqual(r.body.porHora, []);
		assert.deepEqual(r.body.porCategoria, []);
		assert.deepEqual(r.body.nuncaAbiertos, []);
	});

	test('un rango sin datos no divide entre cero', async () => {
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: { totalVisitas: 0, totalClics: 0, visitasPorDia: {}, rankingProductos: [] }, error: null }));
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-01-01&hasta=2026-01-02`, null, tokenCliente);
		assert.equal(r.body.tasaInteraccion, 0);
	});

	test('un plan sin estadísticas se corta ANTES de consultar la base', async () => {
		conPlanYZona('vitrina', 'America/Bogota');
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-01-01&hasta=2026-01-02`, null, tokenCliente);
		assert.equal(r.status, 403);
		assert.equal(S.llamadas.filter(l => l.tipo === 'rpc').length, 0, 'no debe llegar a agregar nada');
	});

	test('un error de la base no se filtra al cliente', async () => {
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: null, error: { message: 'function public.estadisticas_restaurante does not exist' } }));
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-01-01&hasta=2026-01-02`, null, tokenCliente);
		assert.equal(r.status, 500);
		assert.doesNotMatch(JSON.stringify(r.body), /estadisticas_restaurante|function/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('DELETE /api/upload · no se sale de uploads/', () => {
	test('rechaza las rutas escapadas que sí llegan al servidor', async () => {
		// Express decodifica los parámetros de ruta, así que un
		// '..%2F..%2Fserver.js' llega ya convertido en una ruta de salida:
		// esta es la forma que de verdad alcanzaba el fs.unlinkSync.
		const ataques = [
			'/api/upload/x/..%2F..%2Fserver.js',
			'/api/upload/productos/..%2F..%2F..%2Fetc%2Fpasswd',
			'/api/upload/..%2F../.env',
		];
		for (const ruta of ataques) {
			const r = await S.pedir('DELETE', ruta, null, tokenCliente);
			assert.equal(r.status, 400, ruta);
		}
	});

	test('un ".." sin codificar ni siquiera llega al servidor', async () => {
		// El cliente HTTP normaliza el camino antes de enviarlo, así que
		// '/api/upload/productos/..' se convierte en '/api/upload/' y no
		// casa con ninguna ruta. Lo que importa es que no borre nada.
		const r = await S.pedir('DELETE', '/api/upload/productos/..', null, tokenCliente);
		assert.ok([400, 404].includes(r.status), `no debe llegar a borrar (fue ${r.status})`);
	});

	test('un archivo legítimo que no existe da 404, no 400', async () => {
		const r = await S.pedir('DELETE', '/api/upload/productos/1754620000-abc.jpg', null, tokenCliente);
		assert.equal(r.status, 404, 'la ruta es válida; simplemente no está el archivo');
	});

	test('sin token no se borra nada', async () => {
		const r = await S.pedir('DELETE', '/api/upload/productos/foto.jpg');
		assert.equal(r.status, 401);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Control de acceso', () => {
	test('sin token, los endpoints privados responden 401', async () => {
		for (const [metodo, ruta] of [
			['GET', '/api/restaurantes'],
			['GET', `/api/categorias?restaurante_id=${IDS.restaurante}`],
			['GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-01-01&hasta=2026-01-02`],
		]) assert.equal((await S.pedir(metodo, ruta)).status, 401, `${metodo} ${ruta}`);
	});

	test('un token inválido no vale', async () => {
		const r = await S.pedir('GET', '/api/restaurantes', null, 'inventado.no.es');
		assert.equal(r.status, 401);
	});

	test('un cliente no puede ver datos de otro restaurante', async () => {
		const otro = '99999999-9999-4999-8999-999999999999';
		const r = await S.pedir('GET', `/api/categorias?restaurante_id=${otro}`, null, tokenCliente);
		assert.equal(r.status, 403);
	});

	test('crear restaurantes es solo del superadmin', async () => {
		const r = await S.pedir('POST', '/api/restaurantes', { nombre: 'X', slug: 'x', pin: '1234' }, tokenCliente);
		assert.equal(r.status, 403);
	});
});
