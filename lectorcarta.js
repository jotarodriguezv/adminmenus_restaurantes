'use strict';
// Convertir una carta —texto o imágenes— en categorías y platos.
// Ver docs/importar-carta.md §9, donde está la elección de proveedor y modelo.
//
// Este módulo hace UNA cosa: hablar con la API de Anthropic. No sabe de cupos,
// ni de la base de datos, ni de PDF. Se separó así por lo mismo que ia.js: es
// lo único que depende de un tercero, y el día que cambie el proveedor o el
// modelo se reescribe esto y nada más.
//
// Las dos vías del diseño entran por aquí y salen por el mismo sitio:
// leerPdf() da texto y se manda texto; un escaneo o una foto se mandan como
// imágenes. Lo que devuelve es idéntico, así que lo de después no sabe por
// dónde entró.
//
// ── LA CREDENCIAL ─────────────────────────────────────────────
// ANTHROPIC_API_KEY vive en las variables de entorno de la aplicación en
// Dokploy, igual que REPLICATE_API_TOKEN. No está en el repositorio, no está
// en ningún archivo versionado, y no puede acabar en nada que se sirva al
// navegador: le aplica lo mismo que a SUPABASE_SERVICE_KEY.

const precios = require('./precios');

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

// ── QUÉ MODELO LEE LA CARTA ───────────────────────────────────
// Dos variables y no una, porque las dos vías no piden lo mismo:
//
//   · por TEXTO el modelo solo ORDENA en filas un texto que ya es exacto. No
//     puede equivocarse en un precio porque lo está copiando.
//   · por IMAGEN el modelo LEE el precio de una foto, y ahí un dígito mal es
//     un problema real del restaurante.
//
// Por eso la de imagen puede querer subir de modelo sin arrastrar a la otra.
// Si no se pone, usa el mismo que la de texto y nada cambia.
const MODELO        = process.env.LECTOR_MODELO || 'claude-sonnet-5';
const MODELO_VISION = process.env.LECTOR_MODELO_VISION || MODELO;

// Los que se pueden elegir desde el panel. La lista está cerrada A PROPÓSITO:
// el modelo llega en la petición, y sin lista blanca cualquiera podría mandar
// el nombre que quisiera —incluido uno que no existe, o el más caro— y la
// factura la pagamos nosotros.
//
// El precio va aquí para que quien elige lo vea al elegir. Son dólares por
// millón de tokens, consultados el 07/09/2026; si cambian, esto queda viejo y
// solo lo arregla mirarlo.
const MODELOS = [
  { id: 'claude-haiku-4-5-20251001', nombre: 'Haiku 4.5', precio: '$1 / $5',   nota: 'el más barato; suficiente para ordenar texto ya exacto' },
  { id: 'claude-sonnet-5',           nombre: 'Sonnet 5',  precio: '$2 / $10',  nota: 'el equilibrio; el que se usa por defecto' },
  { id: 'claude-opus-5',             nombre: 'Opus 5',    precio: '$5 / $25',  nota: 'el que mejor lee una foto mala' },
];

// Con nueve restaurantes, leer la carta de todos cuesta menos de un dólar. Lo
// que de verdad se paga cuando el modelo se equivoca no es la factura: es la
// persona buscando el precio malo entre ciento setenta filas.
function modeloValido(id) {
  return MODELOS.some((m) => m.id === id);
}

// Una carta de 170 platos sale en unos 8.000 tokens. El doble deja sitio a una
// carta grande sin dejar que una respuesta desbocada se cobre sola.
const MAX_SALIDA = Number(process.env.LECTOR_MAX_SALIDA || 16000);

// Una carta no tiene cuarenta páginas. El tope existe porque en la vía de
// imagen el coste crece con cada una, y porque un PDF de 300 páginas subido por
// error no debería costar nada. Ver docs/importar-carta.md §8.
const MAX_PAGINAS = Number(process.env.LECTOR_MAX_PAGINAS || 20);

