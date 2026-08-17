'use strict';
// Cola de conversión de video.
//
// Convertir un plato cuesta ~86 segundos de CPU. Meter eso dentro de una
// petición HTTP significaría que el navegador espera minuto y medio y que
// diez subidas a la vez tumban el servidor. Así que la subida solo deja
// constancia en trabajos_video, y este módulo la vacía a su ritmo.
//
// Los parámetros de codificación salen de medir sobre un video real en el
// servidor de producción. El porqué de cada uno está en
// docs/cartas-en-video.md; no cambiar aquí sin leer eso primero.

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs   = require('fs');

const ejecutar = promisify(execFile);

const RAIZ = path.join(__dirname, 'uploads');

const CARPETAS = {
  origen:  'originales',   // el archivo crudo del móvil; se borra al terminar
  video:   'videos',       // el entregable que ve el cliente
  master:  'masters',      // el 1080p de archivo; nunca se sirve
  portada: 'miniaturas',   // el fotograma que se muestra antes de reproducir
};

const DURACION_MAX     = 8;                 // segundos
const INTENTOS_MAX     = 3;
const LIMITE_FFMPEG_MS = 10 * 60 * 1000;    // ~86 s esperados; 10 min es un cuelgue
const INTERVALO_MS     = 15_000;
// Un trabajo lleva menos de dos minutos. Si uno lleva una hora en
// 'procesando' es que el proceso murió a mitad, no que vaya lento.
const RESCATE_MS       = 60 * 60 * 1000;

// ── Argumentos de ffmpeg ──────────────────────────────────────
// Funciones puras a propósito: así se pueden comprobar en las pruebas sin
// ejecutar nada. -nostdin es obligatorio — sin él ffmpeg se come la entrada
// estándar del proceso padre y corrompe la ejecución.

const COMUNES = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-nostats', '-y'];

const recorte = (an, al) =>
  `scale=${an}:${al}:force_original_aspect_ratio=increase,crop=${an}:${al},fps=30`;

// El master NO se recorta. Recortar es una decisión de presentación, y el
// master existe justamente para sobrevivir a esas decisiones: si mañana la
// carta pide otra proporción, se vuelve a cortar desde aquí. Un master ya
// recortado no devuelve los píxeles que se tiraron.
//
// Solo se limita el lado largo a 1920 conservando la proporción original,
// así que un 16:9 sale 1920x1080 y un vertical sale 1080x1920 — el mismo
// número de píxeles en los dos casos, sin sorpresas de almacenamiento.
// force_divisible_by=2 lo exige yuv420p, que no admite lados impares.
// Tampoco se toca la cadencia: el master conserva la del original.
const sinRecorte = lado =>
  `scale=w=${lado}:h=${lado}:force_original_aspect_ratio=decrease:force_divisible_by=2`;

function argumentosEntregable(entrada, salida) {
  return [...COMUNES, '-i', entrada,
    '-t', String(DURACION_MAX),
    // 16:9 horizontal, 1280x720. Medido sobre una carta en video ya
    // publicada: sus archivos son 1280x720 y se sirven en un hueco de
    // ~824 px CSS, que en un móvil de 390 px a 3x son 1170 px físicos.
    // 1280 cubre eso sin desperdiciar.
    '-vf', recorte(1280, 720),
    '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-crf', '26', '-maxrate', '1500k', '-bufsize', '3000k', '-preset', 'slow',
    // faststart mueve el índice al principio del archivo: sin esto el
    // navegador descarga el video entero antes de pintar el primer cuadro.
    '-movflags', '+faststart',
    // Ningún navegador móvil autoreproduce con sonido, así que el audio
    // sería peso muerto. El master sí lo conserva.
    '-an',
    salida];
}

function argumentosMaster(entrada, salida) {
  return [...COMUNES, '-i', entrada,
    '-t', String(DURACION_MAX),
    '-vf', sinRecorte(1920),
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', '21', '-preset', 'medium',
    '-movflags', '+faststart',
    // Con audio: si algún día se quiere sonido, tiene que estar aquí. Un
    // master sin audio no permite recuperarlo después.
    '-c:a', 'aac', '-b:a', '96k',
    salida];
}

