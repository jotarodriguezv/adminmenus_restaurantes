// La pestaña Apariencia: lo puramente visual de la carta (logo, colores,
// paleta, imagen de fondo y su color, modelo de página y tipografía), que el
// propio restaurante configura aparte de Ajustes.
//
// Nació el 27/09/2026, separada de Ajustes: los cuatro incrementos de "abrir
// partes de Apariencia al restaurante" (CLAUDE.md) se habían ido sumando ahí
// —logo, colores, modelo, tipografía— y, al verlos junto al carrito, el
// buscador, los filtros y las redes, la propia clienta que probó los cuatro
// propuso separarlos: son preguntas de naturaleza distinta ("¿qué hace mi
// carta?" contra "¿cómo se ve?").
//
// Por dentro es su propia pestaña ('aspecto'), no 'apariencia': ese nombre ya
// lo usa la pestaña de solo superadmin (Plan, dominio, zona horaria, importar
// carta, CSS personalizado) — llamar igual por dentro a dos cosas distintas
// es la clase de confusión que un día hace que alguien edite la que no era.
// Los ids de los CAMPOS sí siguen con el prefijo 'ap' (apColor1, apPaletas,
// apNavModelo…): son los mismos de siempre, desde que vivían en la pestaña de
// solo superadmin, y public/paletas.js no sabe ni le importa de qué pestaña
// son — moverlos de pestaña dos veces no es motivo para renombrarlos.
//
// Se carga con un <script> clásico antes del script principal, como
// ajustes.js: no se puede repetir aquí un nombre que ya exista en otro
// archivo del panel. compressImage, uploadImg, apiFetch, eliminarImagen,
// avisarGuardadoConCarta, hex6, navElegido, estiloElegido,
// ajustarEstiloAlModelo, previsualizarFuente, aplicarPlanAlPanel y
// renderPaletas viven en index.html o en paletas.js: se llaman solo dentro de
// manejadores que se disparan después de que todo terminó de cargar, así que
// el orden de los <script> no es un problema.

function renderAspecto() {
  const r = state.restaurante;
  const at = r?.atributos || {};
  pintarLogo();
  pintarFondo();
  pintarColores(r, at);
  pintarModeloYTipografia(at);
  // Las pruebas unitarias de Apariencia cargan este archivo solo; en el panel
  // real bienvenida.js completa los controles y la vista previa.
  document.getElementById('apIntroActivo').checked = !!at.intro_activo;
  document.getElementById('apIntroEslogan').value = at.intro_eslogan || '';
  if (typeof renderBienvenida === 'function') renderBienvenida(at);
  const st = document.getElementById('aspectoStatus');
  st.textContent = ''; st.style.color = 'var(--text-muted)';
}

function recolectarAspecto() {
  const valor = id => document.getElementById(id).value.trim();
  return {
    color_primario: valor('apColor1'),
    color_secundario: valor('apColor2'),
    color_surface: valor('apColorSurface'),
    color_card: valor('apColorCard'),
    fondo_tipo: document.getElementById('apFondoTipo').value,
    fondo_color: valor('apFondoColor') || '#0a0a0f',
    fondo_intensidad: document.getElementById('apFondoIntensidad').value,
    fuente_titulo: valor('apFuenteTitulo'),
    fuente_cuerpo: valor('apFuenteCuerpo'),
    // Las pruebas de esta pestaña pueden cargarla aislada; en el panel real
    // la función vive en index.html y siempre está disponible antes de guardar.
    ...(typeof recolectarTipografiaMenu === 'function'
      ? { texto_menu: recolectarTipografiaMenu() }
      : {}),
    nav: navElegido(),
    estilo: estiloElegido(),
    subtitulo: valor('apSubtitulo'),
    mostrar_hero: document.getElementById('apMostrarHero').checked,
    ...(typeof valoresBienvenida === 'function' ? valoresBienvenida() : {
      intro_activo: document.getElementById('apIntroActivo').checked,
      intro_eslogan: valor('apIntroEslogan'),
    }),
  };
}

