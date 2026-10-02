// Configuración y previsualización local de la pantalla que aparece antes de
// la carta. El menú público recibe estos mismos atributos en core/intro.js.

const TIPOS_TEXTO_BIENVENIDA = [
  ['nombre', 'Nombre'], ['eslogan', 'Frase de bienvenida'],
  ['adicional', 'Texto adicional'], ['cta', 'Botón principal'], ['direccion', 'Dirección opcional']
];
const VALORES_BIENVENIDA = {
  intro_fondo_color: '#111827', intro_overlay_activo: true, intro_overlay_color: '#0a0a0f',
  intro_overlay_opacidad: 50, intro_imagen_ajuste: 'cover', intro_cta: 'Ver carta',
  intro_social_tiktok: false, intro_resena_activo: false, intro_resena_texto: '',
  intro_horario_activo: true, intro_correo_activo: true,
  intro_reservas_activo: false, intro_reservas_texto: '',
  intro_social_estilo: 'circular', intro_social_icono_color: '#ffffff',
  intro_social_fondo: '#ef7a00', intro_social_borde: '#ffffff', intro_social_tamano: 48,
  intro_mapa_modo: 'mapa', intro_mapa_boton_fondo: '#17120b', intro_mapa_boton_color: '#ffffff', intro_mapa_boton_fuente: '',
  intro_tarjeta_fondo: '#17120b', intro_tarjeta_borde: '#ffffff', intro_tarjeta_borde_grosor: 1, intro_textos: {}
};

function campoBienvenida(id) { return document.getElementById(id); }
function valorBienvenida(id, defecto = '') { return campoBienvenida(id)?.value ?? defecto; }

function pintarControlesTextoBienvenida(textos = {}) {
  const zona = campoBienvenida('apIntroTextosControles');
  if (!zona) return;
  const abiertos = new Set([...zona.querySelectorAll('details[open][data-texto]')].map(panel => panel.dataset.texto));
  const fuentes = (typeof FUENTES_TEXTO_MENU !== 'undefined' ? FUENTES_TEXTO_MENU : ['', 'Montserrat', 'Inter', 'Poppins'])
    .map(f => `<option value="${f}">${f || 'Montserrat (predeterminada)'}</option>`).join('');
  zona.innerHTML = TIPOS_TEXTO_BIENVENIDA.map(([tipo, nombre]) => `<details class="bienvenida-texto-control" data-texto="${tipo}"${abiertos.has(tipo) ? ' open' : ''}>
    <summary><span>${nombre}</span><span class="bienvenida-texto-resumen" data-resumen>Predeterminado</span></summary>
    <div class="bienvenida-texto-cuerpo"><label>${tipo === 'cta' ? 'Color del botón' : 'Color'}</label><input type="color" data-prop="color" value="#ffffff">
      ${tipo === 'cta' ? '<label>Color del texto</label><input type="color" data-prop="color_texto" value="#15100b">' : ''}
      <label>Fuente</label><select data-prop="fuente">${fuentes}</select><label>Grosor</label>
      <select data-prop="peso"><option value="0">Predeterminado</option><option value="400">Normal</option><option value="500">Medio</option><option value="600">Seminegrita</option><option value="700">Negrita</option><option value="800">Extranegrita</option></select>
      <label>Tamaño <span data-tamano></span></label><input type="range" data-prop="tamano" min="12" max="64" value="${tipo === 'nombre' ? 30 : tipo === 'cta' ? 15 : 16}">
      <label>Alineación</label><select data-prop="alineacion"><option value="centro">Centro</option><option value="izquierda">Izquierda</option><option value="derecha">Derecha</option></select>
    </div>
  </details>`).join('');
  zona.querySelectorAll('[data-texto]').forEach(el => {
    const dato = textos[el.dataset.texto] || {};
    for (const prop of ['color', 'color_texto', 'fuente', 'peso', 'tamano', 'alineacion']) {
      const input = el.querySelector(`[data-prop="${prop}"]`);
      if (dato[prop] && input) input.value = dato[prop];
    }
    el.querySelectorAll('input,select').forEach(input => input.addEventListener('input', actualizarVistaPreviaBienvenida));
    actualizarResumenTextoBienvenida(el);
  });
}

