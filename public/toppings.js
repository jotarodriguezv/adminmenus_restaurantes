// Los toppings: el catálogo de adiciones del restaurante (platino, premium y
// salsas) y el aviso de los platos que apuntan a una que ya no existe.
//
// El 16/09/2026 dejaron de ser una pestaña: su marcado vive en Ajustes, bajo el
// carrito, y se guardan con el botón de esa pantalla. Aquí quedó el catálogo y
// lo que lo pinta; el guardado está en ajustes.js, porque todo lo de esa
// pantalla va en una sola petición.
//
// Cómo lee ese catálogo la ficha del plato (catalogoDe) está en index.html,
// con el resto de la ficha: es de Productos, no de esta pestaña.
//
// Salió de public/index.html el 15/09/2026, paso 3 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace. El marcado de la pestaña sigue en index.html.
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// ── TOPPINGS ─────────────────────────────────────────────────
// El catálogo del negocio. Cada elemento lleva un identificador propio y los
// platos guardan ESE identificador, no el nombre — que era lo que hacía que
// renombrar un topping desenganchara en silencio a los platos que lo ofrecen.
//
// Se guarda ya normalizado por catalogoDe: aunque lo que hubiera en la base
// fueran cadenas sueltas, al pulsar Guardar sale con la forma de hoy.
let toppingState = { platino: [], premium: [], salsas: [] };

function renderToppings() {
  if (!state.restaurante?.atributos) return;
  const cat = catalogoDe(state.restaurante.atributos);
  toppingState.platino = cat.platino;
  toppingState.premium = cat.premium;
  toppingState.salsas  = cat.salsas;
  renderToppingList('listToppingsPlatino', 'platino');
  renderToppingList('listToppingsPremium', 'premium');
  renderToppingList('listToppingsSalsas',  'salsas');
  pintarGuiaToppings();
}

// La guía sale mientras el catálogo esté entero vacío: es cuando hace falta.
// Con un solo topping creado ya se ha entendido la pantalla, y repetirla en
// cada visita sería ruido.
function catalogoToppingsVacio(t) {
  return !(t.platino.length || t.premium.length || t.salsas.length);
}
function pintarGuiaToppings() {
  const guia = document.getElementById('toppingsGuia');
  if (guia) guia.style.display = catalogoToppingsVacio(toppingState) ? 'block' : 'none';
  pintarAvisoSinUso();
}

// Un topping que no ofrece ningún plato no sale en ninguna carta, igual que un
// filtro que ningún plato cumple. La pestaña lo cuenta arriba, pero eso se lee
// una vez y el catálogo sigue ahí meses: quien lo creó y no lo marcó ve una
// pestaña llena y una carta que no pregunta nada.
//
// Compara por identificador Y por nombre, como toppingsHuerfanos: un plato que
// nadie haya vuelto a guardar desde la migración todavía lleva nombres dentro,
// y darlo por no usado sería avisar de un problema que no existe.
function toppingsSinUso(t = toppingState, productos = state.productos) {
  const catalogo = [...t.platino, ...t.premium, ...t.salsas];
  if (!catalogo.length) return 0;   // catálogo vacío: de eso habla la guía
  const suyos = new Set();
  for (const x of catalogo) { suyos.add(x.id); suyos.add(x.nombre); }
  const alguno = (productos || []).some(p => {
    const pers = p.atributos?.personalizacion;
    if (!pers) return false;
    return [...(pers.platino || []), ...(pers.premium || []), ...(pers.salsas || [])].some(n => suyos.has(n));
  });
  return alguno ? 0 : catalogo.length;
}

function pintarAvisoSinUso() {
  const aviso = document.getElementById('toppingsSinUso');
  if (!aviso) return;
  const cuantos = toppingsSinUso();
  aviso.style.display = cuantos ? 'block' : 'none';
  aviso.textContent = cuantos === 1
    ? 'Tienes un topping creado y ningún plato lo ofrece, así que en tu carta no aparece. Márcalo en la ficha de los platos que lo lleven, en «Personalización».'
    : `Tienes ${cuantos} toppings creados y ningún plato los ofrece, así que en tu carta no aparece ninguno. Márcalos en la ficha de cada plato, en «Personalización».`;
}

function renderToppingList(containerId, tipo) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const items = toppingState[tipo];
  wrap.innerHTML = '';
  if (!items.length) { wrap.innerHTML = '<span style="font-size:12px;color:var(--text-dim);">Ninguno todavía. Pulsa «+ Añadir».</span>'; pintarGuiaToppings(); return; }
  items.forEach((item, idx) => {
    const chip = document.createElement('div');
    chip.className = 'topping-chip';
    const label = tipo === 'premium'
      ? `${item.nombre} · $${Number(item.precio || 0).toLocaleString('es-CO')}`
      : item.nombre;
    // El nombre es un botón: renombrar es lo que este cambio vuelve seguro,
    // y una función que no se ve desde ningún sitio es una función que no
    // existe. El aspecto es el mismo de antes; solo se puede pulsar.
    chip.innerHTML =
      `<button class="chip-nombre" title="Renombrar">${esc(label)}</button>` +
      `<button class="chip-del" title="Eliminar">✕</button>`;
    chip.querySelector('.chip-nombre').onclick = () => editarTopping(tipo, idx);
    chip.querySelector('.chip-del').onclick = () => {
      items.splice(idx, 1);
      renderToppingList(containerId, tipo);
    };
    wrap.appendChild(chip);
  });
  // Añadir o quitar uno cambia si el catálogo está vacío: la guía se entera aquí.
  pintarGuiaToppings();
}