async function saveAspecto() {
  const st = document.getElementById('aspectoStatus');
  st.textContent = 'Guardando…'; st.style.color = 'var(--text-muted)';
  try {
    // color_primario y color_secundario son columnas propias de la tabla, no
    // claves de atributos (como logo_url): se sacan del mismo recolector para
    // no repetir la lógica de qué campo lee cada uno.
    const { color_primario, color_secundario, ...atributos } = recolectarAspecto();
    // Solo sus claves: el servidor funde con lo que ya hay y no toca el resto.
    const data = await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`,
      { color_primario, color_secundario, atributos });
    if (!data) return;   // sesión caducada: apiFetch ya llevó al login
    state.restaurante = data;
    renderAspecto();
    fijarFotoDePestana('aspecto');
    // Si el modelo cambió, refresca qué opciones quedan deshabilitadas y su
    // etiqueta — la misma llamada que hace saveApariencia() al guardar.
    aplicarPlanAlPanel();
    // Las reservas (01/10/2026) tienen pestaña según el interruptor de la bienvenida,
    // que se guarda aquí: sin esto la pestaña no aparecía hasta recargar el panel.
    ajustarPestanasAlModelo();
    st.textContent = '✓ Guardado'; st.style.color = 'var(--success)';
    avisarGuardadoConCarta('Apariencia guardada');
  } catch (e) {
    // El motivo lo escribe el servidor para quien lo lee.
    st.textContent = e.message; st.style.color = 'var(--danger)';
    showToast(e.message, 'error');
  }
}

// ── LOGO ──────────────────────────────────────────────────────
function pintarLogo() {
  const url = state.restaurante?.logo_url;
  const prev = document.getElementById('apLogoPreview');
  const none = document.getElementById('apLogoNone');
  const borrar = document.getElementById('apLogoDelBtn');
  if (!prev || !none || !borrar) return;   // pestaña Apariencia no está en el DOM (pruebas parciales)
  if (url) { prev.src = url; prev.style.display = 'block'; none.style.display = 'none'; }
  else { prev.style.display = 'none'; none.style.display = 'block'; }
  borrar.style.display = url ? 'inline-block' : 'none';
}

async function handleLogoUpload(input) {
  const file = input.files[0]; if (!file) return;
  const st = document.getElementById('apLogoUploadStatus');
  st.textContent = 'Subiendo...'; st.style.color = 'var(--text-muted)';
  try {
    // El único que conserva PNG: un logo con fondo transparente es lo normal.
    // quitarFondo intenta reconocer un fondo de color sólido y volverlo
    // transparente cuando el archivo no trae transparencia real (ver el
    // comentario de quitarFondoDelLogo, en index.html).
    const blob = await compressImage(file, 500, .9, { conservarTransparencia: true, quitarFondo: true });
    const url = await uploadImg(blob, 'logos');
    await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`, { logo_url: url });
    state.restaurante.logo_url = url; pintarLogo();
    // Aparece «De tu logo» en Colores, aquí mismo, con los colores del logo nuevo.
    renderPaletas();
    st.textContent = blob.fondoAutoQuitado
      ? '✓ Logo actualizado · le quitamos el fondo automáticamente. Revísalo: si el resultado no queda bien, sube uno con fondo transparente'
      : '✓ Logo actualizado';
    st.style.color = 'var(--success)';
    avisarGuardadoConCarta('Logo guardado');
  } catch (e) { st.textContent = e.message || 'Error al subir'; st.style.color = 'var(--danger)'; }
}

// ── IMAGEN DE FONDO ───────────────────────────────────────────
// Se mudó de la pestaña de solo superadmin el 27/09/2026, junto con su color
// e intensidad, que ya vivían aquí (ver «COLORES Y PALETA» más abajo): quedar
// partida entre dos pestañas no tenía sentido, era la misma decisión —cómo se
// ve el fondo de la carta— repartida en dos sitios.
function pintarFondo() {
  const url = state.restaurante?.fondo_url;
  const prev = document.getElementById('apFondoPreview');
  const none = document.getElementById('apFondoNone');
  const borrar = document.getElementById('apFondoDelBtn');
  if (!prev || !none || !borrar) return;   // pestaña Apariencia no está en el DOM (pruebas parciales)
  if (url) { prev.src = url; prev.style.display = 'block'; none.style.display = 'none'; }
  else { prev.style.display = 'none'; none.style.display = 'block'; }
  borrar.style.display = url ? 'inline-block' : 'none';
}

