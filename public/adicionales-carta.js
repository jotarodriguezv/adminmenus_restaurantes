// «Adicionales de tu carta» (Ajustes → Pedidos): ofrecer, dentro de la ventana del pedido, los platos de una
// categoría de adicionales de la propia carta (porción de papa, de tocineta…) cuando se agrega otro plato.
// Es la configuración de `atributos.adicionales_carta = { activo, categoria_id, categorias }`; quien la lee es
// `core/adicionales.js` de vmenus-app, y quien la valida, `validarAdicionalesCarta` en server.js.
//
// Un solo precio y una sola disponibilidad: los adicionales siguen siendo platos de su categoría, y el modal
// los toma de ahí. Por eso no se copian como «adicionales con costo» (esos son aparte y se pueden usar a la vez).
//
// Se carga con un <script> clásico antes del script principal: comparte las declaraciones de nivel superior
// con los demás archivos, así que no puede repetirse aquí ningún nombre (state, esc… vienen de comun.js).

// Las categorías que se están marcando, por id. Una copia: se guarda de verdad al pulsar «Guardar ajustes».
let adicCategoriasMarcadas = new Set();

function adicCategoriasDelRestaurante() {
  return (state.categorias || []).filter(c => c && c.id && c.nombre && !c.archivado_en);
}

// Se llama al pintar Ajustes. Lee lo guardado, no lo que haya a medias en pantalla.
function renderAdicionalesCarta() {
  const caja = document.getElementById('ajAdicActivo');
  if (!caja) return;
  const c = state.restaurante?.atributos?.adicionales_carta || {};
  caja.checked = c.activo === true;
  adicCategoriasMarcadas = new Set(Array.isArray(c.categorias) ? c.categorias.map(String) : []);

  const select = document.getElementById('ajAdicCategoria');
  select.replaceChildren();
  const vacio = document.createElement('option');
  vacio.value = ''; vacio.textContent = 'Elige la categoría…';
  select.appendChild(vacio);
  for (const cat of adicCategoriasDelRestaurante()) {
    const o = document.createElement('option');
    o.value = cat.id; o.textContent = `${cat.emoji ? cat.emoji + ' ' : ''}${cat.nombre}`;
    select.appendChild(o);
  }
  select.value = adicCategoriasDelRestaurante().some(x => x.id === c.categoria_id) ? c.categoria_id : '';
  adicCartaPintar();
}

// Muestra u oculta los campos y rehace la lista de categorías donde se ofrecen (sin la de adicionales).
function adicCartaPintar() {
  const activo = document.getElementById('ajAdicActivo').checked;
  document.getElementById('ajAdicCampos').hidden = !activo;
  const fuente = document.getElementById('ajAdicCategoria').value;

  const lista = document.getElementById('ajAdicCategorias');
  lista.replaceChildren();
  for (const cat of adicCategoriasDelRestaurante()) {
    if (cat.id === fuente) continue;
    const etiqueta = document.createElement('label');
    etiqueta.className = 'aj-adic-categoria';
    const caja = document.createElement('input');
    caja.type = 'checkbox'; caja.checked = adicCategoriasMarcadas.has(cat.id);
    caja.onchange = () => { if (caja.checked) adicCategoriasMarcadas.add(cat.id); else adicCategoriasMarcadas.delete(cat.id); adicCartaPintar(); };
    const texto = document.createElement('span');
    texto.textContent = `${cat.emoji ? cat.emoji + ' ' : ''}${cat.nombre}`;
    etiqueta.append(caja, texto);
    lista.appendChild(etiqueta);
  }

  const aviso = document.getElementById('ajAdicAviso');
  if (!activo) { aviso.textContent = ''; return; }
  const hay = adicCartaMarcadas(fuente).length;
  aviso.textContent = !fuente ? 'Elige la categoría donde tienes tus adicionales.'
    : !hay ? 'Marca al menos una categoría donde se ofrezcan, por ejemplo las hamburguesas.'
    : '';
}

// Las marcadas que siguen existiendo y no son la fuente: lo que de verdad se guardaría.
function adicCartaMarcadas(fuente) {
  const existen = new Set(adicCategoriasDelRestaurante().map(c => c.id));
  return [...adicCategoriasMarcadas].filter(id => existen.has(id) && id !== fuente);
}

// Lo que viaja al guardar. Encendido sin lo necesario no se manda encendido: la carta lo ignoraría igual, y
// el servidor lo rechazaría. Apagado se conserva lo elegido, para encontrarlo al volver a encenderlo.
function recolectarAdicionalesCarta() {
  const caja = document.getElementById('ajAdicActivo');
  if (!caja) return {};
  const fuente = document.getElementById('ajAdicCategoria').value;
  const categorias = adicCartaMarcadas(fuente);
  const completo = !!fuente && categorias.length > 0;
  return { adicionales_carta: { activo: caja.checked && completo, categoria_id: fuente, categorias } };
}
