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

const DURACION_MAX     = 8;                 // segundos que se guardan
// Por debajo de esto el bucle de la carta da tirones y marea más que vender.
// Se rechaza en vez de convertirlo: un video de un segundo no es un video
// corto, es un error de grabación.
const DURACION_MIN     = 3;
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
//
// El min() no es adorno: con la caja fija en 1920x1920, 'decrease' AMPLÍA
// las fuentes más pequeñas — un 1280x959 saldría 1920x1438, más pesado que
// el original y sin un píxel de información nueva. Acotando la caja al
// tamaño de la fuente, el filtro solo reduce y nunca amplía.
//
// Las comas van escapadas porque dentro de un filtro la coma separa
// argumentos: sin la barra, ffmpeg leería min(1920 y iw) como dos filtros.
const sinRecorte = lado =>
  `scale=w=min(${lado}\\,iw):h=min(${lado}\\,ih)` +
  `:force_original_aspect_ratio=decrease:force_divisible_by=2`;

// El recorte no tiene por qué empezar en el segundo 0. Un restaurante graba
// treinta segundos con el móvil y lo bueno —el plato saliendo, el queso
// cayendo— casi nunca está al principio. Este es el único momento en que se
// puede elegir: el original se borra al terminar y el master se corta igual,
// así que lo que no entre aquí no se recupera.
//
// -ss va ANTES de -i a propósito. Así ffmpeg salta usando el índice del
// archivo en vez de decodificar y tirar todo lo anterior; con un original de
// medio minuto la diferencia en CPU se nota, y desde ffmpeg 2.1 ese salto
// previo también cae en el fotograma exacto.
const desdeDe = seg => (seg > 0 ? ['-ss', String(seg)] : []);

// La proporción del entregable la decide el modelo que va a pintarlo, y viene
// guardada en el trabajo. En horizontal, 1280x720: medido sobre una carta en
// video ya publicada, que sirve 1280x720 en un hueco de ~824 px CSS — en un
// móvil de 390 px a 3x son 1170 px físicos, así que 1280 cubre sin
// desperdiciar. En vertical es el mismo cálculo del revés.
//
// El master no cambia: sigue sin recortar en los dos casos. Por eso pasar un
// restaurante de un formato al otro es reconvertir, no volver a grabar.
// Cada formato con su medida Y su calidad, en una sola tabla. Van juntas
// porque la calidad que hace falta depende de dónde se va a mirar el video, y
// eso lo decide el formato.
//
// Los dos tienen el mismo número de píxeles —720x1280 y 1280x720 son lo
// mismo girado—, así que la diferencia no es de resolución sino de tamaño en
// pantalla. El apaisado se ve en una tarjeta dentro de una lista; el vertical
// ocupa la pantalla entera del móvil. A ese tamaño el mismo archivo perdona
// muchísimo menos: se le nota el bloque en las sombras y el ruido en los
// degradados.
//
// De ahí que el vertical gaste más bits. Sale a algo más del doble de peso
// (de ~1 MB a ~2,3 MB por plato), y es donde tiene sentido gastarlos: es el
// modelo cuyo único contenido es el video a tamaño completo.
//
// El maxrate sube con el crf a propósito. Con el tope en 1500k, bajar el crf
// no serviría de nada en los planos con movimiento —justo donde se ve el
// problema—: el limitador recortaría la mejora antes de que llegue.
//
// Ojo: esto solo afecta a las conversiones NUEVAS. Los videos ya convertidos
// se quedan como están; para rehacerlos hay que volver a codificar desde su
// master, que para eso se guarda sin recortar.
const FORMATOS = {
  horizontal: { ancho: 1280, alto:  720, crf: 30, maxrate: '1500k', bufsize: '3000k' },
  vertical:   { ancho:  720, alto: 1280, crf: 26, maxrate: '2500k', bufsize: '5000k' },
};

// Compatibilidad hacia atrás: había código y pruebas mirando MEDIDAS.
const MEDIDAS = Object.fromEntries(
  Object.entries(FORMATOS).map(([k, f]) => [k, [f.ancho, f.alto]]));

