// Archivar en vez de borrar platos y categorías (sql/23).
//
// Lo pide V-POS: cada línea de un pedido apunta al plato que se vendió, y un
// pedido de hace tres meses tiene que seguir diciendo qué se vendió. Si el
// plato se borra, o el borrado falla por la clave foránea —y entonces el panel
// no puede borrar nada— o la venta se queda sin nombre.
//
// Se prueba contra el server.js real por HTTP, como el resto: lo que importa
// es lo que el panel ve y lo que acaba en la base, no una función suelta.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const S = require('./helpers/servidor.js');

describe('archivar un plato', () => {
	test('el DELETE del panel marca archivado_en y NO borra la fila', async () => {
		S.reiniciar();
		S.conTabla(() => ({ data: { restaurante_id: S.IDS.restaurante, imagen_url: null }, error: null }));

		const r = await S.pedir('DELETE', `/api/productos/${S.IDS.producto}`, null, S.tokenCliente);
		assert.equal(r.status, 200);

		const escrituras = S.llamadas.filter(l => l.tabla === 'productos' && l.op !== 'select');
		assert.equal(escrituras.length, 1, 'una sola escritura');
		assert.equal(escrituras[0].op, 'update', 'se actualiza, no se borra');
		assert.ok(escrituras[0].payload.archivado_en, 'queda la marca de cuándo se archivó');
		assert.equal(S.llamadas.some(l => l.op === 'delete'), false, 'ningún delete');
	});

	test('la foto se conserva: el plato sigue siendo su dueño', async () => {
		S.reiniciar();
		const carpeta = path.join(__dirname, '..', 'uploads', 'productos');
		fs.mkdirSync(carpeta, { recursive: true });
		const archivo = path.join(carpeta, 'verif-archivado.jpg');
		fs.writeFileSync(archivo, 'foto');

		S.conTabla(() => ({
			data: { restaurante_id: S.IDS.restaurante, imagen_url: `${process.env.BASE_URL || ''}/uploads/productos/verif-archivado.jpg` },
			error: null,
		}));

		await S.pedir('DELETE', `/api/productos/${S.IDS.producto}`, null, S.tokenCliente);
		assert.ok(fs.existsSync(archivo), 'la foto sigue ahí; borrarla dejaría una venta vieja sin imagen');
		fs.unlinkSync(archivo);
	});

	test('un plato de otro restaurante sigue sin poder tocarse', async () => {
		S.reiniciar();
		S.conTabla(() => ({ data: { restaurante_id: '99999999-9999-4999-8999-999999999999', imagen_url: null }, error: null }));
		const r = await S.pedir('DELETE', `/api/productos/${S.IDS.producto}`, null, S.tokenCliente);
		assert.equal(r.status, 403);
		assert.equal(S.llamadas.some(l => l.op === 'update'), false, 'no se escribió nada');
	});
});

describe('archivar una categoría', () => {
	test('se archivan sus platos y después ella, sin borrar nada', async () => {
		S.reiniciar();
		S.conTabla((st) => {
			if (st.tabla === 'categorias' && st.op === 'select') return { data: { restaurante_id: S.IDS.restaurante }, error: null };
			if (st.tabla === 'productos' && st.op === 'update') return { data: [{ id: 'p1' }, { id: 'p2' }], error: null };
			return { data: null, error: null };
		});

		const r = await S.pedir('DELETE', `/api/categorias/${S.IDS.categoria}`, null, S.tokenCliente);
		assert.equal(r.status, 200);
		assert.equal(r.body.productos_borrados, 2, 'dice cuántos platos se fueron con ella');

		const escrituras = S.llamadas.filter(l => l.op === 'update');
		assert.deepEqual(escrituras.map(l => l.tabla), ['productos', 'categorias'],
			'primero los platos y luego la categoría: al revés quedarían platos apuntando a una categoría que la carta ya no muestra');
		assert.ok(escrituras.every(l => l.payload.archivado_en), 'las dos escrituras archivan');
		assert.equal(S.llamadas.some(l => l.op === 'delete'), false, 'ningún delete');
	});
});

describe('las listas del panel', () => {
	test('los platos archivados no salen', async () => {
		S.reiniciar();
		S.conTabla(() => ({ data: [], error: null }));
		await S.pedir('GET', `/api/productos?restaurante_id=${S.IDS.restaurante}`, null, S.tokenCliente);
		const consulta = S.llamadas.find(l => l.tabla === 'productos');
		assert.equal(consulta.filtros.archivado_en, 'is.null', 'la consulta pide solo lo no archivado');
	});

	test('las categorías archivadas tampoco', async () => {
		S.reiniciar();
		S.conTabla(() => ({ data: [], error: null }));
		await S.pedir('GET', `/api/categorias?restaurante_id=${S.IDS.restaurante}`, null, S.tokenCliente);
		const consulta = S.llamadas.find(l => l.tabla === 'categorias');
		assert.equal(consulta.filtros.archivado_en, 'is.null');
	});
});

describe('la migración', () => {
	const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '23_archivar_en_vez_de_borrar.sql'), 'utf8');

	test('la carta deja de ver lo archivado', () => {
		assert.match(sql, /create policy lectura_publica_productos[\s\S]*?archivado_en is null/);
		assert.match(sql, /create policy lectura_publica_categorias[\s\S]*?archivado_en is null/);
	});

	test('el POS ve también lo agotado, pero solo lo suyo', () => {
		// Un plato agotado en la carta tiene que poder configurarse y venderse
		// desde el POS; pos.pertenece() es lo que impide ver otro restaurante.
		assert.match(sql, /create policy lectura_del_pos_productos[\s\S]*?pos\.pertenece\(restaurante_id\)/);
		assert.doesNotMatch(sql.split('lectura_del_pos_productos')[1].split(';')[0], /disponible/);
	});
});
