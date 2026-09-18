// ── NO RECARGAR CON UN VIDEO SUBIENDO ─────────────────────────
// Desde el 18/09/2026 la ficha del plato no se cierra mientras sube un video
// (ver intentarCerrarProducto en index.html). Pero recargar o cerrar la
// página no pasa por la ficha, y eso SÍ corta la subida, que vive en esta
// pestaña.
//
// Ahí no cabe la ventana del panel: el navegador solo deja pedir su propio
// aviso, y con su texto. Solo mientras sube; convirtiendo, recargar no rompe nada.
window.addEventListener('beforeunload', e => {
	if (!state.subiendoVideo) return;
	e.preventDefault();
	e.returnValue = '';
});