function actualizarResumenTextoBienvenida(el) {
  const resumen = el?.querySelector('[data-resumen]');
  if (!resumen) return;
  const valores = {
    nombre: valorBienvenida('apIntroNombre') || state.restaurante?.nombre || 'Nombre del restaurante',
    eslogan: valorBienvenida('apIntroEslogan') || 'Sin frase configurada',
    adicional: valorBienvenida('apIntroTextoAdicional') || 'Sin texto adicional',
    cta: valorBienvenida('apIntroCta') || 'Ver carta',
    direccion: direccionDelNegocio(state.restaurante?.atributos) || 'Sin dirección configurada'
  };
  resumen.textContent = valores[el.dataset.texto] || 'Predeterminado';
}

function actualizarResumenesBienvenida() {
  document.querySelectorAll('#apIntroTextosControles [data-texto]').forEach(actualizarResumenTextoBienvenida);
}

function sincronizarColorBienvenida(id) {
  const color = campoBienvenida(id);
  const hex = campoBienvenida(`${id}Hex`);
  if (color && hex) hex.value = color.value.toUpperCase();
  actualizarVistaPreviaBienvenida();
}

function sincronizarHexBienvenida(id) {
  const color = campoBienvenida(id);
  const hex = campoBienvenida(`${id}Hex`);
  if (color && hex && /^#[0-9a-f]{6}$/i.test(hex.value.trim())) color.value = hex.value.trim();
  actualizarVistaPreviaBienvenida();
}

function consultaMapaBienvenida(url) {
  try {
    const enlace = new URL(url); const directo = enlace.searchParams.get('q') || enlace.searchParams.get('query') || enlace.searchParams.get('destination') || enlace.searchParams.get('center') || enlace.searchParams.get('ll');
    if (directo) return directo;
    const coordenadas = enlace.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (coordenadas) return `${coordenadas[1]},${coordenadas[2]}`;
    const lugar = enlace.pathname.match(/\/maps\/(?:place|search)\/([^/?]+)/i);
    return lugar ? decodeURIComponent(lugar[1].replace(/\+/g, ' ')) : '';
  } catch { return ''; }
}

function fuenteMapaBienvenida(url) {
  try {
    const enlace = new URL(url);
    if (/\/maps\/embed/i.test(enlace.pathname)) return enlace.href;
    if (/(^|\.)maps\.app\.goo\.gl$/i.test(enlace.hostname)) return '';
    const consulta = consultaMapaBienvenida(enlace.href);
    return consulta ? `https://maps.google.com/maps?output=embed&q=${encodeURIComponent(consulta)}` : '';
  } catch { return ''; }
}

async function resolverFuenteMapaBienvenida(url) {
  const directa = fuenteMapaBienvenida(url);
  if (directa) return directa;
  try {
    const respuesta = await fetch(`/api/mapa-embed?url=${encodeURIComponent(url)}`);
    if (!respuesta.ok) return '';
    const datos = await respuesta.json(); return fuenteMapaBienvenida(datos.url);
  } catch { return ''; }
}

function recolectarTextosBienvenida() {
  const salida = {};
  document.querySelectorAll('#apIntroTextosControles [data-texto]').forEach(el => {
    const leer = prop => el.querySelector(`[data-prop="${prop}"]`)?.value || '';
    salida[el.dataset.texto] = { color: leer('color'), color_texto: leer('color_texto'), fuente: leer('fuente'), peso: Number(leer('peso')) || 0,
      tamano: Number(leer('tamano')) || 0, alineacion: leer('alineacion') || 'centro' };
  });
  return salida;
}

// El campo del nombre empieza con el nombre del restaurante, que es lo que se
// vería de todas formas. Pero si se GUARDARA copiado, la bienvenida dejaría de
// seguirlo: el día que el superadmin cambie el nombre, la bienvenida seguiría
// diciendo el viejo. Por eso, dejado igual, se guarda vacío («sigue al nombre»);
// solo un nombre distinto se guarda como nombre propio de la bienvenida.
function nombreDeBienvenidaParaGuardar() {
  const escrito = valorBienvenida('apIntroNombre').trim();
  return escrito === String(state.restaurante?.nombre ?? '').trim() ? '' : escrito;
}

// Un interruptor sin dato detrás no se puede encender: «mostrar TikTok» sin enlace
// de TikTok no muestra nada, y dejarlo encendido sería prometer algo que la carta
// no hace. Se apaga y se desactiva; el texto de al lado dice qué falta y dónde se
// pone. Al volver a tener el dato se puede volver a encender: queda apagado, no
// recordado, porque encenderlo es una decisión de quien lo enciende.
//
// Lee lo GUARDADO del negocio (se escribe en Ajustes), como la vista previa.
function ajustarInterruptoresBienvenida() {
  const at = state.restaurante?.atributos || {};
  const hay = {
    apIntroSocialInstagram: !!textoDelNegocio(at.social_instagram),
    apIntroSocialFacebook: !!textoDelNegocio(at.social_facebook),
    apIntroSocialTiktok: !!textoDelNegocio(at.social_tiktok),
    apIntroMapaActivo: hayDatoDelNegocio('mapa', at),
    apIntroResenaActivo: hayDatoDelNegocio('resena', at),
    apIntroHorarioActivo: hayDatoDelNegocio('horario', at),
    apIntroCorreoActivo: hayDatoDelNegocio('correo', at),
  };
  for (const [id, hayDato] of Object.entries(hay)) {
    const caja = campoBienvenida(id);
    if (!caja) continue;
    caja.disabled = !hayDato;
    if (!hayDato) caja.checked = false;
    caja.closest?.('.form-check')?.classList.toggle('sin-dato', !hayDato);
  }
}

function valoresBienvenida() {
  const imagen = campoBienvenida('apIntroImagenPreview');
  return {
    intro_activo: campoBienvenida('apIntroActivo').checked,
    intro_nombre: nombreDeBienvenidaParaGuardar(), intro_eslogan: valorBienvenida('apIntroEslogan').trim(),
    intro_texto_adicional: valorBienvenida('apIntroTextoAdicional').trim(), intro_cta: valorBienvenida('apIntroCta').trim() || 'Ver carta',
    intro_fondo_url: imagen?.dataset.url || '',
    intro_fondo_color: valorBienvenida('apIntroFondoColor'), intro_overlay_activo: campoBienvenida('apIntroOverlayActivo').checked,
    intro_overlay_color: valorBienvenida('apIntroOverlayColor'),
    intro_overlay_opacidad: Number(valorBienvenida('apIntroOverlayOpacidad')), intro_imagen_ajuste: valorBienvenida('apIntroImagenAjuste'),
    intro_tarjeta_fondo: valorBienvenida('apIntroTarjetaFondo'), intro_tarjeta_borde: valorBienvenida('apIntroTarjetaBorde'), intro_tarjeta_borde_grosor: Number(valorBienvenida('apIntroTarjetaBordeGrosor')),
    intro_textos: recolectarTextosBienvenida(), intro_social_instagram: campoBienvenida('apIntroSocialInstagram').checked,
    intro_social_facebook: campoBienvenida('apIntroSocialFacebook').checked, intro_social_estilo: valorBienvenida('apIntroSocialEstilo'),
    intro_social_tiktok: campoBienvenida('apIntroSocialTiktok').checked,
    intro_resena_activo: campoBienvenida('apIntroResenaActivo').checked,
    intro_resena_texto: valorBienvenida('apIntroResenaTexto').trim(),
    intro_horario_activo: campoBienvenida('apIntroHorarioActivo').checked, intro_correo_activo: campoBienvenida('apIntroCorreoActivo').checked,
    intro_reservas_activo: campoBienvenida('apIntroReservasActivo').checked, intro_reservas_texto: valorBienvenida('apIntroReservasTexto').trim(),
    intro_social_icono_color: valorBienvenida('apIntroSocialIconoColor'), intro_social_fondo: valorBienvenida('apIntroSocialFondo'),
    intro_social_borde: valorBienvenida('apIntroSocialBorde'), intro_social_tamano: Number(valorBienvenida('apIntroSocialTamano')),
    intro_mapa_activo: campoBienvenida('apIntroMapaActivo').checked, intro_mapa_modo: valorBienvenida('apIntroMapaModo'),
    intro_mapa_boton_fondo: valorBienvenida('apIntroMapaBotonFondo'), intro_mapa_boton_color: valorBienvenida('apIntroMapaBotonColor'), intro_mapa_boton_fuente: valorBienvenida('apIntroMapaBotonFuente')
  };
}

function aplicarTextoPrevisualizacion(tipo, contenido) {
  const nombres = { nombre: 'apIntroPreviewNombre', eslogan: 'apIntroPreviewEslogan', adicional: 'apIntroPreviewExtra', cta: 'apIntroPreviewCta', direccion: 'apIntroPreviewDireccion', horario: 'apIntroPreviewHorario', correo: 'apIntroPreviewCorreo' };
  // El horario y el correo se leen con el estilo de texto de la dirección: son la misma clase de línea.
  const estilo = tipo === 'horario' || tipo === 'correo' ? 'direccion' : tipo;
  const el = campoBienvenida(nombres[tipo]); const datos = recolectarTextosBienvenida()[estilo] || {};
  if (!el) return;
  if (tipo === 'cta') el.textContent = contenido || 'Ver carta'; else el.textContent = contenido;
  el.style.color = datos.color || '#ffffff'; el.style.fontFamily = datos.fuente ? `'${datos.fuente}', Montserrat, sans-serif` : 'Montserrat, sans-serif';
  el.style.fontWeight = datos.peso || ''; el.style.fontSize = `${datos.tamano || (tipo === 'nombre' ? 30 : 16)}px`; el.style.textAlign = datos.alineacion || 'center';
  if (tipo === 'cta') { el.style.background = datos.color || '#ffffff'; el.style.color = datos.color_texto || '#15100b'; }
}

function actualizarVistaPreviaBienvenida() {
  // Lo del negocio (dirección, mapa, reseñas) se escribe en Ajustes: esta vista lo toma de lo guardado.
  const datos = { ...valoresBienvenida(), ...datosDelNegocioParaLaVista() }; const preview = campoBienvenida('apIntroPreview');
  const overlay = campoBienvenida('apIntroPreviewOverlay'); const content = campoBienvenida('apIntroPreviewContent');
  if (!preview || !overlay || !content) return;
  preview.style.backgroundColor = datos.intro_fondo_color; preview.style.backgroundImage = datos.intro_fondo_url ? `url("${datos.intro_fondo_url}")` : 'none';
  preview.style.backgroundSize = datos.intro_imagen_ajuste === 'contain' ? 'contain' : datos.intro_imagen_ajuste === 'center' ? 'auto' : 'cover';
  preview.style.backgroundPosition = 'center'; preview.style.backgroundRepeat = datos.intro_imagen_ajuste === 'center' ? 'no-repeat' : 'no-repeat';
  overlay.style.background = datos.intro_overlay_color; overlay.style.opacity = datos.intro_overlay_activo ? String(datos.intro_overlay_opacidad / 100) : '0';
  campoBienvenida('apIntroOverlayControles').hidden = !datos.intro_overlay_activo;
  campoBienvenida('apIntroMapaBotonControles').hidden = datos.intro_mapa_modo === 'mapa';
  content.style.background = datos.intro_tarjeta_fondo; content.style.border = `${datos.intro_tarjeta_borde_grosor}px solid ${datos.intro_tarjeta_borde}`;
  campoBienvenida('apIntroOverlayOpacidadValor').textContent = `${datos.intro_overlay_opacidad}%`;
  campoBienvenida('apIntroTarjetaBordeGrosorValor').textContent = `${datos.intro_tarjeta_borde_grosor} px`;
  campoBienvenida('apIntroSocialTamanoValor').textContent = `${datos.intro_social_tamano} px`;
  const r = state.restaurante || {}; aplicarTextoPrevisualizacion('nombre', datos.intro_nombre || r.nombre || 'Tu restaurante');
  aplicarTextoPrevisualizacion('eslogan', datos.intro_eslogan || 'Hecho con cariño'); aplicarTextoPrevisualizacion('adicional', datos.intro_texto_adicional);
  aplicarTextoPrevisualizacion('cta', datos.intro_cta); aplicarTextoPrevisualizacion('direccion', datos.direccion);
  aplicarTextoPrevisualizacion('horario', datos.intro_horario_activo ? datos.horario_texto : '');
  aplicarTextoPrevisualizacion('correo', datos.intro_correo_activo && datos.correo ? `✉ ${datos.correo}` : ''); const logo = campoBienvenida('apIntroPreviewLogo');
  logo.replaceChildren();
  if (r.logo_url) {
    const imagenLogo = document.createElement('img');
    imagenLogo.src = r.logo_url; imagenLogo.alt = '';
    logo.appendChild(imagenLogo);
  } else logo.textContent = 'VM';
  const social = campoBienvenida('apIntroPreviewSocial'); const at = r.atributos || {};
  // El botón de reseñas se ve en la vista previa solo si saldría en la carta: encendido y con enlace.
  const resena = campoBienvenida('apIntroPreviewResena');
  // El de reservas sale con solo estar encendido: no necesita ningún enlace.
  const reservas = campoBienvenida('apIntroPreviewReservas');
  if (reservas) { reservas.hidden = !datos.intro_reservas_activo; reservas.textContent = datos.intro_reservas_texto || 'Reservar mesa'; }
  if (resena) { resena.hidden = !(datos.intro_resena_activo && /^https?:\/\//i.test(datos.intro_resena_url)); resena.textContent = `★ ${datos.intro_resena_texto || 'Califícanos en Google'}`; }
  const redes = [datos.intro_social_instagram && at.social_instagram ? '◎' : '', datos.intro_social_facebook && at.social_facebook ? 'f' : '', datos.intro_social_tiktok && at.social_tiktok ? '♪' : ''].filter(Boolean);
  social.textContent = redes.join('  '); social.style.display = redes.length ? '' : 'none'; social.style.color = datos.intro_social_icono_color; social.style.background = datos.intro_social_fondo;
  social.style.border = `1px solid ${datos.intro_social_borde}`; social.style.fontSize = `${Math.round(datos.intro_social_tamano * .45)}px`; social.style.padding = `7px ${datos.intro_social_estilo === 'pildora' ? 14 : 9}px`;
  social.style.borderRadius = datos.intro_social_estilo === 'circular' ? '999px' : datos.intro_social_estilo === 'redondeado' ? '10px' : '999px';
  const mapa = campoBienvenida('apIntroPreviewMapa'); mapa.replaceChildren();
  if (datos.intro_mapa_activo && datos.intro_mapa_url) {
    if (datos.intro_mapa_modo !== 'boton') {
      const fuente = fuenteMapaBienvenida(datos.intro_mapa_url);
      if (fuente) { const iframe = document.createElement('iframe'); iframe.title = 'Vista previa de ubicación'; iframe.loading = 'lazy'; iframe.src = fuente; mapa.appendChild(iframe); }
      else resolverFuenteMapaBienvenida(datos.intro_mapa_url).then(resuelta => {
        if (!resuelta || mapaDelNegocio(state.restaurante?.atributos) !== datos.intro_mapa_url) return;
        const iframe = document.createElement('iframe'); iframe.title = 'Vista previa de ubicación'; iframe.loading = 'lazy'; iframe.src = resuelta;
        const boton = mapa.querySelector('span'); if (boton) boton.before(iframe); else mapa.appendChild(iframe);
      });
    }
    if (datos.intro_mapa_modo !== 'mapa') { const boton = document.createElement('span'); boton.textContent = 'Ver ubicación'; boton.style.background = datos.intro_mapa_boton_fondo; boton.style.color = datos.intro_mapa_boton_color; boton.style.fontFamily = datos.intro_mapa_boton_fuente ? `'${datos.intro_mapa_boton_fuente}', Montserrat, sans-serif` : 'Montserrat, sans-serif'; mapa.appendChild(boton); }
  }
  actualizarResumenesBienvenida();
}

function renderBienvenida(at = {}) {
  const datos = { ...VALORES_BIENVENIDA, ...at }; pintarControlesTextoBienvenida(datos.intro_textos || {});
  const poner = (id, valor) => { const el = campoBienvenida(id); if (el) el.value = valor ?? ''; };
  const marcar = (id, valor) => { const el = campoBienvenida(id); if (el) el.checked = !!valor; };
  marcar('apIntroActivo', datos.intro_activo); poner('apIntroNombre', datos.intro_nombre || state.restaurante?.nombre); poner('apIntroEslogan', datos.intro_eslogan); poner('apIntroTextoAdicional', datos.intro_texto_adicional); poner('apIntroCta', datos.intro_cta);
  poner('apIntroFondoColor', datos.intro_fondo_color); poner('apIntroFondoColorHex', datos.intro_fondo_color); marcar('apIntroOverlayActivo', datos.intro_overlay_activo); poner('apIntroOverlayColor', datos.intro_overlay_color); poner('apIntroOverlayColorHex', datos.intro_overlay_color); poner('apIntroOverlayOpacidad', datos.intro_overlay_opacidad); poner('apIntroImagenAjuste', datos.intro_imagen_ajuste);
  poner('apIntroTarjetaFondo', datos.intro_tarjeta_fondo); poner('apIntroTarjetaBorde', datos.intro_tarjeta_borde); poner('apIntroTarjetaBordeGrosor', datos.intro_tarjeta_borde_grosor);
  marcar('apIntroSocialInstagram', datos.intro_social_instagram); marcar('apIntroSocialFacebook', datos.intro_social_facebook); marcar('apIntroSocialTiktok', datos.intro_social_tiktok);
  marcar('apIntroHorarioActivo', datos.intro_horario_activo !== false); marcar('apIntroCorreoActivo', datos.intro_correo_activo !== false);
  marcar('apIntroReservasActivo', datos.intro_reservas_activo); poner('apIntroReservasTexto', datos.intro_reservas_texto);
  marcar('apIntroResenaActivo', datos.intro_resena_activo); poner('apIntroResenaTexto', datos.intro_resena_texto); poner('apIntroSocialEstilo', datos.intro_social_estilo); poner('apIntroSocialIconoColor', datos.intro_social_icono_color); poner('apIntroSocialFondo', datos.intro_social_fondo); poner('apIntroSocialBorde', datos.intro_social_borde); poner('apIntroSocialTamano', datos.intro_social_tamano);
  marcar('apIntroMapaActivo', datos.intro_mapa_activo); poner('apIntroMapaModo', datos.intro_mapa_modo); poner('apIntroMapaBotonFondo', datos.intro_mapa_boton_fondo); poner('apIntroMapaBotonColor', datos.intro_mapa_boton_color); poner('apIntroMapaBotonFuente', datos.intro_mapa_boton_fuente);
  const fuentesMapa = campoBienvenida('apIntroMapaBotonFuente'); if (fuentesMapa && !fuentesMapa.options.length) fuentesMapa.innerHTML = (typeof FUENTES_TEXTO_MENU !== 'undefined' ? FUENTES_TEXTO_MENU : ['', 'Montserrat', 'Inter', 'Poppins']).map(f => `<option value="${f}">${f || 'Montserrat (predeterminada)'}</option>`).join(''); poner('apIntroMapaBotonFuente', datos.intro_mapa_boton_fuente);
  const imagen = campoBienvenida('apIntroImagenPreview'); imagen.dataset.url = datos.intro_fondo_url || ''; imagen.hidden = !datos.intro_fondo_url; if (datos.intro_fondo_url) imagen.src = datos.intro_fondo_url;
  campoBienvenida('apIntroImagenVacia').hidden = !!datos.intro_fondo_url; campoBienvenida('apIntroImagenEliminar').hidden = !datos.intro_fondo_url;
  const redes = state.restaurante?.atributos || {}; campoBienvenida('apIntroEstadoInstagram').textContent = redes.social_instagram ? 'Instagram · enlace configurado' : 'Instagram · agrega el enlace en Ajustes';
  campoBienvenida('apIntroEstadoFacebook').textContent = redes.social_facebook ? 'Facebook · enlace configurado' : 'Facebook · agrega el enlace en Ajustes';
  campoBienvenida('apIntroEstadoTiktok').textContent = redes.social_tiktok ? 'TikTok · enlace configurado' : 'TikTok · agrega el enlace en Ajustes'; pintarDatosEnBienvenida(); ajustarInterruptoresBienvenida(); actualizarVistaPreviaBienvenida();
}

async function subirFondoBienvenida(input) {
  const file = input.files?.[0]; if (!file) return;
  try { const blob = await compressImage(file, 1600, .85); const url = await uploadImg(blob, 'fondos'); const imagen = campoBienvenida('apIntroImagenPreview'); imagen.src = url; imagen.dataset.url = url; imagen.hidden = false; campoBienvenida('apIntroImagenVacia').hidden = true; campoBienvenida('apIntroImagenEliminar').hidden = false; actualizarVistaPreviaBienvenida(); showToast('Imagen de bienvenida lista para guardar', 'success'); }
  catch (error) { showToast(error.message || 'No se pudo subir la imagen', 'error'); }
  finally { input.value = ''; }
}

function quitarFondoBienvenida() { const imagen = campoBienvenida('apIntroImagenPreview'); imagen.dataset.url = ''; imagen.removeAttribute('src'); imagen.hidden = true; campoBienvenida('apIntroImagenVacia').hidden = false; campoBienvenida('apIntroImagenEliminar').hidden = true; actualizarVistaPreviaBienvenida(); }

function restaurarBienvenida() { renderBienvenida({ ...VALORES_BIENVENIDA, intro_activo: campoBienvenida('apIntroActivo').checked }); showToast('Restauramos los valores de bienvenida; guarda para aplicarlos', 'success'); }
