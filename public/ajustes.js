// La pestaña Ajustes: lo que el propio restaurante configura de su carta.
//
// Nació el 15/09/2026 con las redes sociales, que hasta entonces estaban en
// Apariencia, solo para el superadmin. Es el primer paso de abrir partes de
// Apariencia al restaurante (CLAUDE.md, «Decisión: abrir partes de Apariencia
// al restaurante»); detrás vendrán los filtros y el interruptor del carrito.
//
// El superadmin la ve igual que el restaurante: un solo sitio para cada dato.
// Tenerlo también en Apariencia volvería a abrir el problema que el servidor ya
// resolvió al fundir atributos: dos pantallas guardando la misma clave, y la
// que se guarda la última pisa lo que la otra acababa de cambiar.
//
// Qué vale y qué no lo decide el servidor (validarRedes, en server.js): el
// restaurante ya puede escribir aquí, y un formulario se salta con una llamada
// directa. Esto solo limpia lo evidente para que el aviso de error sea raro.
//
// Se carga con un <script> clásico antes del script principal, como comun.js:
// no se puede repetir aquí un nombre que ya exista en otro archivo del panel.

// ── REDES SOCIALES ────────────────────────────────────────────
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
  const st = document.getElementById('ajustesStatus');
  st.textContent = ''; st.style.color = 'var(--text-muted)';
}

function recolectarRedes() {
  const valor = id => document.getElementById(id).value.trim();
  return {
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
      { atributos: recolectarRedes() });
    if (!data) return;   // sesión caducada: apiFetch ya llevó al login
    state.restaurante = data;
    renderAjustes();
    st.textContent = '✓ Guardado'; st.style.color = 'var(--success)';
    showToast('Ajustes guardados', 'success');
  } catch (e) {
    // El motivo lo escribe el servidor para quien lo lee: «El enlace de
    // Instagram tiene que empezar por https://».
    st.textContent = e.message; st.style.color = 'var(--danger)';
    showToast(e.message, 'error');
  }
}
