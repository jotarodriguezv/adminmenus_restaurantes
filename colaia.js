'use strict';
// La cola de generación con IA.
//
// Es un carril APARTE del de conversión, y eso no es un detalle de estilo.
// video.js procesa un trabajo a la vez porque ffmpeg y Express comparten un
// solo núcleo. Generar no gasta CPU: es una llamada HTTP y esperar. Si las dos
// compartieran carril, una generación de dos minutos dejaría la conversión de
// videos reales parada dos minutos sin ningún motivo.
//
// Son dos límites distintos: la conversión se limita por CPU, la generación
// por presupuesto.
//
// Lo que hace este módulo es unir tres piezas que ya existen y no se conocen
// entre sí:
//
//   cupo.js  ── cuántas puede gastar y qué reservar
//   ia.js    ── hablar con Replicate
//   video.js ── convertir lo que salga
//
// Y el resultado es que trabajos_video no necesita saber que la IA existe: el
// video generado se descarga a originales/ y se encola como cualquier otro.

const path = require('path');
const fs   = require('fs');

const cupo  = require('./cupo');
const ia    = require('./ia');
const video = require('./video');

const RAIZ = path.join(__dirname, 'uploads');

// Más espaciado que la cola de conversión (15 s) a propósito: cada vuelta es
// una consulta a un tercero por cada generación en curso, y una generación
// tarda minutos. Mirar cada 15 s solo añadiría tráfico.
const INTERVALO_MS = 20_000;

// Un video de 6 s a 768p ronda los 3 MB. El tope no está para acotar lo
// normal sino para que una respuesta rara de un tercero no llene el disco:
// con el disco lleno no se cae el video, se cae el servidor entero.
const MAX_DESCARGA_MB = Number(process.env.IA_MAX_DESCARGA_MB || 100);

// Cuánto puede tardar una generación antes de darla por perdida. Muy por
// encima de lo que tarda de verdad: darla por muerta antes de tiempo
// significaría pagar una que sí iba a salir.
const LIMITE_GENERACION_MS = 30 * 60 * 1000;

