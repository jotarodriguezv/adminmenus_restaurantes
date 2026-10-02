'use strict';
// ── DATOS DEL NEGOCIO ─────────────────────────────────────────
// Lo que el restaurante dice una vez y varias funciones usan: hoy el WhatsApp
// y si la carta enseña su botón; irán entrando la dirección, el mapa, las
// reseñas, el horario y el correo (docs/datos-del-negocio.md).
//
// Un solo número de WhatsApp. Antes eran dos —`whatsapp_pedidos`, en la
// tarjeta del carrito, y `social_whatsapp`, en las redes—, y cuatro
// restaurantes los tenían repetidos con el mismo valor. Decidido el 01/10/2026.
//
// Las claves viejas se siguen LEYENDO, pero solo cuando la nueva no existe:
// una carta o un panel con la página vieja todavía las usan. Si el restaurante
// borra el número, `whatsapp_negocio` queda en '' y eso es «no hay número»:
// mirar la vieja entonces resucitaría un número que se quitó a propósito.
//
// Hay una copia de esta regla en public/negocio.js (el panel) y otra en
// vmenus-app/core/negocio.js (la carta). No pueden compartir el módulo: son
// aplicaciones distintas. Las tres corren contra test/casos-negocio.json.

const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const existe = (v) => v !== undefined && v !== null;

// El número del negocio, solo dígitos, o '' si no hay.
function whatsappDelNegocio(at) {
  if (existe(at?.whatsapp_negocio)) return soloDigitos(at.whatsapp_negocio);
  return soloDigitos(at?.whatsapp_pedidos) || soloDigitos(at?.social_whatsapp);
}

// ¿La carta enseña el botón de WhatsApp? Sin la clave nueva, como antes: si
// había un número en la barra de redes, sí.
function botonWhatsappActivo(at) {
  if (existe(at?.whatsapp_boton)) return at.whatsapp_boton === true;
  return !!soloDigitos(at?.social_whatsapp);
}

// Normaliza en su sitio lo que llega a atributos y devuelve un mensaje de
// error, o null. Solo mira las claves que vienen: un PATCH es parcial.
function validarNegocio(atributos) {
  if ('whatsapp_boton' in atributos) atributos.whatsapp_boton = atributos.whatsapp_boton === true;

  if ('whatsapp_negocio' in atributos) {
    // Igual que la carta al pintarlo: se quedan los dígitos. Un número con
    // espacios o con '+' es un error de forma, no de contenido.
    const digitos = soloDigitos(atributos.whatsapp_negocio);
    if (digitos && (digitos.length < 8 || digitos.length > 15))
      return 'El WhatsApp tiene que ser el número completo con el código de país, por ejemplo 573001234567';
    atributos.whatsapp_negocio = digitos;
  }
  return null;
}

module.exports = { whatsappDelNegocio, botonWhatsappActivo, validarNegocio };