const CONTENEDOR_TOPPING = {
  platino: 'listToppingsPlatino',
  premium: 'listToppingsPremium',
  salsas:  'listToppingsSalsas',
};

function addTopping(tipo) {
  document.getElementById('toppingTipo').value = tipo;
  document.getElementById('toppingIndice').value = '';
  document.getElementById('toppingNombre').value = '';
  document.getElementById('toppingPrecio').value = tipo === 'premium' ? '4000' : '';
  document.getElementById('toppingPrecioGroup').style.display = tipo === 'premium' ? 'block' : 'none';
  const titles = { platino: 'Nuevo topping sin costo', premium: 'Nuevo topping con costo', salsas: 'Nueva salsa' };
  document.getElementById('toppingModalTitle').textContent = titles[tipo];
  document.getElementById('btnGuardarTopping').textContent = 'Añadir';
  openModal('toppingModal');
  setTimeout(() => document.getElementById('toppingNombre').focus(), 100);
}

// Renombrar (y, en premium, cambiar el precio) sin tocar el identificador:
// los platos que lo ofrecen siguen enganchados y el cliente ve el nombre
// nuevo. Antes esto no se podía hacer desde el panel — solo añadir y borrar—,
// justamente porque renombrar rompía los platos en silencio.
function editarTopping(tipo, idx) {
  const item = toppingState[tipo][idx];
  if (!item) return;
  document.getElementById('toppingTipo').value = tipo;
  document.getElementById('toppingIndice').value = String(idx);
  document.getElementById('toppingNombre').value = item.nombre;
  document.getElementById('toppingPrecio').value = tipo === 'premium' ? String(item.precio ?? '') : '';
  document.getElementById('toppingPrecioGroup').style.display = tipo === 'premium' ? 'block' : 'none';
  document.getElementById('toppingModalTitle').textContent = tipo === 'salsas' ? 'Editar salsa' : 'Editar topping';
  document.getElementById('btnGuardarTopping').textContent = 'Guardar';
  openModal('toppingModal');
  setTimeout(() => document.getElementById('toppingNombre').focus(), 100);
}

function confirmAddTopping() {
  const tipo   = document.getElementById('toppingTipo').value;
  const nombre = document.getElementById('toppingNombre').value.trim();
  const crudo  = document.getElementById('toppingIndice').value;
  const idx    = crudo === '' ? -1 : Number(crudo);
  if (!nombre) { showToast('Escribe un nombre', 'error'); return; }

  const lista = toppingState[tipo];
  if (!lista) return;

  // Un nombre repetido no es solo desorden. Aunque el cobro ya va por
  // identificador, el cliente vería dos chips iguales en el modal y no
  // sabría cuál marcar. Al renombrar no cuenta el propio elemento.
  const igual = v => String(v || '').trim().toLowerCase() === nombre.toLowerCase();
  if (lista.some((t, i) => i !== idx && igual(t.nombre))) {
    showToast('Ya hay uno con ese nombre', 'error');
    return;
  }

  const precio = tipo === 'premium' ? (parseFloat(document.getElementById('toppingPrecio').value) || 0) : null;

  if (idx >= 0) {
    // Renombrar conserva el identificador: es todo el objetivo del cambio.
    lista[idx] = { ...lista[idx], nombre };
    if (tipo === 'premium') lista[idx].precio = precio;
  } else {
    // Un identificador nuevo que no choque con ninguno de los tres grupos:
    // los platos guardan una sola lista por grupo, pero un choque entre
    // grupos confundiría a cualquiera que lea 'atributos' a mano.
    const usados = new Set([...toppingState.platino, ...toppingState.premium, ...toppingState.salsas].map(t => t.id));
    let id = nuevoIdTopping();
    while (usados.has(id)) id = nuevoIdTopping();
    lista.push(tipo === 'premium' ? { id, nombre, precio } : { id, nombre });
  }

  renderToppingList(CONTENEDOR_TOPPING[tipo], tipo);
  closeModal('toppingModal');
  showToast(idx >= 0 ? 'Actualizado · recuerda guardar' : 'Añadido · recuerda guardar', 'info');
}

// Qué platos se quedan apuntando a algo que ya no existe. Desde que los
// platos guardan el identificador, esto solo puede pasar al BORRAR un
// elemento del catálogo: renombrarlo ya no los desengancha.
//
// Sigue comparando también por nombre porque un plato que nadie haya vuelto a
// guardar desde la migración todavía puede tener nombres dentro, y avisar de
// más es mejor que callarse de menos.
function toppingsHuerfanos() {
  const quedan = new Set();
  for (const t of [...toppingState.platino, ...toppingState.premium, ...toppingState.salsas]) {
    quedan.add(t.id);
    quedan.add(t.nombre);
  }
  const afectados = [];
  for (const p of state.productos || []) {
    const pers = p.atributos?.personalizacion;
    if (!pers) continue;
    const perdidos = [...(pers.platino || []), ...(pers.premium || []), ...(pers.salsas || [])]
      .filter(n => !quedan.has(n));
    if (perdidos.length) afectados.push(`${p.nombre}: ${[...new Set(perdidos)].join(', ')}`);
  }
  return afectados;
}
