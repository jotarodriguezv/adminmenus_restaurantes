// Ajustes se divide en secciones (Mi negocio, Pedidos, Carta) que se ven de una
// en una. Es solo presentación: lo que estas pruebas vigilan es que cada tarjeta
// cayó en la sección que toca, que ninguna se quedó fuera de todas —un campo
// fuera de un panel no se ve nunca o se ve siempre— y que los enlaces que llevan
// a un campo abren antes su sección.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const leer = archivo => fs.readFileSync(path.join(PUBLIC, archivo), 'utf8');

// El tramo de index.html que es la pestaña Ajustes, hasta la siguiente.
function pestanaAjustes() {
	const html = leer('index.html');
	const ini = html.indexOf('<div id="tabAjustes"');
	const fin = html.indexOf('<div id="tabAspecto"', ini);
	assert.ok(ini !== -1 && fin !== -1, 'no se encontró la pestaña Ajustes');
	return html.slice(ini, fin);
}

// Qué ids caen dentro de cada panel: del comienzo de su <div> al del siguiente.
function panelesDeAjustes() {
	const t = pestanaAjustes();
	const marcas = ['ajSeccionNegocio', 'ajSeccionPedidos', 'ajSeccionCarta']
		.map(id => ({ id, pos: t.indexOf(`id="${id}"`) }));
	marcas.forEach(m => assert.notEqual(m.pos, -1, `falta el panel ${m.id}`));
	const botonGuardar = t.indexOf('onclick="saveAjustes()"');
	assert.notEqual(botonGuardar, -1);
	const cuerpo = {};
	marcas.forEach((m, i) => {
		const hasta = i + 1 < marcas.length ? marcas[i + 1].pos : botonGuardar;
		cuerpo[m.id] = t.slice(m.pos, hasta);
	});
	return { cuerpo, t, marcas, botonGuardar };
}

