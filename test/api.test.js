// Endpoints del panel, probados por HTTP contra el server.js real.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
			[{ restaurante_id: IDS.restaurante, tipo: 'agregar_carrito' }, 'agregado sin producto'],
			[{ tipo: 'visita' }, 'sin restaurante'],
		];
		for (const [cuerpo, etiqueta] of malos) {
			const r = await S.pedir('POST', '/api/track', cuerpo);
			assert.equal(r.status, 400, etiqueta);
		}
	});

	test('acepta el evento de agregado al carrito', async () => {
		// El tipo debe coincidir con la restricción de la base: si aquí se
		// aceptara uno que allí no existe, el evento se perdería con un 500.
		const r = await S.pedir('POST', '/api/track',
			{ restaurante_id: IDS.restaurante, tipo: 'agregar_carrito', producto_id: IDS.producto });
		assert.equal(r.status, 204);
		const escrito = S.ultimaEscritura('eventos_analitica');
		assert.equal(escrito.tipo, 'agregar_carrito');
		assert.equal(escrito.producto_id, IDS.producto);
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
		// La categoría tiene que existir y ser del mismo restaurante: desde que
		// eso se comprueba, el falso Supabase tiene que contestarlo.
		S.conTabla(st => st.tabla === 'categorias'
			? { data: { restaurante_id: IDS.restaurante }, error: null }
			: { data: null, error: null });
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

	test('devuelve exactamente los campos que consume el panel', async () => {
		// Esta prueba fija el contrato con el panel. Si falla tras un cambio,
		// hay que mirar si el panel también se actualizó: quitar un campo lo
		// rompe en silencio, porque el JavaScript no avisa de un undefined.
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: AGREGADO, error: null }));
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-08-01&hasta=2026-08-08`, null, tokenCliente);

		assert.equal(r.status, 200);
		assert.deepEqual(Object.keys(r.body).sort(), [
			'masAgregados', 'nuncaAbiertos', 'porCategoria', 'porHora', 'rankingProductos',
			'tasaAnadido', 'tasaInteraccion', 'totalAgregados', 'totalClics', 'totalVisitas',
			'visitasPorDia', 'zona',
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

	test('la tasa de añadido se calcula sobre clics, no sobre visitas', async () => {
		// Una "visita" es una carga de página, no una persona: quien recarga
		// tres veces cuenta tres. Calcular la conversión sobre eso engañaría.
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: { ...AGREGADO, totalClics: 200, totalAgregados: 50, masAgregados: [] }, error: null }));
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-08-01&hasta=2026-08-08`, null, tokenCliente);
		assert.equal(r.body.tasaAnadido, 25, '50 de 200 fichas abiertas = 25%');
	});

	test('un restaurante sin carrito no produce una división por cero', async () => {
		conPlanYZona('completo', 'America/Bogota');
		S.conRpc(() => ({ data: { ...AGREGADO, totalClics: 0, totalAgregados: 0 }, error: null }));
		const r = await S.pedir('GET', `/api/estadisticas?restaurante_id=${IDS.restaurante}&desde=2026-08-01&hasta=2026-08-08`, null, tokenCliente);
		assert.equal(r.body.tasaAnadido, 0);
		assert.deepEqual(r.body.masAgregados, []);
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
describe('POST /api/video · la carta en video depende del plan', () => {
	// Convertir un video cuesta minuto y medio de CPU en un servidor de un
	// núcleo. Si la puerta no estuviera cerrada aquí, cualquier restaurante
	// podría llenar la cola llamando directamente y dejar al resto sin panel.
	const conPlan = plan => S.conTabla(st => {
		if (st.tabla === 'restaurantes') return { data: { atributos: { plan } }, error: null };
		// El insert en trabajos_video devuelve la fila creada.
		return { data: { id: 'trabajo-1', estado: 'pendiente' }, error: null };
	});

	test('un plan sin video no puede subir por llamada directa', async () => {
		conPlan('completo');
		const r = await S.pedirArchivo('/api/video', { restaurante_id: IDS.restaurante }, tokenCliente);

		assert.equal(r.status, 403);
		assert.match(r.body.error, /plan/i);
		assert.equal(S.llamadas.some(l => l.tabla === 'trabajos_video'), false,
			'no debe encolar nada si el plan no lo incluye');
	});

	test('el plan de video sí puede', async () => {
		conPlan('video');
		const r = await S.pedirArchivo('/api/video', { restaurante_id: IDS.restaurante }, tokenCliente);

		assert.equal(r.status, 200);
		assert.equal(r.body.trabajo_id, 'trabajo-1');
	});

	test('el superadmin no queda limitado por el plan', async () => {
		conPlan('vitrina');
		const r = await S.pedirArchivo('/api/video', { restaurante_id: IDS.restaurante }, tokenAdmin);

		assert.equal(r.status, 200);
	});

	// uploads/originales lo comparten los dos ficheros de prueba, y el ejecutor
	// los corre en PROCESOS PARALELOS: mientras esta prueba mira la carpeta,
	// otra puede tener un archivo suyo a medio ciclo de vida. Contar archivos
	// convertía eso en un rojo que no era de nadie.
	//
	// Lo que hay que comprobar no es "no aparece ningún archivo" —eso no está
	// en nuestra mano— sino "no se QUEDA ninguno de los nuestros". Así que se
	// espera a que la carpeta vuelva a como estaba: un archivo ajeno se limpia
	// solo en unos milisegundos, y una fuga de verdad no se limpia nunca y
	// agota el plazo.
	const esperarCarpetaLimpia = async (dir, antes, plazoMs = 4000) => {
		const nuevos = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => !antes.has(f));
		const hasta = Date.now() + plazoMs;
		while (nuevos().length && Date.now() < hasta)
			await new Promise(r => setTimeout(r, 50));
		return nuevos();
	};

	test('el archivo no se queda en el disco cuando se rechaza', async () => {
		// multer ya lo escribió cuando la comprobación de plan corre, así que
		// cada salida por la puerta de atrás tiene que borrarlo. Si no, un
		// restaurante sin plan llena el disco a base de intentos rechazados.
		const dir = path.join(__dirname, '..', 'uploads', 'originales');
		const antes = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);

		conPlan('completo');
		await S.pedirArchivo('/api/video', { restaurante_id: IDS.restaurante }, tokenCliente);

		assert.deepEqual(await esperarCarpetaLimpia(dir, antes), [],
			'el video rechazado no debe quedarse en uploads/originales');
	});

	test('una subida que se corta a medias tampoco deja el trozo', async () => {
		// Pasó de verdad: dos intentos de subir un video de 70 MB se cayeron a
		// media transferencia y dejaron 150 MB tirados en el disco.
		//
		// El descartar() de la ruta no cubre esto. Vive dentro del manejador, y
		// cuando el cliente se va multer nunca llama a next(), así que el
		// manejador no llega a correr: no hay req.file y no hay nadie que
		// borre. Tiene que limpiar alguien de más afuera.
		const dir = path.join(__dirname, '..', 'uploads', 'originales');
		const antes = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);

		conPlan('video');
		await S.subirYCortar('/api/video', { restaurante_id: IDS.restaurante }, tokenCliente);

		// El borrado va con medio segundo de respiro, para que multer suelte su
		// escritura antes; se espera a que la carpeta vuelva a como estaba en
		// vez de dormir un rato fijo y contar.
		assert.deepEqual(await esperarCarpetaLimpia(dir, antes), [],
			'el trozo a medio subir debe borrarse solo');
	});

	test('una subida cortada no encola ningún trabajo', async () => {
		// Media conversión de medio archivo no le sirve a nadie, y dejaría una
		// fila en 'pendiente' que el worker intentaría tres veces antes de
		// rendirse.
		conPlan('video');
		await S.subirYCortar('/api/video', { restaurante_id: IDS.restaurante }, tokenCliente);
		await new Promise(r => setTimeout(r, 300));

		assert.equal(S.llamadas.some(l => l.tabla === 'trabajos_video'), false);
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

// ═══════════════════════════════════════════════════════════════
// Va al final del archivo a propósito: el limitador cuenta por IP y todas las
// pruebas salen de 127.0.0.1, así que estas dos comparten contador entre sí y
// con cualquier otra que llamara a /api/login. El orden importa.
describe('POST /api/login · límite de intentos', () => {
	const fallar  = () => S.pedir('POST', '/api/login', { slug: 'admin', pin: '0000' });
	const acertar = () => S.pedir('POST', '/api/login', { slug: 'admin', pin: '9999' });

	test('un acierto borra los fallos acumulados', async () => {
		// Si no se limpiaran, el personal de un restaurante que se equivoca
		// varias veces a lo largo del día acabaría bloqueado sin haber hecho
		// nada raro.
		for (let i = 0; i < 5; i++) assert.equal((await fallar()).status, 401);

		assert.equal((await acertar()).status, 200, 'con el PIN bueno entra');

		// El contador quedó a cero: cinco fallos más siguen siendo 401 y no 429.
		for (let i = 0; i < 5; i++) assert.equal((await fallar()).status, 401);
		assert.equal((await acertar()).status, 200);
	});

	test('a los diez fallos bloquea, aunque el PIN sea el correcto', async () => {
		for (let i = 0; i < 10; i++) assert.equal((await fallar()).status, 401);

		// Esta es la propiedad que importa: una vez bloqueado no hay forma de
		// seguir probando, ni siquiera acertando. Si esto devolviera 200, el
		// límite no serviría de nada — bastaría con seguir intentando.
		const r = await acertar();
		assert.equal(r.status, 429, 'el bloqueo va antes de comprobar el PIN');
		assert.match(r.body.error, /intentos/i);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('GET /api/og/:slug · la vista previa al compartir', () => {
	// El robot de WhatsApp pide la URL, lee el HTML crudo y se va: no ejecuta
	// JavaScript. Como la carta pública se pinta en el navegador, el HTML que
	// sale del servidor no sabe de qué restaurante es, y por eso compartir un
	// enlace mandaba una tarjeta vacía. Esto es lo que la rellena.
	const conRestaurante = fila => S.conTabla(st =>
		st.tabla === 'restaurantes' ? { data: fila, error: null } : { data: null, error: null });

	// nginx manda host y path porque es el único que sabe con qué dominio
	// entraron: la misma carta responde de las dos formas.
	const og = (host, path) => `/api/og?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}`;

	const BONZAS = {
		// El id hace falta: sin él, fotoDeAlgunPlato() sale sin consultar y la
		// prueba de "no se gasta una consulta de más" pasaría siempre, mida lo
		// que mida. Comprobado quitando la guarda: no fallaba nada.
		id: 'r-bonzas', nombre: 'Bonzas', slug: 'bonzas', activo: true,
		logo_url: 'https://admin.example.com/uploads/logos/bonzas.png',
		fondo_url: 'https://admin.example.com/uploads/fondos/textura.jpg',
		atributos: { subtitulo: 'Carta Digital · 2026' },
	};

	test('devuelve HTML, no JSON, y sin pedir credenciales', async () => {
		// Un robot no se autentica. Si esto pidiera token, no habría vista previa.
		conRestaurante(BONZAS);
		const r = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.equal(r.status, 200);
		assert.match(r.tipo, /text\/html/);
	});

	test('el nombre y el subtítulo del restaurante van en la tarjeta', async () => {
		conRestaurante(BONZAS);
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.match(html, /<meta property="og:title" content="Bonzas">/);
		assert.match(html, /og:description" content="Carta Digital · 2026"/);
		assert.match(html, /<title>Bonzas<\/title>/);
	});

	test('la imagen es el logo, no el fondo', async () => {
		// Un fondo suele ser una textura, y una textura en la vista previa no
		// dice de quién es la carta.
		conRestaurante(BONZAS);
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.match(html, /og:image" content="[^"]*logos\/bonzas\.png"/);
		assert.ok(!html.includes('textura.jpg'), 'el fondo no debe ganarle al logo');
	});

	test('sin ninguna imagen no se inventa una etiqueta vacía', async () => {
		// Un og:image vacío hace que algunos clientes enseñen un hueco roto;
		// sin la etiqueta, enseñan la tarjeta de solo texto, que se ve bien.
		conRestaurante({ nombre: 'Sin Fotos', slug: 'sinfotos', activo: true, atributos: {} });
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/sinfotos'));
		assert.ok(!html.includes('og:image'), 'no debe haber og:image');
		assert.match(html, /twitter:card" content="summary"/, 'tarjeta pequeña sin imagen');
	});


	test('sin logo, una foto de plato antes que rendirse', async () => {
		// De siete restaurantes reales, tres no tenían logo — y dos de ellos
		// tenían seis platos fotografiados cada uno. Mandar la tarjeta sin foto
		// teniendo eso es tirar lo que más llama la atención de un menú.
		S.conTabla(st => {
			if (st.tabla === 'restaurantes') return { data: { id: 'r1', nombre: 'Voro', slug: 'voro', activo: true, atributos: {} }, error: null };
			if (st.tabla === 'productos') return { data: { imagen_url: 'https://x/uploads/productos/tartar.jpg' }, error: null };
			return { data: null, error: null };
		});
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/voro'));
		assert.match(html, /og:image" content="[^"]*tartar\.jpg"/);
		assert.match(html, /twitter:card" content="summary_large_image"/);
	});

	test('con logo no se gasta una consulta de más', async () => {
		// El logo lo eligió el negocio para representarse; la foto de plato es
		// el último recurso, no una mejora.
		conRestaurante(BONZAS);
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.match(html, /og:image" content="[^"]*logos\/bonzas\.png"/);
		assert.equal(S.llamadas.some(l => l.tabla === 'productos'), false,
			'no debería haber preguntado por platos');
	});

	test('sin logo y sin platos con foto, tarjeta de texto', async () => {
		S.conTabla(st => st.tabla === 'restaurantes'
			? { data: { id: 'r1', nombre: 'A Ojo Cerrado', slug: 'aojocerrado', activo: true, atributos: {} }, error: null }
			: { data: null, error: null });
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/aojocerrado'));
		assert.ok(!html.includes('og:image'));
		assert.match(html, /og:title" content="A Ojo Cerrado"/);
	});

	test('og:site_name es el restaurante, no la plataforma', async () => {
		// La tarjeta es del negocio. Los planes sin marca pagan por eso.
		conRestaurante(BONZAS);
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.match(html, /og:site_name" content="Bonzas"/);
		assert.ok(!/og:site_name" content="VMenus"/.test(html));
	});

	test('un restaurante que no existe da tarjeta genérica, no un error', async () => {
		// Y no confirma qué slugs existen. Un 404 o un 500 quedan recordados
		// por algunos robots y luego cuesta que vuelvan a mirar.
		conRestaurante(null);
		const r = await S.pedirTexto(og('menu.vmenus.co', '/noexiste'));
		assert.equal(r.status, 200);
		assert.match(r.html, /Carta digital/);
	});

	test('un restaurante suspendido no se anuncia con su nombre', async () => {
		conRestaurante({ ...BONZAS, activo: false });
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.ok(!html.includes('Bonzas'), 'no debe filtrar el nombre de un negocio suspendido');
	});

	test('el destino puede venir de nginx, que sabe con qué dominio entraron', async () => {
		// La misma carta responde en menu.vmenus.co/bonzas y en bonzas.vmenus.co.
		conRestaurante(BONZAS);
		const { html } = await S.pedirTexto(og('bonzas.vmenus.co', '/'));
		assert.match(html, /og:url" content="https:\/\/bonzas\.vmenus\.co\/"/);
		assert.match(html, /http-equiv="refresh" content="0;url=https:\/\/bonzas\.vmenus\.co\/"/);
	});


	test('las dos formas de URL resuelven el mismo restaurante', async () => {
		// menu.vmenus.co/bonzas y bonzas.vmenus.co son la misma carta. La regla
		// es la misma que leerSlug() en vmenus-app/core/loader.js — están
		// duplicadas porque son dos aplicaciones distintas, y si se
		// desincronizan la tarjeta anuncia un restaurante y el enlace abre otro.
		for (const [host, path] of [['menu.vmenus.co', '/bonzas'], ['bonzas.vmenus.co', '/']]) {
			S.reiniciar();
			conRestaurante(BONZAS);
			await S.pedirTexto(og(host, path));
			// Se mira el slug que se CONSULTÓ, no el nombre que salió: el
			// Supabase de pruebas devuelve la misma fila pida lo que pida, así
			// que afirmar sobre el nombre pasaría aunque la resolución
			// estuviera rota. Lo comprobé rompiéndola: no fallaba nada.
			const consulta = S.llamadas.find(l => l.tabla === 'restaurantes');
			assert.equal(consulta?.filtros?.slug, 'bonzas', `con ${host}${path}`);
		}
	});

	test('cada forma apunta a su propia dirección', async () => {
		// En el subdominio el slug ya está en el dominio: poner /bonzas ahí
		// daría una URL que no es la que el visitante compartió.
		conRestaurante(BONZAS);
		assert.match((await S.pedirTexto(og('menu.vmenus.co', '/bonzas'))).html,
			/og:url" content="https:\/\/menu\.vmenus\.co\/bonzas"/);
		assert.match((await S.pedirTexto(og('bonzas.vmenus.co', '/'))).html,
			/og:url" content="https:\/\/bonzas\.vmenus\.co\/"/);
	});

	test('el dominio en mayúsculas encuentra el restaurante igual', async () => {
		// Los nombres de dominio no distinguen mayúsculas y un robot puede
		// mandarlo como quiera, pero el slug en la base está en minúsculas: sin
		// normalizar, la consulta no encuentra nada y sale la tarjeta genérica.
		conRestaurante(BONZAS);
		await S.pedirTexto(og('MENU.VMENUS.CO', '/BONZAS'));
		assert.equal(S.llamadas.find(l => l.tabla === 'restaurantes')?.filtros?.slug, 'bonzas');
	});

	test('los subdominios de la plataforma no son restaurantes', async () => {
		// www.vmenus.co/bonzas es la carta de bonzas, no la de un restaurante
		// llamado "www". Misma lista de reservados que en loader.js.
		conRestaurante(BONZAS);
		await S.pedirTexto(og('www.vmenus.co', '/bonzas'));
		assert.equal(S.llamadas.find(l => l.tabla === 'restaurantes')?.filtros?.slug, 'bonzas');
	});

	test('un destino que no es una URL no se acepta', async () => {
		// Llega de una cadena de consulta: si se colara un javascript: ahí, el
		// enlace de "Entrar" sería un ataque servido desde nuestro dominio.
		conRestaurante(BONZAS);
		const { html } = await S.pedirTexto(og('javascript:alert(1)', '/bonzas'));
		assert.ok(!html.includes('javascript:'), 'debe caer al destino por defecto');
		assert.match(html, /og:url" content="https:\/\/menu\.vmenus\.co\/bonzas"/);
	});

	test('el nombre no puede inyectar etiquetas', async () => {
		conRestaurante({ ...BONZAS, nombre: '"><script>alert(1)</script>' });
		const { html } = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.ok(!html.includes('<script>'), 'debe ir escapado');
		assert.match(html, /&lt;script&gt;/);
	});

	test('se puede cachear: los robots piden lo mismo muchas veces', async () => {
		conRestaurante(BONZAS);
		const r = await S.pedirTexto(og('menu.vmenus.co', '/bonzas'));
		assert.match(r.cache, /max-age=\d+/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la dirección de un restaurante · lo que no puede ser', () => {
	// El slug es la URL pública y lo que va impreso en los QR. Un slug malo no
	// se nota al crearlo: se nota cuando el restaurante ya repartió los códigos.
	//
	// El panel ya comprueba el formato antes de enviar, así que por la interfaz
	// no entran. Se comprueba igualmente en el servidor porque el panel es UN
	// cliente y no la única puerta, y porque la comprobación ya existía en el
	// PATCH: tenerla en un sitio y no en el otro es lo que deja pasar justo el
	// caso que importa, el de crear.

	test('al CREAR se rechaza un formato inválido, igual que al editar', async () => {
		const r = await S.pedir('POST', '/api/restaurantes',
			{ nombre: 'Mi Sitio', slug: 'Mi Restaurante', pin: '1234' }, tokenAdmin);

		assert.equal(r.status, 400);
		assert.match(r.body.error, /solo minúsculas/);
		assert.equal(S.llamadas.some(l => l.tabla === 'restaurantes' && l.op === 'insert'), false,
			'no puede llegar a escribirse');
	});

	test('"admin" se rechaza: ese restaurante nunca podría entrar a su panel', async () => {
		// POST /api/login desvía todo lo que sea 'admin' al PIN de superadmin.
		// Un restaurante con esa dirección compararía su PIN contra PIN_ADMIN y
		// fallaría siempre, con un "Credenciales incorrectas" que no da ninguna
		// pista de por qué. Se cierra al crearlo, que es cuando tiene arreglo.
		const r = await S.pedir('POST', '/api/restaurantes',
			{ nombre: 'Panel', slug: 'admin', pin: '1234' }, tokenAdmin);

		assert.equal(r.status, 400);
		assert.match(r.body.error, /reservada/);
		assert.equal(S.llamadas.some(l => l.tabla === 'restaurantes' && l.op === 'insert'), false);
	});

	test('los subdominios de la plataforma tampoco', async () => {
		// slugDesde() los trata como "esto no es un restaurante" para poder
		// distinguir menu.vmenus.co/bonzas de bonzas.vmenus.co. Registrar uno
		// crearía una carta inalcanzable por subdominio.
		for (const slug of ['menu', 'www', 'app', 'api']) {
			const r = await S.pedir('POST', '/api/restaurantes',
				{ nombre: 'X', slug, pin: '1234' }, tokenAdmin);
			assert.equal(r.status, 400, `"${slug}" tendría que rechazarse`);
			assert.match(r.body.error, /reservada/);
		}
	});

	test('el mensaje propone una salida en vez de solo decir que no', async () => {
		// Mismo criterio que el de la dirección repetida: quien lo lee tiene que
		// saber qué escribir a continuación.
		const r = await S.pedir('POST', '/api/restaurantes',
			{ nombre: 'X', slug: 'admin', pin: '1234' }, tokenAdmin);
		assert.match(r.body.error, /admin-restaurante/);
	});

	test('al EDITAR se aplica la misma regla', async () => {
		// Si solo se cerrara al crear, bastaría renombrarse después para acabar
		// en el mismo sitio.
		const r = await S.pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`,
			{ slug: 'admin' }, tokenAdmin);

		assert.equal(r.status, 400);
		assert.match(r.body.error, /reservada/);
	});

	test('una dirección normal sigue pasando', async () => {
		// La comprobación no puede volverse tan estricta que estorbe: los guiones
		// y los números son justo lo que se usa para desempatar dos sedes.
		const r = await S.pedir('POST', '/api/restaurantes',
			{ nombre: 'Doña Rosa', slug: 'donarosa-bucaramanga2', pin: '1234' }, tokenAdmin);

		assert.notEqual(r.status, 400);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('POST /api/restaurantes · la dirección repetida se explica', () => {
	// Dos restaurantes SÍ pueden llamarse igual: hay una Doña Rosa en San Gil
	// y otra en Bucaramanga. Lo que no puede repetirse es la dirección, y esa
	// restricción la pone la base (restaurantes_slug_key).
	const conChoque = () => S.conTabla(st =>
		st.tabla === 'restaurantes' && st.op === 'insert'
			? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "restaurantes_slug_key"' } }
			: { data: { id: IDS.restaurante }, error: null });

	test('dice qué pasó y qué hacer, en vez del error de Postgres', async () => {
		conChoque();
		const r = await S.pedir('POST', '/api/restaurantes',
			{ nombre: 'Doña Rosa', slug: 'donarosa', pin: '1234' }, tokenAdmin);

		assert.equal(r.status, 409);
		assert.match(r.body.error, /ya la usa otro restaurante/);
		assert.match(r.body.error, /donarosa-bucaramanga/, 'debe sugerir la salida');
	});

	test('no se filtra el nombre del índice de la base', async () => {
		// Enseñar "restaurantes_slug_key" no ayuda a nadie y cuenta cómo está
		// hecha la base por dentro.
		conChoque();
		const r = await S.pedir('POST', '/api/restaurantes',
			{ nombre: 'Doña Rosa', slug: 'donarosa', pin: '1234' }, tokenAdmin);
		assert.ok(!/constraint|slug_key|duplicate key/.test(r.body.error));
	});

	test('un fallo distinto no se disfraza de dirección repetida', async () => {
		// Si cualquier error de insert dijera "la dirección está repetida", el
		// día que falle otra cosa se buscaría en el sitio equivocado.
		S.conTabla(st => st.tabla === 'restaurantes' && st.op === 'insert'
			? { data: null, error: { code: '08006', message: 'connection failure' } }
			: { data: { id: IDS.restaurante }, error: null });
		const r = await S.pedir('POST', '/api/restaurantes',
			{ nombre: 'Nuevo', slug: 'nuevo', pin: '1234' }, tokenAdmin);
		assert.equal(r.status, 500);
		assert.ok(!/ya la usa/.test(r.body.error));
	});
});

// ═══════════════════════════════════════════════════════════════
describe('POST /api/upload · la extensión no la escribe quien sube', () => {
	// El nombre del archivo lo genera el servidor entero salvo la extensión.
	// Antes se comprobaba con /jpeg|jpg|png|webp/ sin anclar, así que bastaba
	// con que esas letras salieran en algún sitio y la extensión se escribía
	// en el disco tal cual llegara.
	const dirProductos = () => path.join(__dirname, '..', 'uploads', 'productos');
	const listar = () => (fs.existsSync(dirProductos()) ? fs.readdirSync(dirProductos()) : []);

	test('rechaza extensiones que solo CONTIENEN una buena', async () => {
		// '.apng' y '.webpx' son formatos que no se sirven; '.jpeg2000' tampoco.
		for (const nombre of ['foto.apng', 'foto.webpx', 'foto.jpeg2000']) {
			const r = await S.pedirArchivo('/api/upload', {}, tokenCliente, nombre);
			assert.equal(r.status, 400, `${nombre} no debería entrar`);
		}
	});

	test('rechaza una extensión con caracteres raros dentro', async () => {
		// Este es el que hacía daño de verdad. 'foto.jpg;rm' pasaba el filtro y
		// se guardaba con el punto y coma en el nombre; limpieza.js lee los
		// nombres con [A-Za-z0-9._-]+ y de la URL guardada solo reconocía hasta
		// el ';'. Disco y base dejaban de coincidir y, pasados los siete días de
		// gracia, el limpiador borraba una foto que estaba EN USO.
		for (const nombre of ['foto.jpg;rm', 'foto.png?x=1', 'foto.jpg ']) {
			const r = await S.pedirArchivo('/api/upload', {}, tokenCliente, nombre);
			assert.equal(r.status, 400, `${nombre} no debería entrar`);
		}
	});

	test('lo que se guarda solo lleva extensiones de la lista', async () => {
		const antes = new Set(listar());
		const r = await S.pedirArchivo('/api/upload', {}, tokenCliente, 'MiFoto.JPEG');

		assert.equal(r.status, 200);
		// La caja no importa: se normaliza a minúsculas.
		assert.match(r.body.filename, /^\d+-[a-z0-9]+\.jpeg$/,
			'el nombre lo genera el servidor entero salvo la extensión');

		// Y lo que quedó en el disco se llama exactamente igual que lo que se
		// devolvió: es lo que hace que la base y el disco no se separen.
		const nuevos = listar().filter(f => !antes.has(f));
		assert.deepEqual(nuevos, [r.body.filename]);
		for (const f of nuevos) fs.unlinkSync(path.join(dirProductos(), f));
	});

	test('el nombre original no llega al disco', async () => {
		const antes = new Set(listar());
		const r = await S.pedirArchivo('/api/upload', {}, tokenCliente, 'nombre del cliente.png');

		assert.equal(r.status, 200);
		assert.ok(!r.body.filename.includes('nombre'), 'no debe quedar rastro del original');
		assert.ok(!/\s/.test(r.body.filename), 'ni espacios, que limpieza.js no reconoce');

		for (const f of listar().filter(x => !antes.has(x))) fs.unlinkSync(path.join(dirProductos(), f));
	});
});

// ═══════════════════════════════════════════════════════════════
describe('productos · la categoría tiene que ser del mismo restaurante', () => {
	// El permiso se comprueba sobre restaurante_id, y eso no dice nada sobre a
	// quién pertenece la categoría. El daño es callado: el plato se guarda, el
	// panel dice que todo fue bien, y la carta pública —que agrupa por las
	// categorías DEL restaurante— no lo enseña en ningún sitio. Desde fuera
	// parece que se perdió al guardar.
	const AJENA = '44444444-4444-4444-8444-444444444444';
	const OTRO  = '55555555-5555-4555-8555-555555555555';

	const conCategoriaDe = restauranteId => S.conTabla(st => {
		if (st.tabla === 'categorias') return { data: { restaurante_id: restauranteId }, error: null };
		if (st.tabla === 'productos')  return { data: { restaurante_id: IDS.restaurante }, error: null };
		return { data: null, error: null };
	});

	test('no se puede crear un plato en la categoría de otro negocio', async () => {
		conCategoriaDe(OTRO);
		const r = await S.pedir('POST', '/api/productos',
			{ restaurante_id: IDS.restaurante, categoria_id: AJENA, nombre: 'Colado' }, tokenCliente);
		assert.equal(r.status, 400);
		assert.match(r.body.error, /no es de este restaurante/);
	});

	test('tampoco se puede mover uno existente a ella', async () => {
		conCategoriaDe(OTRO);
		const r = await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ categoria_id: AJENA }, tokenCliente);
		assert.equal(r.status, 400);
	});

	test('una categoría que no existe se rechaza en vez de guardarse', async () => {
		S.conTabla(st => st.tabla === 'productos'
			? { data: { restaurante_id: IDS.restaurante }, error: null }
			: { data: null, error: null });
		const r = await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ categoria_id: AJENA }, tokenCliente);
		assert.equal(r.status, 400);
		assert.match(r.body.error, /no existe/);
	});

	test('la categoría propia sí pasa', async () => {
		conCategoriaDe(IDS.restaurante);
		const r = await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ categoria_id: IDS.categoria }, tokenCliente);
		assert.equal(r.status, 200);
	});

	test('un plato sin categoría sigue siendo válido', async () => {
		// Se admite a propósito: hay altas que se guardan antes de decidir en
		// qué categoría van.
		S.conTabla(st => st.tabla === 'productos'
			? { data: { restaurante_id: IDS.restaurante }, error: null }
			: { data: null, error: null });
		const r = await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ nombre: 'Sin categoría' }, tokenCliente);
		assert.equal(r.status, 200);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('productos · qué se puede escribir dentro de "atributos"', () => {
	// Restaurantes y categorías ya filtraban su objeto "atributos"; productos
	// no. Llegaba entero desde el navegador y se guardaba tal cual.
	//
	// Importa porque 'imagenes' se pinta en el PANEL, y el panel lo abre el
	// superadmin para cualquier restaurante con su token en sessionStorage:
	// es la vía para que lo que escribe un restaurante acabe ejecutándose en
	// la sesión de quien administra a todos.
	const conProducto = atributos => S.conTabla(st => {
		if (st.tabla === 'productos')  return { data: { restaurante_id: IDS.restaurante, atributos }, error: null };
		if (st.tabla === 'categorias') return { data: { restaurante_id: IDS.restaurante }, error: null };
		return { data: null, error: null };
	});

	test('una clave inventada no se guarda', async () => {
		conProducto({});
		await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ atributos: { popular: true, colada: 'lo que sea' } }, tokenCliente);

		const g = S.ultimaEscritura('productos');
		assert.equal(g.atributos.popular, true, 'lo legítimo sí pasa');
		assert.equal(g.atributos.colada, undefined, 'lo demás no');
	});

	test('el cliente no puede inventarse el video de un plato', async () => {
		// Lo pone el worker al terminar de convertir. Aceptarlo del navegador
		// dejaría a un plato apuntando a un archivo de cualquier sitio.
		conProducto({});
		await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ atributos: { video: { url: 'https://otro-sitio/x.mp4' } } }, tokenCliente);

		assert.equal(S.ultimaEscritura('productos').atributos.video, undefined);
	});

	test('pero guardar otra cosa NO borra el video que ya tenía', async () => {
		// El panel manda el objeto completo, así que descartar 'video' sin más
		// se lo llevaría por delante al cambiar el nombre de un plato. Ocho
		// platos en producción tienen video: esto es lo que impide perderlos.
		const video = { url: 'https://panel/uploads/videos/a.mp4', portada: 'https://panel/uploads/miniaturas/a.jpg', duracion: 8 };
		conProducto({ video });

		await S.pedir('PATCH', `/api/productos/${IDS.producto}`,
			{ atributos: { popular: true } }, tokenCliente);

		assert.deepEqual(S.ultimaEscritura('productos').atributos.video, video,
			'el video del plato tiene que sobrevivir a cualquier otro guardado');
	});

	test('el alta también filtra', async () => {
		S.conTabla(st => st.tabla === 'categorias'
			? { data: { restaurante_id: IDS.restaurante }, error: null }
			: { data: null, error: null });
		await S.pedir('POST', '/api/productos', {
			restaurante_id: IDS.restaurante, categoria_id: IDS.categoria, nombre: 'Nuevo',
			atributos: { filtros: ['vegetariano'], colada: 1, video: { url: 'https://otro/x.mp4' } },
		}, tokenCliente);

		const g = S.ultimaEscritura('productos');
		assert.deepEqual(g.atributos.filtros, ['vegetariano']);
		assert.equal(g.atributos.colada, undefined);
		assert.equal(g.atributos.video, undefined);
	});

	test('un PATCH sin "atributos" no los toca', async () => {
		// Cambiar solo el precio no puede vaciarle la personalización al plato.
		conProducto({ popular: true, video: { url: 'x' } });
		await S.pedir('PATCH', `/api/productos/${IDS.producto}`, { nombre: 'Otro' }, tokenCliente);

		assert.equal(S.ultimaEscritura('productos').atributos, undefined);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('DELETE /api/productos/:id/video · retirar un video sin perderlo', () => {
	// Hasta ahora no se podía quitar. 'video' vive en
	// ATRIBUTOS_PRODUCTO_DEL_SERVIDOR, así que atributosProducto() lo copia
	// siempre de lo guardado e ignora al cliente — lo que protege a la cola de
	// conversión de que el panel la pise, y de paso hacía imposible borrarlo
	// por PATCH. Un plato que estrenaba video se quedaba con él para siempre.
	//
	// Por eso es una ruta propia: la regla de que el cliente no escribe
	// 'video' sigue intacta, y lo que se añade es una acción que dice qué hace.

	const VIDEO = {
		url:      'https://panel/uploads/videos/a.mp4',
		portada:  'https://panel/uploads/miniaturas/a.jpg',
		duracion: 8,
	};
	const conPlato = atributos => S.conTabla(st =>
		st.tabla === 'productos'
			? { data: { restaurante_id: IDS.restaurante, atributos }, error: null }
			: { data: null, error: null });

	test('quita el video y deja el resto de atributos intactos', async () => {
		conPlato({ video: VIDEO, popular: true, filtros: ['picante'] });
		const r = await S.pedir('DELETE', `/api/productos/${IDS.producto}/video`, null, tokenCliente);

		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.atributos.video, undefined, 'el video se va');
		assert.equal(g.atributos.popular, true, 'lo demás se queda');
		assert.deepEqual(g.atributos.filtros, ['picante']);
	});

	test('NO borra el archivo, ni la portada, ni el master, ni el trabajo', async () => {
		// El master es de donde se vuelve a recortar cuando la carta cambia de
		// formato, y esta plataforma ya decidió no destruirlo: borrar un trabajo
		// 'listo' con master se rechaza con ese mismo argumento. Quitar un video
		// de la carta no es motivo para perder el original — y además deja la
		// salida de "Reconvertir" para volver a ponerlo sin subir nada.
		conPlato({ video: VIDEO });
		await S.pedir('DELETE', `/api/productos/${IDS.producto}/video`, null, tokenCliente);

		assert.equal(
			S.llamadas.some(l => l.tabla === 'trabajos_video' && l.op === 'delete'), false,
			'la fila del trabajo tiene que sobrevivir: es lo que referencia los archivos');
	});

	test('un plato sin video lo dice en vez de fingir que hizo algo', async () => {
		conPlato({ popular: true });
		const r = await S.pedir('DELETE', `/api/productos/${IDS.producto}/video`, null, tokenCliente);

		assert.equal(r.status, 409);
		assert.match(r.body.error, /no tiene video/);
		assert.equal(S.llamadas.some(l => l.tabla === 'productos' && l.op === 'update'), false,
			'no se escribe nada');
	});

	test('no se le puede quitar el video a un plato de otro restaurante', async () => {
		S.conTabla(st => st.tabla === 'productos'
			? { data: { restaurante_id: 'otro-resto', atributos: { video: VIDEO } }, error: null }
			: { data: null, error: null });
		const r = await S.pedir('DELETE', `/api/productos/${IDS.producto}/video`, null, tokenCliente);

		assert.equal(r.status, 403);
		assert.equal(S.llamadas.some(l => l.tabla === 'productos' && l.op === 'update'), false);
	});

	test('el plan no estorba para retirar', async () => {
		// El plan decide quién puede CREAR videos. A quien se le acabó tiene que
		// poder retirar los que ya tiene: al revés sería dejarle una carta con
		// algo que ya no puede administrar.
		conPlato({ video: VIDEO, plan: 'vitrina' });
		const r = await S.pedir('DELETE', `/api/productos/${IDS.producto}/video`, null, tokenCliente);

		assert.equal(r.status, 200);
	});
});

describe('/api/facturacion · la cobranza sale de la tabla pública', () => {
	// dia_pago y ultimo_pago vivían en restaurantes.atributos, que tiene
	// lectura pública: la carta pide 'atributos' entero, así que viajaban al
	// navegador de cada comensal y se veían en el inspector sin ninguna llave.
	// No es una credencial — es información nuestra: quién paga y quién no.

	test('un restaurante no puede ver la cobranza', async () => {
		// Ni la suya. Es un dato de la plataforma SOBRE él, no suyo, así que
		// aquí no vale canAccessRestaurante().
		const r = await S.pedir('GET', '/api/facturacion', null, tokenCliente);
		assert.equal(r.status, 403);
	});

	test('ni escribirla', async () => {
		const r = await S.pedir('PATCH', `/api/facturacion/${IDS.restaurante}`,
			{ ultimo_pago: '2026-08-24' }, tokenCliente);
		assert.equal(r.status, 403);
	});

	test('sin credenciales tampoco', async () => {
		assert.equal((await S.pedir('GET', '/api/facturacion')).status, 401);
	});

	test('el superadmin sí, y va contra la tabla nueva', async () => {
		S.conTabla(() => ({ data: [{ restaurante_id: IDS.restaurante, dia_pago: 1, ultimo_pago: '2026-07-12' }], error: null }));
		const r = await S.pedir('GET', '/api/facturacion', null, tokenAdmin);

		assert.equal(r.status, 200);
		assert.equal(r.body[0].dia_pago, 1);
		assert.ok(S.llamadas.some(l => l.tabla === 'restaurantes_facturacion'),
			'tiene que leer de restaurantes_facturacion, no de restaurantes');
	});

	test('anotar un pago escribe la fecha', async () => {
		await S.pedir('PATCH', `/api/facturacion/${IDS.restaurante}`,
			{ ultimo_pago: '2026-08-24' }, tokenAdmin);

		const g = S.ultimaEscritura('restaurantes_facturacion');
		assert.equal(g.ultimo_pago, '2026-08-24');
		assert.equal(g.restaurante_id, IDS.restaurante);
	});

	test('un día fuera del mes se rechaza', async () => {
		for (const dia of [0, 32, -1, 'lunes']) {
			const r = await S.pedir('PATCH', `/api/facturacion/${IDS.restaurante}`, { dia_pago: dia }, tokenAdmin);
			assert.equal(r.status, 400, String(dia));
		}
	});

	test('una fecha mal escrita se rechaza antes de llegar a la base', async () => {
		// Si llegara, Postgres respondería con nombres de tabla dentro.
		const r = await S.pedir('PATCH', `/api/facturacion/${IDS.restaurante}`,
			{ ultimo_pago: '24/08/2026' }, tokenAdmin);
		assert.equal(r.status, 400);
	});

	test('vacío borra, ausente no toca', async () => {
		// Sin esa diferencia no habría forma de quitarle el día de pago a un
		// restaurante: mandar '' tendría que significar lo mismo que no mandarlo.
		await S.pedir('PATCH', `/api/facturacion/${IDS.restaurante}`, { dia_pago: '' }, tokenAdmin);
		assert.equal(S.ultimaEscritura('restaurantes_facturacion').dia_pago, null, 'vacío borra');

		S.reiniciar();
		await S.pedir('PATCH', `/api/facturacion/${IDS.restaurante}`, { ultimo_pago: '2026-08-24' }, tokenAdmin);
		const g = S.ultimaEscritura('restaurantes_facturacion');
		assert.equal('dia_pago' in g, false, 'lo que no se manda no se toca');
	});

	test('nadie puede volver a colar la cobranza dentro de atributos', async () => {
		// La otra mitad de la migración. Si esto no estuviera, una pantalla
		// vieja o una llamada suelta devolvería el dato a la tabla pública y
		// la fuga volvería sin que nadie se diera cuenta.
		S.conTabla(() => ({ data: { id: IDS.restaurante, atributos: {} }, error: null }));
		await S.pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`,
			{ atributos: { dia_pago: 15, ultimo_pago: '2026-08-24', color_card: '#111' } }, tokenAdmin);

		const g = S.ultimaEscritura('restaurantes');
		assert.equal(g.atributos.dia_pago, undefined);
		assert.equal(g.atributos.ultimo_pago, undefined);
		assert.equal(g.atributos.color_card, '#111', 'lo que sí es apariencia pasa igual');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('/api/ia/cupo · el freno de la factura', () => {
	// Generar con IA cuesta dinero cada vez. El cupo se expone para que el
	// panel pueda enseñar "te quedan N" y para que el superadmin lo amplíe.

	// El fake compartido no sabe de conteos con head:true, que es lo que usa
	// cupo.usadas(). Se le enseña aquí.
	const conCupo = (cupoConfigurado, usadas) => S.conTabla(st => {
		if (st.tabla === 'restaurantes_ia') return { data: { cupo: cupoConfigurado }, error: null, count: null };
		if (st.tabla === 'generaciones_ia') return { data: [], error: null, count: usadas };
		return { data: null, error: null };
	});

	test('el restaurante puede ver su propio cupo', async () => {
		// A diferencia de la cobranza, esto SÍ es información que necesita para
		// usar la función.
		conCupo(24, 5);
		const r = await S.pedir('GET', `/api/ia/cupo?restaurante_id=${IDS.restaurante}`, null, tokenCliente);
		assert.equal(r.status, 200);
		assert.deepEqual(r.body, { cupo: 24, activa: true, usadas: 5, disponibles: 19 });
	});

	test('pero no el de otro restaurante', async () => {
		conCupo(24, 0);
		const r = await S.pedir('GET', '/api/ia/cupo?restaurante_id=99999999-9999-4999-8999-999999999999',
			null, tokenCliente);
		assert.equal(r.status, 403);
	});

	test('sin restaurante_id no adivina de quién', async () => {
		assert.equal((await S.pedir('GET', '/api/ia/cupo', null, tokenCliente)).status, 400);
	});

	test('agotado, disponibles llega a cero y no a negativo', async () => {
		conCupo(24, 30);
		const r = await S.pedir('GET', `/api/ia/cupo?restaurante_id=${IDS.restaurante}`, null, tokenCliente);
		assert.equal(r.body.disponibles, 0);
	});

	test('el restaurante NO puede ampliarse el cupo', async () => {
		// Es la palanca comercial de "escríbenos para ampliar". Si el cliente
		// pudiera moverla, no sería un freno.
		const r = await S.pedir('PATCH', `/api/ia/cupo/${IDS.restaurante}`, { cupo: 500 }, tokenCliente);
		assert.equal(r.status, 403);
	});

	test('el superadmin sí, y queda escrito', async () => {
		const r = await S.pedir('PATCH', `/api/ia/cupo/${IDS.restaurante}`, { cupo: 40 }, tokenAdmin);
		assert.equal(r.status, 200);
		assert.equal(S.ultimaEscritura('restaurantes_ia').cupo, 40);
	});

	test('un cupo absurdo se rechaza antes de guardarse', async () => {
		// El tope no es técnico: es para que una errata de teclado no autorice
		// mil generaciones.
		// 1.5 estaba pasando: parseInt lo convertía en 1 y lo guardaba en
		// silencio. En el número que autoriza el gasto, guardar algo distinto
		// de lo que se mandó no vale.
		for (const malo of [-1, 501, 'muchas', null, 1.5, '', {}]) {
			const r = await S.pedir('PATCH', `/api/ia/cupo/${IDS.restaurante}`, { cupo: malo }, tokenAdmin);
			assert.equal(r.status, 400, String(malo));
		}
	});

	test('cero es válido: apaga la función para ese restaurante', async () => {
		const r = await S.pedir('PATCH', `/api/ia/cupo/${IDS.restaurante}`, { cupo: 0 }, tokenAdmin);
		assert.equal(r.status, 200);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('/api/resumen-video · la vista de la lista de restaurantes', () => {
	test('solo el superadmin lo ve', async () => {
		// Es la vista de operación de la plataforma, no del negocio.
		assert.equal((await S.pedir('GET', '/api/resumen-video', null, tokenCliente)).status, 403);
		assert.equal((await S.pedir('GET', '/api/resumen-video')).status, 401);
	});

	test('devuelve el agregado tal cual lo da la base', async () => {
		S.conRpc(() => ({ data: { [IDS.restaurante]: {
			videos_listos: 4, videos_en_curso: 1, videos_error: 0, ia_usadas: 3, ia_cupo: 24,
		} }, error: null }));

		const r = await S.pedir('GET', '/api/resumen-video', null, tokenAdmin);
		assert.equal(r.status, 200);
		assert.equal(r.body[IDS.restaurante].videos_listos, 4);
		assert.equal(r.body[IDS.restaurante].ia_usadas, 3);
	});

	test('lo agrega la base, no Node', async () => {
		// Contarlo aquí serían dos consultas por restaurante y eso crece con
		// los clientes. Es el mismo criterio que las estadísticas.
		S.conRpc(() => ({ data: {}, error: null }));
		await S.pedir('GET', '/api/resumen-video', null, tokenAdmin);
		assert.ok(S.llamadas.some(l => l.tipo === 'rpc' && l.nombre === 'resumen_video_restaurantes'));
	});

	test('si la base falla, no se filtra su mensaje', async () => {
		S.conRpc(() => ({ data: null, error: { message: 'relation "x" does not exist' } }));
		const r = await S.pedir('GET', '/api/resumen-video', null, tokenAdmin);
		assert.equal(r.status, 500);
		assert.doesNotMatch(r.body.error, /relation/);
	});
});
