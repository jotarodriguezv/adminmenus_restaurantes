'use strict';
// ── SOLICITUDES DE ALTA DE RESTAURANTES ───────────────────────
// Las reglas, aparte de las rutas de server.js para poder probarlas sin
// servidor. Decidido con el usuario el 18-19/09/2026; la tabla está en
// sql/25_solicitudes.sql y el porqué de todo en su cabecera.
//
// Lo que no se negocia:
//   · Una solicitud NUNCA crea un restaurante. La aprueba una persona desde el
//     superadmin, y por eso un robot, en el peor caso, ensucia una lista.
//   · Se guarda PRIMERO y se avisa DESPUÉS. Si n8n o Telegram fallan, el lead
//     sigue en la bandeja: el aviso es una comodidad, no el registro.
//   · Lleva datos personales: sin la autorización marcada no se guarda nada.

const ORIGENES = ['meta', 'campo', 'web'];
const ESTADOS = ['nueva', 'contactada', 'aprobada', 'descartada'];
// Las que todavía piden que alguien haga algo. Una repetida contra una de estas
// no se guarda otra vez: sería el mismo cliente llamado dos veces.
const ESTADOS_ABIERTOS = ['nueva', 'contactada'];

// Cuánto puede medir cada campo. Los mismos límites que la tabla.
const LARGOS = { negocio: 120, contacto: 120, ciudad: 80, tipo_negocio: 60, comercial: 80, notas: 1000 };

// Menos de esto entre abrir la página y enviarla no lo hace una persona. Tres
// segundos dejan margen a quien rellena rápido con el autocompletado del móvil.
const MINIMO_MS_EN_PAGINA = 3000;

