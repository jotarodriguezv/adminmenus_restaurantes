// Las rutas de importar la carta, por HTTP contra el server.js de verdad.
//
// NUNCA se llama a la API de Anthropic: la clave se borra del entorno antes de
// levantar el servidor, así que la extracción falla siempre en la puerta. Eso
// deja probar todo lo que rodea a la llamada —el permiso, el cupo, qué se
// acepta, qué se guarda cuando algo falla— sin gastar un céntimo.
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Antes de require: server.js se carga al pedir el arnés.
delete process.env.ANTHROPIC_API_KEY;

const { pedir, pedirArchivo, llamadas, ultimaEscritura, reiniciar, conTabla, IDS, tokenCliente, tokenAdmin }
	= require('./helpers/servidor.js');
const { unaPagina } = require('./helpers/pdf.js');

const IMPORTACION = '44444444-4444-4444-8444-444444444444';
const AJENO = '55555555-5555-4555-8555-555555555555';

// Un PDF con texto suficiente para no parecer un escaneo.
const CARTA_PDF = unaPagina(`BT /F1 12 Tf (${'CALDO DE COSTILLA $ 10.000 '.repeat(20)}) Tj ET`);
// Y otro casi vacío, que sí lo parece.
const PDF_VACIO = unaPagina('BT /F1 12 Tf (pagina 1) Tj ET');
const IMAGEN = Buffer.concat([
	Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]),
	Buffer.alloc(512),
]);

const subir = (contenido, nombre, token = tokenCliente, rid = IDS.restaurante) =>
	pedirArchivo(`/api/importaciones?restaurante_id=${rid}`, {}, token, nombre, contenido);

// Una fila de importación en el estado que pida cada prueba.
function conFila(fila) {
	conTabla((st) => {
		if (st.tabla === 'importaciones_carta') {
			if (st.op === 'select' && st.opciones && st.opciones.head) return { data: null, count: 0, error: null };
			if (st.op === 'select') return { data: fila, error: null };
			return { data: { ...fila, ...st.payload }, error: null };
		}
		return { data: [], error: null };
	});
}

beforeEach(() => { reiniciar(); });

// Las subidas que salen bien dejan el archivo en el disco a propósito: la fila
// lo referencia para poder repetir la extracción. En las pruebas eso es basura,
// y el limpiador no la recoge porque 'cartas' no está en su lista.
const CARPETA = path.join(__dirname, '..', 'uploads', 'cartas');
const YA_ESTABAN = new Set(fs.existsSync(CARPETA) ? fs.readdirSync(CARPETA) : []);
after(() => {
	if (!fs.existsSync(CARPETA)) return;
	for (const f of fs.readdirSync(CARPETA))
		if (!YA_ESTABAN.has(f)) { try { fs.unlinkSync(path.join(CARPETA, f)); } catch {} }
});

describe('quién puede importar', () => {
	test('sin token no se entra', async () => {
		const r = await pedir('GET', `/api/importaciones?restaurante_id=${IDS.restaurante}`, null, null);
		assert.equal(r.status, 401);
	});

	test('un restaurante no puede importar en otro', async () => {
		const r = await subir(CARTA_PDF, 'carta.pdf', tokenCliente, AJENO);
		assert.equal(r.status, 403);
	});

	test('el permiso se mira ANTES de escribir el archivo', async () => {
		// Si se mirara después, cualquiera con una cuenta podría llenar el disco
		// subiendo cartas a restaurantes ajenos y recibir un 403 al final.
		//
		// Se mira el DISCO y no solo que no se tocara la tabla: comprobar el
		// permiso justo antes del insert también dejaría la tabla intacta, y
		// habría escrito el archivo igualmente.
		const antes = fs.existsSync(CARPETA) ? fs.readdirSync(CARPETA).length : 0;
		await subir(CARTA_PDF, 'carta.pdf', tokenCliente, AJENO);
		const despues = fs.existsSync(CARPETA) ? fs.readdirSync(CARPETA).length : 0;
		assert.equal(despues, antes, 'no se escribió ningún archivo');
		assert.equal(llamadas.filter((l) => l.tabla === 'importaciones_carta').length, 0);
	});

	test('sin restaurante_id en la query no se hace nada', async () => {
		const r = await pedirArchivo('/api/importaciones', {}, tokenCliente, 'carta.pdf', CARTA_PDF);
		assert.equal(r.status, 403);
	});
});

