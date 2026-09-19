// ── BANDEJA DE SOLICITUDES DE ALTA (superadmin) ───────────────
// Las solicitudes que llegan de los anuncios de Meta (vía n8n) y de la página
// /solicitud (equipo en campo). Decidido con el usuario el 18-19/09/2026; las
// reglas del servidor, en solicitudes.js, y la tabla, en sql/25.
//
// Una solicitud NUNCA crea un restaurante. «Aprobar y crear» rellena el
// formulario de «Nuevo restaurante» y es la persona quien lo crea; al crearlo,
// la solicitud queda aprobada y enlazada a él (ver crearRestaurante).
//
// SEGURIDAD: todo lo que se pinta aquí lo escribió un desconocido en un
// formulario público, y esto se ve con la sesión del superadmin, la que más
// puede. Se pinta SIEMPRE con textContent, nunca como HTML.

const FILTROS_SOLICITUDES = [
  ['pendientes', 'Pendientes'], ['aprobada', 'Aprobadas'], ['descartada', 'Descartadas'], ['todas', 'Todas'],
];
const ETIQUETA_ORIGEN = { meta: 'Anuncio de Meta', campo: 'Equipo en campo', web: 'Página de solicitud' };
const ETIQUETA_ESTADO = { nueva: 'Nueva', contactada: 'Contactada', aprobada: 'Aprobada', descartada: 'Descartada' };

// ── REGLAS (puras, para probarlas sin navegador) ──────────────
function solicitudesVisibles(lista, filtro) {
  if (filtro === 'todas') return lista;
  if (filtro === 'pendientes') return lista.filter(s => s.estado === 'nueva' || s.estado === 'contactada');
  return lista.filter(s => s.estado === filtro);
}

// La dirección que se propone para el restaurante: el nombre en minúsculas,
// sin tildes y con guiones. Solo una propuesta: quien crea la revisa, y el
// servidor la rechaza si está reservada o repetida.
function slugDesdeNombre(nombre) {
  return String(nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// Un PIN de seis cifras para proponer. Seis y no cuatro: el login admite hasta
// diez, y cada cifra más multiplica por diez lo que cuesta adivinarlo.
function pinPropuesto() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

// ── ESTADO Y CARGA ────────────────────────────────────────────
let listaSolicitudes = [];
let filtroSolicitudes = 'pendientes';
const seleccionSolicitudes = new Set();

async function cargarSolicitudes() {
  const caja = document.getElementById('solicitudesLista');
  if (!caja) return;
  try {
    listaSolicitudes = await apiFetch('GET', '/api/solicitudes') || [];
  } catch (e) {
    // Sin la tabla todavía (la migración va antes que el código) o con la base
    // caída, la lista de restaurantes se sigue viendo: esto no la frena.
    listaSolicitudes = [];
    caja.replaceChildren(nodoSolicitud('div', 'empty-state', 'No se pudieron cargar las solicitudes.'));
    return;
  }
  pintarSolicitudes();
}

// ── PINTAR ────────────────────────────────────────────────────
function nodoSolicitud(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto != null) n.textContent = texto;
  return n;
}

function pintarSolicitudes() {
  const caja = document.getElementById('solicitudesLista');
  if (!caja) return;
  const pendientes = solicitudesVisibles(listaSolicitudes, 'pendientes').length;
  const cuenta = document.getElementById('solicitudesCuenta');
  if (cuenta) cuenta.textContent = pendientes ? `${pendientes} pendiente${pendientes === 1 ? '' : 's'}` : '';

  const filtros = document.getElementById('solicitudesFiltros');
  filtros.replaceChildren(...FILTROS_SOLICITUDES.map(([id, nombre]) => {
    const b = nodoSolicitud('button', 'cat-chip' + (filtroSolicitudes === id ? ' active' : ''), nombre);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(filtroSolicitudes === id));
    b.onclick = () => { filtroSolicitudes = id; seleccionSolicitudes.clear(); pintarSolicitudes(); };
    return b;
  }));

  const visibles = solicitudesVisibles(listaSolicitudes, filtroSolicitudes);
  if (!visibles.length) {
    caja.replaceChildren(nodoSolicitud('div', 'empty-state', filtroSolicitudes === 'pendientes'
      ? 'No hay solicitudes pendientes.' : 'No hay solicitudes aquí.'));
  } else {
    caja.replaceChildren(...visibles.map(tarjetaSolicitud));
  }

  const lote = document.getElementById('solicitudesLote');
  lote.hidden = !seleccionSolicitudes.size;
  document.getElementById('solicitudesLoteTexto').textContent =
    `${seleccionSolicitudes.size} seleccionada${seleccionSolicitudes.size === 1 ? '' : 's'}`;
}

