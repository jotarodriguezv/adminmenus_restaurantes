// La oferta de precio de un plato (sql/35): lo que acepta el servidor, el espejo
// de la regla en el panel y la ficha.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./helpers/servidor.js');

const { IDS, tokenCliente } = S;
const PUBLIC = path.join(__dirname, '..', 'public');
beforeEach(() => S.reiniciar());

// ═══════════════════════════════════════════════════════════════
describe('PATCH y POST /api/productos · oferta de precio', () => {
	// El plato como está guardado: $ 50.000, sin oferta.
	const guardado = { precio_numerico: 50000, oferta_activa: false, oferta_precio_numerico: null, oferta_desde: null, oferta_hasta: null };
	const patch = (cuerpo, estado = {}) => {
		S.conTabla(st =>
			st.tabla === 'productos' && st.op === 'select'
				? { data: { ...guardado, restaurante_id: IDS.restaurante, ...estado }, error: null }
				: { data: { id: IDS.producto }, error: null });
		return S.pedir('PATCH', `/api/productos/${IDS.producto}`, cuerpo, tokenCliente);
	};
	const alta = (extra) => {
		S.conTabla(st => st.tabla === 'categorias'
			? { data: { restaurante_id: IDS.restaurante }, error: null }
			: { data: { id: IDS.producto }, error: null });
		return S.pedir('POST', '/api/productos',
			{ restaurante_id: IDS.restaurante, categoria_id: IDS.categoria, nombre: 'Con oferta', precio_numerico: 50000, ...extra }, tokenCliente);
	};

	test('se guarda una oferta con precio y fechas', async () => {
		const r = await patch({ oferta_activa: true, oferta_precio_numerico: 40000, oferta_desde: '2026-12-01', oferta_hasta: '2026-12-24' });
		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.oferta_activa, true);
		assert.equal(g.oferta_precio_numerico, 40000);
		assert.equal(g.oferta_desde, '2026-12-01');
		assert.equal(g.oferta_hasta, '2026-12-24');
	});

	test('el texto «false» no enciende la oferta', async () => {
		// Un "false" de texto es verdadero para cualquier if.
		await patch({ oferta_activa: 'false', oferta_precio_numerico: 40000 });
		assert.equal(S.ultimaEscritura('productos').oferta_activa, false);
	});

	test('una edición que no toca la oferta no la escribe', async () => {
		await patch({ nombre: 'Arepa de huevo' });
		const g = S.ultimaEscritura('productos');
		for (const c of ['oferta_activa', 'oferta_precio_numerico', 'oferta_desde', 'oferta_hasta'])
			assert.equal(g[c], undefined, c);
	});

	test('encendida, tiene que traer precio, y menor que el normal', async () => {
		for (const cuerpo of [
			{ oferta_activa: true },
			{ oferta_activa: true, oferta_precio_numerico: '' },
			{ oferta_activa: true, oferta_precio_numerico: 50000 },
			{ oferta_activa: true, oferta_precio_numerico: 60000 },
		]) assert.equal((await patch(cuerpo)).status, 400, JSON.stringify(cuerpo));
	});

	test('se compara con el precio nuevo si llega en el mismo guardado', async () => {
		// El plato sube de $ 50.000 a $ 80.000 a la vez que entra en oferta a
		// $ 60.000: contra el precio viejo sería un error, contra el nuevo no.
		assert.equal((await patch({ precio_numerico: 80000, oferta_activa: true, oferta_precio_numerico: 60000 })).status, 200);
		assert.equal((await patch({ precio_numerico: 55000, oferta_activa: true, oferta_precio_numerico: 60000 })).status, 400);
	});

	test('encender una oferta que ya tenía precio no obliga a mandarlo otra vez', async () => {
		assert.equal((await patch({ oferta_activa: true }, { oferta_precio_numerico: 40000 })).status, 200);
	});

	test('apagada se deja guardar, incluso si ya no es menor que el precio', async () => {
		// Si el restaurante bajó después el precio normal, no puede quedar
		// bloqueado un guardado por una oferta que tiene apagada.
		assert.equal((await patch({ oferta_activa: false, oferta_precio_numerico: 70000 })).status, 200);
	});

	test('las fechas tienen que existir y estar en orden', async () => {
		for (const cuerpo of [
			{ oferta_desde: '2026-02-31' },
			{ oferta_hasta: '24/12/2026' },
			{ oferta_desde: 'mañana' },
			{ oferta_desde: '2026-12-24', oferta_hasta: '2026-12-01' },
		]) assert.equal((await patch(cuerpo)).status, 400, JSON.stringify(cuerpo));
	});

	test('mandar solo una fecha se compara con la que ya estaba guardada', async () => {
		const r = await patch({ oferta_desde: '2026-12-30' }, { oferta_hasta: '2026-12-24' });
		assert.equal(r.status, 400);
	});

	test('fechas vacías se guardan como nulas: oferta sin fin', async () => {
		await patch({ oferta_activa: true, oferta_precio_numerico: 40000, oferta_desde: '', oferta_hasta: '' });
		const g = S.ultimaEscritura('productos');
		assert.equal(g.oferta_desde, null);
		assert.equal(g.oferta_hasta, null);
	});

	test('un precio de oferta negativo o que no es número se rechaza', async () => {
		for (const v of [-1, 'abc'])
			assert.equal((await patch({ oferta_precio_numerico: v })).status, 400, String(v));
	});

	test('un plato nuevo puede nacer en oferta', async () => {
		assert.equal((await alta({ oferta_activa: true, oferta_precio_numerico: 40000 })).status, 200);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.oferta_activa, true);
		assert.equal(g.oferta_precio_numerico, 40000);
	});

	test('un plato nuevo sin oferta no manda columnas de oferta', async () => {
		await alta({});
		const g = S.ultimaEscritura('productos');
		assert.equal(g.oferta_activa, undefined);
	});

	test('un plato nuevo no puede nacer con una oferta más cara', async () => {
		assert.equal((await alta({ oferta_activa: true, oferta_precio_numerico: 90000 })).status, 400);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el espejo de la regla en el panel · mismo juego de casos que la carta', () => {
	const CASOS = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos-oferta.json'), 'utf8'));
	const ctx = vm.createContext({ Number, Math, document: {} });
	vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'oferta.js'), 'utf8')
		, ctx);

	test('hay casos que correr', () => assert.ok(CASOS.casos.length >= 10));

	for (const c of CASOS.casos) {
		test(c.nombre, () => {
			assert.equal(ctx.ofertaEstado(c.plato, c.hoy), c.estado);
			assert.equal(ctx.ofertaPrecioVigente(c.plato, c.hoy), c.precio);
		});
	}
});

