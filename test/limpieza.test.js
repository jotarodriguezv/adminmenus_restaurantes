// El limpiador es el único sitio del sistema que borra archivos del disco sin
// vuelta atrás. Llevaba desde que se escribió en simulacro, así que nunca
// había borrado nada de verdad y nunca se había probado que borrara lo que
// toca. Estas pruebas van antes de encenderlo.
//
// Cada caso monta una carpeta de mentira y una base de datos de mentira: aquí
// no se toca la carpeta real ni con guantes.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const DIA = 86400000;

// El módulo lee su configuración al cargarse, así que cada caso necesita una
// copia nueva con su entorno.
function cargarLimpieza(env = {}) {
	const antes = {};
	for (const k of ['LIMPIEZA_RAIZ', 'LIMPIEZA_BORRAR', 'LIMPIEZA_DIAS', 'LIMPIEZA_TOPE']) {
		antes[k] = process.env[k];
		if (k in env) process.env[k] = String(env[k]); else delete process.env[k];
	}
	const ruta = require.resolve('../limpieza.js');
	delete require.cache[ruta];
	const mod = require(ruta);
	Object.assign(process.env, Object.fromEntries(
		Object.entries(antes).filter(([, v]) => v !== undefined)));
	return mod;
}

// Un disco de mentira: { 'videos/a.mp4': díasDeAntigüedad }
function montarDisco(archivos) {
	const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
	for (const [clave, dias] of Object.entries(archivos)) {
		const abs = path.join(raiz, clave);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, 'x'.repeat(1024));
		const cuando = new Date(Date.now() - dias * DIA);
		fs.utimesSync(abs, cuando, cuando);
	}
	return raiz;
}

// Una base de datos de mentira que devuelve las filas que se le den.
function baseCon(filasPorTabla) {
	const leidas = [];
	return {
		leidas,
		from: tabla => ({
			select: () => ({
				order: campo => ({
					range: (a, b) => {
						leidas.push({ tabla, campo, a, b });
						return Promise.resolve({ data: (filasPorTabla[tabla] || []).slice(a, b + 1), error: null });
					},
				}),
			}),
		}),
	};
}

const quedan = raiz => fs.readdirSync(raiz, { recursive: true })
	.filter(p => fs.statSync(path.join(raiz, p)).isFile())
	.map(p => p.split(path.sep).join('/'))
	.sort();