describe('el cupo', () => {
	test('al llegar al tope se rechaza y no se llama al modelo', async () => {
		conTabla((st) => (st.tabla === 'importaciones_carta' && st.opciones && st.opciones.head)
			? { data: null, count: 5, error: null }
			: { data: null, error: null });
		const r = await subir(CARTA_PDF, 'carta.pdf');
		assert.equal(r.status, 409);
		assert.match(r.body.error, /5 importaciones/);
	});

	test('el admin no tiene tope', async () => {
		// Es la herramienta con la que el equipo da de alta un restaurante.
		conTabla((st) => (st.tabla === 'importaciones_carta' && st.opciones && st.opciones.head)
			? { data: null, count: 999, error: null }
			: { data: { id: IMPORTACION }, error: null });
		const r = await subir(CARTA_PDF, 'carta.pdf', tokenAdmin);
		assert.notEqual(r.status, 409);
	});

	test('la fila se crea ANTES de llamar al modelo', async () => {
		// Es la reserva: si la respuesta se pierde por el camino, el intento ya
		// está contado y nadie lo repite gratis.
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		await subir(CARTA_PDF, 'carta.pdf');
		const insertadas = llamadas.filter((l) => l.tabla === 'importaciones_carta' && l.op === 'insert');
		assert.equal(insertadas.length, 1);
		assert.equal(insertadas[0].payload[0].estado, 'pendiente');
		assert.equal(insertadas[0].payload[0].origen, 'pdf');
	});
});

describe('qué archivos se aceptan', () => {
	test('un .pdf que por dentro no es un PDF se rechaza', async () => {
		// La extensión la elige quien sube; lo que vale es el contenido.
		const r = await subir(Buffer.from('esto es texto plano, no un PDF'), 'carta.pdf');
		assert.equal(r.status, 400);
		assert.match(r.body.error, /no es un PDF ni una imagen/);
	});

	test('una extensión que no está en la lista no pasa', async () => {
		const r = await subir(CARTA_PDF, 'carta.exe');
		assert.equal(r.status, 400);
	});

	test('una imagen se acepta y se marca como tal', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		await subir(IMAGEN, 'carta.jpg');
		const ins = llamadas.find((l) => l.tabla === 'importaciones_carta' && l.op === 'insert');
		assert.equal(ins.payload[0].origen, 'imagen');
	});

	test('un PDF sin texto dentro se explica, no se intenta', async () => {
		// Es un escaneo. Convertirlo a imágenes pide una herramienta nativa que
		// el servidor no tiene, así que se ofrece la salida que sí funciona.
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await subir(PDF_VACIO, 'carta.pdf');
		assert.equal(r.status, 400);
		assert.match(r.body.error, /no lleva texto dentro/);
		assert.match(r.body.error, /foto de cada página/);
	});
});

describe('cuando la extracción falla', () => {
	test('la fila queda en error y con un motivo legible', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await subir(CARTA_PDF, 'carta.pdf');
		assert.equal(r.status, 502);
		const escrito = ultimaEscritura('importaciones_carta');
		assert.equal(escrito.estado, 'error');
		assert.ok(escrito.error, 'se guarda el motivo');
	});

	test('el mensaje no cuenta las tripas del servidor', async () => {
		// Aquí falla por falta de ANTHROPIC_API_KEY. Ese texto NO puede llegar
		// al navegador: un mensaje de error es un sitio del que la gente copia.
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await subir(CARTA_PDF, 'carta.pdf');
		assert.doesNotMatch(JSON.stringify(r.body), /ANTHROPIC/i);
		assert.doesNotMatch(JSON.stringify(ultimaEscritura('importaciones_carta')), /ANTHROPIC/i);
		assert.equal(r.body.error, 'No se pudo leer la carta');
	});
});

