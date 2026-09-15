// La pestaña Ajustes: lo que el propio restaurante configura de su carta.
//
// Nació el 15/09/2026 con las redes sociales y, el mismo día, los filtros y
// etiquetas: las dos cosas estaban en Apariencia, solo para el superadmin. Es
// abrir partes de Apariencia al restaurante (CLAUDE.md, «Decisión: abrir partes
// de Apariencia al restaurante»); detrás vendrá el interruptor del carrito.
//
// El superadmin la ve igual que el restaurante: un solo sitio para cada dato.
// Tenerlo también en Apariencia volvería a abrir el problema que el servidor ya
// resolvió al fundir atributos: dos pantallas guardando la misma clave, y la
// que se guarda la última pisa lo que la otra acababa de cambiar.
//
// Qué vale y qué no lo decide el servidor (validarRedes y validarFiltros, en
// server.js): el
// restaurante ya puede escribir aquí, y un formulario se salta con una llamada
// directa. Esto solo limpia lo evidente para que el aviso de error sea raro.
//
// Se carga con un <script> clásico antes del script principal, como comun.js:
// no se puede repetir aquí un nombre que ya exista en otro archivo del panel.

// ── PINTAR, RECOGER Y GUARDAR ─────────────────────────────────
// Un solo botón para las dos secciones: son del mismo formulario y del mismo
// PATCH, y dos botones harían creer que guardar uno guarda también el otro.
const REDES_CAMPOS = {
  social_instagram: 'ajSocialInstagram',
  social_facebook:  'ajSocialFacebook',
  social_tiktok:    'ajSocialTiktok',
  social_whatsapp:  'ajSocialWhatsapp',
};

function renderAjustes() {
  const at = state.restaurante?.atributos || {};
  document.getElementById('ajSocialBar').checked = !!at.social_bar;
  for (const [clave, id] of Object.entries(REDES_CAMPOS))
    document.getElementById(id).value = at[clave] || '';
  // Una copia: los chips la cambian al pulsarlos, y hasta guardar no es de verdad.
  state.filtrosDisponibles = Array.isArray(at.filtros_disponibles) ? [...at.filtros_disponibles] : [];
  renderFiltrosCatalogo();
  const st = document.getElementById('ajustesStatus');
  st.textContent = ''; st.style.color = 'var(--text-muted)';
}

function recolectarAjustes() {
  const valor = id => document.getElementById(id).value.trim();
  return {
    filtros_disponibles: state.filtrosDisponibles,
    social_bar: document.getElementById('ajSocialBar').checked,
    social_instagram: valor('ajSocialInstagram'),
    social_facebook: valor('ajSocialFacebook'),
    social_tiktok: valor('ajSocialTiktok'),
    // Solo dígitos: wa.me no acepta otra cosa, y un «+57 300 123 4567» —que es
    // como lo teclea cualquiera— arma un enlace que no abre ningún chat.
    social_whatsapp: valor('ajSocialWhatsapp').replace(/[^0-9]/g, ''),
  };
}

async function saveAjustes() {
  const st = document.getElementById('ajustesStatus');
  st.textContent = 'Guardando…'; st.style.color = 'var(--text-muted)';
  try {
    // Solo sus claves: el servidor funde con lo que ya hay y no toca el resto.
    const data = await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`,
      { atributos: recolectarAjustes() });
    if (!data) return;   // sesión caducada: apiFetch ya llevó al login
    state.restaurante = data;
    renderAjustes();
    st.textContent = '✓ Guardado'; st.style.color = 'var(--success)';
    showToast('Ajustes guardados', 'success');
  } catch (e) {
    // El motivo lo escribe el servidor para quien lo lee: «El enlace de
    // Instagram tiene que empezar por https://», «Hay más de 40 filtros».
    st.textContent = e.message; st.style.color = 'var(--danger)';
    showToast(e.message, 'error');
  }
}

// ── FILTROS Y ETIQUETAS ───────────────────────────────────────
// Un filtro está "activo" si su id está en state.filtrosDisponibles.
function filtroActivo(id) {
  return state.filtrosDisponibles.some(f => f.id === id);
}

function renderFiltrosCatalogo() {
  const cont = document.getElementById('ajFiltrosCatalogo');
  if (!cont) return;
  cont.innerHTML = '';

  // Grupos del catálogo curado
  CATALOGO_FILTROS.forEach(grupo => {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '14px';
    const titulo = document.createElement('div');
    titulo.style.cssText = 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;';
    titulo.textContent = grupo.grupo;
    wrap.appendChild(titulo);

    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    grupo.items.forEach(item => {
      chips.appendChild(chipFiltro(item, filtroActivo(item.id)));
    });
    wrap.appendChild(chips);
    cont.appendChild(wrap);
  });

  // Filtros personalizados que el restaurante creó (no están en el catálogo)
  const custom = state.filtrosDisponibles.filter(f =>
    !CATALOGO_FILTROS.some(g => g.items.some(i => i.id === f.id))
  );
  if (custom.length) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '4px';
    const titulo = document.createElement('div');
    titulo.style.cssText = 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;';
    titulo.textContent = 'Personalizados';
    wrap.appendChild(titulo);
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    custom.forEach(item => chips.appendChild(chipFiltro(item, true, true)));
    wrap.appendChild(chips);
    cont.appendChild(wrap);
  }
}

// Un "chip" clicable que activa/desactiva un filtro del catálogo.
// Para filtros personalizados (esCustom) el chip los quita del catálogo.
function chipFiltro(item, activo, esCustom) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.style.cssText =
    'display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:20px;cursor:pointer;' +
    'font-size:12px;font-family:inherit;transition:all .15s;border:1px solid ' +
    (activo ? 'var(--accent)' : 'var(--border)') + ';' +
    'background:' + (activo ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent') + ';' +
    'color:' + (activo ? 'var(--accent)' : 'var(--text-muted)') + ';';
  chip.innerHTML = `<span>${esc(item.emoji || '')}</span><span>${esc(item.label)}</span>` +
    (esCustom ? '<span style="opacity:.6;margin-left:2px">✕</span>' : (activo ? '<span style="margin-left:2px">✓</span>' : ''));
  chip.onclick = () => {
    if (esCustom) {
      // quitar el filtro custom del catálogo
      state.filtrosDisponibles = state.filtrosDisponibles.filter(f => f.id !== item.id);
    } else if (activo) {
      state.filtrosDisponibles = state.filtrosDisponibles.filter(f => f.id !== item.id);
    } else {
      state.filtrosDisponibles.push({ id: item.id, label: item.label, emoji: item.emoji });
    }
    renderFiltrosCatalogo();
  };
  return chip;
}

function agregarFiltroCustom() {
  const labelEl = document.getElementById('ajFiltroCustomLabel');
  const emojiEl = document.getElementById('ajFiltroCustomEmoji');
  const label = labelEl.value.trim();
  const emoji = emojiEl.value.trim();
  if (!label) { showToast('Escribe el nombre del filtro', 'error'); return; }
  // id estable a partir del label
  const base = 'custom_' + label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (state.filtrosDisponibles.some(f => f.id === base)) { showToast('Ese filtro ya existe', 'error'); return; }
  state.filtrosDisponibles.push({ id: base, label, emoji });
  labelEl.value = ''; emojiEl.value = '';
  renderFiltrosCatalogo();
}
