// Acceso rápido global: comparte destinos con Inicio pero no depende de que
// esa pestaña esté visible. Solo se muestra dentro de una carta seleccionada.
let accesoRapidoAbierto = false;

function islaAccesoRapido() {
  return document.getElementById('quickAccess');
}

function hayModalAbierto() {
  return !!document.querySelector('.modal-bg.open');
}

function actualizarVisibilidadAccesoRapido() {
  const isla = islaAccesoRapido();
  if (!isla) return;
  const dentroDeCarta = !!state?.restaurante && document.getElementById('appScreen')?.style.display !== 'none';
  isla.hidden = !dentroDeCarta;
  isla.classList.toggle('quick-access-modal-open', hayModalAbierto());
  if (!dentroDeCarta || hayModalAbierto()) cerrarAccesoRapido();
}

function abrirAccesoRapido() {
  const isla = islaAccesoRapido();
  if (!isla || isla.hidden || hayModalAbierto()) return;
  accesoRapidoAbierto = true;
  isla.classList.add('is-open');
  isla.querySelector('#quickAccessToggle')?.setAttribute('aria-expanded', 'true');
  isla.querySelector('#quickAccessPanel')?.setAttribute('aria-hidden', 'false');
}

function cerrarAccesoRapido() {
  const isla = islaAccesoRapido();
  if (!isla) return;
  accesoRapidoAbierto = false;
  isla.classList.remove('is-open');
  isla.querySelector('#quickAccessToggle')?.setAttribute('aria-expanded', 'false');
  isla.querySelector('#quickAccessPanel')?.setAttribute('aria-hidden', 'true');
}

function alternarAccesoRapido() {
  if (accesoRapidoAbierto) cerrarAccesoRapido();
  else abrirAccesoRapido();
}

function navegarDesdeAccesoRapido(tab) {
  // Reutiliza el mismo flujo de Inicio, incluidos sus nombres de botones y
  // las protecciones que switchTab() ya hace para cambios sin guardar.
  if (typeof abrirDesdeInicio === 'function') abrirDesdeInicio(tab);
  cerrarAccesoRapido();
}

function abrirMenuDesdeAccesoRapido() {
  const restaurante = state?.restaurante;
  const url = restaurante && typeof urlPublica === 'function' ? urlPublica(restaurante) : '';
  if (!url) return showToast('No se pudo encontrar la URL pública de esta carta', 'error');
  window.open(url, '_blank', 'noopener,noreferrer');
  cerrarAccesoRapido();
}

function iniciarAccesoRapido() {
  const isla = islaAccesoRapido();
  if (!isla) return;
  isla.querySelector('#quickAccessToggle')?.addEventListener('click', alternarAccesoRapido);
  isla.querySelector('[data-quick-action="menu"]')?.addEventListener('click', abrirMenuDesdeAccesoRapido);
  isla.querySelectorAll('[data-quick-tab]').forEach(boton => {
    boton.addEventListener('click', () => navegarDesdeAccesoRapido(boton.dataset.quickTab));
  });
  document.addEventListener('pointerdown', evento => {
    if (accesoRapidoAbierto && !isla.contains(evento.target)) cerrarAccesoRapido();
  });
  document.addEventListener('keydown', evento => {
    if (evento.key === 'Escape' && accesoRapidoAbierto) cerrarAccesoRapido();
  });
  // Algunas ventanas antiguas abren su modal directamente con classList.
  // Observamos solo esos fondos para que la isla tampoco interfiera allí.
  new MutationObserver(registros => {
    if (registros.some(r => r.target.classList?.contains('modal-bg'))) actualizarVisibilidadAccesoRapido();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

iniciarAccesoRapido();
