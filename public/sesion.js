// ── LA SESIÓN: SE RENUEVA USÁNDOLA Y PREGUNTA SI NADIE LA USA ──
// Decidido con el equipo el 18/09/2026. Hasta entonces el token duraba 8 h
// fijas desde el login: pasadas, la pestaña parecía abierta y la primera
// petición acababa en el login sin aviso, llevándose lo que se estuviera
// escribiendo (ver CLAUDE.md, «La sesión se renueva usándola»).
//
// Ahora:
//   · Mientras se usa, el token se renueva solo (POST /api/sesion/renovar).
//     Quien trabaja no se topa nunca con el corte.
//   · Tras SESION_INACTIVA_MS sin tocar nada, sale «¿Sigues ahí?» con una
//     cuenta atrás. «Sigo aquí» renueva; si nadie contesta, se cierra.
//
// Avisar sin renovar no servía: el aviso habría llegado, y a las 8 h el
// servidor habría cortado igual.
//
// Todo se mide con Date.now() y no contando ticks: con el portátil cerrado
// los temporizadores se paran, y al abrirlo tiene que saberse cuánto pasó.

// Cuánto sin tocar nada antes de preguntar, y cuánto se espera la respuesta.
// Cambiarlos aquí basta: nada más depende de su valor.
const SESION_INACTIVA_MS = 60 * 60 * 1000;
const SESION_RESPUESTA_MS = 2 * 60 * 1000;
// Renovar en cada clic sería una petición por clic. Con esto, como mucho
// una cada diez minutos, y solo si hubo actividad desde la última.
const SESION_RENOVAR_CADA_MS = 10 * 60 * 1000;
const SESION_TICK_MS = 15 * 1000;

let sesionUltimaActividad = Date.now();
let sesionPreguntadaEn = null;   // cuándo salió «¿Sigues ahí?», o null
let sesionRenovando = false;

// Cuándo se firmó el token que se tiene. Se lee del propio token y no de una
// variable: tras recargar la página la variable diría «ahora», y un token de
// hace 7 h 55 min no se renovaría hasta diez minutos después, ya caducado.
// Solo se lee, sin comprobar la firma: eso lo hace el servidor.
function emitidoEn(t) {
  try {
    const cuerpo = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(cuerpo)).iat || 0) * 1000;
  } catch {
    return 0;   // ilegible: se renueva al primer uso, que lo arregla
  }
}

function anotarActividad() {
  // Con la pregunta a la vista, moverse no cuenta: hay que contestarla. Si no,
  // un roce del ratón la dejaría ahí para siempre sin haberla leído.
  if (sesionPreguntadaEn) return;
  sesionUltimaActividad = Date.now();
}

// Qué toca hacer ahora. Aparte y sin tocar nada para poder probarla sin
// temporizadores: recibe el momento y el estado, devuelve una decisión.
function decisionDeSesion(ahora, { ultimaActividad, ultimaRenovacion, preguntadaEn, subiendoVideo }) {
  // Un video subiendo es alguien esperando delante, no una pestaña olvidada
  // (y cerrar la sesión cortaría la subida).
  if (subiendoVideo) return ahora - ultimaRenovacion >= SESION_RENOVAR_CADA_MS ? 'renovar' : 'nada';
  if (preguntadaEn !== null) return ahora - preguntadaEn >= SESION_RESPUESTA_MS ? 'cerrar' : 'esperar';
  const quieto = ahora - ultimaActividad;
  // Volviendo de una suspensión larga el tiempo ya pasó entero: preguntar
  // ahora daría dos minutos más a una sesión que nadie atendió.
  if (quieto >= SESION_INACTIVA_MS + SESION_RESPUESTA_MS) return 'cerrar';
  if (quieto >= SESION_INACTIVA_MS) return 'preguntar';
  if (ultimaActividad > ultimaRenovacion && ahora - ultimaRenovacion >= SESION_RENOVAR_CADA_MS) return 'renovar';
  return 'nada';
}

async function renovarSesion() {
  if (sesionRenovando || !token) return false;
  sesionRenovando = true;
  try {
    // apiFetch ya manda al login si el token no vale: no hay nada que decir
    // aquí que el login no diga.
    const r = await apiFetch('POST', '/api/sesion/renovar', {});
    if (!r?.token) return false;
    token = r.token;
    sessionStorage.setItem('menuAdminToken', token);
    return true;
  } catch {
    // Sin red se vuelve a intentar en el siguiente tick; el token viejo sigue
    // valiendo hasta sus 8 h.
    return false;
  } finally {
    sesionRenovando = false;
  }
}

function pintarCuentaAtras() {
  const el = document.getElementById('sesionCuenta');
  if (!el || sesionPreguntadaEn === null) return;
  const quedan = Math.max(0, Math.ceil((SESION_RESPUESTA_MS - (Date.now() - sesionPreguntadaEn)) / 1000));
  el.textContent = `${Math.floor(quedan / 60)}:${String(quedan % 60).padStart(2, '0')}`;
}

function preguntarSiSigue() {
  sesionPreguntadaEn = Date.now();
  pintarCuentaAtras();
  document.getElementById('sesionModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('sesionSigo').focus();
}

function cerrarPreguntaSesion() {
  sesionPreguntadaEn = null;
  document.getElementById('sesionModal').classList.remove('open');
  // Puede haber salido encima de la ficha de un plato, que sigue abierta.
  if (!document.querySelector('.modal-bg.open')) document.body.style.overflow = '';
}

async function sigoAqui() {
  cerrarPreguntaSesion();
  sesionUltimaActividad = Date.now();
  await renovarSesion();
}

function cerrarSesionPorInactividad() {
  cerrarPreguntaSesion();
  logout();
  // Se dice en el login: sin esto, quien vuelve al equipo encuentra la
  // pantalla de entrada y no sabe si algo falló.
  const e = document.getElementById('loginError');
  if (e) e.textContent = 'Cerramos tu sesión porque no hubo actividad. Vuelve a entrar.';
}

function revisarSesion() {
  if (!token) {
    if (sesionPreguntadaEn !== null) cerrarPreguntaSesion();
    return;
  }
  const decision = decisionDeSesion(Date.now(), {
    ultimaActividad: sesionUltimaActividad,
    ultimaRenovacion: emitidoEn(token),
    preguntadaEn: sesionPreguntadaEn,
    subiendoVideo: !!state.subiendoVideo,
  });
  if (decision === 'renovar') renovarSesion();
  else if (decision === 'preguntar') preguntarSiSigue();
  else if (decision === 'cerrar') cerrarSesionPorInactividad();
  else if (decision === 'esperar') pintarCuentaAtras();
}

function vigilarSesion() {
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
    document.addEventListener(ev, anotarActividad, { passive: true, capture: true });
  // Escape es «sigo aquí»: quien pulsa una tecla, está. En la fase de captura
  // de window para llegar antes que el Escape de index.html, que cerraría las
  // ventanas de debajo.
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || sesionPreguntadaEn === null) return;
    e.stopPropagation();
    sigoAqui();
  }, true);
  // Al volver a la pestaña o despertar el equipo se mira en el acto, sin
  // esperar al siguiente tick: es justo cuando más tiempo pudo pasar.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarSesion(); });
  setInterval(revisarSesion, SESION_TICK_MS);
  // La cuenta atrás se mueve de segundo en segundo solo mientras se ve.
  setInterval(() => { if (sesionPreguntadaEn !== null) revisarSesion(); }, 1000);
}
