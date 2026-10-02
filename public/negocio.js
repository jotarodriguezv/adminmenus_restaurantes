// Los datos del negocio: lo que el restaurante dice UNA vez y que varias
// funciones de la carta usan por su cuenta.
//
// Hoy son el WhatsApp y si la carta enseña su botón (paso 1), y la dirección, la
// ubicación y el enlace de reseñas de Google (paso 2). Irán entrando el horario y
// el correo (docs/datos-del-negocio.md).
//
// ── POR QUÉ UN SOLO WHATSAPP ──────────────────────────────────
// Había dos campos para el mismo número: el de «recibir pedidos», en la tarjeta
// del carrito, y el de la barra de redes. Cuatro restaurantes los tenían
// escritos dos veces con el mismo valor, y otros tres tenían uno solo. Decidido
// con el usuario el 01/10/2026: un número, sin poder poner uno distinto para los
// pedidos.
//
// ── EL BOTÓN SE DECIDE APARTE DEL NÚMERO ──────────────────────
// Antes el botón de WhatsApp de la barra de redes y de la bienvenida salía si
// `social_whatsapp` tenía número. Con un número único, quien lo ponía solo para
// recibir pedidos habría visto aparecer un botón que nunca pidió. Por eso hay
// un interruptor propio, `whatsapp_boton`.
//
// ── LAS CLAVES VIEJAS SE SIGUEN LEYENDO ───────────────────────
// `whatsapp_pedidos` y `social_whatsapp` no se borran: una carta o un panel con
// la página vieja en el navegador todavía las usan. Solo se miran cuando la
// clave nueva NO EXISTE. Si el restaurante borra el número, `whatsapp_negocio`
// queda en '' y eso significa «no hay número»: mirar la vieja entonces
// resucitaría un número que se quitó a propósito.
//
// Este archivo y vmenus-app/core/negocio.js son dos copias de la misma regla, y
// no pueden compartir el módulo porque son dos aplicaciones desplegadas por
// separado. Las comprueba el mismo juego de casos: test/casos-negocio.json.
//
// Se carga con un <script> clásico antes del script principal, como comun.js:
// no se puede repetir aquí un nombre que ya exista en otro archivo del panel.

const soloDigitosNegocio = v => String(v ?? '').replace(/\D/g, '');
const existeClave = v => v !== undefined && v !== null;

// El número del negocio, solo dígitos, o '' si no hay.
function whatsappDelNegocio(at) {
  if (existeClave(at?.whatsapp_negocio)) return soloDigitosNegocio(at.whatsapp_negocio);
  return soloDigitosNegocio(at?.whatsapp_pedidos) || soloDigitosNegocio(at?.social_whatsapp);
}

// ¿La carta enseña el botón de WhatsApp? Sin la clave nueva, como antes: si
// había un número en la barra de redes, sí.
function botonWhatsappActivo(at) {
  if (existeClave(at?.whatsapp_boton)) return at.whatsapp_boton === true;
  return !!soloDigitosNegocio(at?.social_whatsapp);
}

// ── DIRECCIÓN, UBICACIÓN Y RESEÑAS (paso 2) ───────────────────
// Se pedían dentro del formulario de la bienvenida. Ahora son del negocio y la
// bienvenida los toma de aquí; solo conserva sus interruptores y su estilo.
//
// `direccion` no cambia de nombre: ya era la clave y la usaba solo la bienvenida.
// El mapa y las reseñas tienen clave nueva (`mapa_url`, `resena_url`) porque las
// de antes llevaban el prefijo de la pantalla que las pedía (`intro_mapa_url`,
// `intro_resena_url`) y ya no son de ella. Las viejas se leen SOLO si la nueva no
// existe, con la misma razón que el WhatsApp: borrar el enlace deja '' y eso es
// «no hay enlace», no «no está».
const textoDelNegocio = v => String(v ?? '').trim();

function direccionDelNegocio(at) { return textoDelNegocio(at?.direccion); }

function mapaDelNegocio(at) {
  return existeClave(at?.mapa_url) ? textoDelNegocio(at.mapa_url) : textoDelNegocio(at?.intro_mapa_url);
}