function argumentosPortada(entrada, salida) {
  return [...COMUNES, '-i', entrada,
    // Del segundo 1 y no del 0: el primer fotograma suele pillar la cámara
    // todavía enfocando.
    '-ss', '1', '-frames:v', '1', '-update', '1', '-q:v', '5',
    salida];
}

// ── Ejecución ─────────────────────────────────────────────────

// nice -n 19 deja a ffmpeg en la prioridad más baja. Con un solo núcleo,
// Express y ffmpeg comparten CPU: sin esto, convertir un video hace que las
// cartas tarden en cargar mientras dura.
function correrFfmpeg(args) {
  return ejecutar('nice', ['-n', '19', 'ffmpeg', ...args],
    { timeout: LIMITE_FFMPEG_MS, maxBuffer: 4 * 1024 * 1024 });
}

async function duracionDe(archivo) {
  try {
    const { stdout } = await ejecutar('ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo],
      { timeout: 30_000 });
    const n = parseFloat(String(stdout).trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// El nombre viene de nuestra propia ruta de subida, pero comprobarlo cuesta
// tres líneas y evita que un fallo futuro ahí se convierta en un ffmpeg
// leyendo /etc/passwd.
function rutaDentroDeUploads(relativa) {
  const abs = path.resolve(RAIZ, relativa);
  const rel = path.relative(RAIZ, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).length !== 2) return null;
  return abs;
}

function nombreUnico(ext) {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}

function urlDe(carpeta, nombre) {
  return `${process.env.BASE_URL}/uploads/${carpeta}/${nombre}`;
}

function asegurarCarpetas() {
  for (const c of Object.values(CARPETAS)) {
    const dir = path.join(RAIZ, c);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Un trabajo ────────────────────────────────────────────────

async function convertir(trabajo) {
  const entrada = rutaDentroDeUploads(trabajo.origen);
  if (!entrada) throw new Error('Ruta de origen inválida');
  if (!fs.existsSync(entrada)) throw new Error('El archivo original ya no está');

  asegurarCarpetas();

  // Los tres comparten raíz para que se puedan relacionar de un vistazo al
  // mirar la carpeta.
  const base    = nombreUnico('');
  const nVideo   = `${base}.mp4`;
  const nMaster  = `${base}-master.mp4`;
  const nPortada = `${base}.jpg`;

  const pVideo   = path.join(RAIZ, CARPETAS.video,   nVideo);
  const pMaster  = path.join(RAIZ, CARPETAS.master,  nMaster);
  const pPortada = path.join(RAIZ, CARPETAS.portada, nPortada);

  await correrFfmpeg(argumentosEntregable(entrada, pVideo));
  await correrFfmpeg(argumentosMaster(entrada, pMaster));
  await correrFfmpeg(argumentosPortada(pVideo, pPortada));

  // Comprobar antes de dar por bueno: ffmpeg puede terminar con código 0 y
  // dejar un archivo de cero segundos. Si se borrara el original confiando
  // en el código de salida, se perdería el video del cliente.
  const duracion = await duracionDe(pVideo);
  if (duracion <= 0) throw new Error('El video convertido no tiene duración');
  if (!fs.existsSync(pPortada) || fs.statSync(pPortada).size < 1024)
    throw new Error('La portada salió vacía');

  return {
    video:   path.join(CARPETAS.video,   nVideo),
    master:  path.join(CARPETAS.master,  nMaster),
    portada: path.join(CARPETAS.portada, nPortada),
    duracion,
  };
}

// ── Escritura del resultado ───────────────────────────────────

// atributos guarda otras cosas (las fotos del carrusel, por ejemplo), así
// que hay que leer y fundir. Un update directo las borraría.
async function guardarEnProducto(supabase, productoId, r) {
  const { data: prod } = await supabase
    .from('productos').select('atributos').eq('id', productoId).maybeSingle();
  if (!prod) return;

  const atributos = { ...(prod.atributos || {}) };
  // El master no se expone: la carta pública lee atributos entero y ese
  // archivo es interno. Su ruta vive en trabajos_video, que es donde la
  // buscará el día que haya que recodificar.
  atributos.video = {
    url:      urlDe(CARPETAS.video,   path.basename(r.video)),
    portada:  urlDe(CARPETAS.portada, path.basename(r.portada)),
    duracion: Math.round(r.duracion * 10) / 10,
  };

  await supabase.from('productos').update({ atributos }).eq('id', productoId);
}

async function procesarTrabajo(supabase, trabajo) {
  try {
    const r = await convertir(trabajo);

    await supabase.from('trabajos_video').update({
      estado: 'listo', video: r.video, master: r.master, portada: r.portada, error: null,
    }).eq('id', trabajo.id);

    if (trabajo.producto_id) await guardarEnProducto(supabase, trabajo.producto_id, r);

    // El último paso, y solo si todo lo anterior fue bien. Si se borrara
    // antes y fallara la escritura en base de datos, el trabajo quedaría
    // pendiente sin archivo del que partir.
    const orig = rutaDentroDeUploads(trabajo.origen);
    if (orig && fs.existsSync(orig)) { try { fs.unlinkSync(orig); } catch {} }

    console.log(`🎬 video listo (${r.duracion.toFixed(1)}s) · trabajo ${trabajo.id}`);
  } catch (e) {
    const intentos = (trabajo.intentos || 0) + 1;
    const agotado  = intentos >= INTENTOS_MAX;
    await supabase.from('trabajos_video').update({
      estado: agotado ? 'error' : 'pendiente',
      intentos,
      error: String(e.message || e).slice(0, 500),
    }).eq('id', trabajo.id);
    console.error(`⚠️  video falló (intento ${intentos}/${INTENTOS_MAX}) · ${e.message}`);
  }
}

// ── La cola ───────────────────────────────────────────────────

async function tomarSiguiente(supabase) {
  const { data: cola } = await supabase
    .from('trabajos_video').select('*')
    .eq('estado', 'pendiente').order('creado_en').limit(1);

  const t = cola?.[0];
  if (!t) return null;

  // Marcar exigiendo que siga pendiente. Con un solo worker no hay carrera,
  // pero si algún día se levantan dos procesos, el segundo se encuentra
  // cero filas actualizadas y sigue de largo en vez de convertir lo mismo.
  const { data: tomado } = await supabase
    .from('trabajos_video').update({ estado: 'procesando' })
    .eq('id', t.id).eq('estado', 'pendiente').select();

  return tomado?.length ? t : null;
}

async function rescatarColgados(supabase) {
  const limite = new Date(Date.now() - RESCATE_MS).toISOString();
  const { data } = await supabase
    .from('trabajos_video').update({ estado: 'pendiente' })
    .eq('estado', 'procesando').lt('actualizado_en', limite).select('id');
  if (data?.length) console.log(`♻️  ${data.length} trabajo(s) de video rescatados`);
}

function arrancar(supabase) {
  let ocupado = false;

  const tick = async () => {
    // Uno a la vez. Con un núcleo, dos ffmpeg en paralelo tardan el doble
    // cada uno y además dejan a Express sin CPU.
    if (ocupado) return;
    ocupado = true;
    try {
      const t = await tomarSiguiente(supabase);
      if (t) await procesarTrabajo(supabase, t);
    } catch (e) {
      console.error('⚠️  error en la cola de video:', e.message);
    } finally {
      ocupado = false;
    }
  };

  rescatarColgados(supabase).catch(() => {});
  // unref para que este temporizador no mantenga vivo el proceso por sí
  // solo; quien lo mantiene es el servidor HTTP.
  setInterval(tick, INTERVALO_MS).unref();
  console.log('🎬 cola de video en marcha');
}

async function encolar(supabase, { restaurante_id, producto_id, origen }) {
  const { data, error } = await supabase.from('trabajos_video')
    .insert([{ restaurante_id, producto_id: producto_id || null, origen }])
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  arrancar, encolar,
  CARPETAS, DURACION_MAX,
  // Exportados para las pruebas: son puros y se pueden comprobar sin
  // ejecutar ffmpeg ni tocar el disco.
  argumentosEntregable, argumentosMaster, argumentosPortada,
  rutaDentroDeUploads,
};