// La API tarda: una carta larga son decenas de segundos de generación.
const LIMITE_MS = Number(process.env.LECTOR_LIMITE_MS || 180000);

// Topes de lo que se acepta de vuelta. No son de rendimiento: son para que una
// respuesta rara no llene la tabla ni la pantalla de revisión.
const MAX_CATEGORIAS  = 80;
const MAX_PLATOS      = 600;
const LARGO_NOMBRE    = 200;
const LARGO_DESCRIP   = 1000;

// ── LO QUE SE LE PIDE ─────────────────────────────────────────
// La decisión de producto está aquí, no en el código: se COPIA, no se corrige.
// El porqué está en docs/importar-carta.md §2.3 y resumido en la regla 1.
//
// En una variable de entorno para poder afinarlo sin desplegar, igual que
// IA_PROMPT.
const INSTRUCCIONES = process.env.LECTOR_INSTRUCCIONES || [
  'Eres un transcriptor de cartas de restaurante. Tu trabajo es COPIAR lo que',
  'dice la carta, no mejorarlo.',
  '',
  '1. Copia los nombres y las descripciones LITERALMENTE, con sus erratas y su',
  '   puntuación. Si la carta dice "MOZARELLA", escribe "MOZARELLA". Quien',
  '   revisa pone la carta al lado y compara: cualquier diferencia tiene que',
  '   ser un fallo, no una mejora tuya.',
  '2. No traduzcas. Si la carta está en otro idioma, se queda en ese idioma.',
  '3. No inventes nada. Si un plato o un precio no se lee, déjalo fuera; es',
  '   mejor que falte a que esté mal.',
  '4. El precio va tal como aparece ("$ 12.000", "12.000", "$8"). Si un plato',
  '   no tiene precio, no pongas el campo.',
  '5. Si un plato tiene varios precios por tamaño o porción, haz un plato por',
  '   cada precio y añade la porción al nombre.',
  '6. Conserva el orden en que aparecen las categorías y los platos dentro de',
  '   cada una.',
  '7. Un plato que no está bajo ninguna categoría va en una categoría con el',
  '   nombre vacío.',
  '8. Ignora todo lo que no sea la carta: el nombre del restaurante, teléfonos,',
  '   direcciones, redes sociales, horarios, domicilios, números de página y',
  '   los textos decorativos del diseño.',
  '9. Ignora las fotografías de los platos por completo. No las describas ni',
  '   las menciones: las sube el restaurante aparte.',
  '',
  'Puede que el texto venga con palabras partidas ("PLÁT ANO", "CA LD OS"):',
  'es un efecto del espaciado del PDF. Júntalas.',
].join('\n');

// ── LA FORMA DE LA RESPUESTA ──────────────────────────────────
// Se pide con una herramienta y no "devuélveme JSON" a propósito: así lo que
// llega ya viene como objeto, y no hay que adivinar dónde empieza el JSON
// dentro de un texto que puede traer explicaciones alrededor.
const HERRAMIENTA = {
  name: 'registrar_carta',
  description: 'Registra las categorías y los platos que aparecen en la carta.',
  input_schema: {
    type: 'object',
    properties: {
      categorias: {
        type: 'array',
        description: 'Las categorías, en el orden en que salen en la carta.',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string', description: 'El nombre de la categoría, tal cual. Vacío si los platos no están bajo ninguna.' },
            platos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  nombre:      { type: 'string', description: 'El nombre del plato, literal.' },
                  descripcion: { type: 'string', description: 'Lo que dice debajo del plato, literal. Omitir si no hay.' },
                  precio:      { type: 'string', description: 'El precio tal como aparece. Omitir si el plato no tiene.' },
                },
                required: ['nombre'],
              },
            },
          },
          required: ['nombre', 'platos'],
        },
      },
    },
    required: ['categorias'],
  },
};

// ── EL CUERPO DE LA PETICIÓN ──────────────────────────────────
// Funciones puras y exportadas a propósito, igual que entradaDe() en ia.js: se
// pueden comprobar sin llamar a nadie ni gastar un céntimo.

