'use strict';
// ── RESERVAS DE MESA ──────────────────────────────────────────
// Las reglas, aparte de las rutas de server.js para poder probarlas sin
// servidor. Pedidas por el usuario el 01/10/2026; la tabla está en
// sql/34_reservas.sql y el porqué de todo en su cabecera.
//
// Lo que no se negocia:
//   · La carta no escribe en la base: llama a POST /api/reservas, y es aquí
//     donde se decide qué entra. Lleva el nombre y el celular de un comensal.
//   · Una reserva es una SOLICITUD, no una promesa: nace «pendiente» y solo
//     el restaurante la confirma.
//   · A un robot no se le dice que se le detectó (mismo trato que solicitudes).

const solicitudes = require('./solicitudes');

const ESTADOS = ['pendiente', 'confirmada', 'cancelada'];
const PERSONAS_MAX = 50;
// Hasta cuándo se puede reservar con anticipación. Más lejos de esto es casi
// seguro un error de año al escribir la fecha.
const DIAS_ADELANTE_MAX = 90;
// Cuántas pendientes puede tener un mismo celular en un mismo restaurante.
// Más es acaparar mesas o llenar la lista de basura.
const PENDIENTES_MAX_POR_CELULAR = 3;
const NOMBRE_MAX = 80;
const TEXTO_BOTON_MAX = 40;
const TEXTO_BOTON_DEFECTO = 'Reservar mesa';
const DIAS_RETENCION = 90;
const INTERVALO_PURGA_MS = 24 * 60 * 60 * 1000;

// Reutiliza lo ya probado de las solicitudes: el número con indicativo y el
// recorte de espacios.
const normalizarCelular = solicitudes.normalizarWhatsapp;
const enlaceWhatsapp = solicitudes.enlaceWhatsapp;
const pareceRobot = solicitudes.pareceRobot;

function limpio(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }

