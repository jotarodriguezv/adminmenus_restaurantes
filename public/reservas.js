// Las reservas de mesa: la lista que ve el restaurante y el contador de
// pendientes de la pestaña. Pedidas por el usuario el 01/10/2026.
//
// El comensal las pide desde la bienvenida de la carta (vmenus-app,
// core/intro.js → POST /api/reservas). Aquí el restaurante las ve, las
// confirma o las cancela y le escribe al comensal por WhatsApp. NO hay aviso
// automático: la lista y el contador son el aviso (decidido con el usuario).
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

let reservasCargadas = false;
const ETIQUETAS_RESERVA = { pendiente: 'Por confirmar', confirmada: 'Confirmada', cancelada: 'Cancelada' };

// ── LAS REGLAS, SIN PANTALLA ──────────────────────────────────
// Hoy en el reloj del restaurante, no en el del navegador de quien mire: el
// restaurante puede estar en una zona y su dueño de viaje.
function hoyDelRestaurante(ahora = new Date()) {
  const zona = state.restaurante?.atributos?.zona_horaria || 'America/Bogota';
  try { return ahora.toLocaleDateString('en-CA', { timeZone: zona }); }
  catch { return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); }
}

// Una pendiente cuya fecha ya pasó no pide ya acción de nadie: no cuenta.
function reservasPendientes(lista, hoy) {
  return (lista || []).filter(r => r.estado === 'pendiente' && String(r.fecha).slice(0, 10) >= hoy);
}

// ── POR SEDE ──────────────────────────────────────────────────
// Un restaurante con sedes recibe reservas de todos sus locales en la misma lista, y
// cada local solo quiere ver las suyas. El filtro solo sale si las reservas traen
// DOS sedes o más: con una (o ninguna) no habría nada que elegir. El contador de la
// pestaña NO se filtra: es lo que queda por confirmar en todo el restaurante.
let reservasFiltroSede = '';

