// La cola de conversión. Solo las partes puras: construir los argumentos de
// ffmpeg y decidir de dónde sale la portada. Lo demás toca disco y lanza
// procesos, y probar eso aquí sería probar a ffmpeg, no a nosotros.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const video = require('../video.js');

// Devuelve el valor que sigue a una bandera, para poder afirmar sobre un
// argumento sin depender de en qué posición quedó.
function valorDe(args, bandera) {
	const i = args.indexOf(bandera);
	return i === -1 ? null : args[i + 1];
}

// ═══════════════════════════════════════════════════════════════
describe('instantePortada · de dónde se saca el fotograma', () => {
	test('con un video normal, del segundo 1', () => {
		// El primer fotograma suele pillar la cámara todavía enfocando.
		assert.equal(video.instantePortada(8), 1);
		assert.equal(video.instantePortada(3.5), 1);
	});

	test('con un clip más corto que eso, de la mitad', () => {
		// Un toque sin querer al grabar deja un video de medio segundo. Pedirle
		// el segundo 1 devuelve un JPEG vacío, ffmpeg sale con código 0, y el
		// trabajo muere en "La portada salió vacía" sin explicar nada.
		assert.equal(video.instantePortada(0.6), 0.3);
		assert.equal(video.instantePortada(1), 0.5);
	});

	test('el instante siempre cae dentro del video', () => {
		for (const d of [0.2, 0.5, 1, 1.19, 1.21, 2, 8, 60])
			assert.ok(video.instantePortada(d) < d, `con ${d} s el fotograma queda fuera`);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('argumentos de ffmpeg · el segundo de inicio', () => {
	test('sin desplazamiento no se pasa -ss', () => {
		// Un -ss 0 no rompe nada, pero ensucia la orden y confunde al leer los
		// registros de un trabajo que empezaba por el principio.
		assert.equal(video.argumentosEntregable('e.mp4', 's.mp4').includes('-ss'), false);
		assert.equal(video.argumentosMaster('e.mp4', 's.mp4').includes('-ss'), false);
	});

	test('el -ss va ANTES del -i, no después', () => {
		// Detrás del -i, ffmpeg decodifica y descarta todo lo anterior: el coste
		// crece con lo que se salta. Delante, salta por el índice del archivo.
		for (const args of [video.argumentosEntregable('e.mp4', 's.mp4', 12),
		                    video.argumentosMaster('e.mp4', 's.mp4', 12)]) {
			assert.ok(args.indexOf('-ss') < args.indexOf('-i'), '-ss tiene que ir delante');
			assert.equal(valorDe(args, '-ss'), '12');
		}
	});

	test('el entregable y el master se cortan por el mismo sitio', () => {
		// Si no coincidieran, el master dejaría de servir para recortar otra
		// vez: enseñaría un trozo distinto del que ve el cliente.
		const e = video.argumentosEntregable('e.mp4', 's.mp4', 7);
		const m = video.argumentosMaster('e.mp4', 'm.mp4', 7);
		assert.equal(valorDe(e, '-ss'), valorDe(m, '-ss'));
		assert.equal(valorDe(e, '-t'),  valorDe(m, '-t'));
	});
});

// ═══════════════════════════════════════════════════════════════
describe('argumentos de ffmpeg · lo que no se puede perder', () => {
	test('todas las órdenes llevan -nostdin', () => {
		// Sin él, ffmpeg se come la entrada estándar del proceso padre: al
		// encadenar varias conversiones, las siguientes se cuelan en su consola
		// interactiva y salen con frame=0.
		for (const args of [video.argumentosEntregable('e.mp4', 's.mp4'),
		                    video.argumentosMaster('e.mp4', 'm.mp4'),
		                    video.argumentosPortada('s.mp4', 'p.jpg')])
			assert.ok(args.includes('-nostdin'));
	});

	test('el entregable sale sin audio y el master con audio', () => {
		// Ningún navegador móvil autoreproduce con sonido, así que en el
		// entregable el audio es peso muerto. Pero un master sin audio no
		// permite recuperarlo nunca.
		assert.ok(video.argumentosEntregable('e.mp4', 's.mp4').includes('-an'));
		assert.equal(video.argumentosMaster('e.mp4', 'm.mp4').includes('-an'), false);
		assert.equal(valorDe(video.argumentosMaster('e.mp4', 'm.mp4'), '-c:a'), 'aac');
	});

	test('el entregable lleva faststart', () => {
		// Sin esto el navegador descarga el archivo entero antes de pintar el
		// primer cuadro, y la carga perezosa de la carta deja de servir de nada.
		assert.equal(valorDe(video.argumentosEntregable('e.mp4', 's.mp4'), '-movflags'), '+faststart');
	});

	test('el entregable recorta a 16:9 y el master no recorta', () => {
		// Es la diferencia que permite cambiar de proporción más adelante sin
		// pedirle a ningún cliente que vuelva a grabar.
		const vfEntregable = valorDe(video.argumentosEntregable('e.mp4', 's.mp4'), '-vf');
		const vfMaster     = valorDe(video.argumentosMaster('e.mp4', 'm.mp4'), '-vf');

		assert.match(vfEntregable, /crop=1280:720/);
		assert.doesNotMatch(vfMaster, /crop/, 'el master no puede llevar crop');
		assert.match(vfMaster, /decrease/, 'solo reduce');
	});

	test('el master no amplía una fuente pequeña', () => {
		// Con la caja fija en 1920, 'decrease' agranda lo que sea menor: un
		// 1280x959 saldría 1920x1438, más pesado que el original y sin un píxel
		// de información nueva. El min() lo impide.
		assert.match(valorDe(video.argumentosMaster('e.mp4', 'm.mp4'), '-vf'), /min\(1920/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('purgarAnteriores · reemplazar un video no deja basura', () => {
	// El plato apunta al video nuevo, pero los archivos del viejo seguían en
	// disco. Y el limpiador tampoco los recogía: su fila en trabajos_video los
	// seguía nombrando, así que para él estaban en uso. Unos 7 MB por
	// reemplazo, y reemplazar es lo más normal del mundo.
	const RAIZ = path.join(__dirname, '..', 'uploads');

	// Un supabase de mentira: devuelve los trabajos viejos y apunta qué filas
	// le mandan borrar.
	const supabaseFalso = viejos => {
		const filasBorradas = [];
		const q = {
			select: () => q,
			eq:     () => q,
			neq:    () => q,
			in:     () => Promise.resolve({ data: viejos }),
			delete: () => ({ eq: (_col, valor) => { filasBorradas.push(valor); return Promise.resolve({}); } }),
		};
		return { filasBorradas, from: () => q };
	};

	// Crea los tres archivos de un trabajo y devuelve sus rutas relativas.
	const crearTrio = base => {
		const trio = {
			video:   `videos/${base}.mp4`,
			master:  `masters/${base}-master.mp4`,
			portada: `miniaturas/${base}.jpg`,
		};
		for (const rel of Object.values(trio)) {
			const abs = path.join(RAIZ, rel);
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, 'x');
		}
		return trio;
	};

	const existe = rel => fs.existsSync(path.join(RAIZ, rel));
	const limpiar = trio => { for (const rel of Object.values(trio)) { try { fs.unlinkSync(path.join(RAIZ, rel)); } catch {} } };

	test('borra los tres archivos del trabajo anterior y su fila', async () => {
		const viejo = crearTrio('prueba-viejo-' + Date.now());
		const sb = supabaseFalso([{ id: 'trabajo-viejo', ...viejo }]);

		try {
			await video.purgarAnteriores(sb, { id: 'trabajo-nuevo', producto_id: 'p1' });

			assert.equal(existe(viejo.video), false, 'el entregable viejo');
			assert.equal(existe(viejo.master), false, 'el master viejo');
			assert.equal(existe(viejo.portada), false, 'la portada vieja');
			assert.deepEqual(sb.filasBorradas, ['trabajo-viejo']);
		} finally {
			// En finally: si la prueba falla, los archivos que creó no deben
			// quedarse ahí ensuciando la carpeta de subidas.
			limpiar(viejo);
		}
	});

	test('sin trabajos anteriores no hace nada', async () => {
		const sb = supabaseFalso([]);
		await video.purgarAnteriores(sb, { id: 'trabajo-nuevo', producto_id: 'p1' });
		assert.deepEqual(sb.filasBorradas, []);
	});

	test('un trabajo sin plato no purga nada', async () => {
		// Sin producto_id no hay "anteriores de este plato" que valgan: sería
		// borrar por un criterio que no existe.
		const sb = supabaseFalso([{ id: 'no-deberia-tocarse' }]);
		await video.purgarAnteriores(sb, { id: 'trabajo-nuevo', producto_id: null });
		assert.deepEqual(sb.filasBorradas, []);
	});

	test('una ruta que se sale de uploads no se toca', async () => {
		// rutaDentroDeUploads devuelve null y el archivo se salta. Si algún día
		// entrara basura en esa columna, esto es lo que impide que el worker
		// borre fuera de su carpeta.
		const sb = supabaseFalso([{ id: 'raro', video: '../../etc/passwd', master: null, portada: null }]);
		await video.purgarAnteriores(sb, { id: 'trabajo-nuevo', producto_id: 'p1' });
		assert.deepEqual(sb.filasBorradas, ['raro'], 'la fila sí se limpia');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('formatos · cada modelo pide su encuadre y su calidad', () => {
	const args = f => video.argumentosEntregable('e.mp4', 's.mp4', 0, f);

	test('el apaisado sale 1280x720 y el vertical 720x1280', () => {
		// El servidor deriva el formato del modelo del restaurante. Si el
		// recorte no coincidiera, la carta vertical enseñaría una franja
		// central de un video apaisado, estirada a pantalla completa.
		assert.match(valorDe(args('horizontal'), '-vf'), /scale=1280:720:.*crop=1280:720/);
		assert.match(valorDe(args('vertical'),   '-vf'), /scale=720:1280:.*crop=720:1280/);
	});

	test('los dos recortan por exceso, nunca con franjas negras', () => {
		// increase + crop llena el hueco y recorta lo que sobra. Con 'decrease'
		// saldrían bandas a los lados cuando la fuente no case.
		for (const f of ['horizontal', 'vertical']) {
			const vf = valorDe(args(f), '-vf');
			assert.match(vf, /force_original_aspect_ratio=increase/, `en ${f}`);
			assert.match(vf, /fps=30/, `en ${f}`);
		}
	});

	test('un formato desconocido cae en apaisado y no revienta', () => {
		// La columna tiene un CHECK, pero si algún día entra otro valor es
		// mejor un video apaisado que un trabajo muerto.
		for (const malo of ['cuadrado', '', null, undefined])
			assert.deepEqual(args(malo), args('horizontal'), `con ${JSON.stringify(malo)}`);
	});

	test('el vertical gasta más bits que el apaisado', () => {
		// Mismo número de píxeles en los dos, pero el vertical ocupa la
		// pantalla entera del móvil y ahí el mismo archivo perdona mucho
		// menos. En crf, más bajo es mejor calidad.
		const crf = f => Number(valorDe(args(f), '-crf'));
		assert.ok(crf('vertical') < crf('horizontal'),
			`el vertical debería ir con mejor calidad (v=${crf('vertical')}, h=${crf('horizontal')})`);
	});

	test('el tope de bitrate acompaña al crf', () => {
		// Bajar el crf con el maxrate fijo no sirve de nada en los planos con
		// movimiento, que es justo donde se ve el problema: el limitador
		// recorta la mejora antes de que llegue.
		const kbps = (f, bandera) => Number(valorDe(args(f), bandera).replace('k', ''));
		assert.ok(kbps('vertical', '-maxrate') > kbps('horizontal', '-maxrate'));
		// Y el bufsize por encima del maxrate, o el limitador va a tirones.
		for (const f of ['horizontal', 'vertical'])
			assert.ok(kbps(f, '-bufsize') >= kbps(f, '-maxrate'), `en ${f}`);
	});

	test('todos los formatos declaran las cinco cosas', () => {
		// Una que falte se lee como undefined y ffmpeg recibe "undefined" como
		// valor de bandera: el trabajo muere con un error ilegible.
		for (const [nombre, f] of Object.entries(video.FORMATOS))
			for (const campo of ['ancho', 'alto', 'crf', 'maxrate', 'bufsize'])
				assert.ok(f[campo] !== undefined, `${nombre} no declara "${campo}"`);
	});

	test('lo que no depende del formato no cambia con él', () => {
		// El sonido, faststart y la duración son de la plataforma, no del
		// encuadre. Si se colaran en la tabla, se podrían desincronizar.
		for (const f of ['horizontal', 'vertical']) {
			assert.ok(args(f).includes('-an'), `en ${f} debería ir sin audio`);
			assert.equal(valorDe(args(f), '-movflags'), '+faststart', `en ${f}`);
			assert.equal(valorDe(args(f), '-t'), String(video.DURACION_MAX), `en ${f}`);
		}
	});
});