function tarjetaSolicitud(s) {
  const t = nodoSolicitud('div', 'solicitud-card');
  const abierta = s.estado === 'nueva' || s.estado === 'contactada';

  const cabeza = nodoSolicitud('div', 'solicitud-cabeza');
  if (abierta) {
    const marca = document.createElement('input');
    marca.type = 'checkbox';
    marca.checked = seleccionSolicitudes.has(s.id);
    marca.setAttribute('aria-label', `Seleccionar la solicitud de ${s.negocio}`);
    marca.onchange = () => {
      if (marca.checked) seleccionSolicitudes.add(s.id); else seleccionSolicitudes.delete(s.id);
      pintarSolicitudes();
    };
    cabeza.append(marca);
  }
  cabeza.append(nodoSolicitud('span', 'solicitud-negocio', s.negocio),
    nodoSolicitud('span', `solicitud-estado estado-${s.estado}`, ETIQUETA_ESTADO[s.estado] || s.estado));
  t.append(cabeza);

  const origen = ETIQUETA_ORIGEN[s.origen] || s.origen;
  const fecha = new Date(s.creado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  const datos = [s.contacto, s.ciudad, s.tipo_negocio, `${origen}${s.comercial ? ` · ${s.comercial}` : ''}`, fecha].filter(Boolean);
  t.append(nodoSolicitud('div', 'solicitud-datos', datos.join(' · ')));
  if (s.notas) t.append(nodoSolicitud('div', 'solicitud-notas', s.notas));

  const acciones = nodoSolicitud('div', 'solicitud-acciones');
  // El número se valida al guardar (solo dígitos), así que el enlace no puede
  // llevar otra cosa.
  if (/^[0-9]{8,15}$/.test(s.whatsapp)) {
    const wa = nodoSolicitud('a', 'btn-sm', `WhatsApp +${s.whatsapp}`);
    wa.href = `https://wa.me/${s.whatsapp}`;
    wa.target = '_blank';
    wa.rel = 'noopener noreferrer';
    acciones.append(wa);
  }
  if (s.estado === 'nueva') acciones.append(botonSolicitud('Marcar contactada', () => cambiarEstadoSolicitud(s, 'contactada')));
  if (abierta) {
    acciones.append(botonSolicitud('Aprobar y crear', () => aprobarSolicitud(s), 'accent'));
    acciones.append(botonSolicitud('Descartar', () => descartarSolicitud(s), 'danger'));
  }
  if (s.estado === 'aprobada' && s.restaurante_id) {
    const r = (state.listaRestos || []).find(x => x.id === s.restaurante_id);
    acciones.append(nodoSolicitud('span', 'solicitud-creado', `✓ Creado${r ? `: ${r.nombre}` : ''}`));
  }
  if (s.estado === 'descartada') acciones.append(botonSolicitud('Recuperar', () => cambiarEstadoSolicitud(s, 'nueva')));
  t.append(acciones);
  return t;
}

function botonSolicitud(texto, accion, variante) {
  const b = nodoSolicitud('button', 'btn-sm' + (variante ? ` ${variante}` : ''), texto);
  b.type = 'button';
  b.onclick = accion;
  return b;
}

// ── ACCIONES ──────────────────────────────────────────────────
async function cambiarEstadoSolicitud(s, estado) {
  try {
    await apiFetch('PATCH', `/api/solicitudes/${s.id}`, { estado });
    s.estado = estado;
    pintarSolicitudes();
  } catch (e) { showToast('No se pudo cambiar la solicitud', 'error'); }
}

async function descartarSolicitud(s) {
  if (!await preguntar({ titulo: 'Descartar la solicitud', texto: `Se descarta la solicitud de «${s.negocio}». Se puede recuperar desde «Descartadas».`, si: 'Descartar', peligro: true })) return;
  seleccionSolicitudes.delete(s.id);
  await cambiarEstadoSolicitud(s, 'descartada');
}

async function descartarSeleccionadas() {
  const ids = [...seleccionSolicitudes];
  if (!ids.length) return;
  if (!await preguntar({ titulo: 'Descartar varias', texto: `Se descartan ${ids.length} solicitudes. Se pueden recuperar desde «Descartadas».`, si: 'Descartar', peligro: true })) return;
  try {
    await apiFetch('POST', '/api/solicitudes/descartar', { ids });
    listaSolicitudes.forEach(s => { if (seleccionSolicitudes.has(s.id)) s.estado = 'descartada'; });
    seleccionSolicitudes.clear();
    pintarSolicitudes();
  } catch (e) { showToast('No se pudieron descartar', 'error'); }
}

// Rellena «Nuevo restaurante» con la solicitud. No crea nada: quien crea es la
// persona, después de llamar al número para confirmar que es ese negocio —la
// aprobación manual es lo que evita que alguien pida el restaurante de otro—.
let solicitudEnAlta = null;

function aprobarSolicitud(s) {
  solicitudEnAlta = s.id;
  const panel = document.getElementById('nuevoRestoPanel');
  panel.open = true;
  document.getElementById('newRestoNombre').value = s.negocio;
  document.getElementById('newRestoSlug').value = slugDesdeNombre(s.negocio);
  document.getElementById('newRestoPin').value = pinPropuesto();
  const status = document.getElementById('newRestoStatus');
  status.textContent = `Desde la solicitud de ${s.negocio}. Antes de crearlo, confirma por WhatsApp que es ese negocio. Al crearlo, la solicitud queda aprobada.`;
  status.style.color = 'var(--text-muted)';
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  document.getElementById('newRestoNombre').focus({ preventScroll: true });
}

// La llama crearRestaurante cuando termina bien.
async function marcarSolicitudCreada(restauranteId) {
  if (!solicitudEnAlta) return;
  const id = solicitudEnAlta;
  solicitudEnAlta = null;
  try {
    await apiFetch('PATCH', `/api/solicitudes/${id}`, { estado: 'aprobada', restaurante_id: restauranteId });
  } catch (e) {
    // El restaurante ya está creado, que es lo importante. La solicitud se
    // puede aprobar a mano después.
    showToast('El restaurante se creó, pero la solicitud no se marcó como aprobada', 'error');
  }
  await cargarSolicitudes();
}