describe('oferta.js · porcentaje y precio', () => {
	const ctx = vm.createContext({ Number, Math, document: {} });
	vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'oferta.js'), 'utf8'), ctx);

	test('del porcentaje sale el precio, redondeado a la centena', () => {
		assert.equal(ctx.ofertaPrecioPorPorcentaje(50000, 20), 40000);
		// 15 % de 24.900 son 21.165: se redondea a 21.200.
		assert.equal(ctx.ofertaPrecioPorPorcentaje(24900, 15), 21200);
	});

	test('un porcentaje que no es rebaja no da precio', () => {
		for (const pc of [0, 100, -5, 1.5, NaN]) assert.equal(ctx.ofertaPrecioPorPorcentaje(50000, pc), null, String(pc));
		assert.equal(ctx.ofertaPrecioPorPorcentaje(0, 20), null);
		// En un plato de $ 100 un 1 % redondea a $ 100: igual al normal, no es rebaja.
		assert.equal(ctx.ofertaPrecioPorPorcentaje(100, 1), null);
	});

	test('del precio sale el porcentaje', () => {
		assert.equal(ctx.ofertaPorcentajeDe(50000, 40000), 20);
		assert.equal(ctx.ofertaPorcentajeDe(50000, 50000), null);
		assert.equal(ctx.ofertaPorcentajeDe(50000, 60000), null);
		assert.equal(ctx.ofertaPorcentajeDe(0, 0), null);
	});

	test('la fecha corta no se corre un día por la zona horaria', () => {
		assert.equal(ctx.ofertaFechaCorta('2026-12-24'), '24 dic');
		assert.equal(ctx.ofertaFechaCorta('2026-01-01'), '1 ene');
		assert.equal(ctx.ofertaFechaCorta(null), '');
	});

	test('la marca de la lista avisa de la oferta que terminó sola', () => {
		const p = { precio_numerico: 50000, oferta_activa: true, oferta_precio_numerico: 40000, oferta_hasta: '2026-12-24' };
		assert.equal(ctx.ofertaEtiqueta(p, '2026-12-25').tono, 'aviso');
		assert.match(ctx.ofertaEtiqueta(p, '2026-12-25').texto, /terminada el 24 dic/);
		assert.equal(ctx.ofertaEtiqueta(p, '2026-12-10').tono, 'ok');
		assert.equal(ctx.ofertaEtiqueta({ precio_numerico: 50000 }, '2026-12-10'), null);
	});

	test('los errores de la ficha dicen lo mismo que el servidor', () => {
		const ok = { oferta_activa: true, oferta_precio_numerico: 40000, oferta_desde: null, oferta_hasta: null };
		assert.equal(ctx.ofertaErrores(50000, ok), null);
		assert.match(ctx.ofertaErrores(50000, { ...ok, oferta_precio_numerico: null }), /Escribe el precio/);
		assert.match(ctx.ofertaErrores(50000, { ...ok, oferta_precio_numerico: 50000 }), /menor/);
		assert.match(ctx.ofertaErrores(50000, { ...ok, oferta_desde: '2026-12-30', oferta_hasta: '2026-12-01' }), /antes de empezar/);
		// Apagada no se exige nada del precio.
		assert.equal(ctx.ofertaErrores(50000, { ...ok, oferta_activa: false, oferta_precio_numerico: null }), null);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la ficha y la lista conectan con oferta.js', () => {
	const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('oferta.js se carga antes que el script principal', () => {
		const i = html.indexOf('<script src="oferta.js">');
		assert.ok(i > -1);
		assert.ok(i < html.indexOf('<script>', i), 'tiene que ir antes del script principal');
	});

	test('cada id que usa oferta.js existe en la ficha', () => {
		const js = fs.readFileSync(path.join(PUBLIC, 'oferta.js'), 'utf8');
		const ids = new Set([...js.matchAll(/idDeOferta\('(\w+)'\)/g)].map(m => m[1]));
		assert.ok(ids.size >= 8, 'se esperaban los controles de la ficha');
		for (const id of ids) assert.ok(html.includes(`id="${id}"`), `falta id="${id}" en index.html`);
	});

	test('al guardar viaja la oferta, y se valida antes', () => {
		assert.match(html, /const oferta=ofertaLeerDeFicha\(\)/);
		assert.match(html, /\.\.\.oferta,/);
		assert.match(html, /ofertaErrores\(/);
	});

	test('la ficha se rellena al abrir un plato y se vacía en uno nuevo', () => {
		assert.match(html, /ofertaPintarEnFicha\(p\);/);
		assert.match(html, /ofertaPintarEnFicha\(null\);/);
	});

	test('la lista pinta el precio con la oferta y la marca de estado', () => {
		assert.equal(html.match(/ofertaPintarPrecio\(/g).length, 2, 'escritorio y móvil');
		assert.match(html, /ofertaEtiqueta\(p\)/);
	});

	test('nada de oferta.js usa innerHTML: lo que escribe un restaurante va por DOM', () => {
		const js = fs.readFileSync(path.join(PUBLIC, 'oferta.js'), 'utf8');
		assert.doesNotMatch(js.replace(/^\s*\/\/.*$/gm, ''), /innerHTML/);
	});
});