// ── Descargar lo que devolvió el proveedor ────────────────────
// No se usa el nombre que venga en la URL: lo pone el servidor entero, igual
// que en las subidas. Lo que llega de fuera no nombra archivos en este disco.
function nombreGenerado() {
  return `ia-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
}

async function descargar(url, destinoAbs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`no se pudo descargar el video (${res.status})`);

  const tope = MAX_DESCARGA_MB * 1024 * 1024;
  // Se comprueba lo que promete la cabecera Y lo que llega de verdad: la
  // cabecera puede faltar o mentir, y para entonces ya se estaría escribiendo.
  const prometido = Number(res.headers.get('content-length') || 0);
  if (prometido > tope) throw new Error(`el video generado pasa de ${MAX_DESCARGA_MB} MB`);

  fs.mkdirSync(path.dirname(destinoAbs), { recursive: true });
  const trozos = [];
  let bytes = 0;
  for await (const trozo of res.body) {
    bytes += trozo.length;
    if (bytes > tope) throw new Error(`el video generado pasa de ${MAX_DESCARGA_MB} MB`);
    trozos.push(trozo);
  }
  if (!bytes) throw new Error('el video generado llegó vacío');

  fs.writeFileSync(destinoAbs, Buffer.concat(trozos));
  return bytes;
}

// ── Lanzar una generación ─────────────────────────────────────
// El orden de estas tres cosas es lo que impide pagar de más:
//
//   1. Reservar el cupo      ── antes de llamar, para que el tope sirva
//   2. Crear la predicción   ── la llamada que cuesta dinero
//   3. Anotar su identificador ── ANTES de esperar nada
//
// Si el paso 3 no existiera y la respuesta del paso 2 se perdiera, no habría
// forma de saber que ya se generó: el reintento pagaría otra vez.
async function lanzar(supabase, { restaurante_id, producto_id, foto_url, prompt }) {
  const reserva = await cupo.reservar(supabase, { restaurante_id, producto_id });

  let prediccion;
  try {
    prediccion = await ia.crearPrediccion(foto_url, prompt);
  } catch (e) {
    // La llamada no llegó a crear nada, así que no se cobró: el cupo vuelve.
    // Si esto se dejara consumido, un problema de red le costaría una
    // animación al restaurante sin haber generado nada.
    await cupo.marcarFallida(supabase, reserva.id, e.message, { cobrada: false });
    throw e;
  }

  await cupo.anotarPrediccion(supabase, reserva.id, prediccion.id);
  return { generacion_id: reserva.id, prediction_id: prediccion.id };
}

// ── Recoger una generación terminada ──────────────────────────
async function recoger(supabase, gen) {
  const r = await ia.consultarPrediccion(gen.prediction_id);
  if (r.estado === 'generando') {
    // Sigue en curso. Solo se abandona si lleva demasiado: darla por muerta
    // antes de tiempo sería pagar una que iba a salir bien.
    if (Date.now() - new Date(gen.creado_en).getTime() > LIMITE_GENERACION_MS)
      await cupo.marcarFallida(supabase, gen.id, 'La generación tardó demasiado', { cobrada: true });
    return false;
  }

  if (r.estado === 'error' || !r.url) {
    await cupo.marcarFallida(supabase, gen.id, r.error || 'La generación falló', { cobrada: r.cobrada });
    return false;
  }

  // A partir de aquí el video existe y está pagado. Lo que queda es meterlo en
  // la cola de siempre.
  const nombre = nombreGenerado();
  const relativa = path.join(video.CARPETAS.origen, nombre);
  try {
    await descargar(r.url, path.join(RAIZ, relativa));
  } catch (e) {
    // Se pagó igual: el fallo es nuestro al recogerlo, no del proveedor.
    await cupo.marcarFallida(supabase, gen.id, `descargando: ${e.message}`, { cobrada: true });
    return false;
  }

  // El formato lo decide el modelo del restaurante, exactamente igual que con
  // un video grabado: el modelo no acepta proporción, así que el recorte lo
  // sigue haciendo ffmpeg.
  const { data: resto } = await supabase.from('restaurantes')
    .select('atributos').eq('id', gen.restaurante_id).maybeSingle();
  const formato = resto?.atributos?.nav === 'vertical' ? 'vertical' : 'horizontal';

  await video.encolar(supabase, {
    restaurante_id: gen.restaurante_id,
    producto_id: gen.producto_id,
    origen: relativa,
    desde: 0,          // lo generado empieza donde tiene que empezar
    formato,
  });

  await cupo.marcarLista(supabase, gen.id);
  console.log(`✨ generación lista y encolada · ${gen.id}`);
  return true;
}

// ── El bucle ──────────────────────────────────────────────────
async function pasada(supabase) {
  const { data: enCurso } = await supabase.from('generaciones_ia')
    .select('id, restaurante_id, producto_id, prediction_id, creado_en')
    .eq('estado', 'generando').order('creado_en').limit(10);

  let recogidas = 0;
  for (const gen of enCurso || []) {
    if (!gen.prediction_id) continue;
    try {
      if (await recoger(supabase, gen)) recogidas++;
    } catch (e) {
      // Que una generación con problemas no impida mirar las demás.
      console.error(`⚠️  recogiendo la generación ${gen.id}: ${e.message}`);
    }
  }
  return recogidas;
}

function arrancar(supabase) {
  let ocupado = false;

  const tick = async () => {
    // El flag es suyo, no el de la conversión: las dos colas avanzan a la vez.
    if (ocupado) return;
    ocupado = true;
    try {
      await cupo.rescatarReservas(supabase);
      await pasada(supabase);
    } catch (e) {
      console.error('⚠️  error en la cola de IA:', e.message);
    } finally {
      ocupado = false;
    }
  };

  setInterval(tick, INTERVALO_MS).unref();
  console.log('✨ cola de generación con IA en marcha');
}

module.exports = {
  arrancar, lanzar, pasada, recoger, descargar,
  INTERVALO_MS, MAX_DESCARGA_MB, LIMITE_GENERACION_MS,
};
