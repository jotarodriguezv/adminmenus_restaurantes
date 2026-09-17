// La pestaña Ajustes: lo que el propio restaurante configura de su carta.
//
// El 16/09/2026 se le sumó lo que era la pestaña «Pedidos» —el número de
// WhatsApp y los métodos de pago—, decidido con el usuario: encender el carrito
// hacía aparecer dos pestañas nuevas sin que nadie lo explicara, y «Pedidos»
// daba a entender que ahí se VEN los pedidos. Todo esto escribe en
// restaurantes.atributos, así que va en una sola petición y con un solo botón.
//
// Nació el 15/09/2026 con las redes sociales y, el mismo día, los filtros y
// etiquetas y el interruptor del carrito: las tres cosas estaban en Apariencia,
// solo para el superadmin. Es abrir partes de Apariencia al restaurante
// (CLAUDE.md, «Decisión: abrir partes de Apariencia al restaurante»).
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
// Un solo botón para todas las secciones: son del mismo formulario y del mismo
// PATCH, y varios botones harían creer que guardar uno guarda también los otros.
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
  // Sin el dato, encendido si ya hay filtros elegidos. Es como lo lee la carta
  // —ausente es encendido, core/filtros.js— y así quien los configuró antes de
  // que existiera el interruptor lo encuentra encendido, no apagado.
  //
  // Antes de pintar el catálogo, porque pintarlo repinta también la nota y esa
  // frase depende de si el interruptor está encendido.
  document.getElementById('ajFiltros').checked = at.filtros_activos ?? state.filtrosDisponibles.length > 0;
  renderFiltrosCatalogo();
  // Ausente es encendido, igual que en la carta: nadie tiene que ir a
  // encenderlo para tenerlo, y apagarlo es una decisión de quien lo apaga.
  document.getElementById('ajBuscador').checked = at.buscador !== false;
  pintarNotaBuscador();
  document.getElementById('ajCarrito').checked = !!at.carrito;
  // Los campos de pedidos se rellenan siempre, estén a la vista o no: enseñarlos
  // es cosa de pintarPedidos(), y rellenarlos al enseñarlos borraría lo que
  // alguien hubiera escrito antes de apagar y volver a encender el interruptor.
  renderPedidos();
  renderMetodosPago();
  // Los errores marcados son de lo que se intentó guardar antes; repintar trae
  // lo que hay en la base y esos avisos ya no hablan de nada.
  pintarErroresEnCampos([], CAMPOS_METODOS_PAGO);
  renderToppings();
  pintarNotaCarrito();
  const st = document.getElementById('ajustesStatus');
  st.textContent = ''; st.style.color = 'var(--text-muted)';
}

