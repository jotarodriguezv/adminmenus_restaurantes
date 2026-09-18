// ── «GUARDADO» CON UN ENLACE A LA CARTA ───────────────────────
// Pedido el 18/09/2026: tras guardar, el aviso de abajo a la derecha decía
// «Producto guardado» y ahí se quedaba. Lo siguiente que hace casi todo el mundo
// es ir a mirar cómo quedó, y para eso había que buscar la dirección de su carta.
// Ahora el mismo aviso trae un botón que la abre en otra pestaña.
//
// Solo lo lleva lo que ya se ve en la carta al guardarlo. Un destacado en
// borrador, una foto que todavía está en el formulario sin guardar o un aviso
// que pide hacer algo más antes («falta el número de WhatsApp») no lo llevan:
// el botón prometería un cambio que al abrir la carta no está.
//
// La carta lee la base de datos al cargar y el HTML va sin caché en Cloudflare,
// así que lo guardado se ve al abrirla, sin esperar.

// Dura más que los 3 s del aviso normal: hay que leerlo y llegar al botón.
const VER_CARTA_DURACION_MS = 7000;

// A dónde lleva el botón. null cuando no hay a dónde: sin restaurante cargado,
// o uno suspendido, cuya carta enseña «no disponible» y no el cambio.
function destinoVerCarta(restaurante, pantalla = 'carta') {
  if (!restaurante || !restaurante.slug || restaurante.activo === false) return null;
  const base = urlPublica(restaurante);
  return pantalla === 'tv' ? base + '/tv' : base;
}

function avisarGuardadoConCarta(msg, pantalla = 'carta') {
  const url = destinoVerCarta(state.restaurante, pantalla);
  if (!url) return showToast(msg, 'success');
  showToast(msg, 'success', {
    texto: pantalla === 'tv' ? 'Ver la pantalla ↗' : 'Ver en tu carta ↗',
    // noopener: la carta no necesita tocar esta pestaña, y así no puede.
    alPulsar: () => window.open(url, '_blank', 'noopener'),
    duracionMs: VER_CARTA_DURACION_MS,
  });
}

// Un destacado se ve donde se publicó, y en borrador en ningún sitio.
function pantallaDelDestacado(promo) {
  if (!promo || !promo.activa) return null;
  if (promo.en_popup) return 'carta';
  if (promo.en_tv) return 'tv';
  return null;
}