function base(contenido, modelo) {
  return {
    model: modelo,
    max_tokens: MAX_SALIDA,
    system: INSTRUCCIONES,
    tools: [HERRAMIENTA],
    // Obliga a contestar por la herramienta. Sin esto el modelo puede
    // responder con un texto amable y no con la carta.
    tool_choice: { type: 'tool', name: HERRAMIENTA.name },
    messages: [{ role: 'user', content: contenido }],
  };
}

function cuerpoDeTexto(paginas, modelo) {
  const trozos = (Array.isArray(paginas) ? paginas : [paginas]).slice(0, MAX_PAGINAS);
  const texto = trozos
    .map((p, i) => `--- PÁGINA ${i + 1} ---\n${String(p || '')}`)
    .join('\n\n');
  return base([{ type: 'text', text: `Esta es la carta:\n\n${texto}` }], modelo || MODELO);
}

// Cada imagen es { tipo: 'image/jpeg', datos: '<base64>' }.
function cuerpoDeImagenes(imagenes, modelo) {
  const lista = (Array.isArray(imagenes) ? imagenes : [imagenes]).slice(0, MAX_PAGINAS);
  const contenido = [];
  lista.forEach((img, i) => {
    contenido.push({ type: 'text', text: `--- PÁGINA ${i + 1} ---` });
    contenido.push({
      type: 'image',
      source: { type: 'base64', media_type: img.tipo, data: img.datos },
    });
  });
  contenido.push({ type: 'text', text: 'Transcribe la carta de estas páginas.' });
  return base(contenido, modelo || MODELO_VISION);
}

// ── LO QUE VUELVE ─────────────────────────────────────────────

function recortar(valor, largo) {
  const s = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
  return s.length > largo ? s.slice(0, largo) : s;
}

// Convierte lo que devolvió el modelo en el borrador que se guarda, y de paso
// lo valida. Un modelo puede devolver cualquier cosa: aquí es donde deja de
// poder.
//
// Los precios pasan por precios.js, la misma regla que usa la API para un
// producto escrito a mano. Ver el comentario de ese módulo.
function borradorDeRespuesta(entrada) {
  const crudas = entrada && Array.isArray(entrada.categorias) ? entrada.categorias : [];
  const categorias = [];
  let totalPlatos = 0;

  for (const cruda of crudas.slice(0, MAX_CATEGORIAS)) {
    if (!cruda || typeof cruda !== 'object') continue;

    const platos = [];
    for (const p of Array.isArray(cruda.platos) ? cruda.platos : []) {
      if (totalPlatos >= MAX_PLATOS) break;
      if (!p || typeof p !== 'object') continue;

      // Un plato sin nombre no es un plato. La API tampoco lo aceptaría.
      const nombre = recortar(p.nombre, LARGO_NOMBRE);
      if (!nombre) continue;

      const numero = p.precio == null ? null : precios.numeroDeTexto(p.precio);
      platos.push({
        nombre,
        descripcion: recortar(p.descripcion, LARGO_DESCRIP) || null,
        // Se guardan los dos, ya coherentes entre sí, para que la pantalla de
        // revisión enseñe exactamente lo que se va a guardar.
        precio: numero === null ? null : precios.formatoPrecio(numero),
        precio_numerico: numero,
      });
      totalPlatos++;
    }

    // Una categoría vacía no aporta nada y estorba en la revisión.
    if (!platos.length) continue;
    categorias.push({ nombre: recortar(cruda.nombre, LARGO_NOMBRE), platos });
  }

  return { categorias, total_platos: totalPlatos };
}

// El bloque de herramienta, si vino.
function respuestaDeHerramienta(respuesta) {
  const bloques = respuesta && Array.isArray(respuesta.content) ? respuesta.content : [];
  const uso = bloques.find((b) => b && b.type === 'tool_use' && b.name === HERRAMIENTA.name);
  return uso ? uso.input : null;
}

// ── HABLAR CON LA API ─────────────────────────────────────────