// Los nombres de sede que aparecen en las reservas, sin repetir y en orden.
function sedesDeLasReservas(lista) {
  return [...new Set((lista || []).map(r => r.sede_nombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function reservasVisibles(lista, sede) {
  return sede ? (lista || []).filter(r => r.sede_nombre === sede) : (lista || []);
}

// 'YYYY-MM-DD' y 'HH:MM[:SS]' → «vie 5 oct · 7:30 p. m.», sin pasar por Date
// con zona: una fecha sola se lee como UTC y se correría un día.
function fechaHoraReserva(fecha, hora) {
  const [a, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const [h, min] = String(hora).slice(0, 5).split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${dia.replace(/\./g, '')} · ${h12}:${String(min).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

// El mensaje con el que se le escribe al comensal. Es la copia, para el panel,
// de mensajeParaElComensal() de reservas.js (servidor): no se pueden compartir
// porque uno es CommonJS y el otro un script clásico del navegador.
function mensajeReserva(r, restauranteNombre) {
  const fecha = String(r.fecha).slice(0, 10).split('-').reverse().join('/');
  const detalle = `${fecha} a las ${String(r.hora).slice(0, 5)}, para ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}`;
  const lugar = restauranteNombre ? ` en ${restauranteNombre}${r.sede_nombre ? ` (${r.sede_nombre})` : ''}` : '';
  if (r.estado === 'confirmada') return `Hola ${r.nombre}, tu reserva${lugar} está confirmada: ${detalle}. ¡Te esperamos!`;
  if (r.estado === 'cancelada') return `Hola ${r.nombre}, no pudimos confirmar tu reserva${lugar} para el ${detalle}. ¿Quieres que busquemos otra hora?`;
  return `Hola ${r.nombre}, te escribimos por tu reserva${lugar}: ${detalle}.`;
}

function enlaceReserva(r, restauranteNombre) {
  const numero = String(r.celular || '').replace(/\D/g, '');
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensajeReserva(r, restauranteNombre))}` : '';
}

// ── EL CONTADOR DE LA PESTAÑA ─────────────────────────────────
function pintarContadorReservas() {
  const boton = document.getElementById('tabBtnReservas');
  if (!boton) return;
  const n = reservasPendientes(state.reservas, hoyDelRestaurante()).length;
  boton.textContent = '';
  boton.append('Reservas');
  if (n > 0) {
    const marca = document.createElement('span');
    marca.className = 'tab-contador'; marca.textContent = n > 99 ? '99+' : String(n);
    marca.setAttribute('aria-label', `${n} por confirmar`);
    boton.append(' ', marca);
  }
}

// ¿Tiene este restaurante las reservas encendidas? Solo entonces existe la pestaña.
function restauranteTieneReservas() {
  return state.restaurante?.atributos?.intro_reservas_activo === true;
}

// Es cortesía, no protección: la API responde igual. Al aparecer se cuentan las pendientes.
// La llama ajustarPestanasAlModelo(), que corre al cargar el restaurante y al guardar.
function ajustarPestanaReservas() {
  const conReservas = restauranteTieneReservas();
  document.getElementById('tabBtnReservas').style.display = conReservas ? 'block' : 'none';
  if (conReservas) cargarReservas({ silencioso: true });
  else { state.reservas = []; reservasCargadas = false; }
}

// Trae las reservas y repinta lista y contador. Sin avisos de error: si falla
// en segundo plano (el contador), no hay nada que enseñar; la lista sí lo dice.
async function cargarReservas({ silencioso = false } = {}) {
  const lista = document.getElementById('reservasLista');
  if (!state.restaurante) return;
  if (!silencioso && lista) lista.textContent = 'Cargando reservas…';
  try {
    state.reservas = await apiFetch('GET', `/api/reservas?restaurante_id=${state.restaurante.id}`) || [];
    reservasCargadas = true;
    pintarContadorReservas();
    pintarReservas();
  } catch {
    if (!silencioso && lista) lista.textContent = 'No se pudieron cargar las reservas.';
  }
}

async function cambiarEstadoReserva(r, estado) {
  try {
    await apiFetch('PATCH', `/api/reservas/${r.id}`, { estado });
    r.estado = estado;
    pintarContadorReservas(); pintarReservas();
  } catch { showToast('No se pudo actualizar la reserva', 'error'); }
}

function pintarReservas() {
  const lista = document.getElementById('reservasLista'); const resumen = document.getElementById('reservasResumen');
  if (!lista || !resumen) return;
  pintarFiltroDeSedesDeReservas();
  const todas = reservasVisibles(state.reservas, reservasFiltroSede);
  const hoy = hoyDelRestaurante();
  const proximas = todas.filter(r => String(r.fecha).slice(0, 10) >= hoy);
  const pasadas = todas.filter(r => String(r.fecha).slice(0, 10) < hoy).reverse();
  const porConfirmar = reservasPendientes(todas, hoy).length;
  resumen.textContent = todas.length
    ? `${proximas.length} próximas · ${porConfirmar} por confirmar`
    : '';
  lista.replaceChildren();
  if (!todas.length) { lista.textContent = 'Aún no hay reservas. Cuando alguien reserve desde tu carta, aparecerá aquí.'; return; }

  const grupo = (titulo, filas) => {
    if (!filas.length) return;
    const h = document.createElement('div'); h.className = 'reservas-grupo'; h.textContent = titulo; lista.appendChild(h);
    filas.forEach(r => lista.appendChild(tarjetaReserva(r)));
  };
  grupo('Próximas', proximas);
  grupo('Pasadas', pasadas);
}

function pintarFiltroDeSedesDeReservas() {
  const caja = document.getElementById('reservasFiltro');
  if (!caja) return;
  const sedes = sedesDeLasReservas(state.reservas);
  if (!sedes.includes(reservasFiltroSede)) reservasFiltroSede = '';
  caja.replaceChildren();
  if (sedes.length < 2) return;
  const etiqueta = document.createElement('label');
  etiqueta.className = 'form-label'; etiqueta.htmlFor = 'reservasFiltroSede'; etiqueta.textContent = 'Ver reservas de';
  const sel = document.createElement('select');
  sel.id = 'reservasFiltroSede'; sel.className = 'form-select';
  for (const [valor, texto] of [['', 'Todas las sedes'], ...sedes.map(s => [s, s])]) {
    const o = document.createElement('option'); o.value = valor; o.textContent = texto; sel.appendChild(o);
  }
  sel.value = reservasFiltroSede;
  sel.addEventListener('change', () => { reservasFiltroSede = sel.value; pintarReservas(); });
  caja.append(etiqueta, sel);
}

function tarjetaReserva(r) {
  const caja = document.createElement('article'); caja.className = `reserva-card reserva-${r.estado}`;
  const nombre = state.restaurante?.nombre || '';
  const wa = enlaceReserva(r, nombre);
  const cuando = fechaHoraReserva(r.fecha, r.hora);
  caja.innerHTML = `<div class="reserva-info"><strong class="reserva-cliente">${esc(r.nombre)}</strong> <span class="reserva-contacto">· ${esc(r.celular)}</span>`
    + (r.sede_nombre ? `<br><span class="reserva-sede">${esc(r.sede_nombre)}</span>` : '')
    + `<br><span class="reserva-cuando"><strong>${esc(cuando)} · ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}</strong></span>`
    + `<br><span class="reserva-estado"><strong>${esc(ETIQUETAS_RESERVA[r.estado] || r.estado)}</strong></span></div>`;
  const acciones = document.createElement('div'); acciones.className = 'reserva-acciones';
  const boton = (texto, clase, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn-sm ${clase}`; b.textContent = texto; b.onclick = fn; acciones.appendChild(b); };
  if (r.estado !== 'confirmada') boton('Confirmar', 'reserva-ok', () => cambiarEstadoReserva(r, 'confirmada'));
  if (r.estado !== 'cancelada') boton('Cancelar', 'reserva-cancelar', () => cambiarEstadoReserva(r, 'cancelada'));
  if (r.estado !== 'pendiente') boton('Volver a pendiente', 'reserva-restaurar', () => cambiarEstadoReserva(r, 'pendiente'));
  if (wa) {
    const a = document.createElement('a'); a.className = 'btn-sm reserva-wa'; a.href = wa; a.target = '_blank'; a.rel = 'noopener';
    a.setAttribute('aria-label', `Escribir a ${r.nombre} por WhatsApp`);
    a.innerHTML = '<span aria-hidden="true">◉</span> Escribir por WhatsApp'; acciones.appendChild(a);
  }
  caja.appendChild(acciones);
  return caja;
}