// 'YYYY-MM-DD' de hoy en el reloj de la zona del restaurante. No el de UTC: a
// las 8 de la noche en Bogotá ya es mañana en UTC, y se rechazaría la reserva
// de esa misma noche.
function hoyEn(zona, ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ¿Es una fecha real del calendario? '2026-02-30' pasa una expresión regular
// y no existe.
function fechaValida(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// Valida lo que llega de la carta. Devuelve los datos listos para guardar o el
// primer error en palabras que entiende quien rellenó el formulario.
// 'zona' es la del restaurante; 'ahora' se pasa en las pruebas.
function validarReserva(cuerpo, { zona = 'America/Bogota', ahora = new Date() } = {}) {
  const c = cuerpo || {};
  const nombre = limpio(c.nombre);
  if (!nombre) return { error: 'Escribe tu nombre' };
  if (nombre.length > NOMBRE_MAX) return { error: 'El nombre es demasiado largo' };

  const celular = normalizarCelular(c.celular);
  if (!celular) return { error: 'El celular no parece un número válido' };

  const fecha = limpio(c.fecha);
  if (!fechaValida(fecha)) return { error: 'Elige la fecha de la reserva' };
  const hoy = hoyEn(zona, ahora);
  if (fecha < hoy) return { error: 'Esa fecha ya pasó' };
  if (fecha > sumarDias(hoy, DIAS_ADELANTE_MAX)) return { error: `Solo se reserva con hasta ${DIAS_ADELANTE_MAX} días de anticipación` };

  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(limpio(c.hora));
  if (!m) return { error: 'Elige la hora de la reserva' };
  const hora = `${m[1]}:${m[2]}`;

  // Estrictamente entero: "4", 4.5 o "cuatro" no son un número de personas.
  const personas = c.personas;
  if (!Number.isInteger(personas) || personas < 1) return { error: 'Indica para cuántas personas es la reserva' };
  if (personas > PERSONAS_MAX) return { error: `Para grupos de más de ${PERSONAS_MAX} personas, escríbenos directamente` };

  return { datos: { nombre, celular, fecha, hora, personas } };
}

// El texto del botón de la bienvenida: el que configuró el restaurante o el de
// siempre. Se recorta aquí y también en el servidor al guardarlo.
function textoDelBoton(atributos) {
  return limpio(atributos?.intro_reservas_texto).slice(0, TEXTO_BOTON_MAX) || TEXTO_BOTON_DEFECTO;
}

// El mensaje con el que el restaurante le escribe al comensal, ya armado para
// el enlace de WhatsApp. Lleva la fecha tal cual está guardada: sin pasar por
// Date, que la correría un día según la zona de quien la mire.
function mensajeParaElComensal(r, restauranteNombre, estado = r.estado) {
  const fecha = String(r.fecha).slice(0, 10).split('-').reverse().join('/');
  const hora = String(r.hora).slice(0, 5);
  const lugar = restauranteNombre ? ` en ${restauranteNombre}` : '';
  const detalle = `${fecha} a las ${hora}, para ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}`;
  if (estado === 'confirmada') return `Hola ${r.nombre}, tu reserva${lugar} está confirmada: ${detalle}. ¡Te esperamos!`;
  if (estado === 'cancelada') return `Hola ${r.nombre}, no pudimos confirmar tu reserva${lugar} para el ${detalle}. ¿Quieres que busquemos otra hora?`;
  return `Hola ${r.nombre}, te escribimos por tu reserva${lugar}: ${detalle}.`;
}

function enlaceParaElComensal(r, restauranteNombre) {
  const base = enlaceWhatsapp(r.celular);
  return base ? `${base}?text=${encodeURIComponent(mensajeParaElComensal(r, restauranteNombre))}` : null;
}

// ── LAS PASADAS SE BORRAN A LOS 90 DÍAS ───────────────────────
// Ver la cabecera de sql/34. Se cuenta desde la fecha de la reserva, no desde
// cuándo se pidió: una reserva para dentro de dos meses no caduca antes de
// llegar. Es un compromiso de privacidad, no una limpieza opcional.
function corteReservas(ahora = new Date()) {
  return sumarDias(hoyEn('UTC', ahora), -DIAS_RETENCION);
}

// Devuelve cuántas borró, o null si falló. Nunca lanza: corre en un
// temporizador y ahí una excepción no la recoge nadie.
async function purgarPasadas(supabase, { ahora = new Date(), log = console } = {}) {
  try {
    const { data, error } = await supabase.from('reservas').delete()
      .lte('fecha', corteReservas(ahora)).select('id');
    if (error) throw new Error(error.message);
    const n = (data || []).length;
    if (n) log.log(`🗑️  reservas: ${n} con más de ${DIAS_RETENCION} días desde su fecha, borradas`);
    return n;
  } catch (e) {
    log.error(`⚠️  purga de reservas: ${e.message}`);
    return null;
  }
}

let temporizadores = [];
let purgaEnCurso = null;

function arrancarPurga(supabase) {
  const correr = () => {
    if (purgaEnCurso) return;
    purgaEnCurso = purgarPasadas(supabase).finally(() => { purgaEnCurso = null; });
  };
  temporizadores = [setTimeout(correr, 7 * 60 * 1000), setInterval(correr, INTERVALO_PURGA_MS)];
  temporizadores.forEach(t => t.unref());
}

async function detenerPurga() {
  temporizadores.forEach(t => { clearTimeout(t); clearInterval(t); });
  temporizadores = [];
  if (purgaEnCurso) await purgaEnCurso;
}

module.exports = {
  ESTADOS, PERSONAS_MAX, DIAS_ADELANTE_MAX, PENDIENTES_MAX_POR_CELULAR, TEXTO_BOTON_MAX,
  TEXTO_BOTON_DEFECTO, DIAS_RETENCION,
  normalizarCelular, pareceRobot, hoyEn, sumarDias, fechaValida, validarReserva, textoDelBoton,
  mensajeParaElComensal, enlaceParaElComensal, corteReservas, purgarPasadas, arrancarPurga, detenerPurga,
};