function cabeceras() {
  const clave = process.env.ANTHROPIC_API_KEY;
  // El mensaje nombra la variable y NO dice nada de su valor: este texto acaba
  // en el registro, y un registro es un sitio del que la gente copia y pega.
  if (!clave) throw new Error('Falta ANTHROPIC_API_KEY');

  const cab = {
    'x-api-key': clave,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  // Hay dos tipos de clave. Una atada a un workspace ya sabe dónde trabajar;
  // una de ORGANIZACIÓN sirve para varios y hay que decírselo, o la API
  // responde:
  //
  //   This API key is not scoped to a workspace, so this request must include
  //   the anthropic-workspace-id header...
  //
  // Pasó en producción el 07/09/2026, en el primer intento real. Lo normal es
  // usar una clave atada a un workspace y no poner esta variable; está para no
  // obligar a cambiar de clave a quien ya tiene una de organización.
  if (process.env.ANTHROPIC_WORKSPACE_ID)
    cab['anthropic-workspace-id'] = process.env.ANTHROPIC_WORKSPACE_ID;

  return cab;
}

async function pedir(cuerpo) {
  const res = await fetch(ANTHROPIC, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(LIMITE_MS),
  });
  const texto = await res.text();

  let json = null;
  try { json = JSON.parse(texto); } catch { /* un 502 de un intermediario puede venir en HTML */ }

  if (!res.ok) {
    const e = new Error((json && json.error && json.error.message) || `Anthropic respondió ${res.status}`);
    e.estado = res.status;
    // Igual que en ia.js: un 4xx no se arregla repitiendo, el mismo cuerpo dará
    // el mismo error. 429 sí, que es "ahora no" y no "nunca".
    e.definitivo = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw e;
  }
  return json;
}

// La puerta de entrada. Recibe { paginas } o { imagenes } y devuelve siempre lo
// mismo, que es lo que permite que la pantalla de revisión no sepa por qué vía
// llegó la carta.
async function extraer(entrada) {
  const porImagen = Array.isArray(entrada && entrada.imagenes) && entrada.imagenes.length > 0;

  // El modelo puede venir en la petición, para poder comparar dos sobre la
  // misma carta sin volver a desplegar. Si viene y no está en la lista, se para
  // aquí: lo que llega de fuera no elige a quién se le paga.
  const pedido = entrada && entrada.modelo;
  if (pedido && !modeloValido(pedido))
    throw Object.assign(new Error('Ese modelo no está permitido'), { definitivo: true, publico: true });

  const modelo = pedido || (porImagen ? MODELO_VISION : MODELO);
  const cuerpo = porImagen ? cuerpoDeImagenes(entrada.imagenes, modelo) : cuerpoDeTexto(entrada.paginas || [], modelo);

  const respuesta = await pedir(cuerpo);

  // Si la respuesta se cortó por el tope de tokens, lo que llegó está a medias:
  // faltarán las últimas categorías y NADA lo dirá. Una carta a la que le falta
  // el final es justo el fallo silencioso que no puede pasar de aquí.
  if (respuesta && respuesta.stop_reason === 'max_tokens')
    throw Object.assign(new Error('La carta es demasiado larga para leerla de una vez'), { definitivo: true, publico: true });

  const bruto = respuestaDeHerramienta(respuesta);
  if (!bruto) throw new Error('El modelo no devolvió la carta');

  const uso = (respuesta && respuesta.usage) || {};
  return {
    borrador: borradorDeRespuesta(bruto),
    via: porImagen ? 'vision' : 'texto',
    modelo: (respuesta && respuesta.model) || MODELO,
    tokens_entrada: uso.input_tokens || null,
    tokens_salida: uso.output_tokens || null,
  };
}

module.exports = {
  extraer,
  MODELOS,
  MODELO,
  MODELO_VISION,
  modeloValido,
  cuerpoDeTexto,
  cuerpoDeImagenes,
  borradorDeRespuesta,
  respuestaDeHerramienta,
  HERRAMIENTA,
  MAX_PAGINAS,
  MAX_CATEGORIAS,
  MAX_PLATOS,
};
