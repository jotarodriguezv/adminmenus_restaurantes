// Qué se crearía al aplicar un borrador. Aquí no se escribe nada, y por eso se
// puede probar entero sin base de datos.
//
// Lo que se protege son las dos reglas que no se negocian: la importación AÑADE
// y nunca reemplaza, y lo nuevo no se mete en medio de lo que el restaurante ya
// tenía colocado.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const importacion = require('../importacion.js');

const plato = (nombre, precio) => ({ nombre, precio_numerico: precio });

describe('reconocer una categoría que ya existe', () => {
	const existentes = [{ id: 'cat-postres', nombre: 'Postres', orden: 3 }];

	test('da igual mayúsculas, tildes y espacios de más', () => {
		for (const escrito of ['POSTRES', 'postres', '  Póstres ', 'Postres']) {
			const plan = importacion.planDeAplicacion(
				{ categorias: [{ nombre: escrito, platos: [plato('FLAN', 5000)] }] }, existentes);
			assert.equal(plan.categorias[0].id, 'cat-postres', escrito);
			assert.equal(plan.categorias[0].existia, true);
			assert.equal(plan.totales.categorias_nuevas, 0);
		}
	});

	test('una que no existe se crea', () => {
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'CALDOS', platos: [plato('CALDO', 8000)] }] }, existentes);
		assert.equal(plan.categorias[0].id, null);
		assert.equal(plan.totales.categorias_nuevas, 1);
	});

	test('el nombre se guarda como venía en la carta, no normalizado', () => {
		// La comparación ignora tildes; lo que se GUARDA no. 'CAFÉ' se crea con
		// su tilde.
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'CAFÉ', platos: [plato('TINTO', 2000)] }] });
		assert.equal(plan.categorias[0].nombre, 'CAFÉ');
	});
});

describe('no pisar lo que el restaurante ya tenía', () => {
	test('las categorías nuevas van al final, no en medio', () => {
		// Meterlas en medio movería de sitio las que ya estaban colocadas.
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'CALDOS', platos: [plato('A', 1000)] }, { nombre: 'CARNES', platos: [plato('B', 2000)] }] },
			[{ id: 'x', nombre: 'Entradas', orden: 7 }]);
		assert.deepEqual(plan.categorias.map((c) => c.orden), [8, 9]);
	});

	test('los platos nuevos entran DETRÁS de los que ya había', () => {
		// Empezando en cero se intercalarían con los existentes y la carta
		// quedaría revuelta.
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'Postres', platos: [plato('FLAN', 5000), plato('TORTA', 6000)] }] },
			[{ id: 'cat-postres', nombre: 'Postres', orden: 1 }],
			{ 'cat-postres': 12 });
		assert.deepEqual(plan.categorias[0].platos.map((p) => p.orden), [13, 14]);
	});

	test('en una categoría nueva los platos empiezan en 1', () => {
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'CALDOS', platos: [plato('A', 1), plato('B', 2)] }] });
		assert.deepEqual(plan.categorias[0].platos.map((p) => p.orden), [1, 2]);
	});

	test('nunca se propone borrar ni renombrar nada', () => {
		// El plan solo sabe crear. Si algún día aparece aquí una propiedad que
		// signifique otra cosa, esta prueba tiene que ser lo que lo frene.
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'Postres', platos: [plato('FLAN', 5000)] }] },
			[{ id: 'cat-postres', nombre: 'Postres', orden: 1 }]);
		assert.deepEqual(Object.keys(plan).sort(), ['categorias', 'totales']);
		assert.deepEqual(Object.keys(plan.totales).sort(),
			['categorias_nuevas', 'categorias_reutilizadas', 'platos']);
	});
});

describe('el orden de la carta se conserva', () => {
	test('las categorías salen como venían', () => {
		const plan = importacion.planDeAplicacion({
			categorias: [
				{ nombre: 'ENTRADAS', platos: [plato('A', 1)] },
				{ nombre: 'CALDOS', platos: [plato('B', 2)] },
				{ nombre: 'POSTRES', platos: [plato('C', 3)] },
			],
		});
		assert.deepEqual(plan.categorias.map((c) => c.nombre), ['ENTRADAS', 'CALDOS', 'POSTRES']);
	});

	test('y los platos dentro de cada una también', () => {
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'X', platos: [plato('PRIMERO', 1), plato('SEGUNDO', 2), plato('TERCERO', 3)] }] });
		assert.deepEqual(plan.categorias[0].platos.map((p) => p.nombre), ['PRIMERO', 'SEGUNDO', 'TERCERO']);
	});
});