// ═══════════════════════════════════════════════════════════════
describe('recogerNombres · qué cuenta como una referencia', () => {
	const { recogerNombres } = cargarLimpieza();
	const de = t => [...recogerNombres(t, new Set())].sort();

	test('encuentra la URL completa y la ruta relativa', () => {
		// productos.imagen_url guarda la URL entera; trabajos_video, la ruta
		// suelta. Las dos formas tienen que contar.
		assert.deepEqual(de('https://admin.example.com/uploads/videos/abc-123.mp4'), ['videos/abc-123.mp4']);
		assert.deepEqual(de('"originales/abc-123.mp4"'), ['originales/abc-123.mp4']);
	});

	test('saca todas las de una fila serializada', () => {
		const fila = JSON.stringify({
			imagen_url: 'https://x/uploads/productos/foto.jpg',
			atributos: { video: { url: 'https://x/uploads/videos/v.mp4', portada: 'https://x/uploads/miniaturas/v.jpg' },
			             imagenes: ['https://x/uploads/productos/otra.png'] },
		});
		assert.deepEqual(de(fila), [
			'miniaturas/v.jpg', 'productos/foto.jpg', 'productos/otra.png', 'videos/v.mp4',
		]);
	});

	test('hace falta una carpeta conocida y una barra', () => {
		// Anclar a la lista de carpetas es lo que impide que cualquier palabra
		// del menú se lea como un nombre de archivo.
		assert.deepEqual(de('mezcla de productos frescos'), [], 'sin barra no hay ruta');
		assert.deepEqual(de('recetas/secreta.jpg'), [], 'carpeta que no es nuestra');
	});

	test('si un texto se cuela, protege de más y nunca de menos', () => {
		// Una descripción que contenga algo con forma de ruta —"videos/promos"—
		// sí produce una entrada. No es un fallo peligroso y conviene dejar
		// escrito por qué: este conjunto es la lista de LO QUE NO SE BORRA, y
		// solo se le añaden cosas. Una entrada de más protege un archivo que no
		// existe; jamás puede provocar que se borre uno que sí.
		//
		// El día que alguien quiera afinar el patrón, que sepa que el margen de
		// error tiene que seguir cayendo de este lado.
		assert.deepEqual(de('Nuestros videos/promos son caseros'), ['videos/promos']);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('pasada · qué se borra y qué no', () => {
	const conDisco = async (archivos, filas, env = {}) => {
		const raiz = montarDisco(archivos);
		const { pasada } = cargarLimpieza({ LIMPIEZA_RAIZ: raiz, ...env });
		const r = await pasada(baseCon(filas));
		return { raiz, r, quedan: quedan(raiz) };
	};

	test('lo referenciado no se toca aunque sea viejísimo', async () => {
		const { quedan: q } = await conDisco(
			{ 'videos/vivo.mp4': 400, 'productos/foto.jpg': 400 },
			{ productos: [{ id: 1, imagen_url: 'https://x/uploads/productos/foto.jpg',
			                atributos: { video: { url: 'https://x/uploads/videos/vivo.mp4' } } }] },
			{ LIMPIEZA_BORRAR: '1' });
		assert.deepEqual(q, ['productos/foto.jpg', 'videos/vivo.mp4']);
	});

	test('lo huérfano y viejo se borra', async () => {
		const { r, quedan: q } = await conDisco(
			{ 'videos/vivo.mp4': 30, 'originales/sobra.mp4': 30 },
			{ productos: [{ id: 1, atributos: { video: { url: 'https://x/uploads/videos/vivo.mp4' } } }] },
			{ LIMPIEZA_BORRAR: '1' });
		assert.equal(r.borrados, 1);
		assert.deepEqual(q, ['videos/vivo.mp4']);
	});

	test('lo huérfano pero reciente se respeta', async () => {
		// El panel sube el archivo al elegirlo y la fila no se escribe hasta
		// guardar. Sin la gracia, se borraría lo que alguien está subiendo.
		const { r, quedan: q } = await conDisco(
			{ 'originales/recien.mp4': 2 },
			{ productos: [{ id: 1, imagen_url: 'https://x/uploads/productos/algo.jpg' }] },
			{ LIMPIEZA_BORRAR: '1' });
		assert.equal(r.huerfanos, 0);
		assert.deepEqual(q, ['originales/recien.mp4']);
	});

	test('en simulacro no desaparece nada', async () => {
		// Tres archivos vivos y uno que sobra: por debajo del tope, para que
		// esta prueba mida el simulacro y no acabe abortando por otra razón.
		const { r, quedan: q } = await conDisco(
			{ 'productos/a.jpg': 30, 'productos/b.jpg': 30, 'productos/c.jpg': 30, 'originales/sobra.mp4': 30 },
			{ productos: [{ id: 1, imagen_url: 'https://x/uploads/productos/a.jpg' },
			              { id: 2, imagen_url: 'https://x/uploads/productos/b.jpg' },
			              { id: 3, imagen_url: 'https://x/uploads/productos/c.jpg' }] });
		assert.equal(r.abortado, false, 'no debe abortar: el caso es el simulacro');
		assert.equal(r.huerfanos, 1, 'lo cuenta');
		assert.equal(r.borrados, 0, 'pero no lo borra');
		assert.equal(q.length, 4, 'siguen los cuatro archivos');
	});

	test('sin ninguna referencia se aborta en vez de vaciar el disco', async () => {
		// Si la base no responde, TODO parecería huérfano. Cero referencias con
		// archivos en disco no es un estado real: es un error.
		//
		// El tope va al 100% a propósito: con cero referencias sobra siempre el
		// disco entero, así que el tope también lo pararía y esta prueba pasaría
		// sin comprobar nada del guardia que dice comprobar. Desactivándolo,
		// solo queda en pie el que interesa.
		const { r, quedan: q } = await conDisco(
			{ 'videos/vivo.mp4': 30, 'productos/foto.jpg': 30 },
			{},
			{ LIMPIEZA_BORRAR: '1', LIMPIEZA_TOPE: '1' });
		assert.equal(r.abortado, true);
		assert.equal(r.borrados, 0);
		assert.equal(q.length, 2, 'no se borró nada');
	});

	test('si sobrara la mayor parte del disco, se aborta', async () => {
		// Una pasada que quiere llevarse casi todo no es limpieza: es la lista
		// de referencias rota. Cuesta un día de disco; el error cuesta las
		// fotos de todos.
		const { r, quedan: q } = await conDisco(
			{ 'productos/a.jpg': 30, 'productos/b.jpg': 30, 'productos/c.jpg': 30, 'productos/d.jpg': 30 },
			{ productos: [{ id: 1, imagen_url: 'https://x/uploads/productos/a.jpg' }] },
			{ LIMPIEZA_BORRAR: '1' });
		assert.equal(r.abortado, true);
		assert.equal(r.huerfanos, 3, 'los cuenta y los enseña');
		assert.equal(r.borrados, 0, 'pero no borra ninguno');
		assert.equal(q.length, 4);
	});

	test('por debajo del tope sí borra', async () => {
		// El mismo caso con uno menos: 2 de 4 es justo el 50%, no lo pasa.
		const { r } = await conDisco(
			{ 'productos/a.jpg': 30, 'productos/b.jpg': 30, 'productos/c.jpg': 30, 'productos/d.jpg': 30 },
			{ productos: [{ id: 1, imagen_url: 'https://x/uploads/productos/a.jpg' },
			              { id: 2, imagen_url: 'https://x/uploads/productos/b.jpg' }] },
			{ LIMPIEZA_BORRAR: '1' });
		assert.equal(r.abortado, false);
		assert.equal(r.borrados, 2);
	});

	test('el tope se puede subir a sabiendas', async () => {
		// Para la primera pasada, cuando de verdad se ha acumulado mucho.
		const { r } = await conDisco(
			{ 'productos/a.jpg': 30, 'productos/b.jpg': 30, 'productos/c.jpg': 30, 'productos/d.jpg': 30 },
			{ productos: [{ id: 1, imagen_url: 'https://x/uploads/productos/a.jpg' }] },
			{ LIMPIEZA_BORRAR: '1', LIMPIEZA_TOPE: '0.9' });
		assert.equal(r.abortado, false);
		assert.equal(r.borrados, 3);
	});

	test('una carpeta fuera de la lista no se toca', async () => {
		// Añadir una carpeta y olvidarse de CARPETAS deja sus archivos sin
		// limpiar, que es el fallo bueno. Al revés sería borrarlos.
		const { quedan: q } = await conDisco(
			{ 'facturas/enero.pdf': 400 },
			{ productos: [{ id: 1, imagen_url: 'https://x/uploads/productos/algo.jpg' }] },
			{ LIMPIEZA_BORRAR: '1' });
		assert.deepEqual(q, ['facturas/enero.pdf']);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('referencias · de dónde se leen', () => {
	test('se leen las cuatro tablas que guardan archivos, y ordenadas', async () => {
		// Ordenar no es adorno: sin ORDER BY, Postgres no promete el mismo
		// orden entre páginas y paginar puede saltarse filas. Una fila saltada
		// es un archivo que parece huérfano — o sea, uno que se borra.
		const raiz = montarDisco({ 'videos/x.mp4': 30 });
		const { pasada, TABLAS } = cargarLimpieza({ LIMPIEZA_RAIZ: raiz });
		const base = baseCon({ productos: [{ id: 1, imagen_url: 'https://x/uploads/videos/x.mp4' }] });
		await pasada(base);

		assert.deepEqual([...new Set(base.leidas.map(l => l.tabla))].sort(), [...TABLAS].sort());
		for (const l of base.leidas)
			assert.equal(l.campo, 'id', `${l.tabla} se leyó sin ordenar`);
	});
});
