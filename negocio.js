'use strict';
// ── DATOS DEL NEGOCIO ─────────────────────────────────────────
// Lo que el restaurante dice una vez y varias funciones usan: hoy el WhatsApp
// y si la carta enseña su botón; irán entrando la dirección, el mapa, las
// reseñas, el horario y el correo (docs/datos-del-negocio.md).
//
// El horario de atención y el correo (paso 4, 02/10/2026) entran aquí sin clave
// vieja: no se pedían en ningún sitio.
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

// ── HORARIO DE ATENCIÓN ───────────────────────────────────────
// `horario_atencion` es una LISTA DE FRANJAS, cada una con los días a los que
// vale y sus horas, que es la forma que ya usan las promociones y los horarios
// del televisor (core/horarios.js: `dias` de 0 —domingo— a 6, `desde` y `hasta`
// en 'HH:MM'). Una sola franja no basta: «lunes a viernes de 11 a 22 y fin de
// semana de 12 a 23» son dos, y un almuerzo y una cena con cierre en medio son
// dos más para los mismos días.
//
// Un día que no sale en ninguna franja es un día cerrado. Sin horas, la franja
// es «todo el día». `hasta` menor que `desde` es un cierre pasada la medianoche
// (18:00–02:00): no se rechaza, porque es el horario de un bar.
//
// Por ahora solo se muestra. Cuando haya una función que lo use —«abierto
// ahora»—, tendrá que decidir qué hace con ese cierre de madrugada.
const MAX_FRANJAS_ATENCION = 7;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Devuelve { franjas } normalizadas (días únicos y ordenados, horas o '') o
// { error }. Lo mismo que hace el panel antes de mandarlo, para que el mensaje
// de error sea raro.
function validarFranjas(valor) {
  if (valor === null || valor === undefined || valor === '') return { franjas: [] };
  if (!Array.isArray(valor)) return { error: 'El horario de atención no es válido' };
  if (valor.length > MAX_FRANJAS_ATENCION)
    return { error: `El horario puede tener hasta ${MAX_FRANJAS_ATENCION} franjas` };
  const franjas = [];
  for (const f of valor) {
    if (!f || typeof f !== 'object' || !Array.isArray(f.dias) || !f.dias.length)
      return { error: 'Cada horario necesita al menos un día' };
    if (!f.dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      return { error: 'Hay un día del horario que no es válido' };
    const dias = [...new Set(f.dias)].sort((a, b) => a - b);
    const desde = f.desde == null ? '' : String(f.desde).trim();
    const hasta = f.hasta == null ? '' : String(f.hasta).trim();
    if (!!desde !== !!hasta)
      return { error: 'Pon la hora de apertura y la de cierre, o deja las dos en «Todo el día»' };
    if (desde && (!HORA.test(desde) || !HORA.test(hasta)))
      return { error: 'Las horas del horario tienen que ser como 11:00 o 22:30' };
    if (desde && desde === hasta)
      return { error: 'La hora de cierre tiene que ser distinta de la de apertura' };
    franjas.push({ dias, desde, hasta });
  }
  return { franjas };
}

// ── CORREO ────────────────────────────────────────────────────
// Va a un enlace mailto: en la bienvenida, así que se rechaza todo lo que no
// sea una dirección de aspecto normal: sin espacios ni comillas, comas, <, >.
const CORREO_MAX = 120;
const CORREO = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

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

  if ('correo' in atributos) {
    const correo = String(atributos.correo ?? '').trim();
    if (correo.length > CORREO_MAX) return 'El correo es demasiado largo';
    if (correo && !CORREO.test(correo)) return 'El correo no parece válido, por ejemplo hola@turestaurante.com';
    atributos.correo = correo;
  }

  if ('horario_atencion' in atributos) {
    const r = validarFranjas(atributos.horario_atencion);
    if (r.error) return r.error;
    atributos.horario_atencion = r.franjas;
  }
  return null;
}

module.exports = { whatsappDelNegocio, botonWhatsappActivo, validarNegocio, validarFranjas, MAX_FRANJAS_ATENCION, CORREO };
