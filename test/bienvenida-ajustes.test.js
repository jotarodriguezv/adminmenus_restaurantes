// Los ajustes de la bienvenida del 02/10/2026, tras las primeras pruebas del usuario:
// el nombre del restaurante por defecto, los interruptores que no se dejan
// encender sin un dato detrás, y la dirección junto a la ubicación.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const leer = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const sinComentarios = (t) => t.replace(/^\s*\/\/.*$/gm, '');

// Un campo de formulario de juguete.
function campo(extra = {}) {
	const clases = new Set();
	return {
		value: '', checked: false, disabled: false, hidden: false, textContent: '', style: {}, dataset: {},
		classList: { toggle(c, on) { on ? clases.add(c) : clases.delete(c); }, add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) },
		closest() { return this; }, _clases: clases,
		...extra,
	};
}

// bienvenida.js + negocio.js cargados juntos, como en el panel, con los campos que se le den.
function montar(campos = {}, restaurante = { nombre: 'Bonzas', atributos: {} }) {
	const ids = { ...campos };
	const $ = (id) => (ids[id] ||= campo());
	const ctx = vm.createContext({ document: { getElementById: $ }, state: { restaurante }, String, Array, Set, Number, Object, JSON });
	vm.runInContext(leer('negocio.js'), ctx);
	vm.runInContext(leer('bienvenida.js'), ctx);
	return { ctx, $ };
}