// ── EL NÚMERO DE WHATSAPP ─────────────────────────────────────
// Se guarda solo con dígitos y el indicativo del país, para poder montar el
// enlace wa.me y encontrar repetidas sin pelear con espacios, guiones o «+».
// Un celular colombiano se escribe casi siempre sin indicativo (3001234567):
// 10 dígitos que empiezan por 3. A esos se les pone el 57.
function normalizarWhatsapp(texto) {
  let d = String(texto || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;
  return /^[0-9]{8,15}$/.test(d) ? d : null;
}

// Recorta espacios y deja un solo espacio seguido. Nada más: el texto se
// guarda como lo escribió la persona, y donde se enseña se escapa.
function limpio(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

// Valida lo que llega y devuelve los datos listos para guardar, o el primer
// error en palabras que entiende quien rellenó el formulario.
function validarSolicitud(cuerpo, origen) {
  const c = cuerpo || {};
  if (!ORIGENES.includes(origen)) return { error: 'Origen desconocido' };

  const datos = { origen };
  for (const campo of Object.keys(LARGOS)) {
    const v = limpio(c[campo]);
    if (v.length > LARGOS[campo]) return { error: `El campo «${campo}» es demasiado largo` };
    datos[campo] = v || null;
  }
  // Las notas conservan los saltos de línea: son lo único que se escribe en
  // párrafos.
  if (c.notas) {
    const n = String(c.notas).trim();
    if (n.length > LARGOS.notas) return { error: 'Las notas son demasiado largas' };
    datos.notas = n || null;
  }

  if (!datos.negocio) return { error: 'Falta el nombre del negocio' };
  if (!datos.contacto) return { error: 'Falta el nombre de la persona de contacto' };
  const whatsapp = normalizarWhatsapp(c.whatsapp);
  if (!whatsapp) return { error: 'El WhatsApp no parece un número válido' };
  datos.whatsapp = whatsapp;

  // Estrictamente true: una casilla sin marcar puede llegar como "false",
  // "off" o nada, y ninguna de esas cosas es una autorización.
  if (c.autoriza_datos !== true) return { error: 'Hace falta la autorización para tratar los datos' };
  datos.autoriza_datos = true;
  datos.autorizado_en = new Date().toISOString();

  // En la página, el que envía como comercial es 'campo'; sin nombre, 'web'.
  if (origen !== 'meta') datos.origen = datos.comercial ? 'campo' : 'web';
  return { datos };
}

// ¿Lo mandó un robot? Dos señales baratas que no molestan a nadie:
//   · el campo trampa: está en la página pero escondido, así que una persona
//     no lo ve ni lo rellena, y un robot que rellena todo sí;
//   · el tiempo: cuándo se abrió la página, y si se envió en menos de lo que
//     tarda una persona.
// A un robot NO se le dice que se le detectó: se le contesta como si todo
// fuera bien, para que no aprenda a esquivarlo.
function pareceRobot(cuerpo, ahora = Date.now()) {
  const c = cuerpo || {};
  if (limpio(c.sitio_web)) return 'campo trampa';
  const abierto = Number(c.abierto_en);
  if (!Number.isFinite(abierto) || abierto <= 0) return 'sin hora de apertura';
  if (ahora - abierto < MINIMO_MS_EN_PAGINA) return 'demasiado rápido';
  return null;
}

// El enlace para escribirle por WhatsApp desde el aviso o la bandeja.
function enlaceWhatsapp(whatsapp) {
  return whatsapp ? `https://wa.me/${whatsapp}` : null;
}

// El mensaje del aviso, ya escrito, para que n8n solo tenga que mandarlo a
// Telegram. En texto plano a propósito: con formato Markdown o HTML, un
// nombre de negocio con un asterisco o un «<» rompería el mensaje o, peor,
// cambiaría lo que dice. En n8n, el nodo de Telegram sin «Parse Mode».
function textoDelAviso(s, enlacePanel) {
  const origen = { meta: 'Anuncio de Meta', campo: `Equipo en campo${s.comercial ? ` (${s.comercial})` : ''}`, web: 'Página de solicitud' }[s.origen] || s.origen;
  return [
    '🆕 Nueva solicitud de alta',
    '',
    `🏪 ${s.negocio}`,
    `👤 ${s.contacto}`,
    `📱 ${enlaceWhatsapp(s.whatsapp)}`,
    s.ciudad ? `📍 ${s.ciudad}` : null,
    s.tipo_negocio ? `🍽 ${s.tipo_negocio}` : null,
    `📣 ${origen}`,
    s.notas ? `📝 ${s.notas}` : null,
    enlacePanel ? '' : null,
    enlacePanel ? `Revisarla: ${enlacePanel}` : null,
  ].filter(l => l !== null).join('\n');
}

// Lo que se le manda a n8n. Todo lo que necesita un flujo de Telegram, de
// Google Sheets o de un CRM, y el texto ya armado.
function avisoParaN8n(s, enlacePanel) {
  return {
    evento: 'solicitud_nueva',
    id: s.id,
    origen: s.origen,
    negocio: s.negocio,
    contacto: s.contacto,
    whatsapp: s.whatsapp,
    whatsapp_enlace: enlaceWhatsapp(s.whatsapp),
    ciudad: s.ciudad,
    tipo_negocio: s.tipo_negocio,
    comercial: s.comercial,
    notas: s.notas,
    creado_en: s.creado_en,
    enlace_panel: enlacePanel || null,
    texto: textoDelAviso(s, enlacePanel),
  };
}

// Avisa a n8n y NUNCA lanza: si falla, se registra y la solicitud sigue
// guardada en la bandeja. Cinco segundos como mucho, para no dejar colgada la
// respuesta a quien envió el formulario.
async function avisarN8n(s, { url, clave, enlacePanel, fetchFn = fetch, log = console } = {}) {
  if (!url) return false;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-clave-solicitudes': clave } : {}) },
      body: JSON.stringify(avisoParaN8n(s, enlacePanel)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`n8n respondió ${res.status}`);
    return true;
  } catch (e) {
    log.error(`⚠️  aviso de solicitud a n8n: ${e.message} (la solicitud ${s.id} quedó guardada)`);
    return false;
  }
}

module.exports = {
  ORIGENES, ESTADOS, ESTADOS_ABIERTOS, LARGOS, MINIMO_MS_EN_PAGINA,
  normalizarWhatsapp, validarSolicitud, pareceRobot, enlaceWhatsapp,
  textoDelAviso, avisoParaN8n, avisarN8n,
};
