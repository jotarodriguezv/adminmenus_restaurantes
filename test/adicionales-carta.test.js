// «Adicionales de tu carta» (Ajustes → Pedidos): ofrecer en el modal del pedido los platos de una categoría de
// adicionales de la propia carta. El servidor valida (categorías de ESTE restaurante) y la ficha las edita.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./helpers/servidor.js');

const { IDS, tokenCliente } = S;
beforeEach(() => S.reiniciar());

const FUENTE = '11111111-1111-4111-8111-111111111111';
const BURGERS = '22222222-2222-4222-8222-222222222222';
const PERROS = '33333333-3333-4333-8333-333333333333';
const AJENA = '44444444-4444-4444-8444-444444444444';

// El restaurante tiene las tres primeras categorías; la cuarta es de otro.
function guardar(adicionales_carta) {
	S.conTabla(st => {
		if (st.tabla === 'categorias' && st.op === 'select') {
			const pedidas = st.en?.id ?? [];
			const propias = [FUENTE, BURGERS, PERROS];
			const lista = (Array.isArray(pedidas) ? pedidas : [pedidas]).filter(id => propias.includes(id)).map(id => ({ id }));
			return { data: lista, error: null };
		}
		return { data: { id: IDS.restaurante, atributos: { nav: 'sidebar' } }, error: null };
	});
	return S.pedir('PATCH', `/api/restaurantes/${IDS.restaurante}`, { atributos: { adicionales_carta } }, tokenCliente);
}

describe('PATCH /api/restaurantes · adicionales_carta', () => {
	test('encendido, con la fuente y dos categorías de platos, se guarda normalizado', async () => {
		const r = await guardar({ activo: true, categoria_id: FUENTE, categorias: [BURGERS, PERROS, BURGERS, FUENTE], extra: 'x' });
		assert.equal(r.status, 200, JSON.stringify(r.body));
		const g = S.ultimaEscritura('restaurantes').atributos.adicionales_carta;
		assert.deepEqual(g, { activo: true, categoria_id: FUENTE, categorias: [BURGERS, PERROS] });
	});

	test('encendido sin fuente o sin categorías se rechaza', async () => {
		let r = await guardar({ activo: true, categoria_id: '', categorias: [BURGERS] });
		assert.equal(r.status, 400);
		r = await guardar({ activo: true, categoria_id: FUENTE, categorias: [] });
		assert.equal(r.status, 400);
		assert.match(r.body.error, /al menos una/);
	});

	test('apagado se conserva lo elegido, aunque esté incompleto', async () => {
		const r = await guardar({ activo: false, categoria_id: FUENTE, categorias: [] });
		assert.equal(r.status, 200);
		assert.deepEqual(S.ultimaEscritura('restaurantes').atributos.adicionales_carta, { activo: false, categoria_id: FUENTE, categorias: [] });
	});

	test('solo el true explícito lo enciende', async () => {
		for (const activo of ['true', 1, 'false', null]) {
			const r = await guardar({ activo, categoria_id: FUENTE, categorias: [BURGERS] });
			assert.equal(r.status, 200, String(activo));
			assert.equal(S.ultimaEscritura('restaurantes').atributos.adicionales_carta.activo, false, String(activo));
		}
	});

	test('una categoría de otro restaurante o un id que no es uuid se rechaza', async () => {
		let r = await guardar({ activo: true, categoria_id: FUENTE, categorias: [AJENA] });
		assert.equal(r.status, 400);
		assert.match(r.body.error, /no es de este restaurante/);
		r = await guardar({ activo: true, categoria_id: 'no-es-uuid', categorias: [BURGERS] });
		assert.equal(r.status, 400);
		r = await guardar('texto');
		assert.equal(r.status, 400);
		r = await guardar([FUENTE]);
		assert.equal(r.status, 400);
	});
});

// ═══════════════════════════════════════════════════════════════
describe('public/adicionales-carta.js · lo que viaja', () => {
	const fuente = fs.readFileSync(path.join(__dirname, '..', 'public', 'adicionales-carta.js'), 'utf8');
	function montar(categorias, atributos = {}) {
		const els = {
			ajAdicActivo: { checked: false },
			ajAdicCategoria: { value: '', options: [], replaceChildren() { this.options = []; }, appendChild(o) { this.options.push(o); } },
			ajAdicCampos: { hidden: true },
			ajAdicOfrecer: { hidden: true },
			ajAdicCategorias: { replaceChildren() {}, appendChild() {} },
			ajAdicAviso: { textContent: '' },
		};
		const ctx = vm.createContext({
			state: { categorias, restaurante: { atributos } },
			document: { getElementById: id => els[id], createElement: () => ({ append() {}, appendChild() {}, style: {} }) },
		});
		vm.runInContext(fuente.replace(/^let /gm, 'var ').replace(/^function (\w+)/gm, 'globalThis.$1 = function $1'), ctx);
		return { ctx, els };
	}
	const N = x => JSON.parse(JSON.stringify(x));
	const CATS = [{ id: FUENTE, nombre: 'ADICIONALES' }, { id: BURGERS, nombre: 'BURGERS' }, { id: PERROS, nombre: 'PERROS' }, { id: 'x', nombre: 'Vieja', archivado_en: '2026-01-01' }];

	test('lee lo guardado y lo devuelve igual', () => {
		const { ctx, els } = montar(CATS, { adicionales_carta: { activo: true, categoria_id: FUENTE, categorias: [BURGERS] } });
		ctx.renderAdicionalesCarta();
		assert.equal(els.ajAdicActivo.checked, true);
		assert.equal(els.ajAdicCategoria.value, FUENTE);
		assert.deepEqual(N(ctx.recolectarAdicionalesCarta()), { adicionales_carta: { activo: true, categoria_id: FUENTE, categorias: [BURGERS] } });
	});

	test('encendido sin lo necesario no viaja encendido; las categorías archivadas o la fuente no cuentan', () => {
		const { ctx, els } = montar(CATS, { adicionales_carta: { activo: true, categoria_id: FUENTE, categorias: [FUENTE, 'x'] } });
		ctx.renderAdicionalesCarta();
		const g = N(ctx.recolectarAdicionalesCarta()).adicionales_carta;
		assert.equal(g.activo, false);
		assert.deepEqual(g.categorias, []);
		assert.match(els.ajAdicAviso.textContent, /al menos una categoría/);
	});

	test('la lista de dónde se ofrece no sale hasta elegir la categoría de adicionales', () => {
		const { ctx, els } = montar(CATS, { adicionales_carta: { activo: true, categoria_id: '', categorias: [] } });
		ctx.renderAdicionalesCarta();
		assert.equal(els.ajAdicOfrecer.hidden, true);
		els.ajAdicCategoria.value = FUENTE; ctx.adicCartaPintar();
		assert.equal(els.ajAdicOfrecer.hidden, false);
	});

	test('encendido a medias no se guarda en silencio: dice qué falta', () => {
		const { ctx, els } = montar(CATS);
		ctx.renderAdicionalesCarta();
		assert.equal(ctx.errorDeAdicionalesCarta(), '', 'apagado no avisa');
		els.ajAdicActivo.checked = true;
		assert.match(ctx.errorDeAdicionalesCarta(), /Elige primero la categoría/);
		els.ajAdicCategoria.value = FUENTE;
		assert.match(ctx.errorDeAdicionalesCarta(), /Marca en qué categorías/);
		ctx.adicCategoriasMarcadas.add(BURGERS);
		assert.equal(ctx.errorDeAdicionalesCarta(), '');
	});
});