function argumentosEntregable(entrada, salida, desde = 0, formato = 'horizontal') {
  const f = FORMATOS[formato] || FORMATOS.horizontal;
  return [...COMUNES, ...desdeDe(desde), '-i', entrada,
    '-t', String(DURACION_MAX),
    '-vf', recorte(f.ancho, f.alto),
    '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-crf', String(f.crf), '-maxrate', f.maxrate, '-bufsize', f.bufsize, '-preset', 'slow',
    // faststart mueve el índice al principio del archivo: sin esto el
    // navegador descarga el video entero antes de pintar el primer cuadro.
    '-movflags', '+faststart',
    // Ningún navegador móvil autoreproduce con sonido, así que el audio
    // sería peso muerto. El master sí lo conserva.
    '-an',
    salida];
}

function argumentosMaster(entrada, salida, desde = 0) {
  return [...COMUNES, ...desdeDe(desde), '-i', entrada,
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

// Del segundo 1 y no del 0: el primer fotograma suele pillar la cámara
// todavía enfocando. Pero el instante es un parámetro y no una constante
// porque un video puede durar menos de un segundo —un toque sin querer al
// grabar— y entonces ese salto cae más allá del final: ffmpeg termina con
// código 0 y deja un JPEG vacío, y el trabajo muere en "La portada salió
// vacía" sin que se entienda por qué. Quien llama decide el instante
// sabiendo ya cuánto dura.
// El 1,2 y no el 1 deja un margen: pedirle el fotograma exacto del final a
// un clip de 1,05 s es pedirle que acierte al milisegundo.
const instantePortada = duracion => (duracion > 1.2 ? 1 : duracion / 2);

function argumentosPortada(entrada, salida, instante = 1) {
  return [...COMUNES, '-i', entrada,
    '-ss', String(instante), '-frames:v', '1', '-update', '1', '-q:v', '5',
    salida];
}

// Hay fallos que no se arreglan repitiéndolos: un video demasiado corto lo
// seguirá siendo dentro de un minuto. Marcarlos evita gastar tres intentos y
// tres minutos de CPU en llegar al mismo sitio, y deja el motivo a la vista
// del restaurante en vez de un "reintentando" que no lleva a ninguna parte.
class ErrorDefinitivo extends Error {
  constructor(mensaje) { super(mensaje); this.definitivo = true; }
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
  if (!entrada) throw new ErrorDefinitivo('Ruta de origen inválida');
  if (!fs.existsSync(entrada)) throw new ErrorDefinitivo('El archivo original ya no está');

  // numeric de Postgres puede llegar como cadena según el cliente.
  const desde = Number(trabajo.desde) || 0;

  // Se mide antes de convertir, no después. Un clip demasiado corto no
  // mejora reintentando y convertirlo cuesta minuto y medio para acabar en
  // un bucle que marea. El panel ya lo impide, pero el panel es solo la
  // puerta bonita: quien llame a la API directamente entra por aquí.
  const duracionOriginal = await duracionDe(entrada);
  const aprovechable = duracionOriginal - desde;
  if (duracionOriginal > 0 && aprovechable < DURACION_MIN) {
    throw new ErrorDefinitivo(desde > 0
      ? `Desde el segundo ${desde} solo quedan ${Math.max(0, aprovechable).toFixed(1)} s, y hacen falta al menos ${DURACION_MIN}`
      : `El video dura ${duracionOriginal.toFixed(1)} s y hacen falta al menos ${DURACION_MIN}`);
  }

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

  await correrFfmpeg(argumentosEntregable(entrada, pVideo, desde, trabajo.formato));
  await correrFfmpeg(argumentosMaster(entrada, pMaster, desde));

  // Comprobar antes de dar por bueno: ffmpeg puede terminar con código 0 y
  // dejar un archivo de cero segundos. Si se borrara el original confiando
  // en el código de salida, se perdería el video del cliente.
  const duracion = await duracionDe(pVideo);
  if (duracion <= 0) throw new Error('El video convertido no tiene duración');

  // La portada va después de medir: un clip de medio segundo no tiene
  // "segundo 1" del que sacarla. Con margen de sobra se coge el segundo 1
  // como siempre; si no, la mitad del clip, que siempre existe.
  await correrFfmpeg(argumentosPortada(pVideo, pPortada, instantePortada(duracion)));

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

// Un plato enseña un video, no dos. Cuando se sube otro, el anterior deja de
// estar en productos.atributos pero sus tres archivos siguen en el disco —y
// su fila en trabajos_video los sigue nombrando, así que el limpiador
// tampoco los recoge: para él están referenciados—. Son unos 7 MB por
// reemplazo, casi todo master, y reemplazar el video de un plato es de lo más
// normal: cambia la receta, salió mal, entra la carta de temporada.
//
// Solo se tocan los trabajos ya terminados. Uno 'pendiente' o 'procesando'
// puede ser una segunda subida en camino, y borrarle la fila a ffmpeg
// mientras trabaja lo dejaría escribiendo en archivos de nadie.
async function purgarAnteriores(supabase, trabajo) {
  if (!trabajo.producto_id) return;

  const { data: viejos } = await supabase.from('trabajos_video')
    .select('id, video, master, portada')
    .eq('producto_id', trabajo.producto_id)
    .neq('id', trabajo.id)
    .in('estado', ['listo', 'error']);

  for (const v of viejos || []) {
    for (const relativa of [v.video, v.master, v.portada]) {
      const abs = relativa && rutaDentroDeUploads(relativa);
      if (abs && fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch {} }
    }
    await supabase.from('trabajos_video').delete().eq('id', v.id);
  }

  if (viejos?.length) console.log(`🧹 ${viejos.length} video(s) anteriores del plato retirados`);
}

// Un trabajo espera revisión si lo generó un modelo y nadie lo ha mirado.
// Función suelta y exportada porque la usan tres sitios —la cola, la ruta de
// aprobación y las pruebas— y tener la condición escrita tres veces es cómo
// acaban discrepando.
function esperaAprobacion(trabajo) {
  return trabajo?.origen_tipo === 'ia' && trabajo?.aprobado !== true;
}

// Publica en la carta un trabajo que ya estaba convertido y esperando. Es lo
// mismo que hace procesarTrabajo al terminar, pero en diferido: por eso
// reutiliza las dos funciones y no repite la lógica.
//
// El trabajo tiene que traer ya sus rutas (video, master, portada); si no las
// tiene es que la conversión no llegó a terminar y no hay nada que publicar.
async function publicarTrabajo(supabase, trabajo) {
  if (!trabajo?.video || !trabajo?.portada)
    throw new Error('Ese video todavía no está convertido');
  if (!trabajo.producto_id)
    throw new Error('Ese video no está asociado a ningún plato');

  const duracion = await duracionDe(path.join(RAIZ, trabajo.video));
  await guardarEnProducto(supabase, trabajo.producto_id, {
    video: trabajo.video, master: trabajo.master, portada: trabajo.portada, duracion,
  });
  await purgarAnteriores(supabase, trabajo);
  await supabase.from('trabajos_video').update({ aprobado: true }).eq('id', trabajo.id);
}

// Lo contrario de publicar. Borra los tres archivos aquí mismo en vez de
// dejárselos al limpiador: el limpiador espera siete días de gracia, y entre
// entregable, master y portada un video generado ocupa unos 7 MB. Con
// veinticinco platos y algún descarte en cada uno, eso es medio giga esperando
// una semana en el mismo disco cuyo espacio ya se vigila antes de cada subida.
//
// La fila NO se borra. Se marca, y así queda constancia de que esa generación
// —que se pagó igual— se miró y no valía. generaciones_ia dice que se generó;
// lo que se decidió después solo consta aquí.
async function descartarTrabajo(supabase, trabajo) {
  for (const relativa of [trabajo.video, trabajo.master, trabajo.portada]) {
    const abs = relativa && rutaDentroDeUploads(relativa);
    if (abs && fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch {} }
  }

  // Las rutas se dejan en null a la vez que se marca. Si siguieran apuntando a
  // archivos ya borrados, cualquier cosa que lea la fila —la ficha del plato,
  // el limpiador contando referencias— creería que todavía están.
  await supabase.from('trabajos_video').update({
    aprobado: false, video: null, master: null, portada: null,
  }).eq('id', trabajo.id);
}

async function procesarTrabajo(supabase, trabajo) {
  try {
    const r = await convertir(trabajo);

    await supabase.from('trabajos_video').update({
      estado: 'listo', video: r.video, master: r.master, portada: r.portada, error: null,
    }).eq('id', trabajo.id);

    // Un video generado por un modelo NO entra solo en la carta. El modelo no
    // copia el plato: lo interpreta, y al orbitar tiene que rellenar el lado
    // que la foto no enseña. Si ahí aparece una guarnición que el negocio no
    // sirve, eso es publicidad engañosa y el expuesto es el restaurante.
    //
    // Así que el archivo queda convertido y visible en el panel, pero el
    // plato sigue enseñando su foto hasta que alguien lo mire. Lo publica
    // publicarTrabajo(), desde la ruta de aprobación.
    //
    // Los subidos a mano no pasan por aquí: quien sube un video suyo ya lo ha
    // visto, y pedirle que lo apruebe sería preguntar dos veces lo mismo.
    if (esperaAprobacion(trabajo)) {
      console.log(`🎬 video generado listo, esperando revisión · trabajo ${trabajo.id}`);
    } else if (trabajo.producto_id) {
      await guardarEnProducto(supabase, trabajo.producto_id, r);

      // Después de que atributos apunte al nuevo, nunca antes: si esto se
      // hiciera primero y fallara la escritura, el plato se quedaría señalando
      // archivos recién borrados.
      await purgarAnteriores(supabase, trabajo);
    }

    // El último paso, y solo si todo lo anterior fue bien. Si se borrara
    // antes y fallara la escritura en base de datos, el trabajo quedaría
    // pendiente sin archivo del que partir.
    const orig = rutaDentroDeUploads(trabajo.origen);
    if (orig && fs.existsSync(orig)) { try { fs.unlinkSync(orig); } catch {} }

    console.log(`🎬 video listo (${r.duracion.toFixed(1)}s) · trabajo ${trabajo.id}`);
  } catch (e) {
    const intentos = (trabajo.intentos || 0) + 1;
    // Un fallo definitivo no se reintenta: repetirlo daría el mismo resultado
    // tres minutos después y el restaurante seguiría sin saber qué pasa.
    const agotado  = e.definitivo || intentos >= INTENTOS_MAX;
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

// Cada cuánto se vuelve a mirar si hay trabajos abandonados. No en cada
// vuelta de la cola: son 15 segundos y esto es una consulta que casi siempre
// no encuentra nada.
const RESCATE_CADA_MS = 30 * 60 * 1000;

function arrancar(supabase) {
  let ocupado = false;
  let ultimoRescate = 0;

  const tick = async () => {
    // Uno a la vez. Con un núcleo, dos ffmpeg en paralelo tardan el doble
    // cada uno y además dejan a Express sin CPU.
    if (ocupado) return;
    ocupado = true;
    try {
      // El rescate corría SOLO al arrancar. Un trabajo se queda en
      // 'procesando' cuando el proceso muere a mitad de conversión —un
      // reinicio del contenedor, un OOM—, y ese estado no lo desbloquea
      // nadie: el trabajo no vuelve a la cola porque ya no está
      // 'pendiente', y el restaurante ve "convirtiendo" para siempre. Con
      // el rescate solo al arranque, la única cura era otro despliegue.
      if (Date.now() - ultimoRescate >= RESCATE_CADA_MS) {
        ultimoRescate = Date.now();
        await rescatarColgados(supabase);
      }
      const t = await tomarSiguiente(supabase);
      if (t) await procesarTrabajo(supabase, t);
    } catch (e) {
      console.error('⚠️  error en la cola de video:', e.message);
    } finally {
      ocupado = false;
    }
  };

  rescatarColgados(supabase).catch(() => {});
  ultimoRescate = Date.now();
  // unref para que este temporizador no mantenga vivo el proceso por sí
  // solo; quien lo mantiene es el servidor HTTP.
  setInterval(tick, INTERVALO_MS).unref();
  console.log('🎬 cola de video en marcha');
}

async function encolar(supabase, { restaurante_id, producto_id, origen, desde = 0, formato = 'horizontal', origen_tipo = 'subido' }) {
  const { data, error } = await supabase.from('trabajos_video')
    .insert([{ restaurante_id, producto_id: producto_id || null, origen, desde, formato, origen_tipo }])
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  arrancar, encolar,
  CARPETAS, DURACION_MAX, DURACION_MIN, MEDIDAS, FORMATOS,
  // Exportados para las pruebas: son puros y se pueden comprobar sin
  // ejecutar ffmpeg ni tocar el disco.
  argumentosEntregable, argumentosMaster, argumentosPortada, instantePortada,
  purgarAnteriores, esperaAprobacion, publicarTrabajo, descartarTrabajo, guardarEnProducto,
  rutaDentroDeUploads,
};