function resenaDelNegocio(at) {
  return existeClave(at?.resena_url) ? textoDelNegocio(at.resena_url) : textoDelNegocio(at?.intro_resena_url);
}

// Lo que la vista previa de la bienvenida necesita del negocio, con las claves
// que ella ya conoce. Sale de lo GUARDADO: se escribe en otra pestaña, y mezclar
// lo que está a medio teclear allí con esta vista sería adivinar.
function datosDelNegocioParaLaVista() {
  const at = state.restaurante?.atributos || {};
  return {
    direccion: direccionDelNegocio(at), intro_mapa_url: mapaDelNegocio(at), intro_resena_url: resenaDelNegocio(at),
    horario_texto: textoHorarioAtencion(franjasDelNegocio(at)), correo: correoDelNegocio(at),
  };
}

// En el formulario de la bienvenida ya no se escriben: se dice cuál es cada uno
// y se lleva a donde se cambia.
function pintarDatosEnBienvenida() {
  const at = state.restaurante?.atributos || {};
  const poner = (id, valor, vacio) => {
    const el = document.getElementById(id);
    if (el) el.textContent = valor || vacio;
  };
  poner('apDireccionTexto', direccionDelNegocio(at), 'Todavía no hay dirección');
  poner('apIntroMapaUrlTexto', mapaDelNegocio(at), 'Todavía no hay enlace: sin él no se muestra la ubicación');
  poner('apIntroResenaUrlTexto', resenaDelNegocio(at), 'Todavía no hay enlace: sin él no sale el botón');
  poner('apHorarioTexto', textoHorarioAtencion(franjasDelNegocio(at)), 'Todavía no hay horario');
  poner('apCorreoTexto', correoDelNegocio(at), 'Todavía no hay correo');
}

// Desde la bienvenida, a la tarjeta del negocio. Si hay cambios sin guardar,
// switchTab pregunta y puede no cambiar de pestaña: el foco solo se pone si llegó.
function irADatosDelNegocio(idCampo) {
  switchTab('ajustes', document.getElementById('tabBtnAjustes'));
  if (pestanaActual !== 'ajustes') return;
  const campo = document.getElementById(idCampo);
  if (!campo) return;
  campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  campo.focus({ preventScroll: true });
}

// ── HORARIO DE ATENCIÓN Y CORREO (paso 4) ─────────────────────
// `horario_atencion` es una LISTA DE FRANJAS, cada una con los días a los que vale
// y sus horas: la forma de los horarios de las promociones y de la televisión
// (`dias` de 0 —domingo— a 6, `desde` y `hasta` en 'HH:MM'). Un día que no sale en
// ninguna franja es un día cerrado; sin horas, la franja es «todo el día»; y un
// `hasta` menor que `desde` es un cierre pasado la medianoche. `correo` es una
// dirección. Ninguno tiene clave vieja: no se pedían en ningún sitio.
//
// Las dos reglas —describir y validar— están también en el servidor
// (negocio.js, la validación) y en la carta (vmenus-app/core/negocio.js, la
// descripción). La descripción corre contra test/casos-negocio.json.
const MAX_FRANJAS_ATENCION = 7;
const HORA_ATENCION = /^([01]\d|2[0-3]):[0-5]\d$/;
const CORREO_NEGOCIO = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const DIAS_ATENCION_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const ORDEN_DIAS_ATENCION = [1, 2, 3, 4, 5, 6, 0];   // de lunes a domingo, como se lee

// La copia de trabajo del editor, como `filtrosDisponibles` con los filtros: los
// clics la cambian y hasta guardar no es de verdad. La dibuja horario-atencion.js.
let franjasEnEdicion = [];

