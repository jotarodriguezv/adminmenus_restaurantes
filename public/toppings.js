// La pestaña Toppings: el catálogo de adiciones del restaurante (platino,
// premium y salsas) y el aviso de los platos que apuntan a una que ya no existe.
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

async function saveToppings() {
  const huerfanos = toppingsHuerfanos();
  if (huerfanos.length) {
    const ok = confirm(
      `Estos platos ofrecen toppings que van a dejar de existir con este cambio:\n\n` +
      huerfanos.slice(0, 10).join('\n') +
      (huerfanos.length > 10 ? `\n…y ${huerfanos.length - 10} plato(s) más` : '') +
      `\n\nSi lo que quieres es cambiarle el nombre a uno, no hace falta borrarlo: ` +
      `pulsa sobre él y edítalo, y los platos lo siguen solos.\n\n¿Guardar de todas formas?`);
    if (!ok) return;
  }

  // Solo sus tres claves. Antes se mandaba `{...atributos, ...}` con la copia
  // que el panel cargó al entrar, así que guardar toppings reescribía TODO
  // atributos y devolvía a su valor viejo cualquier cosa que se hubiera
  // cambiado mientras tanto. Ahora las funde el servidor, que sí tiene la
  // versión de ahora.
  const atributos = {
    toppings_platino: toppingState.platino,
    toppings_premium: toppingState.premium,
    salsas:           toppingState.salsas,
  };
  try {
    const data = await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`, { atributos });
    if (data) state.restaurante = data;
    // Quedarse sin toppings puede dejar la pestaña sin motivo para existir.
    ajustarPestanasAlModelo();
    showToast('Toppings guardados', 'success');
  } catch(e) { showToast('Error al guardar: ' + e.message, 'error'); }
}