describe('lo que trae una carta de verdad', () => {
	test('un título repetido en dos páginas es una sola categoría', () => {
		// Pasa constantemente: la carta repite 'PATACONES' arriba de la página
		// siguiente para que se sepa dónde sigue.
		const plan = importacion.planDeAplicacion({
			categorias: [
				{ nombre: 'PATACONES', platos: [plato('A', 1)] },
				{ nombre: 'Patacones', platos: [plato('B', 2)] },
			],
		});
		assert.equal(plan.categorias.length, 1);
		assert.equal(plan.totales.categorias_nuevas, 1);
		assert.deepEqual(plan.categorias[0].platos.map((p) => p.orden), [1, 2]);
	});

	test('los platos sueltos van a una categoría con nombre', () => {
		// 'categoria_id' es NOT NULL: un plato sin categoría no existe.
		const plan = importacion.planDeAplicacion({ categorias: [{ nombre: '', platos: [plato('SOPA', 1000)] }] });
		assert.equal(plan.categorias[0].nombre, importacion.SIN_CATEGORIA);
		assert.ok(plan.categorias[0].slug, 'y con slug, que la ruta de categorías también lo pone');
	});

	test('un plato sin precio entra a cero, no se inventa uno', () => {
		// Cero se ve en la carta y se corrige. Un precio inventado no.
		const plan = importacion.planDeAplicacion({ categorias: [{ nombre: 'X', platos: [{ nombre: 'SOPA' }] }] });
		assert.equal(plan.categorias[0].platos[0].precio_numerico, 0);
	});

	test('un precio que no es número no se cuela', () => {
		const plan = importacion.planDeAplicacion({
			categorias: [{ nombre: 'X', platos: [{ nombre: 'SOPA', precio_numerico: 'diez mil' }] }],
		});
		assert.equal(plan.categorias[0].platos[0].precio_numerico, 0);
	});

	test('el slug sale igual que el de una categoría escrita a mano', () => {
		const plan = importacion.planDeAplicacion(
			{ categorias: [{ nombre: 'BEBIDAS CALIENTES', platos: [plato('TINTO', 2000)] }] });
		assert.equal(plan.categorias[0].slug, 'bebidas_calientes');
	});
});

describe('lo que no vale se queda fuera', () => {
	test('un plato sin nombre no llega', () => {
		const plan = importacion.planDeAplicacion({
			categorias: [{ nombre: 'X', platos: [{ precio_numerico: 100 }, plato('SOPA', 200)] }],
		});
		assert.deepEqual(plan.categorias[0].platos.map((p) => p.nombre), ['SOPA']);
	});

	test('ni uno cuyo nombre son solo espacios', () => {
		// Se colaba: '   ' es truthy, así que pasaba el filtro y se creaba un
		// producto sin nombre. Esto escribe en 'productos' directamente, sin
		// pasar por la comprobación de la ruta, así que era la única red.
		// Lo cazó la prueba que compara estas cuentas con las del panel.
		const plan = importacion.planDeAplicacion({
			categorias: [{ nombre: 'X', platos: [{ nombre: '   ' }, plato('SOPA', 200)] }],
		});
		assert.deepEqual(plan.categorias[0].platos.map((p) => p.nombre), ['SOPA']);
		assert.equal(plan.totales.platos, 1);
	});

	test('una categoría cuyos platos son todos sin nombre no se crea', () => {
		const plan = importacion.planDeAplicacion({
			categorias: [{ nombre: 'FANTASMA', platos: [{ nombre: '  ' }, { nombre: '' }] }],
		});
		assert.deepEqual(plan.categorias, []);
	});

	test('una categoría sin platos no se crea', () => {
		// Crear una categoría vacía deja un título suelto en la carta.
		const plan = importacion.planDeAplicacion({ categorias: [{ nombre: 'VACIA', platos: [] }] });
		assert.deepEqual(plan.categorias, []);
		assert.equal(plan.totales.categorias_nuevas, 0);
	});

	test('basura en lugar del borrador no rompe nada', () => {
		for (const entrada of [null, undefined, {}, { categorias: 'no' }, { categorias: [null, 7, 'x'] }]) {
			const plan = importacion.planDeAplicacion(entrada);
			assert.deepEqual(plan.categorias, []);
			assert.equal(plan.totales.platos, 0);
		}
	});
});

describe('las cuentas que se le enseñan a la persona', () => {
	test('cuadran con lo que se va a crear', () => {
		// El botón de aplicar dice cuántas categorías y cuántos platos. Si esos
		// números no cuadran con lo que pasa después, la revisión no sirve.
		const plan = importacion.planDeAplicacion({
			categorias: [
				{ nombre: 'Postres', platos: [plato('FLAN', 1), plato('TORTA', 2)] },
				{ nombre: 'CALDOS', platos: [plato('CALDO', 3)] },
			],
		}, [{ id: 'cat-postres', nombre: 'POSTRES', orden: 1 }]);

		assert.equal(plan.totales.categorias_nuevas, 1);
		assert.equal(plan.totales.categorias_reutilizadas, 1);
		assert.equal(plan.totales.platos, 3);
		assert.equal(plan.categorias.reduce((n, c) => n + c.platos.length, 0), plan.totales.platos);
	});
});
