// Las presentaciones de un plato (1X / 2X, 500 ml / 750 ml): la validación del servidor,
// cómo se guardan y las funciones puras de la ficha (docs/presentaciones.md).
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./helpers/servidor.js');
const { normalizarPresentaciones, precioBaseDePresentaciones } = require('../precios.js');

const { IDS, tokenCliente } = S;
beforeEach(() => S.reiniciar());

// ═══════════════════════════════════════════════════════════════
describe('normalizarPresentaciones · la regla', () => {
	const dos = [{ nombre: '1X', precio_numerico: 12000 }, { nombre: '2X', precio_numerico: 20000 }];

	test('nada o vacío es «sin presentaciones»', () => {
		for (const v of [undefined, null, []]) assert.deepEqual(normalizarPresentaciones(v), { lista: [] });
	});

	test('dos válidas se aceptan y reciben un id cada una', () => {
		const { lista } = normalizarPresentaciones(dos);
		assert.equal(lista.length, 2);
		assert.deepEqual(lista.map(x => x.nombre), ['1X', '2X']);
		assert.deepEqual(lista.map(x => x.precio_numerico), [12000, 20000]);
		for (const x of lista) assert.match(x.id, /^[a-z0-9]{3,24}$/);
		assert.notEqual(lista[0].id, lista[1].id);
	});

	test('una sola no es una presentación', () => {
		assert.match(normalizarPresentaciones([dos[0]]).error, /Una sola presentación/);
	});

	test('el id que el plato ya tenía se respeta; uno inventado se cambia', () => {
		const actuales = [{ id: 'pabc123', nombre: '1X', precio_numerico: 1 }];
		const { lista } = normalizarPresentaciones(
			[{ id: 'pabc123', nombre: 'Sencillo', precio_numerico: 12000 }, { id: 'pajeno99', nombre: 'Doble', precio_numerico: 20000 }], actuales);
		assert.equal(lista[0].id, 'pabc123');
		assert.notEqual(lista[1].id, 'pajeno99');
	});

	test('el mismo id repetido no se duplica', () => {
		const actuales = [{ id: 'pabc123', nombre: 'a', precio_numerico: 1 }];
		const { lista } = normalizarPresentaciones(
			[{ id: 'pabc123', nombre: 'A', precio_numerico: 1 }, { id: 'pabc123', nombre: 'B', precio_numerico: 2 }], actuales);
		assert.notEqual(lista[0].id, lista[1].id);
	});

	test('rechaza nombre vacío, repetido, largo, precio inválido o demasiadas', () => {
		assert.match(normalizarPresentaciones([{ nombre: ' ', precio_numerico: 1 }, dos[1]]).error, /nombre/);
		assert.match(normalizarPresentaciones([dos[0], { nombre: ' 1x ', precio_numerico: 5 }]).error, /Dos presentaciones/);
		assert.match(normalizarPresentaciones([{ nombre: 'x'.repeat(41), precio_numerico: 1 }, dos[1]]).error, /hasta 40/);
		assert.match(normalizarPresentaciones([{ nombre: 'A', precio_numerico: -1 }, dos[1]]).error, /precio/);
		assert.match(normalizarPresentaciones([{ nombre: 'A', precio_numerico: 'abc' }, dos[1]]).error, /precio/);
		assert.match(normalizarPresentaciones([{ nombre: 'A', precio_numerico: 1e9 }, dos[1]]).error, /demasiado alto/);
		assert.match(normalizarPresentaciones(Array.from({ length: 9 }, (_, i) => ({ nombre: 'n' + i, precio_numerico: i }))).error, /hasta 8/);
		assert.match(normalizarPresentaciones('hola').error, /lista/);
	});

	test('el precio base es el de la más barata', () => {
		assert.equal(precioBaseDePresentaciones(normalizarPresentaciones([dos[1], dos[0]]).lista), 12000);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('POST y PATCH /api/productos · presentaciones', () => {
	const dos = [{ nombre: '1X', precio_numerico: 20000 }, { nombre: '2X', precio_numerico: 12000 }];
	const patch = (cuerpo, estado = {}) => {
		S.conTabla(st =>
			st.tabla === 'productos' && st.op === 'select'
				? { data: { restaurante_id: IDS.restaurante, precio_numerico: 50000, atributos: {}, ...estado }, error: null }
				: { data: { id: IDS.producto }, error: null });
		return S.pedir('PATCH', `/api/productos/${IDS.producto}`, cuerpo, tokenCliente);
	};
	const alta = (extra) => {
		S.conTabla(st => st.tabla === 'categorias'
			? { data: { restaurante_id: IDS.restaurante }, error: null }
			: { data: { id: IDS.producto }, error: null });
		return S.pedir('POST', '/api/productos',
			{ restaurante_id: IDS.restaurante, categoria_id: IDS.categoria, nombre: 'Fresas con crema', precio_numerico: 99999, ...extra }, tokenCliente);
	};

	test('al crear: se guardan con ids y el precio del plato pasa a ser el de la más barata', async () => {
		const r = await alta({ atributos: { presentaciones: dos } });
		assert.equal(r.status, 200);
		const fila = S.ultimaEscritura('productos');
		assert.equal(fila.atributos.presentaciones.length, 2);
		assert.ok(fila.atributos.presentaciones.every(x => x.id));
		assert.equal(fila.precio_numerico, 12000);
		assert.equal(fila.precio, '$ 12.000');
	});

	test('al crear: con presentaciones la oferta sale apagada', async () => {
		await alta({ atributos: { presentaciones: dos }, oferta_activa: true, oferta_precio_numerico: 5000 });
		assert.equal(S.ultimaEscritura('productos').oferta_activa, false);
	});

	test('una lista mala se rechaza con 400 y no escribe', async () => {
		const r = await alta({ atributos: { presentaciones: [dos[0]] } });
		assert.equal(r.status, 400);
		assert.match(r.body.error, /Una sola presentación/);
		assert.equal(S.llamadas.filter(l => l.tabla === 'productos' && l.op === 'insert').length, 0);
	});

	test('al editar: las nuevas reemplazan y el precio se sincroniza', async () => {
		const r = await patch({ atributos: { presentaciones: dos } });
		assert.equal(r.status, 200);
		const g = S.ultimaEscritura('productos');
		assert.equal(g.precio_numerico, 12000);
		assert.equal(g.oferta_activa, false);
	});

	test('al editar: una lista vacía las quita', async () => {
		const prev = [{ id: 'pa1b2c3', nombre: '1X', precio_numerico: 1 }, { id: 'pd4e5f6', nombre: '2X', precio_numerico: 2 }];
		await patch({ atributos: { presentaciones: [] }, precio_numerico: 15000 }, { atributos: { presentaciones: prev } });
		const g = S.ultimaEscritura('productos');
		assert.equal(g.atributos.presentaciones, undefined);
		assert.equal(g.precio_numerico, 15000);
	});

	test('al editar: un guardado de atributos sin la clave las conserva', async () => {
		const prev = [{ id: 'pa1b2c3', nombre: '1X', precio_numerico: 5000 }, { id: 'pd4e5f6', nombre: '2X', precio_numerico: 9000 }];
		await patch({ atributos: { popular: true } }, { atributos: { presentaciones: prev } });
		const g = S.ultimaEscritura('productos');
		assert.deepEqual(g.atributos.presentaciones, prev);
		assert.equal(g.precio_numerico, 5000);
	});

	test('un guardado parcial de precio no pisa el precio de un plato con presentaciones', async () => {
		const prev = [{ id: 'pa1b2c3', nombre: '1X', precio_numerico: 5000 }, { id: 'pd4e5f6', nombre: '2X', precio_numerico: 9000 }];
		await patch({ precio_numerico: 777 }, { atributos: { presentaciones: prev } });
		const g = S.ultimaEscritura('productos');
		assert.equal(g.precio_numerico, undefined);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('PUT /api/productos-sedes · plato con presentaciones', () => {
	const SEDE = '99999999-9999-4999-8999-999999999999';
	const PLATO_PRES = IDS.producto;
	const PLATO_B = '44444444-4444-4444-8444-444444444444';
	const mundo = () => S.conTabla(st => {
		if (st.tabla === 'sedes' && st.op === 'select') return { data: { restaurante_id: IDS.restaurante, slug: 'x' }, error: null };
		if (st.tabla === 'productos' && st.op === 'select') return { data: [
			{ id: PLATO_PRES, atributos: { presentaciones: [{ id: 'pa1b2c3', nombre: '1X', precio_numerico: 1 }, { id: 'pd4e5f6', nombre: '2X', precio_numerico: 2 }] } },
			{ id: PLATO_B, atributos: {} }], error: null };
		return { data: null, error: null };
	});
	const put = filas => S.pedir('PUT', '/api/productos-sedes', { sede_id: SEDE, filas }, tokenCliente);

	test('un precio para un plato con presentaciones se rechaza', async () => {
		mundo();
		const r = await put([{ producto_id: PLATO_PRES, precio_numerico: 9000 }]);
		assert.equal(r.status, 400);
		assert.match(r.body.error, /presentaciones/);
		assert.equal(S.llamadas.filter(l => l.tabla === 'productos_sedes' && l.op === 'upsert').length, 0);
	});

	test('«no se sirve aquí» sí se admite, y un plato normal conserva su precio por sede', async () => {
		mundo();
		const r = await put([{ producto_id: PLATO_PRES, disponible: false }, { producto_id: PLATO_B, precio_numerico: 31000 }]);
		assert.equal(r.status, 200);
		assert.deepEqual(r.body, { guardados: 2, quitados: 0 });
	});
});

// ═══════════════════════════════════════════════════════════════
describe('public/presentaciones.js · las funciones de la ficha', () => {
	const fuente = fs.readFileSync(path.join(__dirname, '..', 'public', 'presentaciones.js'), 'utf8');
	const ctx = { document: { getElementById: () => null } };
	vm.createContext(ctx);
	// `const`/`let` de nivel superior no cuelgan del contexto: se exponen las funciones que se prueban.
	vm.runInContext(fuente.replace(/^function (\w+)/gm, 'globalThis.$1 = function $1').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), Object.assign(ctx, {
		formatPrecio: n => '$ ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
		precioNumericoDe: v => { const d = String(v ?? '').replace(/\D/g, ''); return d === '' ? NaN : Number(d); },
	}));
	const N = x => JSON.parse(JSON.stringify(x));

	test('presentacionesDelPlato: dos o más válidas; una sola, ninguna', () => {
		const p = l => ({ atributos: { presentaciones: l } });
		assert.equal(ctx.presentacionesDelPlato(p([{ nombre: 'a', precio_numerico: 1 }, { nombre: 'b', precio_numerico: 2 }])).length, 2);
		assert.equal(ctx.presentacionesDelPlato(p([{ nombre: 'a', precio_numerico: 1 }])).length, 0);
		assert.equal(ctx.presentacionesDelPlato({}).length, 0);
		assert.equal(ctx.presentacionesDelPlato(null).length, 0);
	});

	test('textoPrecioConPresentaciones: «Desde» el más bajo y cuántas', () => {
		const p = { atributos: { presentaciones: [{ nombre: 'a', precio_numerico: 20000 }, { nombre: 'b', precio_numerico: 12000 }] } };
		assert.equal(ctx.textoPrecioConPresentaciones(p), 'Desde $ 12.000 · 2 presentaciones');
		assert.equal(ctx.textoPrecioConPresentaciones({ atributos: {} }), '');
	});

	test('presLeerFilas: apagado no manda nada; lo escrito se limpia; una fila en blanco se ignora', () => {
		assert.deepEqual(N(ctx.presLeerFilas(false, [{ nombre: 'x', precio: '1' }])), { lista: [] });
		const r = ctx.presLeerFilas(true, [
			{ id: 'pa1b2c3', nombre: '  1X ', precio: '12.000' },
			{ id: '', nombre: '2X', precio: '$ 20.000' },
			{ id: '', nombre: '', precio: '' }]);
		assert.deepEqual(N(r), { lista: [{ id: 'pa1b2c3', nombre: '1X', precio_numerico: 12000 }, { nombre: '2X', precio_numerico: 20000 }] });
	});

	test('presLeerFilas: avisa de lo que falta', () => {
		assert.match(ctx.presLeerFilas(true, [{ nombre: '', precio: '5' }, { nombre: 'b', precio: '5' }]).error, /nombre/);
		assert.match(ctx.presLeerFilas(true, [{ nombre: 'a', precio: '' }, { nombre: 'b', precio: '5' }]).error, /precio de «a»/);
		assert.match(ctx.presLeerFilas(true, [{ nombre: 'a', precio: '5' }, { nombre: 'A', precio: '6' }]).error, /Dos presentaciones/);
		assert.match(ctx.presLeerFilas(true, [{ nombre: 'a', precio: '5' }]).error, /Una sola/);
	});
});