describe('aplicar el borrador', () => {
	const BORRADOR = {
		categorias: [
			{ nombre: 'CALDOS', platos: [{ nombre: 'CALDO DE COSTILLA', precio_numerico: 10000 }] },
			{ nombre: 'Postres', platos: [{ nombre: 'FLAN', precio_numerico: 5000 }] },
		],
	};

	// Un restaurante que ya tiene 'POSTRES' con dos platos dentro.
	function conCartaExistente(estado = 'listo') {
		conTabla((st) => {
			if (st.tabla === 'importaciones_carta') {
				if (st.op === 'select') return { data: { id: IMPORTACION, restaurante_id: IDS.restaurante, estado, borrador: BORRADOR }, error: null };
				return { data: {}, error: null };
			}
			if (st.tabla === 'categorias' && st.op === 'select')
				return { data: [{ id: 'cat-postres', nombre: 'POSTRES', orden: 2 }], error: null };
			if (st.tabla === 'categorias' && st.op === 'insert')
				return { data: st.payload.map((c, i) => ({ id: `nueva-${i}`, nombre: c.nombre })), error: null };
			if (st.tabla === 'productos' && st.op === 'select')
				return { data: [{ categoria_id: 'cat-postres', orden: 4 }, { categoria_id: 'cat-postres', orden: 9 }], error: null };
			return { data: [], error: null };
		});
	}

	test('crea lo que falta y reutiliza lo que ya estaba', async () => {
		conCartaExistente();
		const r = await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		assert.equal(r.status, 200);
		assert.equal(r.body.categorias_creadas, 1);
		assert.equal(r.body.categorias_reutilizadas, 1);
		assert.equal(r.body.platos_creados, 2);
	});

	test('no borra nada: solo inserta', async () => {
		conCartaExistente();
		await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		assert.equal(llamadas.filter((l) => l.op === 'delete').length, 0);
		assert.equal(llamadas.filter((l) => l.tabla === 'productos' && l.op === 'update').length, 0);
	});

	test('los platos nuevos entran detrás de los que ya había', async () => {
		conCartaExistente();
		await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		const ins = llamadas.find((l) => l.tabla === 'productos' && l.op === 'insert');
		const flan = ins.payload.find((p) => p.nombre === 'FLAN');
		assert.equal(flan.categoria_id, 'cat-postres');
		assert.equal(flan.orden, 10, 'el mayor que había era 9');
	});

	test('los dos campos de precio salen coherentes', async () => {
		conCartaExistente();
		await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		const ins = llamadas.find((l) => l.tabla === 'productos' && l.op === 'insert');
		const caldo = ins.payload.find((p) => p.nombre === 'CALDO DE COSTILLA');
		assert.equal(caldo.precio_numerico, 10000);
		assert.equal(caldo.precio, '$ 10.000');
	});

	test('ningún plato llega con foto', async () => {
		// Las fotos no se importan: se suben aparte, como siempre.
		conCartaExistente();
		await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		const ins = llamadas.find((l) => l.tabla === 'productos' && l.op === 'insert');
		for (const p of ins.payload) assert.equal(p.imagen_url, null);
	});

	test('queda marcada como aplicada', async () => {
		conCartaExistente();
		await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		assert.equal(ultimaEscritura('importaciones_carta').estado, 'aplicado');
	});

	test('aplicar dos veces no duplica la carta', async () => {
		// Un doble clic con la red lenta llega igual dos veces, así que esto no
		// puede estar solo en el panel.
		conCartaExistente('aplicado');
		const r = await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		assert.equal(r.status, 409);
		assert.equal(llamadas.filter((l) => l.tabla === 'productos' && l.op === 'insert').length, 0);
	});

	test('una que todavía no está lista no se aplica', async () => {
		conCartaExistente('error');
		const r = await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		assert.equal(r.status, 409);
	});

	test('un borrador sin platos no crea categorías sueltas', async () => {
		conTabla((st) => {
			if (st.tabla === 'importaciones_carta' && st.op === 'select')
				return { data: { id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'listo', borrador: { categorias: [] } }, error: null };
			return { data: [], error: null };
		});
		const r = await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		assert.equal(r.status, 400);
		assert.equal(llamadas.filter((l) => l.tabla === 'categorias' && l.op === 'insert').length, 0);
	});

	test('no se aplica una importación de otro restaurante', async () => {
		conTabla((st) => (st.tabla === 'importaciones_carta' && st.op === 'select')
			? { data: { id: IMPORTACION, restaurante_id: AJENO, estado: 'listo', borrador: BORRADOR }, error: null }
			: { data: [], error: null });
		const r = await pedir('POST', `/api/importaciones/${IMPORTACION}/aplicar`, {}, tokenCliente);
		assert.equal(r.status, 403);
	});
});

