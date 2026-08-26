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

	test('la portada es UN fotograma, no un video de un cuadro', () => {
		// Las tres banderas van juntas y ninguna sobra. Sin -frames:v 1, ffmpeg
		// escribe la secuencia entera. Sin -update 1, avisa de que está
		// sobreescribiendo el mismo archivo una y otra vez y puede acabar
		// dejando el ÚLTIMO fotograma en vez del que se pidió.
		const args = video.argumentosPortada('s.mp4', 'p.jpg');
		assert.equal(valorDe(args, '-frames:v'), '1');
		assert.equal(valorDe(args, '-update'), '1');
	});

	test('la portada se guarda con calidad de mirar, no de archivo', () => {
		// -q:v va de 2 (mejor) a 31. En 5 la miniatura de un plato pesa unos
		// 40 KB y es lo primero que se ve de la carta: subirlo se nota en la
		// carga y bajarlo se nota en el plato.
		assert.equal(valorDe(video.argumentosPortada('s.mp4', 'p.jpg'), '-q:v'), '5');
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

// ═══════════════════════════════════════════════════════════════
describe('aprobación · lo que genera un modelo no entra solo en la carta', () => {
	// El modelo no copia el plato: lo interpreta. Al orbitar hacia 3/4 tiene
	// que rellenar el lado que la foto no enseña, y ahí puede aparecer una
	// guarnición que el negocio no sirve. Publicar eso sin mirarlo es
	// publicidad engañosa, y el expuesto es el restaurante.
	//
	// Un video subido a mano no pasa por aquí: quien graba su plato ya lo vio.

	test('un video subido se publica solo', () => {
		assert.equal(video.esperaAprobacion({ origen_tipo: 'subido' }), false);
		// Sin la columna tampoco espera: son todos los que ya existían antes
		// de que este paso existiera, y ninguno debe quedarse fuera de la carta.
		assert.equal(video.esperaAprobacion({}), false);
	});

	test('un video generado espera, y deja de esperar al aprobarlo', () => {
		assert.equal(video.esperaAprobacion({ origen_tipo: 'ia' }), true);
		assert.equal(video.esperaAprobacion({ origen_tipo: 'ia', aprobado: null }), true);
		assert.equal(video.esperaAprobacion({ origen_tipo: 'ia', aprobado: false }), true,
			'descartado no es publicado: tampoco entra en la carta');
		assert.equal(video.esperaAprobacion({ origen_tipo: 'ia', aprobado: true }), false);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('publicarTrabajo · el mismo final, en diferido', () => {
	// Publica lo que procesarTrabajo habría publicado solo si el video no
	// viniera de un modelo. Por eso reutiliza guardarEnProducto y
	// purgarAnteriores en vez de repetir la lógica: dos copias del "qué se
	// escribe en el plato" es cómo acaban discrepando.

	const supabaseFalso = () => {
		const escrituras = [];
		const q = {
			select: () => q, eq: () => q, neq: () => q,
			maybeSingle: () => Promise.resolve({ data: { atributos: { imagenes: ['foto.jpg'] } } }),
			in: () => Promise.resolve({ data: [] }),
			update(obj) { escrituras.push(obj); return { eq: () => Promise.resolve({}) }; },
			delete: () => ({ eq: () => Promise.resolve({}) }),
		};
		return { escrituras, from: () => q };
	};

	test('un trabajo sin convertir no se puede publicar', async () => {
		// Sin rutas no hay archivo: la conversión no llegó a terminar. Marcar
		// eso como aprobado dejaría el plato apuntando a nada.
		await assert.rejects(
			() => video.publicarTrabajo(supabaseFalso(), { id: 't1', producto_id: 'p1' }),
			/todavía no está convertido/);
	});

	test('un trabajo sin plato tampoco', async () => {
		await assert.rejects(
			() => video.publicarTrabajo(supabaseFalso(), { id: 't1', video: 'videos/a.mp4', portada: 'miniaturas/a.jpg' }),
			/no está asociado a ningún plato/);
	});

	test('publicar escribe el video en el plato y marca el trabajo', async () => {
		const sb = supabaseFalso();
		await video.publicarTrabajo(sb, {
			id: 't1', producto_id: 'p1',
			video: 'videos/a.mp4', master: 'masters/a-master.mp4', portada: 'miniaturas/a.jpg',
		});

		const enPlato = sb.escrituras.find(e => e.atributos);
		assert.ok(enPlato, 'el plato tiene que recibir su video');
		assert.match(enPlato.atributos.video.url, /videos\/a\.mp4$/);
		assert.match(enPlato.atributos.video.portada, /miniaturas\/a\.jpg$/);
		// Lo que ya tenía el plato sigue ahí: atributos guarda más cosas y un
		// update directo se las llevaría por delante.
		assert.deepEqual(enPlato.atributos.imagenes, ['foto.jpg']);
		// El master NO se expone: es interno y su ruta vive en trabajos_video.
		assert.equal('master' in enPlato.atributos.video, false);

		assert.ok(sb.escrituras.some(e => e.aprobado === true), 'y el trabajo queda aprobado');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('descartarTrabajo · lo contrario de publicar', () => {
	const RAIZ = path.join(__dirname, '..', 'uploads');

	const supabaseFalso = () => {
		const escrituras = [];
		const q = {
			select: () => q, eq: () => q,
			update(obj) { escrituras.push(obj); return { eq: () => Promise.resolve({}) }; },
		};
		return { escrituras, from: () => q };
	};

	test('borra los archivos en el momento y deja constancia', async () => {
		// No se le dejan al limpiador: espera siete días de gracia, y entre
		// entregable, master y portada son ~7 MB por descarte en un disco cuyo
		// espacio ya se vigila antes de cada subida.
		const base = 'prueba-descarte-' + Date.now();
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

		const sb = supabaseFalso();
		try {
			await video.descartarTrabajo(sb, { id: 't1', ...trio });

			for (const [que, rel] of Object.entries(trio))
				assert.equal(fs.existsSync(path.join(RAIZ, rel)), false, `${que} debe borrarse`);

			// La fila NO se borra: se marca. generaciones_ia dice que se generó
			// —y se pagó—; lo que se decidió después solo consta aquí.
			assert.deepEqual(sb.escrituras, [{ aprobado: false, video: null, master: null, portada: null }]);
		} finally {
			for (const rel of Object.values(trio)) { try { fs.unlinkSync(path.join(RAIZ, rel)); } catch {} }
		}
	});

	test('una ruta que se sale de uploads no se toca', async () => {
		const sb = supabaseFalso();
		await video.descartarTrabajo(sb, { id: 't1', video: '../../etc/passwd', master: null, portada: null });
		assert.equal(sb.escrituras[0].aprobado, false, 'la fila se marca igual');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('encajeDeFoto · la proporción se comprueba antes de pagar', () => {
	// El modelo hereda la proporción de la foto —su JSON de entrada no tiene
	// campo de proporción—, así que lo que no encaje lo recorta ffmpeg después,
	// sobre un video ya pagado y sin reintento. Comprobarlo antes cuesta una
	// división; no comprobarlo cuesta $0,27.

	test('una foto con la proporción de la carta no pierde nada', () => {
		assert.equal(video.encajeDeFoto(1600, 900, 'horizontal').veredicto, 'bien');
		assert.equal(video.encajeDeFoto(720, 1280, 'vertical').veredicto, 'bien');
	});

	test('una foto 3:4 en una carta horizontal avisa, pero deja pasar', () => {
		// Es el caso real: la Salchipapa de Juan Mar, generada el 24/08/2026
		// desde una foto 3:4. Pierde el 58% de la altura y el video quedó bien,
		// porque en horizontal se ve en una tarjeta y el plato va centrado.
		// Rechazarlo habría bloqueado una generación que sí sirvió.
		const r = video.encajeDeFoto(800, 1067, 'horizontal');
		assert.equal(r.veredicto, 'avisa');
		assert.equal(r.perdido, 58);
	});

	test('una foto apaisada en una carta vertical se rechaza', () => {
		// Aquí el video ocupa la pantalla entera: hay que sacar una tira
		// estrecha del centro y ampliarla, y al plato se le van los lados.
		const r = video.encajeDeFoto(1600, 900, 'vertical');
		assert.equal(r.veredicto, 'rechaza');
		assert.match(r.mensaje, /foto vertical/i, 'y tiene que decir qué hacer');
	});

	test('una cuadrada también se rechaza en vertical', () => {
		// 44% del ancho fuera. No es apaisada, pero al plato le pasa lo mismo.
		assert.equal(video.encajeDeFoto(1000, 1000, 'vertical').veredicto, 'rechaza');
	});

	test('la regla NO es simétrica, y es a propósito', () => {
		// Misma foto 3:4, distinto destino. En horizontal pierde más (58% frente
		// a 25%) y aun así pasa; en vertical pierde menos y aun así avisa. Lo
		// que decide no es cuánto se recorta sino a qué tamaño se mira: una
		// tarjeta en una lista perdona lo que una pantalla completa no.
		assert.equal(video.encajeDeFoto(800, 1067, 'horizontal').veredicto, 'avisa');
		assert.equal(video.encajeDeFoto(800, 1067, 'vertical').veredicto, 'avisa');
		assert.ok(video.encajeDeFoto(800, 1067, 'horizontal').perdido >
		          video.encajeDeFoto(800, 1067, 'vertical').perdido);
	});

	test('un formato desconocido no revienta: cae en horizontal', () => {
		assert.equal(video.encajeDeFoto(1600, 900, 'diagonal').veredicto, 'bien');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('formatoDe · una sola línea para los tres sitios que preguntaban', () => {
	test('solo "vertical" es vertical', () => {
		assert.equal(video.formatoDe({ nav: 'vertical' }), 'vertical');
		for (const nav of ['video', 'topnav', 'explorar', undefined, null])
			assert.equal(video.formatoDe({ nav }), 'horizontal');
	});

	test('sin atributos tampoco falla', () => {
		// Un restaurante recién creado o una lectura que no trajo la columna.
		assert.equal(video.formatoDe(null), 'horizontal');
		assert.equal(video.formatoDe(undefined), 'horizontal');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('reconvertir · el master por fin sirve para algo', () => {
	// video.js dice desde el principio que "pasar un restaurante de un formato
	// al otro es reconvertir, no volver a grabar". No era verdad: se guardaban
	// los masters y no había código que los usara. Esto es lo que faltaba.

	test('un origen en masters/ es una reconversión, y nada más lo es', () => {
		assert.equal(video.esReconversion({ origen: 'masters/x-master.mp4' }), true);
		assert.equal(video.esReconversion({ origen: 'originales/x.mp4' }), false);
		assert.equal(video.esReconversion({ origen: 'videos/x.mp4' }), false);
		// Sin origen no se puede decidir, y "no es reconversión" es el fallo
		// seguro: como mucho re-codifica de más, nunca borra un master.
		assert.equal(video.esReconversion({}), false);
		assert.equal(video.esReconversion(null), false);
	});

	const RAIZ = path.join(__dirname, '..', 'uploads');
	const supabaseFalso = () => {
		const insertados = [];
		const q = {
			select: () => q, eq: () => q, single: () => Promise.resolve({ data: { id: 'nuevo' }, error: null }),
			insert(filas) { insertados.push(filas[0]); return q; },
		};
		return { insertados, from: () => q };
	};

	test('encola el master como origen, desde el segundo 0', async () => {
		const rel = `masters/prueba-recon-${Date.now()}-master.mp4`;
		const abs = path.join(RAIZ, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, 'x');

		const sb = supabaseFalso();
		try {
			await video.reconvertir(sb, {
				id: 't1', restaurante_id: 'r1', producto_id: 'p1',
				master: rel, formato: 'horizontal', origen_tipo: 'ia', aprobado: true,
			}, 'vertical');

			const f = sb.insertados[0];
			assert.equal(f.origen, rel, 'se parte del master, no de un original que ya no existe');
			assert.equal(f.formato, 'vertical');
			// El master ya viene recortado en el tiempo: volver a saltar
			// segundos se comería el trozo que el restaurante eligió una vez.
			assert.equal(f.desde, 0);
			// La procedencia se hereda: recortar de otra forma no convierte un
			// video generado en uno grabado.
			assert.equal(f.origen_tipo, 'ia');
			// Y la decisión también. Ya lo miró alguien; recortar no es
			// contenido nuevo.
			assert.equal(f.aprobado, true);
		} finally {
			try { fs.unlinkSync(abs); } catch {}
		}
	});

	test('sin master no se puede, y se dice por qué', async () => {
		await assert.rejects(
			() => video.reconvertir(supabaseFalso(), { id: 't1', master: null }, 'vertical'),
			e => e.definitivo === true && /no tiene master/.test(e.message));
	});

	test('con el master borrado del disco tampoco', async () => {
		// La fila puede seguir nombrándolo después de una limpieza o un
		// despliegue que se llevó el volumen por delante.
		await assert.rejects(
			() => video.reconvertir(supabaseFalso(), { id: 't1', master: 'masters/no-existe.mp4' }, 'vertical'),
			e => e.definitivo === true && /ya no está en el disco/.test(e.message));
	});

	test('un master fuera de uploads no se toca', async () => {
		await assert.rejects(
			() => video.reconvertir(supabaseFalso(), { id: 't1', master: '../../etc/passwd' }, 'vertical'),
			e => e.definitivo === true);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('purgarAnteriores · un reconvertido comparte master con su origen', () => {
	// El fallo que esto atrapa borra datos: el reconvertido apunta al MISMO
	// master que el trabajo del que salió, así que purgar sin mirar se lleva el
	// archivo al que el nuevo acaba de apuntar — y con él la única copia sin
	// recortar que queda del video.
	const RAIZ = path.join(__dirname, '..', 'uploads');

	test('no borra el master que el trabajo nuevo está usando', async () => {
		const base = 'prueba-compartido-' + Date.now();
		const master = `masters/${base}-master.mp4`;
		const videoViejo = `videos/${base}-viejo.mp4`;
		for (const rel of [master, videoViejo]) {
			const abs = path.join(RAIZ, rel);
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, 'x');
		}

		const borradas = [];
		const q = {
			select: () => q, eq: () => q, neq: () => q,
			in: () => Promise.resolve({ data: [{ id: 'viejo', video: videoViejo, master, portada: null }] }),
			delete: () => ({ eq: (_c, v) => { borradas.push(v); return Promise.resolve({}); } }),
		};

		try {
			await video.purgarAnteriores({ from: () => q }, {
				id: 'nuevo', producto_id: 'p1',
				video: `videos/${base}-nuevo.mp4`, master, portada: null,
			});

			assert.equal(fs.existsSync(path.join(RAIZ, master)), true,
				'el master compartido tiene que sobrevivir');
			assert.equal(fs.existsSync(path.join(RAIZ, videoViejo)), false,
				'el entregable viejo sí sobra');
			assert.deepEqual(borradas, ['viejo'], 'y la fila vieja se limpia igual');
		} finally {
			for (const rel of [master, videoViejo]) { try { fs.unlinkSync(path.join(RAIZ, rel)); } catch {} }
		}
	});
});
