'use strict';
// Generación de video con IA (Replicate · minimax/hailuo-02).
//
// Este módulo hace UNA cosa: hablar con Replicate. No sabe de cupos, ni de la
// cola, ni de ffmpeg. Se separó así porque es lo único que depende de un
// tercero: el día que cambie el proveedor o el modelo, se reescribe esto y
// nada más.
//
// Lo que hace la cola con el resultado no cambia: el video que devuelve
// Replicate se descarga a originales/ y a partir de ahí es un origen como el
// de un móvil. Ver docs/video-con-ia.md §2.
//
// ⚠ La forma de la API (rutas y nombres de campo) NO se pudo comprobar contra
// la documentación desde el entorno donde se escribió esto: el proxy bloquea
// replicate.com. Los nombres del INPUT sí están confirmados —salen del editor
// JSON del propio modelo— pero las rutas y el nombre de 'status'/'output' son
// la API general de Replicate, y hay que verlas funcionar una vez antes de
// darlas por buenas. La primera generación real es esa comprobación.

const REPLICATE = 'https://api.replicate.com/v1';

// Todo configurable por entorno para poder cambiar de modelo, duración o
// resolución sin desplegar código. Los valores por defecto son los decididos
// en docs/video-con-ia.md §3.
const MODELO     = process.env.IA_MODELO     || 'minimax/hailuo-02';
const DURACION   = Number(process.env.IA_DURACION || 6);
const RESOLUCION = process.env.IA_RESOLUCION || '768p';

// Cuánto se espera a que Replicate ACEPTE la petición. No es lo que tarda en
// generar —eso se consulta después—, solo lo que tarda en decir "recibido".
const LIMITE_CREAR_MS  = 30_000;
const LIMITE_MIRAR_MS  = 15_000;

// El prompt lo fija la plataforma, no el restaurante. Dos motivos, y el
// segundo es el que manda:
//
//   1. Un prompt libre da resultados impredecibles y cada intento se paga.
//   2. La restricción de producto: movimiento de cámara sobre el plato REAL.
//      Si el modelo agrega una guarnición que el restaurante no sirve, eso es
//      publicidad engañosa y el expuesto ante la SIC es el cliente. Un campo de
//      texto libre en el panel sería justo la forma de que eso pase.
//
// Este texto es el que se probó a mano en Replicate y dio buen resultado. Fija
// tres cosas y conviene no perderlas al retocarlo:
//
//   · el MOVIMIENTO — una órbita de frente a 3/4, no un zoom ni un barrido
//   · el PLATO QUIETO — "centered and completely still", para que no flote
//   · NADA MÁS SE MUEVE — sin esto el modelo anima el fondo, los cubiertos,
//     lo que pille
//
// ⚠ Lo que NO fija: que no se inventen ingredientes. Y la órbita es
// precisamente lo que más lo pide, porque al girar hacia 3/4 el modelo tiene
// que RELLENAR el lado del plato que la foto no muestra. Ahí es donde puede
// aparecer una guarnición que nadie sirve. Está sin cubrir a conciencia —el
// prompt es del usuario y este es el que le funcionó—, y la red que lo atrapa
// es el paso de aprobación de la fase 3. Ver docs/video-con-ia.md §9.
//
// Se deja en una variable de entorno para poder afinarlo sin desplegar.
const PROMPT = process.env.IA_PROMPT ||
  'Camera slowly orbits around the dish from front to a 3/4 side angle, ' +
  'plate stays centered and completely still, steady smooth camera motion, ' +
  'consistent soft natural lighting, shallow depth of field, ' +
  'photorealistic food photography style, no other movement in the scene';

// ── El cuerpo de la petición ──────────────────────────────────
// Función pura y exportada a propósito, igual que argumentosEntregable en
// video.js: se puede comprobar sin llamar a nadie ni gastar un dólar.
//
// No lleva proporción porque el modelo no la acepta: la hereda de la foto.
// Eso significa que el recorte al formato del restaurante lo sigue haciendo
// ffmpeg después, exactamente igual que con un video grabado.
function entradaDe(fotoUrl, prompt = PROMPT) {
  return {
    first_frame_image: fotoUrl,
    prompt,
    duration: DURACION,
    resolution: RESOLUCION,
    // El optimizador reescribe el prompt por su cuenta. Este texto se afinó a
    // mano hasta dar con el movimiento que se quería —una órbita concreta, no
    // un zoom— y dejar que lo reescriba es perder justo eso.
    prompt_optimizer: false,
  };
}

function cabeceras() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('Falta REPLICATE_API_TOKEN');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function pedir(url, opciones, limiteMs) {
  const corte = AbortSignal.timeout(limiteMs);
  const res = await fetch(url, { ...opciones, signal: corte });
  const texto = await res.text();

  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { /* Replicate puede devolver HTML en un 502 */ }

  if (!res.ok) {
    const e = new Error(cuerpo?.detail || `Replicate respondió ${res.status}`);
    e.estado = res.status;
    // 4xx no se arregla repitiendo: el mismo cuerpo dará el mismo error. Solo
    // los 5xx y los cortes de red merecen otro intento.
    e.definitivo = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw e;
  }
  return cuerpo;
}

// ── Crear ─────────────────────────────────────────────────────
// Devuelve el identificador de la predicción. Quien llama tiene que
// guardarlo ANTES de esperar nada: es lo único que permite preguntar "¿en qué
// quedó aquella?" si la respuesta se pierde, en vez de generar —y pagar—
// otra vez. Ver cupo.anotarPrediccion().
async function crearPrediccion(fotoUrl, prompt) {
  if (!fotoUrl || !/^https?:\/\//i.test(String(fotoUrl)))
    throw Object.assign(new Error('La foto del plato debe tener una URL pública'), { definitivo: true });

  const cuerpo = await pedir(`${REPLICATE}/models/${MODELO}/predictions`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ input: entradaDe(fotoUrl, prompt) }),
  }, LIMITE_CREAR_MS);

  if (!cuerpo?.id) throw new Error('Replicate no devolvió identificador de predicción');
  return { id: cuerpo.id, estado: cuerpo.status };
}

// ── Consultar ─────────────────────────────────────────────────
// Se consulta desde el bucle de la cola, que ya corre cada 15 s. No se usa
// webhook a propósito: obligaría a exponer un endpoint público y a validar
// firmas, y no hay nada que ganar teniendo ya un bucle.
const TERMINADAS = { succeeded: 'lista', failed: 'error', canceled: 'error' };

async function consultarPrediccion(id) {
  const c = await pedir(`${REPLICATE}/predictions/${encodeURIComponent(id)}`,
    { headers: cabeceras() }, LIMITE_MIRAR_MS);

  const estado = TERMINADAS[c?.status] || 'generando';

  // El output puede venir como cadena o como lista según el modelo; se acepta
  // cualquiera de las dos en vez de dar por hecho una.
  const salida = Array.isArray(c?.output) ? c.output[0] : c?.output;

  return {
    estado,
    url: estado === 'lista' ? salida || null : null,
    error: c?.error ? String(c.error) : null,
    // Una predicción que llegó a ejecutarse y falló SE PAGÓ igual. Solo lo que
    // ni siquiera arrancó libera el cupo. Ver cupo.marcarFallida().
    cobrada: c?.status === 'succeeded' || c?.status === 'failed',
  };
}

module.exports = {
  MODELO, DURACION, RESOLUCION, PROMPT,
  entradaDe, crearPrediccion, consultarPrediccion,
};