describe('corregir y descartar', () => {
	test('lo que corrige la persona pasa por la misma validación', async () => {
		// Un plato sin nombre no puede colarse por la puerta de la revisión si
		// no puede colarse por la del modelo.
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'listo' });
		await pedir('PUT', `/api/importaciones/${IMPORTACION}`, {
			borrador: { categorias: [{ nombre: 'X', platos: [{ nombre: '  ' }, { nombre: 'SOPA', precio: '$ 3.000' }] }] },
		}, tokenCliente);
		const guardado = ultimaEscritura('importaciones_carta');
		assert.equal(guardado.borrador.categorias[0].platos.length, 1);
		assert.equal(guardado.borrador.categorias[0].platos[0].precio_numerico, 3000);
	});

	test('no se corrige una que ya se aplicó', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'aplicado' });
		const r = await pedir('PUT', `/api/importaciones/${IMPORTACION}`, { borrador: { categorias: [] } }, tokenCliente);
		assert.equal(r.status, 409);
	});

	test('descartar marca, no borra', async () => {
		// La fila es lo que cuenta el cupo, y el intento ya se pagó.
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'listo' });
		const r = await pedir('DELETE', `/api/importaciones/${IMPORTACION}`, null, tokenCliente);
		assert.equal(r.status, 200);
		assert.equal(ultimaEscritura('importaciones_carta').estado, 'descartado');
		assert.equal(llamadas.filter((l) => l.tabla === 'importaciones_carta' && l.op === 'delete').length, 0);
	});

	test('no se descarta una que ya se aplicó', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'aplicado' });
		const r = await pedir('DELETE', `/api/importaciones/${IMPORTACION}`, null, tokenCliente);
		assert.equal(r.status, 409);
	});

	test('no se lee la importación de otro restaurante', async () => {
		conTabla((st) => (st.tabla === 'importaciones_carta')
			? { data: { id: IMPORTACION, restaurante_id: AJENO, estado: 'listo' }, error: null }
			: { data: [], error: null });
		const r = await pedir('GET', `/api/importaciones/${IMPORTACION}`, null, tokenCliente);
		assert.equal(r.status, 403);
	});
});

describe('elegir el modelo desde el panel', () => {
	test('la lista sale del servidor, que es donde está la lista blanca', async () => {
		const r = await pedir('GET', `/api/importaciones/opciones?restaurante_id=${IDS.restaurante}`, null, tokenAdmin);
		assert.equal(r.status, 200);
		assert.ok(r.body.modelos.length >= 2);
		assert.ok(r.body.por_defecto.texto, 'dice cuál se usa si no eliges');
		assert.ok(r.body.por_defecto.vision, 'y cuál para las imágenes');
	});

	test("'/opciones' no se confunde con el id de una importación", async () => {
		// Express prueba las rutas en orden: si '/:id' se registrara antes, esta
		// petición buscaría una importación llamada 'opciones' y daría 403.
		const r = await pedir('GET', `/api/importaciones/opciones?restaurante_id=${IDS.restaurante}`, null, tokenAdmin);
		assert.notEqual(r.status, 403);
		assert.ok(Array.isArray(r.body.modelos));
	});

	test('sin token no se lista', async () => {
		assert.equal((await pedir('GET', `/api/importaciones/opciones?restaurante_id=${IDS.restaurante}`, null, null)).status, 401);
	});

	test('el admin puede elegirlo al subir', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await pedirArchivo(`/api/importaciones?restaurante_id=${IDS.restaurante}`,
			{ modelo: 'claude-opus-5' }, tokenAdmin, 'carta.pdf', CARTA_PDF);
		// Falla igual por falta de clave, pero el modelo llegó a validarse: si
		// no estuviera permitido, el mensaje sería otro.
		assert.doesNotMatch(String(r.body && r.body.error), /no está permitido/);
	});

	test('un modelo que no está en la lista se rechaza', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await pedirArchivo(`/api/importaciones?restaurante_id=${IDS.restaurante}`,
			{ modelo: 'claude-carisimo-9' }, tokenAdmin, 'carta.pdf', CARTA_PDF);
		assert.equal(r.status, 400);
		assert.match(r.body.error, /no está permitido/);
	});

	test('al restaurante no se le hace caso: elegir modelo cambia lo que se paga', async () => {
		// No da error, simplemente se ignora. Un 400 obligaría al panel a saber
		// quién puede y quién no, y esa regla vive en un solo sitio.
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await pedirArchivo(`/api/importaciones?restaurante_id=${IDS.restaurante}`,
			{ modelo: 'claude-carisimo-9' }, tokenCliente, 'carta.pdf', CARTA_PDF);
		assert.doesNotMatch(String(r.body && r.body.error), /no está permitido/);
	});
});

