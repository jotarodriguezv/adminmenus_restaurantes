// Los datos del negocio: lo que el restaurante dice UNA vez y que varias
// funciones de la carta usan por su cuenta.
//
// Hoy son el WhatsApp y si la carta enseña su botón. Irán entrando la
// dirección, el mapa, el enlace de reseñas de Google, el horario y el correo,
// que ahora se piden dentro de la pantalla de bienvenida (docs/datos-del-negocio.md).
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

// ── LA TARJETA «DATOS DEL NEGOCIO» ────────────────────────────
function renderDatosNegocio() {
  const at = state.restaurante?.atributos || {};
  document.getElementById('ajNegocioWhatsapp').value = whatsappDelNegocio(at);
  document.getElementById('ajWhatsappBoton').checked = botonWhatsappActivo(at);
  pintarWhatsappEnPedidos();
}

// Lo que sale en la tarjeta del carrito, que ya no pide el número: dice a cuál
// llegan los pedidos y lleva a donde se cambia. Sigue lo que se escribe, antes
// de guardar, para que no parezca que falta lo que está a medio teclear.
function pintarWhatsappEnPedidos() {
  const campo = document.getElementById('ajNegocioWhatsapp');
  const numero = campo ? soloDigitosNegocio(campo.value) : '';
  const texto = document.getElementById('pedidosWhatsappTexto');
  if (texto) texto.textContent = numero || 'Todavía no hay número';
}

// Solo dígitos: wa.me no acepta otra cosa, y un «+57 300 123 4567» —que es como
// lo teclea cualquiera— arma un enlace que no abre ningún chat.
function recolectarDatosNegocio() {
  return {
    whatsapp_negocio: soloDigitosNegocio(document.getElementById('ajNegocioWhatsapp').value),
    whatsapp_boton: document.getElementById('ajWhatsappBoton').checked,
  };
}

// «Cámbialo en Datos del negocio»: lleva a la tarjeta y deja el cursor en el campo.
function irAlWhatsappDelNegocio() {
  const campo = document.getElementById('ajNegocioWhatsapp');
  campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  campo.focus({ preventScroll: true });
}