describe('Ajustes · qué tarjeta va en qué sección', () => {
	const { cuerpo } = panelesDeAjustes();

	test('Mi negocio: datos, horario y redes', () => {
		const p = cuerpo.ajSeccionNegocio;
		for (const id of ['ajNegocioCard', 'ajNegocioWhatsapp', 'ajNegocioDireccion', 'ajHorarioBloque', 'ajRedesBloque', 'ajSocialInstagram'])
			assert.ok(p.includes(`id="${id}"`), `${id} debería estar en Mi negocio`);
	});

	test('Pedidos: carrito, pedidos y toppings', () => {
		const p = cuerpo.ajSeccionPedidos;
		for (const id of ['ajCarritoCard', 'ajCarrito', 'ajPedidosCuerpo', 'ajToppingsCuerpo', 'listToppingsSalsas'])
			assert.ok(p.includes(`id="${id}"`), `${id} debería estar en Pedidos`);
	});

	test('Carta: buscador y filtros', () => {
		const p = cuerpo.ajSeccionCarta;
		for (const id of ['ajBuscadorCard', 'ajBuscador', 'ajFiltrosCard', 'ajFiltros', 'ajFiltrosCatalogo'])
			assert.ok(p.includes(`id="${id}"`), `${id} debería estar en Carta`);
	});

	test('ningún campo de un panel aparece también en otro', () => {
		const ids = p => new Set([...p.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
		const [a, b, c] = Object.values(cuerpo).map(ids);
		for (const id of a) assert.ok(!b.has(id) && !c.has(id), `${id} repetido entre secciones`);
		for (const id of b) assert.ok(!c.has(id), `${id} repetido entre secciones`);
	});

	test('el botón de guardar y su estado están FUERA de los paneles: valen para todos', () => {
		const { t, botonGuardar, marcas } = panelesDeAjustes();
		assert.ok(botonGuardar > marcas[marcas.length - 1].pos);
		assert.ok(!cuerpo.ajSeccionCarta.includes('saveAjustes()'));
		assert.ok(t.includes('id="ajustesStatus"'));
		assert.ok(!cuerpo.ajSeccionCarta.includes('id="ajustesStatus"'));
	});

	test('solo el primer panel nace a la vista, y las tres fichas existen con su rol', () => {
		const t = pestanaAjustes();
		assert.doesNotMatch(t.match(/<div id="ajSeccionNegocio"[^>]*>/)[0], /hidden/);
		assert.match(t.match(/<div id="ajSeccionPedidos"[^>]*>/)[0], /class="hidden"/);
		assert.match(t.match(/<div id="ajSeccionCarta"[^>]*>/)[0], /class="hidden"/);
		for (const n of ['Negocio', 'Pedidos', 'Carta']) {
			const tab = t.match(new RegExp(`<button[^>]*id="ajTab${n}"[^>]*>`))[0];
			assert.match(tab, /role="tab"/);
			assert.match(tab, new RegExp(`aria-controls="ajSeccion${n}"`));
		}
	});

	test('las fichas miden al menos 44 px de alto: se tocan con el pulgar', () => {
		const css = leer('panel.css');
		assert.match(css.match(/\.aj-seccion-tab\{[^}]*\}/)[0], /min-height:44px/);
	});
});

describe('Ajustes · cambiar de sección', () => {
	function montar(estado = { restaurante: { id: 'r1' } }) {
		const nodos = {};
		const nodo = () => {
			const clases = new Set();
			return {
				clases, tabIndex: 0, atributos: {},
				classList: { toggle: (c, on) => (on ? clases.add(c) : clases.delete(c)), contains: c => clases.has(c) },
				setAttribute(k, v) { this.atributos[k] = v; },
				scrollIntoView() {},
			};
		};
		const ctx = vm.createContext({ state: estado, document: { getElementById: id => (nodos[id] ||= nodo()) }, String });
		const src = leer('ajustes.js');
		const i = src.indexOf('const SECCIONES_AJUSTES');
		const f = src.indexOf('function renderAjustes', i);
		assert.ok(i !== -1 && f !== -1);
		vm.runInContext(src.slice(i, f), ctx);
		return { ctx, nodos, nodo };
	}

	test('enseña el panel pedido y esconde los demás, y marca la ficha', () => {
		const { ctx, nodos } = montar();
		ctx.ajustesCambiarSeccion('pedidos');
		assert.equal(nodos.ajSeccionPedidos.clases.has('hidden'), false);
		assert.equal(nodos.ajSeccionNegocio.clases.has('hidden'), true);
		assert.equal(nodos.ajSeccionCarta.clases.has('hidden'), true);
		assert.equal(nodos.ajTabPedidos.atributos['aria-selected'], 'true');
		assert.equal(nodos.ajTabNegocio.atributos['aria-selected'], 'false');
		assert.equal(nodos.ajTabPedidos.tabIndex, 0);
		assert.equal(nodos.ajTabCarta.tabIndex, -1);
	});

	test('un nombre que no existe no cambia nada', () => {
		const { ctx, nodos } = montar();
		ctx.ajustesCambiarSeccion('pedidos');
		ctx.ajustesCambiarSeccion('inventada');
		assert.equal(nodos.ajSeccionPedidos.clases.has('hidden'), false);
	});

	test('un campo en una sección escondida abre la suya antes', () => {
		const { ctx, nodos } = montar();
		const campo = { closest: sel => (sel === '[data-aj-seccion]' ? { dataset: { ajSeccion: 'carta' } } : null) };
		ctx.ajustesMostrarSeccionDe(campo);
		assert.equal(nodos.ajSeccionCarta.clases.has('hidden'), false);
		assert.equal(nodos.ajSeccionNegocio.clases.has('hidden'), true);
	});

	test('un campo suelto, sin sección, no rompe', () => {
		const { ctx } = montar();
		assert.doesNotThrow(() => ctx.ajustesMostrarSeccionDe({ closest: () => null }));
		assert.doesNotThrow(() => ctx.ajustesMostrarSeccionDe(null));
	});

	test('dentro del mismo restaurante se respeta la sección que se dejó', () => {
		const { ctx, nodos } = montar();
		ctx.ajustesRecordarSeccion();
		ctx.ajustesCambiarSeccion('carta');
		ctx.ajustesRecordarSeccion();
		assert.equal(nodos.ajSeccionCarta.clases.has('hidden'), false);
	});

	test('al cambiar de restaurante se vuelve a la primera (como TV4)', () => {
		const estado = { restaurante: { id: 'r1' } };
		const { ctx, nodos } = montar(estado);
		ctx.ajustesRecordarSeccion();
		ctx.ajustesCambiarSeccion('carta');
		estado.restaurante = { id: 'r2' };
		ctx.ajustesRecordarSeccion();
		assert.equal(nodos.ajSeccionNegocio.clases.has('hidden'), false);
		assert.equal(nodos.ajSeccionCarta.clases.has('hidden'), true);
	});
});

describe('Ajustes · los enlaces a un campo abren su sección', () => {
	test('«Cambiarlo en Datos del negocio» (irADatosDelNegocio) y el del WhatsApp', () => {
		const neg = leer('negocio.js');
		const datos = neg.match(/function irADatosDelNegocio\(idCampo\) \{[\s\S]*?\n\}/)[0];
		assert.match(datos, /ajustesMostrarSeccionDe\(campo\)/);
		assert.ok(datos.indexOf('ajustesMostrarSeccionDe') < datos.indexOf('scrollIntoView'), 'hay que abrir la sección ANTES de traerlo a la vista');
		const whatsapp = neg.match(/function irAlWhatsappDelNegocio\(\) \{[\s\S]*?\n\}/)[0];
		assert.match(whatsapp, /ajustesMostrarSeccionDe\(campo\)/);
		assert.ok(whatsapp.indexOf('ajustesMostrarSeccionDe') < whatsapp.indexOf('scrollIntoView'));
	});

	test('abrir la pestaña Ajustes recuerda la sección antes de pintarla', () => {
		const html = leer('index.html');
		assert.match(html, /if \(tab === 'ajustes'\) \{ ajustesRecordarSeccion\(\); renderAjustes\(\); \}/);
	});
});