describe('el motivo de verdad, solo para quien puede arreglarlo', () => {
	// Un fallo de configuración —una clave sin workspace, un modelo retirado—
	// le llegaba al superadmin como "No se pudo leer la carta", y hubo que
	// entrar por SSH al servidor para saber qué pasaba. El 07/09/2026.
	test('el superadmin recibe el motivo técnico', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await subir(CARTA_PDF, 'carta.pdf', tokenAdmin);
		assert.equal(r.body.error, 'No se pudo leer la carta');
		assert.match(r.body.detalle, /ANTHROPIC_API_KEY/, 'el motivo real, para poder arreglarlo');
	});

	test('el restaurante no', async () => {
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		const r = await subir(CARTA_PDF, 'carta.pdf', tokenCliente);
		assert.equal(r.body.error, 'No se pudo leer la carta');
		assert.equal(r.body.detalle, null);
	});

	test('lo que se GUARDA sigue siendo el mensaje de siempre', async () => {
		// La fila la puede leer el restaurante por GET, así que el motivo
		// técnico no puede quedarse ahí.
		conFila({ id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' });
		await subir(CARTA_PDF, 'carta.pdf', tokenAdmin);
		const guardado = ultimaEscritura('importaciones_carta');
		assert.equal(guardado.error, 'No se pudo leer la carta');
		assert.doesNotMatch(JSON.stringify(guardado), /ANTHROPIC/);
	});
});

describe('a quién se le ofrece importar', () => {
	// Es una herramienta del ALTA. A quien ya tiene la carta montada no se le
	// ofrece: no le sirve y sí puede duplicársela.
	//
	// El umbral NO es cero, y el motivo salió de los datos el 09/09/2026: de
	// los diez restaurantes de entonces ninguno tenía cero productos, así que
	// con la regla estricta la función no le habría aparecido a nadie. Los que
	// más la necesitaban eran los de 1, 2, 5 y 6 platos.
	const conProductos = (n) => conTabla((st) => {
		if (st.tabla === 'productos' && st.opciones && st.opciones.head) return { data: null, count: n, error: null };
		if (st.tabla === 'importaciones_carta') {
			if (st.opciones && st.opciones.head) return { data: null, count: 0, error: null };
			return { data: { id: IMPORTACION, restaurante_id: IDS.restaurante, estado: 'pendiente' }, error: null };
		}
		return { data: [], error: null };
	});

	const opciones = (token) => pedir('GET', `/api/importaciones/opciones?restaurante_id=${IDS.restaurante}`, null, token);

	test('con la carta a medias, sí', async () => {
		conProductos(6);
		assert.equal((await opciones(tokenCliente)).body.puede_importar, true);
	});

	test('con la carta montada, no', async () => {
		conProductos(97);
		assert.equal((await opciones(tokenCliente)).body.puede_importar, false);
	});

	test('justo en el umbral, no', async () => {
		// El tope es "menos de", no "hasta".
		const r = await opciones(tokenAdmin);
		const tope = r.body.max_productos;
		conProductos(tope);
		assert.equal((await opciones(tokenCliente)).body.puede_importar, false);
		conProductos(tope - 1);
		assert.equal((await opciones(tokenCliente)).body.puede_importar, true);
	});

	test('el superadmin siempre, tenga la carta que tenga', async () => {
		// Para el equipo esto ES la herramienta del alta.
		conProductos(500);
		assert.equal((await opciones(tokenAdmin)).body.puede_importar, true);
	});

	test('y el servidor lo rechaza, no solo el panel', async () => {
		// Esconder una pestaña no impide una llamada directa a la API.
		conProductos(97);
		const r = await subir(CARTA_PDF, 'carta.pdf', tokenCliente);
		assert.equal(r.status, 409);
		assert.match(r.body.error, /ya tiene platos/);
		assert.equal(llamadas.filter((l) => l.tabla === 'importaciones_carta' && l.op === 'insert').length, 0,
			'ni se crea la fila: no gasta cupo');
	});

	test('el superadmin sube igual con la carta llena', async () => {
		conProductos(500);
		const r = await subir(CARTA_PDF, 'carta.pdf', tokenAdmin);
		assert.notEqual(r.status, 409);
	});

	test('sin restaurante_id no se contesta', async () => {
		assert.equal((await pedir('GET', '/api/importaciones/opciones', null, tokenCliente)).status, 403);
	});

	test('no se preguntan las opciones de otro restaurante', async () => {
		const r = await pedir('GET', `/api/importaciones/opciones?restaurante_id=${AJENO}`, null, tokenCliente);
		assert.equal(r.status, 403);
	});
});

describe('elegir modelo es cosa del superadmin', () => {
	const opciones = (token) => pedir('GET', `/api/importaciones/opciones?restaurante_id=${IDS.restaurante}`, null, token);

	test('al restaurante no se le manda la lista', async () => {
		// El servidor ya ignora el campo si llega de él; no mandarle la lista es
		// no enseñarle un mando que no acciona nada.
		const r = await opciones(tokenCliente);
		assert.deepEqual(r.body.modelos, []);
		assert.equal(r.body.por_defecto, null);
	});

	test('al superadmin sí, y con su precio', async () => {
		const r = await opciones(tokenAdmin);
		assert.ok(r.body.modelos.length >= 2);
		assert.ok(r.body.por_defecto.texto);
		for (const m of r.body.modelos) assert.ok(m.precio, `${m.id} sin precio`);
	});
});