function recolectarAjustes() {
  const valor = id => document.getElementById(id).value.trim();
  // El carrito solo viaja si aquí se puede decidir. Mandarlo siempre apagaría el
  // de un restaurante cuyo interruptor está escondido: el servidor lo filtraría
  // por plan, pero no por modelo.
  const carrito = puedeElegirCarrito() ? { carrito: document.getElementById('ajCarrito').checked } : {};
  // El número y los pagos solo viajan si la carta va a tener carrito. Mandarlos
  // siempre metería un metodos_pago entero en restaurantes que no reciben
  // pedidos, con los campos vacíos que tiene la pantalla escondida.
  const pedidos = carritoEnPantalla() ? {
    whatsapp_pedidos: document.getElementById('pedidosWhatsapp').value.trim().replace(/[^0-9]/g, ''),
    metodos_pago: recolectarMetodosPago(),
  } : {};
  // Los toppings viajan mientras se estén enseñando. El catálogo lo lleva
  // toppingState, que es lo que las tarjetas cambian al añadir o borrar.
  const toppings = hayQueEnsenarToppings() ? {
    toppings_platino: toppingState.platino,
    toppings_premium: toppingState.premium,
    salsas:           toppingState.salsas,
  } : {};
  return {
    ...carrito,
    ...pedidos,
    ...toppings,
    // La lista viaja también con el interruptor apagado: apagar esconde, no
    // borra, y es lo que permite volver a encenderlo y encontrarlo todo igual.
    buscador: document.getElementById('ajBuscador').checked,
    filtros_activos: document.getElementById('ajFiltros').checked,
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
  // Antes de nada, lo que no se puede guardar a medias. Vive aquí y no en el
  // servidor por lo mismo que las demás comprobaciones de esta pantalla: es
  // para que el aviso sea inmediato y diga qué método es.
  if (carritoEnPantalla()) {
    const errores = erroresDeMetodosPago(recolectarMetodosPago());
    if (errores.length) {
      // Cada campo marcado y el foco en el primero; el aviso de arriba resume
      // por método, que es como se piensan («me falta lo de Nequi»).
      pintarErroresEnCampos(errores, CAMPOS_METODOS_PAGO);
      const faltan = metodosIncompletos(recolectarMetodosPago());
      const texto = errores.length === 1
        ? errores[0].mensaje
        : `Faltan datos de ${faltan.join(' y ')}`;
      st.textContent = texto; st.style.color = 'var(--danger)';
      showToast(texto, 'error');
      return;
    }
    pintarErroresEnCampos([], CAMPOS_METODOS_PAGO);
  }
  // Borrar un topping desengancha a los platos que lo ofrecen, y eso no se ve
  // desde aquí. Se pregunta antes de mandarlo, no después.
  //
  // Solo por lo que ESTE guardado quita. Al principio se preguntaba por
  // cualquier plato que apuntara a un topping inexistente, y un plato que se
  // quedó así de un borrado anterior hacía saltar la pregunta en CADA guardado
  // de Ajustes, aunque solo se cambiara una red social. En su pestaña de antes
  // no se notaba, porque ahí solo se guardaba al tocar toppings.
  if (hayQueEnsenarToppings()) {
    const huerfanos = toppingsQueSeQuitan();
    if (huerfanos.length && !confirm(
      'Estos platos ofrecen adicionales que van a dejar de existir con este cambio:\n\n' +
      huerfanos.slice(0, 10).join('\n') +
      (huerfanos.length > 10 ? `\n…y ${huerfanos.length - 10} plato(s) más` : '') +
      '\n\nSi lo que quieres es cambiarle el nombre a uno, no hace falta borrarlo: ' +
      'pulsa sobre él y edítalo, y los platos lo siguen solos.\n\n¿Guardar de todas formas?')) {
      st.textContent = ''; return;
    }
  }
  st.textContent = 'Guardando…'; st.style.color = 'var(--text-muted)';
  try {
    // Solo sus claves: el servidor funde con lo que ya hay y no toca el resto.
    const data = await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`,
      { atributos: recolectarAjustes() });
    if (!data) return;   // sesión caducada: apiFetch ya llevó al login
    state.restaurante = data;
    renderAjustes();
    fijarFotoDePestana('ajustes');
    // Encender el carrito hace aparecer las pestañas Pedidos y Toppings, y sin
    // repintarlas habría que recargar para llegar a poner el número.
    ajustarPestanasAlModelo();
    const faltaNumero = cartaTieneCarrito(data.atributos, planActual()) && !recibePedidos(data.atributos);
    st.textContent = faltaNumero ? '✓ Guardado · falta el número de WhatsApp para recibir los pedidos' : '✓ Guardado';
    st.style.color = faltaNumero ? 'var(--warn)' : 'var(--success)';
    showToast(faltaNumero ? 'Guardado. Ahora pon el número de WhatsApp al que llegan los pedidos' : 'Ajustes guardados',
              faltaNumero ? 'info' : 'success');
  } catch (e) {
    // El motivo lo escribe el servidor para quien lo lee: «El enlace de
    // Instagram tiene que empezar por https://», «Hay más de 40 filtros».
    st.textContent = e.message; st.style.color = 'var(--danger)';
    showToast(e.message, 'error');
  }
}

// ── BUSCADOR DE PLATOS ────────────────────────────────────────
// El interruptor de vmenus-app/core/buscador.js, puesto el 17/09/2026 con
// vmenus-app#36. Como los filtros: apagarlo no borra nada, solo quita la caja
// de búsqueda de la carta.
//
// ESTE NÚMERO ES ESPEJO de MINIMO_PLATOS_BUSCADOR en vmenus-app/core/buscador.js.
// Son dos aplicaciones desplegadas por separado y no pueden compartir el
// módulo, igual que PLANES o la lista de slugs reservados. Si cambia allí,
// cambia aquí — y desincronizarlo hace que el panel prometa un buscador que la
// carta no enseña, que es de los fallos que nadie sabe contar.
const MINIMO_PLATOS_BUSCADOR = 8;

// Aparte de la pantalla para poder probarla, como notaFiltros: son los estados
// que desde el panel se confunden con «lo encendí y no aparece».
function notaBuscador(encendido, platos) {
  if (!encendido) return ['Tu carta no enseña el buscador.', 'var(--text-muted)'];
  if (platos < MINIMO_PLATOS_BUSCADOR) return [
    `Tu carta tiene ${platos} plato${platos === 1 ? '' : 's'}: el buscador aparece a partir de ${MINIMO_PLATOS_BUSCADOR}. ` +
    'Una carta corta se lee de un vistazo y la caja le quitaría el sitio a un plato.',
    'var(--warn)'];
  return ['Tus clientes ven el buscador arriba, encima de la carta.', 'var(--success)'];
}

function pintarNotaBuscador() {
  const nota = document.getElementById('ajBuscadorNota');
  if (!nota) return;
  const [texto, color] = notaBuscador(
    document.getElementById('ajBuscador').checked, (state.productos || []).length);
  nota.textContent = texto;
  nota.style.color = color;
}

// ── FILTROS Y ETIQUETAS ───────────────────────────────────────
// El interruptor esconde la sección entera cuando está apagado: la lista de
// chips con todo por marcar no ayuda a decidir si se quieren filtros o no.
function pintarFiltros() {
  const encendido = document.getElementById('ajFiltros').checked;
  document.getElementById('ajFiltrosCuerpo').style.display = encendido ? '' : 'none';
  const nota = document.getElementById('ajFiltrosNota');
  const [texto, color] = notaFiltros(encendido, state.filtrosDisponibles.length, filtrosConPlato());
  nota.textContent = texto;
  nota.style.color = color;
}

// Cuántos de los filtros elegidos tiene al menos un plato. La carta solo pinta
// esos (core/filtros.js), así que es el número que explica lo que se ve.
function filtrosConPlato(lista = state.filtrosDisponibles, productos = state.productos) {
  const marcados = new Set();
  for (const p of productos || [])
    for (const id of p.atributos?.filtros || []) marcados.add(id);
  return lista.filter(f => marcados.has(f.id)).length;
}

// Aparte de la pantalla para poder probarla: son los tres estados que desde el
// panel se confunden con «los configuré y no funcionan».
function notaFiltros(encendido, elegidos, conPlato) {
  if (!encendido) return ['Tu carta no enseña filtros. Lo que elijas aquí se guarda aunque lo apagues.', 'var(--text-muted)'];
  if (!elegidos) return ['Todavía no has elegido ninguno, así que tu carta no enseña filtros.', 'var(--warn)'];
  if (!conPlato) return [
    elegidos === 1
      ? 'Elegiste un filtro, pero ningún plato lo cumple: en tu carta no aparece. Márcalo en la ficha de los platos que lo cumplan.'
      : `Elegiste ${elegidos} filtros, pero ningún plato los cumple: en tu carta no aparece ninguno. Márcalos en la ficha de cada plato.`,
    'var(--warn)'];
  if (conPlato < elegidos) return [
    `En tu carta se ven ${conPlato} de ${elegidos}: los demás no los cumple ningún plato todavía.`, 'var(--warn)'];
  return [elegidos === 1 ? 'Tu filtro se ve en la carta.' : `Tus ${elegidos} filtros se ven en la carta.`, 'var(--success)'];
}

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

  // Marcar o desmarcar un chip cambia lo que dice la nota, y los dos sitios que
  // tocan la lista acaban aquí.
  pintarFiltros();
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

// ── PEDIDOS DESDE LA CARTA ────────────────────────────────────
// El interruptor que antes estaba en Apariencia, solo para video y vertical.
// Desde el 15/09/2026 la carta también sabe pintar el carrito en topnav y sidebar
// (vmenus-app#28), y lo decide el propio restaurante.
//
// Se ofrece donde puede hacer algo: plan con pedidos y un modelo que lo tenga
// como opción (MODELOS_CARRITO_OPCIONAL, en index.html, la misma lista que usan
// los campos de pedidos y los avisos). En el resto la tarjeta dice por qué no, en vez
// de desaparecer: quien viene a buscar el carrito tiene que saber qué le falta.
function puedeElegirCarrito() {
  const nav = state.restaurante?.atributos?.nav || MODELO_POR_DEFECTO;
  return !!planActual().carrito && MODELOS_CARRITO_OPCIONAL.includes(nav);
}

// ¿La carta que se está configurando va a tener carrito? Mira el INTERRUPTOR de
// la pantalla, no lo guardado: encenderlo tiene que enseñar el número y los
// pagos ahí mismo, que es de lo que iba traérselos a esta pestaña.
function carritoEnPantalla() {
  const at = state.restaurante?.atributos || {};
  return cartaTieneCarrito({ ...at, carrito: document.getElementById('ajCarrito').checked }, planActual());
}

// Los toppings salen solo con el carrito encendido. Hasta el 16/09/2026 salían
// también sin él si ya había alguno creado, con la idea de que el restaurante
// pudiera verlos y borrarlos; al probarlo, apagar el carrito dejaba los
// toppings a la vista, que es lo contrario de lo que se espera de un
// interruptor. Sin carrito no hacen nada en la carta, y esconderlos no los
// borra: al encenderlo otra vez están igual. Es la regla de los filtros.
function hayQueEnsenarToppings() {
  return carritoEnPantalla();
}

function pintarToppings() {
  document.getElementById('ajToppingsCuerpo').style.display = hayQueEnsenarToppings() ? '' : 'none';
}

function pintarPedidos() {
  const hay = carritoEnPantalla();
  document.getElementById('ajPedidosCuerpo').style.display = hay ? '' : 'none';
  if (hay) actualizarAvisoPedidos();
}

function pintarNotaCarrito() {
  const at = state.restaurante?.atributos || {};
  const nav = at.nav || MODELO_POR_DEFECTO;
  const nota = document.getElementById('ajCarritoNota');
  const puede = puedeElegirCarrito();
  document.getElementById('ajCarritoInterruptor').style.display = puede ? '' : 'none';
  nota.style.color = 'var(--text-muted)';

  if (!planActual().carrito) {
    nota.textContent = 'Tu plan no incluye pedidos desde la carta.';
  } else if (!puede) {
    nota.textContent = 'El modelo de tu carta no tiene carrito de pedidos.';
  } else if (!document.getElementById('ajCarrito').checked) {
    nota.textContent = 'Enciéndelo y tus clientes podrán armar su pedido desde la carta y enviártelo por WhatsApp.';
  } else if (recibePedidos(at)) {
    nota.textContent = 'Tus clientes arman su pedido en la carta y te llega por WhatsApp, al número de aquí debajo.';
  } else {
    // Encendido sin número: la carta deja armar el pedido y no lo deja enviar.
    nota.textContent = 'Pon aquí debajo el número de WhatsApp al que llegan los pedidos. Sin él, tus clientes podrán armar el pedido pero no enviarlo.';
    nota.style.color = 'var(--warn)';
  }
  pintarPedidos();
  pintarToppings();
}