function franjasNormalizadas(lista) {
  return (Array.isArray(lista) ? lista : []).map(f => ({
    dias: [...new Set((Array.isArray(f?.dias) ? f.dias : []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b),
    desde: typeof f?.desde === 'string' ? f.desde.trim() : '',
    hasta: typeof f?.hasta === 'string' ? f.hasta.trim() : '',
  }));
}

function franjasDelNegocio(at) { return franjasNormalizadas(at?.horario_atencion); }
function correoDelNegocio(at) { return textoDelNegocio(at?.correo); }

// «Lun a Vie», «Sáb y Dom», «Lun, Mié y Vie», «Todos los días». Los tramos de tres
// días o más se dicen con «a»; los de uno o dos, nombrando cada día.
function textoDiasDeAtencion(dias) {
  const orden = ORDEN_DIAS_ATENCION.filter(d => dias.includes(d));
  if (orden.length === 7) return 'Todos los días';
  const tramos = [];
  let actual = [];
  for (const d of orden) {
    const ultimo = actual[actual.length - 1];
    if (actual.length && ORDEN_DIAS_ATENCION.indexOf(d) === ORDEN_DIAS_ATENCION.indexOf(ultimo) + 1) actual.push(d);
    else { if (actual.length) tramos.push(actual); actual = [d]; }
  }
  if (actual.length) tramos.push(actual);
  const partes = [];
  for (const t of tramos) {
    if (t.length >= 3) partes.push(`${DIAS_ATENCION_CORTOS[t[0]]} a ${DIAS_ATENCION_CORTOS[t[t.length - 1]]}`);
    else for (const d of t) partes.push(DIAS_ATENCION_CORTOS[d]);
  }
  return partes.length <= 1 ? (partes[0] || '') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

// «Lun a Vie 11:00–22:00 · Sáb y Dom 12:00–23:00». Una franja sin días no cuenta.
function textoHorarioAtencion(franjas) {
  const partes = [];
  for (const f of franjasNormalizadas(franjas)) {
    const dias = textoDiasDeAtencion(f.dias);
    if (!dias) continue;
    partes.push(`${dias} ${HORA_ATENCION.test(f.desde) && HORA_ATENCION.test(f.hasta) ? `${f.desde}–${f.hasta}` : 'todo el día'}`);
  }
  return partes.join(' · ');
}

// Lo mismo que comprueba el servidor, con el mensaje donde se mira.
function errorDeHorarioAtencion(franjas) {
  const lista = Array.isArray(franjas) ? franjas : [];
  if (lista.length > MAX_FRANJAS_ATENCION) return `El horario puede tener hasta ${MAX_FRANJAS_ATENCION} franjas.`;
  for (const f of franjasNormalizadas(lista)) {
    if (!f.dias.length) return 'Un horario no tiene días: elige alguno o quita ese horario.';
    if (!!f.desde !== !!f.hasta) return 'Pon la hora de apertura y la de cierre, o marca «Todo el día».';
    if (f.desde && (!HORA_ATENCION.test(f.desde) || !HORA_ATENCION.test(f.hasta))) return 'Las horas del horario tienen que ser como 11:00 o 22:30.';
    if (f.desde && f.desde === f.hasta) return 'La hora de cierre tiene que ser distinta de la de apertura.';
  }
  return null;
}

function errorDeCorreoNegocio(valor) {
  const correo = textoDelNegocio(valor);
  if (correo.length > 120) return 'El correo es demasiado largo.';
  if (correo && !CORREO_NEGOCIO.test(correo)) return 'El correo no parece válido, por ejemplo hola@turestaurante.com.';
  return null;
}

// ── ¿QUÉ FALTA DE LOS DATOS DEL NEGOCIO? (paso 5) ─────────────
// Inicio lo usa para decirle al restaurante qué le falta por rellenar. Cuenta lo
// que de verdad se lee, con las mismas reglas que la carta: un enlace guardado
// con el nombre viejo (`intro_mapa_url`) cuenta como puesto, y uno vacío, no.
//
// No entran las redes sociales: es muy común no tener alguna, y una fila que
// nunca se puede completar acaba ignorada. Tampoco el nombre, que es del
// superadmin. Son datos OPCIONALES: Inicio los enseña aparte de lo pendiente y no
// los cuenta en su aviso (docs/datos-del-negocio.md, paso 5).
const DATOS_DEL_NEGOCIO = [
  { clave: 'whatsapp', nombre: 'el WhatsApp', campo: 'ajNegocioWhatsapp', hay: at => !!whatsappDelNegocio(at) },
  { clave: 'direccion', nombre: 'la dirección', campo: 'ajNegocioDireccion', hay: at => !!direccionDelNegocio(at) },
  { clave: 'mapa', nombre: 'la ubicación', campo: 'ajNegocioMapa', hay: at => !!mapaDelNegocio(at) },
  { clave: 'resena', nombre: 'el enlace de reseñas', campo: 'ajNegocioResena', hay: at => !!resenaDelNegocio(at) },
  { clave: 'horario', nombre: 'el horario', campo: 'ajHorarioBloque', hay: at => !!textoHorarioAtencion(franjasDelNegocio(at)) },
  // El panel guarda el correo tal cual se escribe; aquí solo cuenta uno que la carta enseñaría.
  { clave: 'correo', nombre: 'el correo', campo: 'ajNegocioCorreo', hay: at => !!correoDelNegocio(at) && !errorDeCorreoNegocio(correoDelNegocio(at)) },
];

// ¿Está este dato? Lo usan los interruptores de la bienvenida para no dejarse
// encender sin nada detrás.
function hayDatoDelNegocio(clave, at) {
  return !!DATOS_DEL_NEGOCIO.find(d => d.clave === clave)?.hay(at);
}

// Los que todavía no están, en el orden de la tarjeta.
function datosDelNegocioFaltantes(at) {
  return DATOS_DEL_NEGOCIO.filter(d => !d.hay(at));
}

// «a», «a y b», «a, b y c».
function enLista(nombres) {
  return nombres.length <= 1 ? (nombres[0] || '') : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// ── LA TARJETA «DATOS DEL NEGOCIO» ────────────────────────────
function renderDatosNegocio() {
  const at = state.restaurante?.atributos || {};
  document.getElementById('ajNegocioWhatsapp').value = whatsappDelNegocio(at);
  document.getElementById('ajWhatsappBoton').checked = botonWhatsappActivo(at);
  document.getElementById('ajNegocioDireccion').value = direccionDelNegocio(at);
  document.getElementById('ajNegocioMapa').value = mapaDelNegocio(at);
  document.getElementById('ajNegocioResena').value = resenaDelNegocio(at);
  document.getElementById('ajNegocioCorreo').value = correoDelNegocio(at);
  // Una copia: las fichas de días la cambian, y hasta guardar no es de verdad.
  franjasEnEdicion = franjasDelNegocio(at);
  if (typeof renderHorarioAtencion === 'function') renderHorarioAtencion();
  pintarWhatsappEnPedidos();
}

// Lo que sale en la tarjeta del carrito, que ya no pide el número: dice a cuál
// llegan los pedidos y lleva a donde se cambia. Sigue lo que se escribe, antes
// de guardar, para que no parezca que falta lo que está a medio teclear.
function pintarWhatsappEnPedidos() {
  const campo = document.getElementById('ajNegocioWhatsapp');
  const numero = campo ? soloDigitosNegocio(campo.value) : '';
  // El botón de WhatsApp no se puede encender sin número: no habría adónde llevarlo.
  const boton = document.getElementById('ajWhatsappBoton');
  if (boton) { boton.disabled = !numero; if (!numero) boton.checked = false; }
  const texto = document.getElementById('pedidosWhatsappTexto');
  if (texto) texto.textContent = numero || 'Todavía no hay número';
}

// Solo dígitos: wa.me no acepta otra cosa, y un «+57 300 123 4567» —que es como
// lo teclea cualquiera— arma un enlace que no abre ningún chat.
function recolectarDatosNegocio() {
  return {
    whatsapp_negocio: soloDigitosNegocio(document.getElementById('ajNegocioWhatsapp').value),
    whatsapp_boton: document.getElementById('ajWhatsappBoton').checked,
    direccion: textoDelNegocio(document.getElementById('ajNegocioDireccion').value),
    mapa_url: textoDelNegocio(document.getElementById('ajNegocioMapa').value),
    resena_url: textoDelNegocio(document.getElementById('ajNegocioResena').value),
    correo: textoDelNegocio(document.getElementById('ajNegocioCorreo').value),
    horario_atencion: franjasNormalizadas(franjasEnEdicion),
  };
}

// «Cámbialo en Datos del negocio»: lleva a la tarjeta y deja el cursor en el campo.
function irAlWhatsappDelNegocio() {
  const campo = document.getElementById('ajNegocioWhatsapp');
  campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  campo.focus({ preventScroll: true });
}