// ═══════════════════════════════════════════════════════════════
describe('el nombre del restaurante, por defecto en la bienvenida', () => {
	test('dejado igual que el del restaurante, se guarda VACÍO: sigue al nombre', () => {
		// Guardarlo copiado lo congelaría: si el superadmin cambia el nombre, la
		// bienvenida seguiría diciendo el viejo.
		const { ctx, $ } = montar();
		$('apIntroNombre').value = 'Bonzas';
		assert.equal(ctx.nombreDeBienvenidaParaGuardar(), '');
		$('apIntroNombre').value = '  Bonzas  ';
		assert.equal(ctx.nombreDeBienvenidaParaGuardar(), '', 'los espacios no lo hacen distinto');
	});

	test('uno distinto se guarda como nombre propio de la bienvenida', () => {
		const { ctx, $ } = montar();
		$('apIntroNombre').value = 'Bonzas Burger Grill';
		assert.equal(ctx.nombreDeBienvenidaParaGuardar(), 'Bonzas Burger Grill');
	});

	test('un campo vacío también sigue al nombre', () => {
		const { ctx, $ } = montar();
		$('apIntroNombre').value = '   ';
		assert.equal(ctx.nombreDeBienvenidaParaGuardar(), '');
	});

	test('con otro nombre de restaurante, la comparación es con ese', () => {
		const { ctx, $ } = montar({}, { nombre: 'Malparados', atributos: {} });
		$('apIntroNombre').value = 'Bonzas';
		assert.equal(ctx.nombreDeBienvenidaParaGuardar(), 'Bonzas');
		$('apIntroNombre').value = 'Malparados';
		assert.equal(ctx.nombreDeBienvenidaParaGuardar(), '');
	});

	test('lo que se guarda lo usa valoresBienvenida', () => {
		assert.match(sinComentarios(leer('bienvenida.js')), /intro_nombre: nombreDeBienvenidaParaGuardar\(\)/);
	});

	test('al abrir la pestaña el campo se rellena con el nombre si no hay uno propio', () => {
		assert.match(leer('bienvenida.js'), /poner\('apIntroNombre', datos\.intro_nombre \|\| state\.restaurante\?\.nombre\)/);
	});

	test('la etiqueta ya no dice «vacío = nombre actual»', () => {
		const html = leer('index.html');
		assert.doesNotMatch(html, /vacío = nombre actual/);
		assert.match(html, /sigue al nombre del restaurante/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('los interruptores de la bienvenida no se dejan encender sin un dato', () => {
	const IDS = ['apIntroSocialInstagram', 'apIntroSocialFacebook', 'apIntroSocialTiktok', 'apIntroMapaActivo',
		'apIntroResenaActivo', 'apIntroHorarioActivo', 'apIntroCorreoActivo'];
	const todosEncendidos = () => Object.fromEntries(IDS.map(id => [id, campo({ checked: true })]));
	const COMPLETO = {
		social_instagram: 'https://instagram.com/x', social_facebook: 'https://facebook.com/x', social_tiktok: 'https://tiktok.com/@x',
		mapa_url: 'https://maps.app.goo.gl/a', resena_url: 'https://g.page/r/a/review', correo: 'hola@bonzas.co',
		horario_atencion: [{ dias: [1, 2, 3], desde: '11:00', hasta: '22:00' }],
	};
	const estado = (atributos) => {
		const { ctx, $ } = montar(todosEncendidos(), { nombre: 'Bonzas', atributos });
		ctx.ajustarInterruptoresBienvenida();
		return Object.fromEntries(IDS.map(id => [id, { desactivado: $(id).disabled, encendido: $(id).checked }]));
	};

	test('con todos los datos, todos quedan activos y como estaban', () => {
		for (const [id, e] of Object.entries(estado(COMPLETO))) assert.deepEqual(e, { desactivado: false, encendido: true }, id);
	});

	test('sin ningún dato, todos se apagan y se desactivan', () => {
		for (const [id, e] of Object.entries(estado({}))) assert.deepEqual(e, { desactivado: true, encendido: false }, id);
	});

	test('el caso del usuario: Instagram y Facebook sí, TikTok no', () => {
		const e = estado({ social_instagram: 'https://instagram.com/aojocerrado', social_facebook: 'https://facebook.com/aojocerrado' });
		assert.equal(e.apIntroSocialInstagram.desactivado, false);
		assert.equal(e.apIntroSocialFacebook.desactivado, false);
		assert.deepEqual(e.apIntroSocialTiktok, { desactivado: true, encendido: false });
	});

	test('cada interruptor mira SU dato', () => {
		const sin = (clave) => { const { [clave]: _, ...resto } = COMPLETO; return resto; };
		assert.equal(estado(sin('mapa_url')).apIntroMapaActivo.desactivado, true);
		assert.equal(estado(sin('resena_url')).apIntroResenaActivo.desactivado, true);
		assert.equal(estado(sin('correo')).apIntroCorreoActivo.desactivado, true);
		assert.equal(estado(sin('horario_atencion')).apIntroHorarioActivo.desactivado, true);
		// y los demás no se ven afectados
		assert.equal(estado(sin('correo')).apIntroMapaActivo.desactivado, false);
	});

	test('cuenta lo que la carta lee: las claves viejas del mapa y las reseñas valen', () => {
		const e = estado({ ...COMPLETO, mapa_url: undefined, resena_url: undefined, intro_mapa_url: 'https://maps.app.goo.gl/v', intro_resena_url: 'https://g.page/r/v/review' });
		assert.equal(e.apIntroMapaActivo.desactivado, false);
		assert.equal(e.apIntroResenaActivo.desactivado, false);
	});

	test('un dato borrado (vacío) no cuenta, aunque la clave vieja tuviera valor', () => {
		const e = estado({ ...COMPLETO, mapa_url: '', intro_mapa_url: 'https://maps.app.goo.gl/v' });
		assert.equal(e.apIntroMapaActivo.desactivado, true);
	});

	test('un horario sin días o un correo que no lo parece no cuentan', () => {
		assert.equal(estado({ ...COMPLETO, horario_atencion: [{ dias: [], desde: '', hasta: '' }] }).apIntroHorarioActivo.desactivado, true);
		assert.equal(estado({ ...COMPLETO, correo: 'hola' }).apIntroCorreoActivo.desactivado, true);
	});

	test('la fila entera se marca como «sin dato» para verse apagada', () => {
		const { ctx, $ } = montar(todosEncendidos(), { nombre: 'Bonzas', atributos: { social_instagram: 'https://instagram.com/x' } });
		ctx.ajustarInterruptoresBienvenida();
		assert.equal($('apIntroSocialInstagram')._clases.has('sin-dato'), false);
		assert.equal($('apIntroSocialTiktok')._clases.has('sin-dato'), true);
	});

	test('se aplica al pintar la pestaña, antes de la vista previa', () => {
		assert.match(leer('bienvenida.js'), /pintarDatosEnBienvenida\(\); ajustarInterruptoresBienvenida\(\); actualizarVistaPreviaBienvenida\(\);/);
	});

	test('las reservas NO dependen de ningún dato: ese interruptor queda libre', () => {
		const fuente = sinComentarios(leer('bienvenida.js').match(/function ajustarInterruptoresBienvenida\(\) \{[\s\S]*?\n\}/)[0]);
		assert.doesNotMatch(fuente, /Reservas/);
	});

	test('el estilo de un interruptor desactivado existe', () => {
		const css = leer('panel.css');
		assert.match(css, /\.form-check\.sin-dato/);
		assert.match(css, /\.toggle input:disabled \+ \.toggle-slider/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el botón de WhatsApp de Ajustes no se deja encender sin número', () => {
	const probar = (numero, encendido) => {
		const { ctx, $ } = montar({ ajNegocioWhatsapp: campo({ value: numero }), ajWhatsappBoton: campo({ checked: encendido }) });
		ctx.pintarWhatsappEnPedidos();
		return $('ajWhatsappBoton');
	};

	test('sin número se apaga y se desactiva', () => {
		const b = probar('', true);
		assert.equal(b.disabled, true);
		assert.equal(b.checked, false);
	});

	test('con número se puede encender, y no se le cambia lo que tenía', () => {
		assert.deepEqual({ d: probar('573185267015', true).disabled, c: probar('573185267015', true).checked }, { d: false, c: true });
		assert.deepEqual({ d: probar('573185267015', false).disabled, c: probar('573185267015', false).checked }, { d: false, c: false });
	});

	test('solo espacios o un «+» cuenta como sin número', () => {
		assert.equal(probar('  + - ', true).disabled, true);
	});

	test('se reevalúa al escribir el número, no solo al abrir la pestaña', () => {
		const html = leer('index.html');
		assert.match(html, /id="ajNegocioWhatsapp"[^>]*oninput="pintarWhatsappEnPedidos\(\)"/);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la dirección, junto a la ubicación', () => {
	const html = leer('index.html');
	const seccion = (titulo) => {
		const i = html.indexOf(`<summary>${titulo}</summary>`);
		assert.ok(i > -1, `no se encontró la sección «${titulo}»`);
		return html.slice(i, html.indexOf('</details>', i));
	};

	test('la sección se llama «Dirección y ubicación» y lleva la dirección arriba', () => {
		const s = seccion('Dirección y ubicación');
		assert.ok(s.includes('id="apDireccionTexto"'));
		assert.ok(s.indexOf('apDireccionTexto') < s.indexOf('apIntroMapaActivo'), 'la dirección, antes del interruptor de la ubicación');
		assert.match(s, /irADatosDelNegocio\('ajNegocioDireccion'\)/);
	});

	test('ya no queda suelta después de las reservas', () => {
		const despues = html.slice(html.indexOf('<summary>Botón «Reservar mesa»</summary>'));
		const hasta = despues.slice(0, despues.indexOf('bienvenida-reset'));
		assert.ok(!hasta.includes('apDireccionTexto'), 'sigue suelta entre las reservas y «Restaurar»');
	});

	test('la dirección está en la pantalla una sola vez', () => {
		assert.equal((html.match(/id="apDireccionTexto"/g) || []).length, 1);
	});

	test('ya no existe una sección llamada solo «Ubicación en el menú»', () => {
		assert.ok(!html.includes('<summary>Ubicación en el menú</summary>'));
	});
});

// ═══════════════════════════════════════════════════════════════
describe('la bienvenida guarda por su cuenta (02/10/2026)', () => {
	// Vivía en Apariencia y se guardaba con «Guardar apariencia», junto a los
	// colores de la carta. Ahora está en Ajustes → Bienvenida con su botón.
	function guardable(apiFetch) {
		const { ctx, $ } = montar({}, { id: 'r1', nombre: 'Bonzas', atributos: {} });
		const llamadas = { fotos: [], render: [], pestanas: 0, avisos: [], marcas: 0, toasts: [] };
		Object.assign(ctx, {
			apiFetch,
			valoresBienvenida: () => ({ intro_activo: true, intro_eslogan: 'Hecho con cariño' }),
			renderBienvenida: (at) => llamadas.render.push(at),
			fijarFotoDePestana: (t) => llamadas.fotos.push(t),
			ajustarPestanasAlModelo: () => { llamadas.pestanas++; },
			avisarGuardadoConCarta: (m) => llamadas.avisos.push(m),
			ajustesMarcarPendientes: () => { llamadas.marcas++; },
			showToast: (m, tipo) => llamadas.toasts.push([m, tipo]),
		});
		return { ctx, $, llamadas };
	}

	test('manda SOLO las claves de la bienvenida, no los colores ni nada más', async () => {
		const peticiones = [];
		const { ctx } = guardable(async (metodo, ruta, cuerpo) => { peticiones.push({ metodo, ruta, cuerpo }); return { id: 'r1', atributos: cuerpo.atributos }; });
		await ctx.saveBienvenida();
		assert.equal(peticiones.length, 1);
		assert.equal(peticiones[0].metodo, 'PATCH');
		assert.equal(peticiones[0].ruta, '/api/restaurantes/r1');
		assert.deepEqual(Object.keys(peticiones[0].cuerpo), ['atributos'], 'sin color_primario ni color_secundario');
		assert.deepEqual(peticiones[0].cuerpo.atributos, { intro_activo: true, intro_eslogan: 'Hecho con cariño' });
	});

	test('al terminar: repinta desde lo guardado, toma SU foto y repinta las pestañas (Reservas)', async () => {
		const { ctx, $, llamadas } = guardable(async (m, r, c) => ({ id: 'r1', atributos: c.atributos }));
		await ctx.saveBienvenida();
		assert.deepEqual(llamadas.fotos, ['bienvenida'], 'solo la suya: guardar esto no da por guardado lo demás de Ajustes');
		assert.equal(llamadas.render.length, 1);
		assert.equal(llamadas.render[0].intro_eslogan, 'Hecho con cariño');
		assert.equal(llamadas.pestanas, 1, 'la pestaña Reservas depende de su interruptor');
		assert.equal(llamadas.marcas, 1, 'el punto de «sin guardar» se apaga');
		assert.deepEqual(llamadas.avisos, ['Bienvenida guardada']);
		assert.equal($('bienvenidaStatus').textContent, '✓ Guardado');
	});

	test('si el servidor lo rechaza, se dice el motivo junto al botón y no se da por guardado', async () => {
		const { ctx, $, llamadas } = guardable(async () => { throw new Error('El color de fondo de bienvenida tiene que ser un color válido'); });
		await ctx.saveBienvenida();
		assert.match($('bienvenidaStatus').textContent, /color de fondo/);
		assert.deepEqual(llamadas.fotos, [], 'sigue pendiente');
		assert.equal(llamadas.toasts.length, 1);
		assert.equal(llamadas.toasts[0][1], 'error');
	});

	test('con la sesión caducada (apiFetch devuelve nada) no repinta ni toma foto', async () => {
		const { ctx, llamadas } = guardable(async () => undefined);
		await ctx.saveBienvenida();
		assert.deepEqual(llamadas.fotos, []);
		assert.deepEqual(llamadas.render, []);
	});

	test('guardar Ajustes refresca los datos de la bienvenida sin repintar su formulario', () => {
		const ajustes = leer('ajustes.js');
		const guardar = ajustes.match(/async function saveAjustes\(\)[\s\S]*?\n\}/)[0];
		assert.match(guardar, /refrescarDatosDeBienvenida\(\)/);
		const bien = leer('bienvenida.js');
		const refresco = bien.match(/function refrescarDatosDeBienvenida\(\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(refresco, /renderBienvenida\(/, 'repintarlo tiraría lo que se esté escribiendo');
		assert.match(refresco, /ajustarInterruptoresBienvenida\(\)/);
	});

	test('Apariencia ya no manda las claves intro_*', () => {
		const aspecto = sinComentarios(leer('aspecto.js'));
		assert.doesNotMatch(aspecto, /valoresBienvenida|intro_activo|intro_eslogan|renderBienvenida/);
	});
});

describe('guardar «Mi negocio» y lo que la bienvenida dice de las redes', () => {
	// Visto al probarlo el 02/10/2026: tras guardar un enlace de Facebook, el
	// interruptor se habilitaba pero el texto de al lado seguía diciendo
	// «agrega el enlace en Ajustes».
	test('el texto de cada red se repinta con lo recién guardado', () => {
		const { ctx, $ } = montar({}, { id: 'r1', nombre: 'Bonzas', atributos: { social_instagram: 'https://instagram.com/x' } });
		Object.assign(ctx, {
			pintarDatosEnBienvenida() {}, ajustarInterruptoresBienvenida() {},
			actualizarVistaPreviaBienvenida() {}, ajustesMarcarPendientes() {},
		});
		ctx.refrescarDatosDeBienvenida();
		assert.equal($('apIntroEstadoInstagram').textContent, 'Instagram · enlace configurado');
		assert.match($('apIntroEstadoFacebook').textContent, /agrega el enlace/);

		ctx.state.restaurante.atributos.social_facebook = 'https://facebook.com/bonzas';
		ctx.refrescarDatosDeBienvenida();
		assert.equal($('apIntroEstadoFacebook').textContent, 'Facebook · enlace configurado');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('el interruptor de la bienvenida dice su estado (BV4)', () => {
	function estadoDe(activa) {
		const { ctx, $ } = montar();
		ctx.pintarEstadoDeBienvenida(activa);
		return { $, e: $('apIntroEstado'), nota: $('apIntroNotaApagada'), fijo: $('apIntroPreviewFijo') };
	}

	test('encendida: lo dice, sin nota y con la vista previa normal', () => {
		const { e, nota, fijo } = estadoDe(true);
		assert.equal(e.textContent, 'Encendida');
		assert.equal(e._clases.has('apagada'), false);
		assert.equal(nota.hidden, true);
		assert.equal(fijo._clases.has('bienvenida-preview-apagada'), false);
	});

	test('apagada: lo dice, explica qué pasa con los clientes y atenúa la vista previa', () => {
		const { e, nota, fijo } = estadoDe(false);
		assert.equal(e.textContent, 'Apagada');
		assert.equal(e._clases.has('apagada'), true);
		assert.equal(nota.hidden, false);
		assert.equal(fijo._clases.has('bienvenida-preview-apagada'), true);
	});

	test('la vista previa lo repinta con cada cambio, y el interruptor la dispara al cambiar', () => {
		const bien = leer('bienvenida.js');
		const vista = bien.match(/function actualizarVistaPreviaBienvenida\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(vista, /pintarEstadoDeBienvenida\(!!datos\.intro_activo\)/);
		const html = leer('index.html');
		assert.match(html.match(/<input[^>]*id="apIntroActivo"[^>]*>/)[0], /onchange="actualizarVistaPreviaBienvenida\(\)"/);
	});

	test('el interruptor tiene nombre accesible, no solo un `title` que en móvil no se ve', () => {
		const html = leer('index.html');
		assert.match(html.match(/<input[^>]*id="apIntroActivo"[^>]*>/)[0], /aria-label="[^"]+"/);
		assert.match(html.match(/<span[^>]*id="apIntroEstado"[^>]*>/)[0], /role="status"/);
	});
});

describe('la vista previa de la bienvenida se queda a la vista (BV5)', () => {
	const html = leer('index.html');
	const css = leer('panel.css');

	test('la vista previa va dentro de un contenedor fijo, y el formulario queda fuera', () => {
		const ini = html.indexOf('id="apIntroPreviewFijo"');
		const fin = html.indexOf('/apIntroPreviewFijo');
		assert.ok(ini !== -1 && fin > ini);
		const dentro = html.slice(ini, fin);
		assert.ok(dentro.includes('id="apIntroPreview"'));
		assert.ok(!dentro.includes('class="bienvenida-details"'), 'el formulario no puede quedar dentro de lo fijo');
	});

	test('se fija solo con altura de sobra, bajo la barra superior y con tope de altura', () => {
		const regla = css.match(/@media\s*\(min-height:\s*640px\)\s*\{\s*\.bienvenida-preview-fijo\{[^}]*\}/)[0];
		assert.match(regla, /position:sticky/);
		assert.match(regla, /top:64px/, 'debajo de la barra superior (52 px), no encima');
		assert.match(regla, /max-height:\d+vh/, 'con tope: la bienvenida con todo encendido mide más que la pantalla');
		assert.match(regla, /overflow-y:auto/);
		assert.match(regla, /z-index:5/, 'por debajo de la barra superior, que es 100');
	});

	test('cada sección del formulario dice qué parte de la vista previa cambia', () => {
		const secciones = [...html.matchAll(/<details class="bienvenida-details"[^>]*?data-previa="([^"]+)"[^>]*><summary>([^<]+)<\/summary>/g)];
		assert.equal(secciones.length, 8, 'las ocho secciones');
		for (const [, destino] of secciones) {
			if (destino !== 'arriba') assert.ok(html.includes(`id="${destino}"`), `${destino} no existe en la vista previa`);
		}
	});

	test('el panel escucha el foco de sus campos', () => {
		assert.match(html.match(/<div id="ajSeccionBienvenida"[^>]*>/)[0], /onfocusin="llevarPreviaAlCampo\(event\)"/);
	});

	// Una caja de juguete con rectángulos a mano: lo que se prueba es la cuenta.
	function caja(altoCaja, elementos) {
		const { ctx, $ } = montar();
		const c = $('apIntroPreviewFijo');
		c.scrollTop = 0;
		c.getBoundingClientRect = () => ({ top: 100, bottom: 100 + altoCaja });
		for (const [id, top, alto, extra] of elementos) {
			const el = $(id);
			el.offsetParent = {};
			Object.assign(el, extra || {});
			// el elemento se mueve con el scroll de la caja, como en el navegador
			el.getBoundingClientRect = () => ({ top: 100 + top - c.scrollTop, bottom: 100 + top + alto - c.scrollTop });
		}
		return { ctx, c, $ };
	}

	test('lleva la vista previa hasta lo que está fuera de la ventana', () => {
		const { ctx, c } = caja(276, [['apIntroPreviewSocial', 400, 40]]);
		ctx.llevarPreviaA('apIntroPreviewSocial');
		assert.ok(c.scrollTop > 0);
		const r = { top: 100 + 400 - c.scrollTop, bottom: 100 + 440 - c.scrollTop };
		assert.ok(r.top >= 100 && r.bottom <= 376, 'queda dentro de la ventana');
	});

	test('si ya se ve, no la mueve', () => {
		const { ctx, c } = caja(276, [['apIntroPreviewNombre', 60, 40]]);
		ctx.llevarPreviaA('apIntroPreviewNombre');
		assert.equal(c.scrollTop, 0);
	});

	test('«arriba» la devuelve al principio (fondo y recuadro)', () => {
		const { ctx, c } = caja(276, []);
		c.scrollTop = 300;
		ctx.llevarPreviaA('arriba');
		assert.equal(c.scrollTop, 0);
	});

	test('un elemento escondido o que no existe no hace nada ni rompe', () => {
		const { ctx, c } = caja(276, [['apIntroPreviewResena', 500, 30, { hidden: true }], ['apIntroPreviewMapa', 500, 30, { offsetParent: null }]]);
		c.scrollTop = 50;
		ctx.llevarPreviaA('apIntroPreviewResena');
		ctx.llevarPreviaA('apIntroPreviewMapa');
		assert.doesNotThrow(() => ctx.llevarPreviaA('noExiste'));
		assert.equal(c.scrollTop, 50);
	});

	test('no usa scrollIntoView: arrastraría la página y el formulario saltaría', () => {
		const src = leer('bienvenida.js');
		const fn = src.match(/function llevarPreviaA\(destino\) \{[\s\S]*?\n\}/)[0];
		assert.doesNotMatch(fn, /scrollIntoView/);
	});

	test('llevarPreviaAlCampo toma el destino de la sección que contiene al campo', () => {
		const { ctx, c } = caja(276, [['apIntroPreviewSocial', 400, 40]]);
		const campo = { closest: sel => (sel === '[data-previa]' ? { dataset: { previa: 'apIntroPreviewSocial' } } : null) };
		ctx.llevarPreviaAlCampo({ target: campo });
		assert.ok(c.scrollTop > 0);
		assert.doesNotThrow(() => ctx.llevarPreviaAlCampo({ target: { closest: () => null } }));
		assert.doesNotThrow(() => ctx.llevarPreviaAlCampo({}));
	});
});

// ═══════════════════════════════════════════════════════════════
describe('avisos de legibilidad de la bienvenida (BV7)', () => {
	// Es la pantalla que ve todo el que escanea el QR, y el formulario deja poner
	// el texto casi del color del recuadro sin decir nada. Solo avisa, no impide.
	function conPaletas() {
		const { ctx, $ } = montar();
		vm.runInContext(leer('paletas.js'), ctx);   // contrasteColores: la misma cuenta que la paleta de la carta
		return { ctx, $ };
	}

	// Lo que valoresBienvenida devolvería con los valores de fábrica del formulario.
	const FABRICA = () => ({
		intro_tarjeta_fondo: '#17120b',
		intro_social_icono_color: '#ffffff', intro_social_fondo: '#ef7a00',
		intro_mapa_boton_fondo: '#17120b', intro_mapa_boton_color: '#ffffff',
		intro_textos: {
			nombre: { color: '#ffffff', tamano: 30, peso: 0 }, eslogan: { color: '#ffffff', tamano: 16, peso: 0 },
			adicional: { color: '#ffffff', tamano: 16, peso: 0 }, direccion: { color: '#ffffff', tamano: 16, peso: 0 },
			cta: { color: '#ffffff', color_texto: '#15100b', tamano: 15, peso: 0 },
		},
	});
	// Lo que sale de un vm trae otros prototipos: deepStrictEqual los vería distintos.
	const plano = (x) => JSON.parse(JSON.stringify(x));
	const TODO = { nombre: true, eslogan: true, adicional: true, direccion: true, redes: true, botonMapa: true };

	test('los valores de fábrica no avisan de nada', () => {
		const { ctx } = conPaletas();
		const avisos = ctx.avisosDeLegibilidadBienvenida(FABRICA(), TODO);
		assert.deepEqual(plano(avisos.map(a => a.texto)), []);
	});

	test('texto casi del color del recuadro: avisa, dice cuál y por qué', () => {
		const { ctx } = conPaletas();
		const d = FABRICA();
		d.intro_textos.eslogan.color = '#1c160e';
		const [a] = ctx.avisosDeLegibilidadBienvenida(d, TODO);
		assert.equal(a.cual, 'eslogan');
		assert.match(a.texto, /^La frase de bienvenida se lee mal sobre el fondo del recuadro/);
		assert.match(a.texto, /contraste 1,\d y lo recomendado es 4,5/);
		assert.deepEqual(plano(a.secciones), ['textos', 'recuadro']);
	});

	test('el umbral es de texto grande para el nombre (3) y de texto normal para lo pequeño (4,5)', () => {
		const { ctx } = conPaletas();
		// Un gris medio sobre el recuadro oscuro: contraste entre 3 y 4,5.
		const gris = '#7a7468';
		const medida = ctx.contrasteColores(gris, '#17120b');
		assert.ok(medida > 3 && medida < 4.5, `el gris de la prueba mide ${medida}`);
		const nombreGrande = FABRICA(); nombreGrande.intro_textos.nombre.color = gris;
		assert.equal(ctx.avisosDeLegibilidadBienvenida(nombreGrande, TODO).length, 0, '30 px cuenta como texto grande');
		const pequeno = FABRICA(); pequeno.intro_textos.eslogan.color = gris;
		assert.equal(ctx.avisosDeLegibilidadBienvenida(pequeno, TODO).length, 1, '16 px pide 4,5');
	});

	test('un texto de 24 px, o de 19 px en negrita, también cuenta como grande; de 19 px normal, no', () => {
		const { ctx } = conPaletas();
		assert.equal(ctx.esTextoGrandeBienvenida(24, 400), true);
		assert.equal(ctx.esTextoGrandeBienvenida(19, 700), true);
		assert.equal(ctx.esTextoGrandeBienvenida(19, 400), false);
		assert.equal(ctx.esTextoGrandeBienvenida(18, 800), false);
	});

	test('el texto del botón principal, contra el color de su botón', () => {
		const { ctx } = conPaletas();
		const d = FABRICA();
		d.intro_textos.cta = { color: '#ffffff', color_texto: '#f4f4f4' };   // blanco sobre blanco
		const avisos = ctx.avisosDeLegibilidadBienvenida(d, TODO);
		assert.equal(avisos.length, 1);
		assert.equal(avisos[0].cual, 'cta');
		assert.match(avisos[0].texto, /el color del botón/);
		assert.deepEqual(plano(avisos[0].secciones), ['textos']);
	});

	test('iconos de redes: mínimo de 2,5 —el de fábrica mide 2,8—, y solo si hay redes que se vayan a ver', () => {
		const { ctx } = conPaletas();
		const { ctx: c0 } = conPaletas();
		// El de fábrica (blanco sobre #ef7a00) mide 2,8: el panel no puede avisar de lo que él mismo ofrece.
		assert.ok(c0.contrasteColores('#ffffff', '#ef7a00') > 2.5 && c0.contrasteColores('#ffffff', '#ef7a00') < 3);
		const d = FABRICA(); d.intro_social_icono_color = '#ef7b02';   // casi el color del fondo
		assert.equal(ctx.avisosDeLegibilidadBienvenida(d, TODO).filter(a => a.cual === 'redes').length, 1);
		assert.equal(ctx.avisosDeLegibilidadBienvenida(d, { ...TODO, redes: false }).length, 0, 'sin redes visibles no hay nada que avisar');
		const [a] = ctx.avisosDeLegibilidadBienvenida(d, TODO);
		assert.deepEqual(plano(a.secciones), ['redes']);
	});

	test('botón de ubicación: solo si el botón sale', () => {
		const { ctx } = conPaletas();
		const d = FABRICA(); d.intro_mapa_boton_color = '#17120c';
		assert.equal(ctx.avisosDeLegibilidadBienvenida(d, TODO).filter(a => a.cual === 'mapa').length, 1);
		assert.equal(ctx.avisosDeLegibilidadBienvenida(d, { ...TODO, botonMapa: false }).length, 0);
	});

	test('un texto que no sale en la carta no avisa, aunque tenga un color malo', () => {
		const { ctx } = conPaletas();
		const d = FABRICA();
		for (const t of ['eslogan', 'adicional', 'direccion']) d.intro_textos[t].color = '#17120b';
		const avisos = ctx.avisosDeLegibilidadBienvenida(d, { nombre: true });
		assert.deepEqual(plano(avisos), []);
	});

	test('sin color puesto usa los de fábrica y un color roto no rompe nada', () => {
		const { ctx } = conPaletas();
		const d = FABRICA();
		d.intro_textos.nombre = {}; d.intro_textos.eslogan = { color: 'no-es-un-color' }; d.intro_tarjeta_fondo = '';
		assert.doesNotThrow(() => ctx.avisosDeLegibilidadBienvenida(d, TODO));
		assert.deepEqual(plano(ctx.avisosDeLegibilidadBienvenida({ intro_tarjeta_fondo: '#17120b' }, { nombre: true })), []);
	});

	test('el contraste se muestra con una coma y sin redondear hacia arriba', () => {
		const { ctx } = conPaletas();
		assert.equal(ctx.formatoContrasteBienvenida(4.49), '4,4');
		assert.equal(ctx.formatoContrasteBienvenida(4.5), '4,5');
		assert.equal(ctx.formatoContrasteBienvenida(1), '1,0');
	});

	test('usa la misma cuenta que la paleta de la carta (contrasteColores), no una copia', () => {
		const src = leer('bienvenida.js');
		assert.match(src, /typeof contraste === 'function' \? contraste : contrasteColores/);
		assert.doesNotMatch(src, /function luminancia|0\.2126/, 'no repite la fórmula');
	});

	test('no impide guardar: saveBienvenida no consulta los avisos para decidir', () => {
		const src = leer('bienvenida.js');
		const guardar = src.match(/async function saveBienvenida\(\) \{[\s\S]*?\r?\n\}/)[0];
		const antes = guardar.slice(0, guardar.indexOf('apiFetch'));
		assert.doesNotMatch(antes, /aviso|legibilidad/i);
	});

	test('al guardar dice cuántos avisos quedan, en singular y en plural', async () => {
		const casos = [[0, '✓ Guardado'], [1, '✓ Guardado · ojo: 1 aviso de legibilidad, arriba'], [3, '✓ Guardado · ojo: 3 avisos de legibilidad, arriba']];
		for (const [n, esperado] of casos) {
			const { ctx, $ } = montar({}, { id: 'r1', nombre: 'Bonzas', atributos: {} });
			$('apIntroAvisos').querySelectorAll = () => new Array(n).fill({});
			Object.assign(ctx, {
				apiFetch: async (m, r, c) => ({ id: 'r1', atributos: c.atributos }),
				valoresBienvenida: () => ({}), renderBienvenida() {}, fijarFotoDePestana() {},
				ajustesMarcarPendientes() {}, ajustarPestanasAlModelo() {}, avisarGuardadoConCarta() {}, showToast() {},
			});
			await ctx.saveBienvenida();
			assert.equal($('bienvenidaStatus').textContent, esperado);
		}
	});

	test('el cuadro existe y cuatro secciones pueden llevar la marca ⚠', () => {
		const html = leer('index.html');
		assert.match(html, /<div class="bienvenida-avisos" id="apIntroAvisos" role="status" hidden><\/div>/);
		const marcadas = [...html.matchAll(/data-aviso="([^"]+)"/g)].map(m => m[1]).sort();
		assert.deepEqual(marcadas, ['recuadro', 'redes', 'textos', 'ubicacion']);
		assert.match(leer('panel.css'), /\.bienvenida-details\.con-aviso>summary::before\{content:'⚠'/);
	});

	test('la vista previa repinta los avisos con cada cambio', () => {
		const src = leer('bienvenida.js');
		const vista = src.match(/function actualizarVistaPreviaBienvenida\(\) \{[\s\S]*?\r?\n\}/)[0];
		assert.match(vista, /pintarAvisosDeLegibilidad\(avisosDeLegibilidadBienvenida\(/);
	});

	test('pintar: llena la lista con textContent y marca las secciones afectadas', () => {
		const { ctx, $ } = conPaletas();
		const creados = [];
		const nodo = (tag) => { const n = { tag, children: [], textContent: '', hidden: false, append(...h) { this.children.push(...h); }, appendChild(h) { this.children.push(h); } }; creados.push(n); return n; };
		const caja = $('apIntroAvisos');
		caja.children = []; caja.replaceChildren = function () { this.children = []; }; caja.append = (...h) => caja.children.push(...h);
		const detalle = (clave) => { const d = campo(); d.dataset = { aviso: clave }; return d; };
		const secciones = ['recuadro', 'textos', 'redes', 'ubicacion'].map(detalle);
		ctx.document.createElement = nodo;
		ctx.document.querySelectorAll = () => secciones;
		ctx.pintarAvisosDeLegibilidad([{ texto: 'El nombre se lee mal', secciones: ['textos', 'recuadro'] }]);
		assert.equal(caja.hidden, false);
		assert.equal(secciones.filter(s => s._clases.has('con-aviso')).map(s => s.dataset.aviso).sort().join(), 'recuadro,textos');
		const li = creados.find(n => n.tag === 'li');
		assert.equal(li.textContent, 'El nombre se lee mal');
		ctx.pintarAvisosDeLegibilidad([]);
		assert.equal(caja.hidden, true);
		assert.equal(secciones.some(s => s._clases.has('con-aviso')), false, 'sin avisos no queda ninguna marca');
	});
});

// ═══════════════════════════════════════════════════════════════
describe('pulido de la bienvenida (BV6 y BV8)', () => {
	const html = leer('index.html');

	// ── BV6 ──
	test('BV6: el estilo de la dirección se llama por lo que manda: dirección, horario y correo', () => {
		const src = leer('bienvenida.js');
		assert.match(src, /\['direccion', 'Dirección, horario y correo'\]/);
		assert.doesNotMatch(src, /Dirección opcional/);
		// Y la sección «Horario y correo» dice dónde se cambia su estilo.
		const seccion = html.match(/<summary>Horario y correo<\/summary>[\s\S]*?<\/p>/)[0];
		assert.match(seccion, /mismo estilo que la dirección/);
		assert.match(seccion, /Textos y tipografía/);
		assert.match(seccion, /Dirección, horario y correo/);
	});

	test('BV6: lo que dice la ayuda es lo que hace el código (horario y correo usan el estilo de la dirección)', () => {
		const src = leer('bienvenida.js');
		assert.match(src, /const estilo = tipo === 'horario' \|\| tipo === 'correo' \? 'direccion' : tipo;/);
	});

	// ── BV8: nombre de la sección ──
	test('BV8: la sección de fondo no se parece a «Imagen de fondo» / «Color de fondo» de la carta', () => {
		assert.ok(!html.includes('<summary>Fondo e imagen</summary>'));
		assert.match(html, /<details class="bienvenida-details" open data-previa="arriba"[^>]*><summary>Fondo de la bienvenida<\/summary>/);
	});

	// ── BV8: restaurar pregunta ──
	function conRestaurar(respuesta) {
		const { ctx, $ } = montar();
		const llamadas = { preguntas: [], renders: [], marcas: 0, toasts: [] };
		$('apIntroActivo').checked = true;
		Object.assign(ctx, {
			preguntar: async (p) => { llamadas.preguntas.push(p); return respuesta; },
			renderBienvenida: (d) => llamadas.renders.push(d),
			ajustesMarcarPendientes: () => { llamadas.marcas++; },
			showToast: (m, t) => llamadas.toasts.push([m, t]),
		});
		return { ctx, llamadas };
	}

	test('BV8: «Restaurar» pregunta antes, con «Cancelar» como salida y en rojo', async () => {
		const { ctx, llamadas } = conRestaurar(false);
		await ctx.restaurarBienvenida();
		assert.equal(llamadas.preguntas.length, 1);
		const p = llamadas.preguntas[0];
		assert.equal(p.peligro, true);
		assert.equal(p.si, 'Restaurar');
		assert.match(p.texto, /imagen de fondo/);
		assert.match(p.texto, /«Mi negocio» no se toca/);
		assert.match(p.nota, /Guardar bienvenida/);
	});

	test('BV8: si dice que no, no se toca nada', async () => {
		const { ctx, llamadas } = conRestaurar(false);
		await ctx.restaurarBienvenida();
		assert.deepEqual(llamadas.renders, []);
		assert.equal(llamadas.marcas, 0);
		assert.deepEqual(llamadas.toasts, []);
	});

	test('BV8: si dice que sí, restaura conservando el interruptor, y marca pendiente', async () => {
		const { ctx, llamadas } = conRestaurar(true);
		await ctx.restaurarBienvenida();
		assert.equal(llamadas.renders.length, 1);
		assert.equal(llamadas.renders[0].intro_activo, true, 'el interruptor se queda como estaba');
		assert.equal(llamadas.renders[0].intro_fondo_color, '#111827');
		assert.equal(llamadas.marcas, 1, 'repintar por código no dispara los eventos que marcan pendiente');
		assert.equal(llamadas.toasts.length, 1);
	});

	test('BV8: el botón sigue llamando a la función, que ahora es asíncrona', () => {
		assert.match(html, /onclick="restaurarBienvenida\(\)"/);
		assert.match(leer('bienvenida.js'), /async function restaurarBienvenida\(\)/);
	});

	// ── BV8: hexadecimal en todos los colores ──
	test('BV8: el código acepta «#» o no, y solo cuando está completo', () => {
		const { ctx } = montar();
		assert.equal(ctx.normalizarHexBienvenida('#C0392B'), '#c0392b');
		assert.equal(ctx.normalizarHexBienvenida('c0392b'), '#c0392b', 'se copia de una web sin «#»');
		assert.equal(ctx.normalizarHexBienvenida('  #fff000 '), '#fff000');
		for (const mal of ['', '#c03', '#c0392', '#c0392bb', 'rojo', '#gggggg', null, undefined])
			assert.equal(ctx.normalizarHexBienvenida(mal), '', String(mal));
	});

	// Un DOM de juguete con lo justo: elementos que se pueden crear, mover y escuchar.
	function dom(colores) {
		const nodos = [];
		const el = (tag) => {
			const n = { tag, value: '', children: [], escuchas: {}, atributos: {}, eventos: [] };
			n.addEventListener = (tipo, f) => { (n.escuchas[tipo] ||= []).push(f); };
			n.dispatchEvent = (e) => { n.eventos.push(e.type); (n.escuchas[e.type] || []).forEach(f => f(e)); return true; };
			n.setAttribute = (k, v) => { n.atributos[k] = v; };
			n.append = (...h) => { n.children.push(...h); h.forEach(x => { x.padre = n; }); };
			n.replaceWith = (otro) => { n.reemplazadoPor = otro; };
			nodos.push(n);
			return n;
		};
		const entradas = colores.map(c => { const n = el('input'); n.type = 'color'; n.value = c.value; if (c.id) n.id = c.id; return n; });
		const extra = {};
		const raiz = { querySelectorAll: (sel) => (sel === 'input[type="color"]' ? entradas : []) };
		const document = {
			getElementById: (id) => (id === 'ajSeccionBienvenida' ? raiz : (extra[id] || null)),
			createElement: el,
		};
		return { document, entradas, extra, el };
	}

	function conDom(colores, hexExistentes = {}) {
		const d = dom(colores);
		for (const [id, valor] of Object.entries(hexExistentes)) { const h = d.el('input'); h.value = valor; d.extra[id] = h; }
		const { ctx } = montar();
		Object.assign(ctx, { document: { ...d.document, getElementById: (id) => d.document.getElementById(id) ?? null } });
		ctx.Event = class { constructor(tipo, o) { this.type = tipo; this.bubbles = !!(o && o.bubbles); } };
		return { ctx, ...d };
	}

	test('BV8: cada selector sin código recibe su campo, y los dos que ya lo traían no se duplican', () => {
		const { ctx, entradas } = conDom(
			[{ id: 'apIntroFondoColor', value: '#111827' }, { id: 'apIntroTarjetaFondo', value: '#17120b' }, { value: '#ffffff' }],
			{ apIntroFondoColorHex: '#111827' });
		ctx.decorarCamposHexBienvenida();
		const [conId, sinCampo, sinId] = entradas;
		assert.ok(conId._hex && !conId.reemplazadoPor, 'el que ya traía su campo no se vuelve a envolver');
		assert.ok(sinCampo.reemplazadoPor, 'el recuadro se envuelve en la caja del color');
		assert.equal(sinCampo.reemplazadoPor.className, 'bienvenida-color-field');
		assert.equal(sinCampo._hex.value, '#17120B');
		assert.equal(sinCampo._hex.maxLength, 7);
		assert.match(sinCampo._hex.atributos['aria-label'], /hexadecimal/i);
		assert.ok(sinId._hex, 'también los de los textos, que no tienen id');
		assert.equal(sinId._hex.value, '#FFFFFF');
	});

	test('BV8: es idempotente: pintar otra vez no añade otro campo', () => {
		const { ctx, entradas } = conDom([{ id: 'apIntroTarjetaBorde', value: '#ffffff' }]);
		ctx.decorarCamposHexBienvenida();
		const primero = entradas[0]._hex;
		ctx.decorarCamposHexBienvenida();
		assert.equal(entradas[0]._hex, primero);
		assert.equal(entradas[0].reemplazadoPor.children.length, 2, 'selector y código, y nada más');
	});

	test('BV8: al escribir un código completo, mueve el selector y avisa como si se hubiera elegido', () => {
		const { ctx, entradas } = conDom([{ id: 'apIntroSocialFondo', value: '#ef7a00' }]);
		ctx.decorarCamposHexBienvenida();
		const [color] = entradas, hex = color._hex;
		hex.value = 'c0392b';
		hex.escuchas.input.forEach(f => f());
		assert.equal(color.value, '#c0392b');
		assert.deepEqual(color.eventos, ['input'], 'repinta la vista previa y marca pendiente');
	});

	test('BV8: a medio escribir no mueve nada', () => {
		const { ctx, entradas } = conDom([{ id: 'apIntroSocialFondo', value: '#ef7a00' }]);
		ctx.decorarCamposHexBienvenida();
		const [color] = entradas, hex = color._hex;
		for (const parcial of ['#c', '#c03', '#c0392']) { hex.value = parcial; hex.escuchas.input.forEach(f => f()); }
		assert.equal(color.value, '#ef7a00');
		assert.deepEqual(color.eventos, []);
	});

	test('BV8: elegir con el selector actualiza el código, y al salir del campo se normaliza', () => {
		const { ctx, entradas } = conDom([{ id: 'apIntroSocialBorde', value: '#ffffff' }]);
		ctx.decorarCamposHexBienvenida();
		const [color] = entradas, hex = color._hex;
		color.value = '#123abc'; color.escuchas.input.forEach(f => f());
		assert.equal(hex.value, '#123ABC');
		hex.value = 'c0392'; hex.escuchas.blur.forEach(f => f());
		assert.equal(hex.value, '#123ABC', 'un código roto vuelve al del selector');
	});

	test('BV8: se aplica al terminar de pintar, cuando los valores ya están puestos', () => {
		const src = leer('bienvenida.js');
		const i = src.indexOf('decorarCamposHexBienvenida(); pintarEstadoDeRedesEnBienvenida();');
		assert.notEqual(i, -1);
		assert.ok(i > src.indexOf("poner('apIntroTarjetaFondo'"), 'después de poner los valores, o el código saldría vacío');
	});

	// ── BV8: lo que ya estaba resuelto ──
	test('BV8: los enlaces «Cambiarlo en Datos del negocio» ya no sacan de la bienvenida', () => {
		// Desde que la bienvenida vive en Ajustes (#340) el enlace cambia de SECCIÓN
		// dentro de la misma pestaña: nada se pierde, y con cambios pendientes
		// switchTab ni siquiera repinta. Se vigila que siga así.
		const neg = leer('negocio.js');
		const cuerpo = neg.match(/function irADatosDelNegocio\(idCampo\) \{[\s\S]*?\r?\n\}/)[0];
		assert.match(cuerpo, /switchTab\('ajustes'/);
		assert.match(cuerpo, /ajustesMostrarSeccionDe\(campo\)/);
		const indice = leer('index.html');
		const cambiar = indice.match(/function switchTab\(tab, btn\) \{[\s\S]*?\r?\n\}/)[0];
		assert.match(cambiar, /if \(tab !== pestanaActual\) \{ pestanaPedida/, 'misma pestaña con cambios: no pregunta ni repinta');
	});
});