async function handleFondoUpload(input) {
  const file = input.files[0]; if (!file) return;
  const st = document.getElementById('apFondoUploadStatus');
  st.textContent = 'Subiendo...'; st.style.color = 'var(--text-muted)';
  try {
    const blob = await compressImage(file, 1600, .85);
    const url = await uploadImg(blob, 'fondos');
    await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`, { fondo_url: url });
    state.restaurante.fondo_url = url; pintarFondo();
    st.textContent = '✓ Fondo actualizado'; st.style.color = 'var(--success)';
    avisarGuardadoConCarta('Fondo guardado');
  } catch (e) { st.textContent = e.message || 'Error al subir'; st.style.color = 'var(--danger)'; }
}

// ── COLORES Y PALETA ──────────────────────────────────────────
// El color de fondo (fondo_color/fondo_intensidad) viaja con las paletas
// porque aplicarPaleta() los pone los cinco a la vez (paletas.js,
// CAMPOS_PALETA). La imagen de fondo y su estilo (cubrir/repetir) están
// justo arriba, en su propia tarjeta.
function pintarColores(r, at) {
  const c1 = document.getElementById('apColor1');
  if (!c1) return;   // pestaña Apariencia no está en el DOM (pruebas parciales)
  c1.value = r?.color_primario || '';
  document.getElementById('apPrevColor1').value = hex6(r?.color_primario, '#3dd68c');
  document.getElementById('apColor2').value = r?.color_secundario || '';
  document.getElementById('apPrevColor2').value = hex6(r?.color_secundario, '#a374af');
  document.getElementById('apColorSurface').value = at.color_surface || '';
  document.getElementById('apPrevColorSurface').value = hex6(at.color_surface, '#12111a');
  document.getElementById('apColorCard').value = at.color_card || '';
  document.getElementById('apPrevColorCard').value = hex6(at.color_card, '#1a1825');
  document.getElementById('apFondoColor').value = at.fondo_color || '#0a0a0f';
  document.getElementById('apPrevFondoColor').value = hex6(at.fondo_color, '#0a0a0f');
  document.getElementById('apFondoIntensidad').value = at.fondo_intensidad || 'solido';
  // Después de llenar los colores: marca la paleta que coincida con ellos.
  renderPaletas();
}

// ── MODELO DE PÁGINA Y TIPOGRAFÍA ──────────────────────────────
function pintarModeloYTipografia(at) {
  const nav = document.getElementById('apNavModelo');
  if (!nav) return;   // pestaña Apariencia no está en el DOM (pruebas parciales)
  nav.value = at.nav || 'topnav';
  pintarOpcionesModelo();
  document.getElementById('apEstilo').value = at.estilo || 'clasico';
  ajustarEstiloAlModelo();
  document.getElementById('apSubtitulo').value = at.subtitulo || '';
  document.getElementById('apMostrarHero').checked = !!at.mostrar_hero;

  document.getElementById('apFuenteTitulo').value = at.fuente_titulo || '';
  document.getElementById('apFuenteCuerpo').value = at.fuente_cuerpo || '';
  // Al abrir, no solo al cambiar: lo primero que se quiere saber al entrar en
  // Apariencia es cómo se ve lo que ya está puesto.
  previsualizarFuente('titulo');
  previsualizarFuente('cuerpo');
  if (typeof renderTipografiaMenu === 'function') renderTipografiaMenu(at.texto_menu || {});

  pintarNotaModelo();
  pintarVistasPreviasModelo();
}

// Los identificadores técnicos (topnav, sidebar…) sirven al código, no a quien
// monta una carta. Estas tarjetas son la interfaz: muestran una maqueta de
// cada forma y solo dejan a la vista los modelos que el plan actual permite.
// El select oculto se conserva como única fuente del valor que guardamos.
function pintarOpcionesModelo() {
  const selector = document.getElementById('apNavModelo');
  const tarjetas = document.querySelectorAll?.('[data-modelo]') || [];
  if (!selector || !tarjetas.length) return;
  const plan = planActual();
  const permitidos = plan?.modelos || [];
  const bloqueado = selector.disabled;
  tarjetas.forEach(tarjeta => {
    const modelo = tarjeta.dataset.modelo;
    const disponible = permitidos.includes(modelo);
    tarjeta.hidden = !disponible;
    tarjeta.disabled = bloqueado || !disponible;
    const elegido = selector.value === modelo;
    tarjeta.classList.toggle('seleccionado', elegido);
    tarjeta.setAttribute('aria-checked', String(elegido));
  });
}

function seleccionarModeloPagina(modelo) {
  const selector = document.getElementById('apNavModelo');
  const plan = planActual();
  if (!selector || selector.disabled || !plan?.modelos?.includes(modelo)) return;
  selector.value = modelo;
  ajustarEstiloAlModelo();
  pintarOpcionesModelo();
}

// No son dibujos aproximados: cada tarjeta carga la carta pública real con
// el mismo menú, logo y colores, cambiando únicamente la navegación dentro
// del parámetro de vista previa. La URL de ruta funciona también cuando el
// restaurante tiene como dirección oficial un subdominio aún sin configurar.
function pintarVistasPreviasModelo() {
  const tarjetas = document.querySelectorAll?.('[data-modelo]') || [];
  if (!tarjetas.length || typeof urlPublica !== 'function') return;
  const { color_primario, color_secundario, ...atributos } = recolectarAspecto();
  tarjetas.forEach(tarjeta => {
    // No cargamos en segundo plano los modelos que este plan ni siquiera puede
    // mostrar. Además de respetar el límite Fotos/Video, evita dos cartas
    // públicas innecesarias al abrir esta pestaña.
    if (tarjeta.hidden) return;
    const marco = tarjeta.querySelector?.('iframe');
    if (!marco) return;
    const vista = { color_primario, color_secundario, atributos: { ...atributos, nav: tarjeta.dataset.modelo } };
    const url = `${urlPublica(state.restaurante, 'ruta')}?preview=${encodeURIComponent(JSON.stringify(vista))}`;
    if (marco.dataset.vista !== url) { marco.src = url; marco.dataset.vista = url; }
  });
}

// Por qué el modelo está bloqueado: solo aplica a un restaurante de video,
// y solo si quien mira no es el superadmin. aplicarPlanAlPanel() (en
// index.html) ya deshabilita las opciones que tocan; esto nombra el motivo,
// porque un <select> con casi todo gris y sin explicación parece roto.
function pintarNotaModelo() {
  const nota = document.getElementById('apNavModeloNota');
  if (!nota) return;
  const bloqueado = state.rol !== 'admin' && planActual().videos;
  nota.style.display = bloqueado ? 'block' : 'none';
  if (bloqueado) nota.textContent = 'El modelo de tu carta en video lo cambia tu asesor: '
    + 'cruzar entre horizontal y vertical necesita volver a procesar los videos que ya subiste.';
}
