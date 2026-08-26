require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const video    = require('./video');
const limpieza = require('./limpieza');
const cupo     = require('./cupo');
const colaia   = require('./colaia');

const app  = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Detrás del proxy de Dokploy, req.ip sería siempre la IP del proxy y el
// límite de /api/track trataría a todos los visitantes como uno solo. Con
// esto Express lee la IP real del final de X-Forwarded-For. El valor es
// cuántos proxies hay delante; si cambia la infraestructura se ajusta con
// la variable TRUST_PROXY sin tocar el código.
const TRUST_PROXY = process.env.TRUST_PROXY ?? '1';
app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// Lo subido nunca se modifica: cada archivo lleva un nombre irrepetible
// (`${Date.now()}-${aleatorio}.jpg`) y cambiar la foto de un plato sube otro
// archivo con otro nombre. Eso permite cachear sin miedo a servir algo viejo.
//
// Por defecto express.static manda 'max-age=0', que obliga al navegador a
// preguntar por CADA imagen en CADA carga. Suele responder 304 sin datos,
// pero en un menú de veinte platos son veinte viajes de ida y vuelta antes de
// ver nada — y en un móvil con mala señal eso se nota más que el peso.
//
// masters/ y originales/ viven bajo uploads/ porque es la única carpeta con
// volumen: fuera de ahí se perderían en cada despliegue. Pero son archivos
// internos —el master es material de archivo, el original es el crudo del
// cliente— y no deben servirse a internet. Este guardia va antes del static.
const CARPETAS_PRIVADAS = new Set(['masters', 'originales']);
app.use('/uploads', (req, res, next) => {
  // req.path llega aquí como '/masters/algo.mp4'
  if (CARPETAS_PRIVADAS.has(req.path.split('/')[1])) return res.status(404).end();
  next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1y',
  immutable: true,
}));

// ── Multer ────────────────────────────────────────────────────
// Las carpetas de subida son un conjunto cerrado. Usar el valor crudo de
// ?folder= permitía construir rutas como '../../' y escribir fuera de
// uploads/, así que cualquier valor que no esté en la lista cae en la
// carpeta por defecto.
const CARPETAS_VALIDAS = new Set(['productos', 'categorias', 'promos', 'logos', 'fondos', 'portadas']);
const CARPETA_POR_DEFECTO = 'productos';

function carpetaDe(req) {
  return CARPETAS_VALIDAS.has(req.query.folder) ? req.query.folder : CARPETA_POR_DEFECTO;
}

// La extensión es lo ÚNICO que el nombre del archivo hereda de quien sube:
// el resto lo genera el servidor. Por eso tiene que salir de una lista y no
// de la cadena que mandó el navegador.
//
// Antes se comprobaba con /jpeg|jpg|png|webp/ SIN anclar, así que bastaba que
// esas letras aparecieran en algún sitio: '.apng', '.webpx' y '.jpg;rm'
// pasaban, y la extensión entera —con lo que llevara dentro— se escribía en
// el disco tal cual.
//
// El daño no era el que parece. No es que se pudiera subir un ejecutable: es
// que limpieza.js reconoce los nombres con [A-Za-z0-9._-]+, así que de
// 'foto.jpg;rm' guardado en la base solo leía hasta el punto y coma. El
// archivo del disco y la referencia de la base dejaban de coincidir, y a los
// siete días el limpiador borraba una foto que SÍ estaba en uso.
//
// Devolver la extensión de la lista, y no la del usuario, cierra las dos
// cosas de una vez: lo que se guarda solo puede ser una de estas.
const EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.webp'];
const EXTENSIONES_VIDEO  = ['.mp4', '.mov', '.m4v'];

function extensionSegura(nombre, permitidas) {
  const ext = path.extname(String(nombre || '')).toLowerCase();
  return permitidas.includes(ext) ? ext : null;
}

// El nombre lo pone entero el servidor. Irrepetible para que dos subidas
// simultáneas no se pisen, y sin un solo carácter del original.
function nombreGenerado(ext) {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}

const IMAGEN_MAX_MB = Number(process.env.IMAGEN_MAX_MB || 10);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Leer folder desde query params (?folder=promos) porque en multipart
    // req.body aún no está disponible cuando multer procesa el archivo
    const sub = carpetaDe(req);
    const dir = path.join(__dirname, 'uploads', sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // No puede ser null: fileFilter ya rechazó lo que no está en la lista.
    cb(null, nombreGenerado(extensionSegura(file.originalname, EXTENSIONES_IMAGEN)));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: IMAGEN_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (extensionSegura(file.originalname, EXTENSIONES_IMAGEN)) cb(null, true);
    else cb(new Error('Solo JPG, PNG o WEBP'));
  }
});

// ── Multer para video ─────────────────────────────────────────
// Instancia aparte, no un límite más alto en la de imágenes. Si se subiera
// aquel a 200 MB, cualquiera podría colar un archivo de 200 MB por la ruta de
// fotos. Cada una acepta lo suyo, con el tamaño que le toca.
const VIDEO_MAX_MB = Number(process.env.VIDEO_MAX_MB || 200);

const almacenVideo = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', video.CARPETAS.origen);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const nombre = nombreGenerado(extensionSegura(file.originalname, EXTENSIONES_VIDEO));
    // Se apunta la ruta AQUÍ, que es cuando se decide, y no al terminar.
    // Multer solo publica req.file cuando el archivo llegó entero; si la
    // subida se corta antes, req.file no existe nunca y lo que se llevaba
    // escrito no lo borra nadie. Ver limpiarSubidaCortada.
    req._archivoEnVuelo = path.join(__dirname, 'uploads', video.CARPETAS.origen, nombre);
    cb(null, nombre);
  }
});

// ── SUBIDAS QUE SE CORTAN A MEDIAS ────────────────────────────
// Pasó de verdad, y costó encontrarlo: dos intentos de subir un video de 70
// MB se cayeron a media transferencia y dejaron los dos trozos en el disco,
// 150 MB, sin que nada los recogiera.
//
// El descartar() de la ruta no sirve para esto: vive DENTRO del manejador, y
// cuando el cliente se va multer nunca llama a next(), así que el manejador
// no llega a ejecutarse. Tiene que limpiar alguien de más afuera.
//
// 'close' sin 'complete' es la forma correcta de detectarlo: complete solo es
// cierto si el cuerpo entró entero. (req.aborted diría lo mismo, pero está
// desaconsejado desde Node 16.)
//
// El limpiador de huérfanos también acabaría recogiéndolos, pero tarda siete
// días. Una racha de subidas cortadas en una conexión mala llena el disco
// mucho antes de eso, y con el disco lleno no se cae el video: se cae el
// servidor entero.
function limpiarSubidaCortada(req, res, next) {
  req.on('close', () => {
    if (req.complete) return;              // llegó entero, no hay nada que limpiar
    const ruta = req._archivoEnVuelo;
    if (!ruta) return;                     // se cortó antes de escribir un byte
    // Un respiro para que multer suelte su escritura antes de borrar.
    setTimeout(() => {
      let bytes = 0;
      try { bytes = fs.statSync(ruta).size; } catch { return; }
      try {
        fs.unlinkSync(ruta);
        console.warn(`⚠️  subida cortada a medias: descartados ${(bytes / 1048576).toFixed(1)} MB (${path.basename(ruta)})`);
      } catch (e) {
        console.error(`⚠️  subida cortada y no se pudo borrar ${path.basename(ruta)}: ${e.message}`);
      }
    }, 500).unref();
  });
  next();
}

const subidaVideo = multer({
  storage: almacenVideo,
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Solo la extensión. El tipo que declara el navegador lo pone el cliente
    // y no prueba nada, y además varios mandan octet-stream para .mov, con lo
    // que rechazaría archivos buenos. Quien valida de verdad es ffmpeg: si no
    // es video, la conversión falla y el trabajo queda en error.
    if (extensionSegura(file.originalname, EXTENSIONES_VIDEO)) cb(null, true);
    else cb(new Error('Solo MP4 o MOV'));
  }
});

// Un video crudo son ~200 MB y el disco ya está al 55 %. Si se llenara no
// dejaría de funcionar el video: dejaría de funcionar el servidor entero,
// porque con el disco lleno no se puede ni escribir un registro.
const MARGEN_DISCO_MB = Number(process.env.VIDEO_MARGEN_MB || 2048);
function espacioLibreMB() {
  try {
    const st = fs.statfsSync(path.join(__dirname, 'uploads'));
    return (st.bsize * st.bavail) / 1048576;
  } catch { return Infinity; }
}

// ── LÍMITE DE PETICIONES PARA /api/track ──────────────────────
// El endpoint no puede pedir credenciales (lo llama el menú público, que no
// tiene ninguna), así que lo único que queda es limitar por IP.
//
// Es una barrera contra el abuso trivial —un bucle de curl inflando las
// visitas de un restaurante—, no contra alguien decidido: quien rote IPs
// pasa igual. El tope va holgado a propósito: un restaurante lleno comparte
// una sola IP de wifi, y perder eventos reales sería peor que el abuso que
// esto evita.
const TRACK_VENTANA_MS = 60_000;
const TRACK_MAX_POR_VENTANA = 120;
const trackPorIp = new Map();

function dentroDelLimite(ip) {
  const ahora = Date.now();
  const reg = trackPorIp.get(ip);
  if (!reg || ahora - reg.desde >= TRACK_VENTANA_MS) {
    trackPorIp.set(ip, { desde: ahora, n: 1 });
    return true;
  }
  reg.n++;
  return reg.n <= TRACK_MAX_POR_VENTANA;
}

// El Map crece con cada IP nueva. Sin esta limpieza es una fuga de memoria
// lenta pero segura en un proceso que no se reinicia. unref() para que el
// temporizador no mantenga vivo al proceso por su cuenta.
setInterval(() => {
  const limite = Date.now() - TRACK_VENTANA_MS;
  for (const [ip, reg] of trackPorIp) if (reg.desde < limite) trackPorIp.delete(ip);
}, TRACK_VENTANA_MS).unref();

// ── LÍMITE DE INTENTOS DE LOGIN ───────────────────────────────
// El limitador de /api/track no sirve aquí. Allí 120 por minuto va holgado a
// propósito, porque un restaurante lleno comparte una sola IP de wifi; en un
// login eso es barra libre.
//
// Un PIN de restaurante son cuatro caracteres, y bcrypt de coste 10 encarece
// cada intento a ~100 ms sin llegar a impedir el ataque: 10.000 combinaciones
// se agotan en un cuarto de hora. Y de paso cada intento consume ese tiempo
// del único núcleo, así que una fuerza bruta degrada las cartas aunque no
// acierte nunca.
//
// Se cuentan SOLO los fallos, y un acierto borra la cuenta. Así el personal
// del restaurante no lo toca jamás: diez fallos en quince minutos desde la
// misma IP no es alguien que se equivoca, es alguien probando a ciegas.
const LOGIN_VENTANA_MS = 15 * 60 * 1000;
const LOGIN_MAX_FALLOS = 10;
const fallosLogin = new Map();

function loginBloqueado(ip) {
  const reg = fallosLogin.get(ip);
  if (!reg) return false;
  if (Date.now() - reg.desde >= LOGIN_VENTANA_MS) { fallosLogin.delete(ip); return false; }
  return reg.n >= LOGIN_MAX_FALLOS;
}

function anotarFalloLogin(ip) {
  const ahora = Date.now();
  const reg = fallosLogin.get(ip);
  if (!reg || ahora - reg.desde >= LOGIN_VENTANA_MS) fallosLogin.set(ip, { desde: ahora, n: 1 });
  else reg.n++;
}

// Se limita por IP y no por slug a propósito: contar por restaurante
// permitiría que cualquiera dejara a un cliente fuera de su propio panel sin
// más que fallar diez veces a su nombre.
setInterval(() => {
  const limite = Date.now() - LOGIN_VENTANA_MS;
  for (const [ip, reg] of fallosLogin) if (reg.desde < limite) fallosLogin.delete(ip);
}, LOGIN_VENTANA_MS).unref();

// Comparar con !== termina en el primer carácter distinto, así que el tiempo
// de respuesta filtra información sobre el PIN. Contra una cadena larga y con
// la variación normal de internet de por medio no es un ataque realista, pero
// cuesta cinco líneas.
function igualSeguro(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  // timingSafeEqual exige longitudes iguales; comparar antes solo revela el
  // tamaño, que es lo único que este método no puede ocultar.
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Debe coincidir con la restricción eventos_analitica_tipo_check de la base:
// si aquí se acepta un tipo que allí no existe, el evento se pierde con un
// error 500 en vez de rechazarse limpiamente.
const TIPOS_EVENTO = ['visita', 'clic', 'agregar_carrito'];

// ── Auth ──────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try { req.user = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
}

function canAccessRestaurante(user, restauranteId) {
  return user.rol === 'admin' || user.restauranteId === restauranteId;
}

// ── LOGIN ─────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { slug, pin } = req.body;
  if (!slug || !pin) return res.status(400).json({ error: 'Faltan datos' });

  if (loginBloqueado(req.ip)) {
    // Se registra para que un ataque sea visible en los registros: sin esta
    // línea, la única señal sería que alguien no puede entrar.
    console.warn(`🔒 login bloqueado por intentos · ip ${req.ip} · slug ${slug}`);
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera unos minutos.' });
  }

  if (slug === 'admin') {
    if (!process.env.PIN_ADMIN || !igualSeguro(pin, process.env.PIN_ADMIN)) {
      anotarFalloLogin(req.ip);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    fallosLogin.delete(req.ip);
    const token = jwt.sign({ slug, rol: 'admin', restauranteId: null }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token, rol: 'admin', restauranteId: null });
  }

  // El hash vive en restaurantes_privado, una tabla sin políticas RLS: solo
  // la llave de servicio (que las ignora) la puede leer. La tabla pública
  // 'restaurantes' se sirve entera al menú de cualquier visitante, así que
  // no puede contener secretos.
  const { data } = await supabase.from('restaurantes').select('id').eq('slug', slug).single();
  if (!data) {
    anotarFalloLogin(req.ip);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const { data: cred } = await supabase.from('restaurantes_privado')
    .select('pin_hash').eq('restaurante_id', data.id).maybeSingle();
  if (!cred?.pin_hash || !(await bcrypt.compare(pin, cred.pin_hash))) {
    anotarFalloLogin(req.ip);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  // Un acierto limpia la cuenta: quien entra bien nunca arrastra el límite.
  fallosLogin.delete(req.ip);
  const token = jwt.sign({ slug, rol: 'cliente', restauranteId: data.id }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, rol: 'cliente', restauranteId: data.id });
});

// ── RESTAURANTES ──────────────────────────────────────────────
app.get('/api/restaurantes', auth, async (req, res) => {
  let q = supabase.from('restaurantes').select('*').order('nombre');
  if (req.user.rol === 'cliente') q = q.eq('id', req.user.restauranteId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(({ pin_hash, ...r }) => r));
});

// Al clonar apariencia de otro restaurante, solo se copian estas claves de
// "atributos" (look & feel puro). Nunca pagos, redes, contenido ni PIN.
// 'estilo' va junto a 'nav' y no por separado: son el modelo y su aspecto, y
// clonar uno sin el otro deja al restaurante nuevo con el carrete puesto pero
// con otra cara que la del que se copió — que es justo lo que no se esperaba
// al pulsar "clonar apariencia".
const ATRIBUTOS_CLONABLES = ['nav', 'estilo', 'fuente_titulo', 'fuente_cuerpo', 'color_surface', 'color_card', 'fondo_tipo', 'fondo_color', 'fondo_intensidad', 'css_custom'];

app.post('/api/restaurantes', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });
  const { nombre, slug, color_primario, color_secundario, activo, pin, clonar_de } = req.body;
  if (!nombre || !slug) return res.status(400).json({ error: 'Nombre y slug requeridos' });
  if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN requerido (mínimo 4 caracteres)' });
  const pin_hash = await bcrypt.hash(pin, 10);

  let atributos = {};
  if (clonar_de) {
    const { data: origen } = await supabase.from('restaurantes').select('atributos').eq('id', clonar_de).single();
    if (origen?.atributos) {
      atributos = Object.fromEntries(Object.entries(origen.atributos).filter(([k]) => ATRIBUTOS_CLONABLES.includes(k)));
    }
  }

  const { data, error } = await supabase.from('restaurantes')
    .insert([{ nombre, slug, color_primario: color_primario||'#3dd68c', color_secundario: color_secundario||'#a374af', activo: activo!==false, promo_activa: false, atributos }])
    .select().single();
  // La dirección repetida es el choque más probable de todos y merece
  // explicarse: dos restaurantes SÍ pueden llamarse igual —hay una Doña Rosa
  // en San Gil y otra en Bucaramanga— pero la dirección es única por
  // definición, y la restricción la pone la base de datos (restaurantes_slug_key).
  //
  // Sin esto salía el mensaje crudo de Postgres, que habla de constraints y no
  // dice qué hacer. Y de paso enseñaba el nombre interno de un índice.
  if (error?.code === '23505' || /restaurantes_slug_key|duplicate key/.test(error?.message || '')) {
    return res.status(409).json({
      error: `La dirección "${slug}" ya la usa otro restaurante. Prueba añadiendo la ciudad, por ejemplo "${slug}-bucaramanga".`
    });
  }
  if (error) return res.status(500).json({ error: error.message });

  const { error: errPin } = await supabase.from('restaurantes_privado')
    .insert([{ restaurante_id: data.id, pin_hash }]);
  if (errPin) {
    // Un restaurante sin PIN no lo puede administrar nadie. Antes que dejarlo
    // creado e inaccesible, se deshace la creación.
    await supabase.from('restaurantes').delete().eq('id', data.id);
    return res.status(500).json({ error: errPin.message });
  }
  res.json(data);
});

app.patch('/api/restaurantes/:id/pin', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });
  const { pin } = req.body;
  if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN requerido (mínimo 4 caracteres)' });
  const pin_hash = await bcrypt.hash(pin, 10);
  // upsert y no update: un restaurante que todavía no tiene fila de
  // credenciales (creado antes de que el PIN fuera obligatorio) también
  // tiene que poder recibir uno.
  const { error } = await supabase.from('restaurantes_privado')
    .upsert({ restaurante_id: req.params.id, pin_hash, actualizado_at: new Date().toISOString() },
            { onConflict: 'restaurante_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Campos de nivel superior que cada rol puede tocar en un restaurante.
// El cliente NUNCA debe poder cambiar marca/estructura (eso es Apariencia,
// oculta en la UI pero antes también alcanzable a mano por API).
const CAMPOS_RESTAURANTE_ADMIN   = ['promo_activa', 'promo_imagen_url', 'color_primario', 'color_secundario', 'nombre', 'slug', 'logo_url', 'fondo_url', 'activo', 'atributos'];
const CAMPOS_RESTAURANTE_CLIENTE = ['promo_activa', 'promo_imagen_url', 'atributos'];
// Dentro de "atributos" (JSON libre), el cliente solo puede tocar estas claves
// (toppings, WhatsApp de pedidos, métodos de pago y diseño del QR). nav,
// fuentes, redes, css_custom, etc. quedan fuera.
const ATRIBUTOS_CLIENTE_PERMITIDOS = ['toppings_platino', 'toppings_premium', 'salsas', 'whatsapp_pedidos', 'metodos_pago', 'qr', 'orden_productos'];

// Claves de "atributos" que además dependen del plan. El panel ya las
// esconde, pero esconder un formulario no impide una llamada directa a la
// API, así que la restricción se repite aquí. 'plan' nunca está en la
// lista del cliente, así que nadie puede ascenderse solo.
const ATRIBUTOS_SEGUN_PLAN = { qr: 'qr_disenador' };

const PLANES = {
  vitrina:  { qr_disenador: false, estadisticas: false, horarios: false, videos: false, carrito: false },
  pedidos:  { qr_disenador: true,  estadisticas: true,  horarios: true,  videos: false, carrito: true  },
  completo: { qr_disenador: true,  estadisticas: true,  horarios: true,  videos: false, carrito: true  },
  // Único plan que abre la subida de video. Como el resto de banderas de
  // plan, se comprueba también aquí y no solo en el panel: esconder un
  // formulario no impide una llamada directa a la API.
  video:    { qr_disenador: true,  estadisticas: true,  horarios: true,  videos: true,  carrito: true  },
};
const PLAN_POR_DEFECTO = 'pedidos';
const planDe = atributos => PLANES[atributos?.plan] || PLANES[PLAN_POR_DEFECTO];

// Lo mismo dentro de "atributos" de una CATEGORÍA. El horario es una función
// de plan, y esconder el interruptor en el panel no impide una llamada
// directa a la API — la misma razón por la que ya se repite el chequeo en
// restaurantes y en /api/estadisticas.
const ATRIBUTOS_CATEGORIA_PERMITIDOS = ['horario', 'imagen_cabecera'];
const ATRIBUTOS_CATEGORIA_SEGUN_PLAN = { horario: 'horarios' };

// El panel manda el objeto "atributos" COMPLETO: apagar un horario es borrar
// la clave. Por eso esto filtra un reemplazo y no mezcla con lo guardado —
// mezclar dejaría el horario imposible de quitar.
function atributosCategoria(entrantes, actuales, esAdmin, plan) {
  const out = {};
  for (const clave of ATRIBUTOS_CATEGORIA_PERMITIDOS) {
    const requiere = ATRIBUTOS_CATEGORIA_SEGUN_PLAN[clave];
    const bloqueada = !esAdmin && requiere && !plan[requiere];
    // Sin el plan que la incluye la clave no se puede cambiar, pero tampoco se
    // borra lo que ya hubiera: bajar de plan no debe destruir la configuración.
    const valor = bloqueada ? actuales?.[clave] : entrantes?.[clave];
    // null es como el panel pide quitar una imagen de cabecera.
    if (valor !== undefined && valor !== null) out[clave] = valor;
  }
  return out;
}

// ── FECHAS EN LA ZONA DEL RESTAURANTE ─────────────────────────
// Las estadísticas se cuentan con el reloj del restaurante, nunca en UTC.
// En Colombia (UTC-5) contar en UTC empuja todo lo que ocurre después de
// las 7 p. m. — la franja más cargada de un restaurante — al día siguiente.
// Es el mismo criterio que ya usa core/horarios.js en el sitio público.
const ZONA_POR_DEFECTO = 'America/Bogota';

function zonaDe(atributos) {
  const zona = atributos?.zona_horaria;
  if (!zona) return ZONA_POR_DEFECTO;
  // Una zona inválida hace estallar Intl y tumbaría el endpoint entero
  try { new Intl.DateTimeFormat('en-US', { timeZone: zona }); return zona; }
  catch { return ZONA_POR_DEFECTO; }
}

function partesEn(instante, zona) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(instante).map(p => [p.type, p.value])
  );
}

// Cuánto se aparta la zona de UTC en ese instante concreto. No es un valor
// fijo por zona: donde hay horario de verano cambia según la fecha.
function offsetMs(instante, zona) {
  const p = partesEn(instante, zona);
  // Con hour12:false algunos motores devuelven "24" para la medianoche
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - instante.getTime();
}

// 'YYYY-MM-DD' + 'HH:mm:ss' del reloj local de la zona → instante UTC real.
function instanteUTC(fecha, hora, zona) {
  const ingenuo = new Date(`${fecha}T${hora}Z`);
  // Dos pasadas: junto a un cambio de horario el offset del primer tanteo
  // puede ser el del lado equivocado de la transición.
  const tanteo = ingenuo.getTime() - offsetMs(ingenuo, zona);
  return new Date(ingenuo.getTime() - offsetMs(new Date(tanteo), zona));
}

// El agrupado por día lo hace ahora estadisticas_restaurante() en SQL, con
// 'at time zone', así que aquí ya no hace falta calcular el día de un evento.
// Lo que sigue haciendo falta es traducir los días del selector a instantes.

app.patch('/api/restaurantes/:id', auth, async (req, res) => {
  if (!canAccessRestaurante(req.user, req.params.id))
    return res.status(403).json({ error: 'Sin permiso' });

  const permitidos = req.user.rol === 'admin' ? CAMPOS_RESTAURANTE_ADMIN : CAMPOS_RESTAURANTE_CLIENTE;
  const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));

  if (body.slug) {
    if (!/^[a-z0-9-]+$/.test(body.slug))
      return res.status(400).json({ error: 'Slug inválido: solo minúsculas, números y guiones' });
    const { data: choque } = await supabase.from('restaurantes').select('id').eq('slug', body.slug).neq('id', req.params.id).maybeSingle();
    if (choque) return res.status(409).json({ error: 'Ese slug ya está en uso por otro restaurante' });
  }

  // Aunque el admin puede escribir 'atributos' entero, estas dos claves ya no
  // viven ahí: tienen su propia tabla, fuera de la lectura pública. Se quitan
  // aquí para que ninguna pantalla vieja ni ninguna llamada suelta las vuelva
  // a colar en la tabla que ve todo el mundo.
  if (body.atributos && typeof body.atributos === 'object') {
    const { dia_pago, ultimo_pago, ...resto } = body.atributos;
    body.atributos = resto;
  }

  if (body.atributos && req.user.rol !== 'admin') {
    // Nunca confiar en el objeto "atributos" completo que manda el cliente:
    // se reconstruye a partir de lo que ya existe + solo las claves permitidas.
    const { data: actual } = await supabase.from('restaurantes').select('atributos').eq('id', req.params.id).single();
    const plan = planDe(actual?.atributos);
    const entrantes = Object.fromEntries(Object.entries(body.atributos).filter(([k]) =>
      ATRIBUTOS_CLIENTE_PERMITIDOS.includes(k) &&
      (!ATRIBUTOS_SEGUN_PLAN[k] || plan[ATRIBUTOS_SEGUN_PLAN[k]])
    ));
    body.atributos = { ...(actual?.atributos || {}), ...entrantes };
  }

  const { data, error } = await supabase.from('restaurantes').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const { pin_hash, ...safe } = data;
  res.json(safe);
});

// Solo superadmin. Borra en cascada categorías, productos y eventos de
// estadísticas de ese restaurante antes de borrar el restaurante mismo
// (no depende de que la base de datos tenga ON DELETE CASCADE configurado).
// No borra archivos subidos (logo, fondos, fotos de producto) — quedan
// huérfanos en disco, aceptado a propósito por ahora.
app.delete('/api/restaurantes/:id', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });
  const id = req.params.id;
  await supabase.from('eventos_analitica').delete().eq('restaurante_id', id);
  await supabase.from('productos').delete().eq('restaurante_id', id);
  await supabase.from('categorias').delete().eq('restaurante_id', id);
  await supabase.from('restaurantes_privado').delete().eq('restaurante_id', id);
  const { error } = await supabase.from('restaurantes').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// De la URL pública de una subida al archivo en disco. Solo reconoce lo que
// sirvió este mismo servidor: una foto alojada fuera devuelve null y quien
// llama sigue sin ella, que es lo correcto — no se puede medir lo que no está.
//
// La comprobación de que no se sale de uploads/ la hace video.js, la misma que
// usa el worker antes de darle un archivo a ffmpeg.
function rutaLocalDeSubida(url) {
  const m = /\/uploads\/([^/]+)\/([^/?#]+)$/.exec(String(url || ''));
  return m ? video.rutaDentroDeUploads(path.join(m[1], m[2])) : null;
}

// ── GENERAR UN VIDEO A PARTIR DE LA FOTO ──────────────────────
// Responde en cuanto la petición sale hacia Replicate; la generación tarda
// minutos y la recoge colaia.js por su cuenta. Igual que la subida de video:
// ninguna petición HTTP debería esperar a eso.
//
// El prompt lo fija la plataforma y no se acepta del navegador. No es
// desconfianza: es que el prompt es lo que sujeta el "no añadas ni cambies
// ingredientes", y si el modelo agrega una guarnición que el negocio no sirve,
// el expuesto ante la SIC es el cliente. Ver docs/video-con-ia.md §9.
app.post('/api/ia/generar', auth, async (req, res) => {
  const { restaurante_id, producto_id } = req.body;
  if (!restaurante_id || !canAccessRestaurante(req.user, restaurante_id))
    return res.status(403).json({ error: 'Sin permiso' });
  if (!producto_id) return res.status(400).json({ error: 'Falta el plato' });

  // El plato tiene que ser de este restaurante Y tener foto: la foto ES la
  // entrada del modelo. Sin ella no hay nada que animar.
  const { data: prod } = await supabase.from('productos')
    .select('restaurante_id, imagen_url').eq('id', producto_id).maybeSingle();
  if (!prod || prod.restaurante_id !== restaurante_id)
    return res.status(403).json({ error: 'Ese plato no es de este restaurante' });
  if (!prod.imagen_url)
    return res.status(400).json({ error: 'Ese plato no tiene foto todavía. La foto es de donde sale el video.' });

  // Misma comprobación de plan que la subida de video: convertir y generar
  // son la misma capacidad y cuestan dinero de dos formas distintas.
  const { data: resto } = await supabase.from('restaurantes')
    .select('atributos').eq('id', restaurante_id).single();
  if (req.user.rol !== 'admin' && !planDe(resto?.atributos).videos)
    return res.status(403).json({ error: 'La carta en video no está incluida en el plan actual' });

  // ── ¿LA FOTO SIRVE PARA ESTE FORMATO? ───────────────────────
  // El modelo hereda la proporción de la foto, así que lo que no encaje lo
  // recorta ffmpeg después — sobre un video ya pagado y sin reintento. En una
  // carta vertical el video ocupa la pantalla entera y una foto apaisada no
  // sobrevive al recorte: se le cortan los lados al plato. Ver
  // video.encajeDeFoto(), que es donde está el porqué de la regla.
  //
  // El panel ya avisa antes de preguntar, pero avisar no es impedir: esta ruta
  // se puede llamar directamente, y lo que hay al otro lado es dinero.
  // ── ¿YA HAY UNA PARA ESTE PLATO? ────────────────────────────
  // Este es el freno que de verdad cuida el dinero, y existe porque falló:
  // el 26/08/2026 un mismo plato se generó dos veces con 21 segundos de
  // diferencia. El panel había apagado el botón y volvió a encenderlo solo
  // —refrescarCupoIA() deshacía el apagado—, y encima pisó el
  // "✨ Generando..." con un aviso naranja que se lee como un rechazo. Quien
  // lo ve da por hecho que no salió y vuelve a pulsar.
  //
  // Aquello se arregló en el panel, pero el panel es la puerta bonita. Lo que
  // impide pagar dos veces por la misma decisión tiene que estar aquí.
  const { data: yaGenerando } = await supabase.from('generaciones_ia')
    .select('id').eq('producto_id', producto_id).eq('estado', 'generando').limit(1);
  if (yaGenerando?.length)
    return res.status(409).json({ error: 'Ese plato ya tiene una generación en camino. Espera a que termine.' });

  // Y una ya generada que nadie ha mirado cuenta igual: pedir otra es pagar
  // por una decisión que todavía no se ha tomado.
  const { data: sinRevisar } = await supabase.from('trabajos_video')
    .select('id').eq('producto_id', producto_id).eq('origen_tipo', 'ia')
    .is('aprobado', null).in('estado', ['pendiente', 'procesando', 'listo']).limit(1);
  if (sinRevisar?.length)
    return res.status(409).json({ error: 'Ese plato ya tiene un video generado esperando revisión. Publícalo o descártalo antes de generar otro.' });

  const rutaFoto = rutaLocalDeSubida(prod.imagen_url);
  if (rutaFoto && fs.existsSync(rutaFoto)) {
    const m = await video.medidasDe(rutaFoto);
    // Si no se pueden leer las medidas NO se bloquea. No saber la proporción
    // arriesga un resultado feo; no saber el cupo arriesga la factura. Por eso
    // aquel falla cerrado y este no.
    if (m) {
      const encaje = video.encajeDeFoto(m.ancho, m.alto, video.formatoDe(resto?.atributos));
      if (encaje.veredicto === 'rechaza')
        return res.status(400).json({ error: encaje.mensaje, encaje });
    }
  }

  try {
    const r = await colaia.lanzar(supabase, {
      restaurante_id, producto_id, foto_url: prod.imagen_url,
    });
    res.json(r);
  } catch (e) {
    // Quedarse sin cupo no es un error del sistema: es la respuesta esperada
    // y el panel la enseña tal cual, con el texto que invita a escribir.
    if (e.sinCupo) return res.status(409).json({ error: e.message, sinCupo: true });
    console.error('[ia] no se pudo lanzar la generación:', e.message);
    res.status(502).json({ error: 'No se pudo pedir la generación. Inténtalo de nuevo.' });
  }
});

// ── RESUMEN DE VIDEO POR RESTAURANTE ──────────────────────────
// Para la lista del superadmin: cuántos videos lleva cada uno y cuánto le
// queda de cupo de IA, sin tener que entrar a cada restaurante.
//
// Lo agrega la base (resumen_video_restaurantes) y no Node, por lo mismo que
// las estadísticas: pedirlo desde aquí serían dos consultas por restaurante y
// eso crece con los clientes. Así viaja el resultado y nada más.
app.get('/api/resumen-video', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });
  const { data, error } = await supabase.rpc('resumen_video_restaurantes');
  if (error) {
    console.error('[resumen] ', error.message);
    return res.status(500).json({ error: 'No se pudo calcular el resumen' });
  }
  res.json(data || {});
});

// ── CUPO DE GENERACIONES CON IA ───────────────────────────────
// Generar un video con IA cuesta dinero cada vez, así que el cupo existe
// antes que el botón que lo gasta. Ver cupo.js.
//
// A diferencia de la cobranza, el restaurante SÍ ve su cupo: es información
// que necesita para usar la función —"te quedan 12 animaciones"— y no un
// dato nuestro sobre él. Lo que no puede es cambiarlo.

app.get('/api/ia/cupo', auth, async (req, res) => {
  const rid = req.query.restaurante_id;
  if (!rid) return res.status(400).json({ error: 'Falta restaurante_id' });
  if (!canAccessRestaurante(req.user, rid)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    res.json(await cupo.estado(supabase, rid));
  } catch (e) {
    // Sin saber cuántas quedan, el panel no debe enseñar el botón de generar:
    // es preferible un error visible a dejar creer que hay cupo de sobra.
    console.error('[ia] no se pudo leer el cupo:', e.message);
    res.status(500).json({ error: 'No se pudo consultar el cupo' });
  }
});

// Ampliar (o recortar) el cupo de un restaurante. Solo superadmin: es la
// palanca comercial de "escríbenos para ampliar", no una preferencia del
// negocio.
app.patch('/api/ia/cupo/:restauranteId', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });

  // Sin parseInt a propósito: parseInt('1.5') da 1, y guardar un número
  // distinto del que se mandó no es aceptable en el dato que autoriza el
  // gasto. Lo que no sea un entero exacto se rechaza en vez de redondearse.
  //
  // null tampoco pasa: no mandar cupo no es lo mismo que poner 0, y Number(null)
  // vale 0.
  const bruto = req.body.cupo;
  const n = typeof bruto === 'number' ? bruto
          : (typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN);

  // El tope de arriba no es un límite técnico: es un freno para que una
  // errata de teclado no autorice mil generaciones.
  if (!Number.isInteger(n) || n < 0 || n > 500)
    return res.status(400).json({ error: 'El cupo va de 0 a 500' });

  const { error } = await supabase.from('restaurantes_ia')
    .upsert({ restaurante_id: req.params.restauranteId, cupo: n, actualizado_at: new Date().toISOString() },
            { onConflict: 'restaurante_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, cupo: n });
});

// ── APROBAR LO QUE GENERÓ EL MODELO ───────────────────────────
// Un video generado se convierte como cualquier otro pero NO entra solo en la
// carta. El motivo no es de calidad, es legal: el modelo no copia el plato, lo
// interpreta, y al orbitar hacia 3/4 tiene que rellenar el lado que la foto no
// enseña. Si ahí aparece una guarnición que el negocio no sirve, el comensal
// pide una cosa y le llega otra — publicidad engañosa, y el expuesto ante la
// SIC es el restaurante, no nosotros. Ver docs/video-con-ia.md §9.
//
// Los videos subidos a mano no pasan por aquí: quien graba su propio plato ya
// lo ha visto, y pedirle que lo apruebe sería preguntarle dos veces lo mismo.

// El entregable y la portada se sirven desde /uploads sin llave, igual que en
// la carta pública. El master no: vive en una carpeta privada y no se enseña.
const urlDeSubida = relativa =>
  relativa ? `${process.env.BASE_URL}/uploads/${String(relativa).split(path.sep).join('/')}` : null;

// Carga el trabajo y comprueba de una vez las cuatro condiciones. Están juntas
// porque las dos rutas necesitan exactamente las mismas y separarlas es cómo
// acaban discrepando: aprobar comprobando una cosa y descartar otra.
async function trabajoEnRevision(id, user) {
  const { data: t } = await supabase.from('trabajos_video')
    .select('id, restaurante_id, producto_id, estado, origen_tipo, aprobado, video, master, portada')
    .eq('id', id).maybeSingle();

  if (!t || !canAccessRestaurante(user, t.restaurante_id))
    return { codigo: 403, error: 'Sin permiso' };
  if (t.origen_tipo !== 'ia')
    return { codigo: 400, error: 'Ese video no lo generó un modelo: ya está publicado' };
  if (t.estado !== 'listo')
    return { codigo: 409, error: 'Ese video todavía no ha terminado de convertirse' };
  // aprobado ya decidido: ni se vuelve a publicar ni se vuelve a descartar. No
  // es un error del usuario, es que llegó dos veces —doble clic, dos pestañas—
  // y la segunda no tiene que deshacer la primera.
  if (t.aprobado !== null && t.aprobado !== undefined)
    return { codigo: 409, error: t.aprobado ? 'Ese video ya está publicado' : 'Ese video ya se descartó' };

  return { trabajo: t };
}

// Lo que hay pendiente de mirar. Devuelve las URL públicas porque sin poder
// VER el video la aprobación no significa nada: sería firmar a ciegas.
app.get('/api/ia/por-aprobar', auth, async (req, res) => {
  const rid = req.query.restaurante_id;
  if (!rid || !canAccessRestaurante(req.user, rid)) return res.status(403).json({ error: 'Sin permiso' });

  const { data, error } = await supabase.from('trabajos_video')
    .select('id, producto_id, video, portada, creado_en')
    .eq('restaurante_id', rid).eq('origen_tipo', 'ia').eq('estado', 'listo')
    .is('aprobado', null)
    .order('creado_en', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });

  res.json((data || []).map(t => ({
    id: t.id, producto_id: t.producto_id, creado_en: t.creado_en,
    video: urlDeSubida(t.video), portada: urlDeSubida(t.portada),
  })));
});

// Publicar: a partir de aquí el plato enseña el video en vez de la foto.
app.post('/api/ia/por-aprobar/:id/publicar', auth, async (req, res) => {
  const r = await trabajoEnRevision(req.params.id, req.user);
  if (r.error) return res.status(r.codigo).json({ error: r.error });

  try {
    await video.publicarTrabajo(supabase, r.trabajo);
    res.json({ ok: true });
  } catch (e) {
    console.error('[ia] no se pudo publicar el video generado:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Descartar: se borran los archivos y el plato se queda con su foto. La
// animación gastada NO vuelve al cupo — se generó y se pagó. Devolverla
// convertiría el cupo en "intentos hasta que te guste", que es justo el gasto
// sin techo que el cupo existe para impedir.
app.post('/api/ia/por-aprobar/:id/descartar', auth, async (req, res) => {
  const r = await trabajoEnRevision(req.params.id, req.user);
  if (r.error) return res.status(r.codigo).json({ error: r.error });

  try {
    await video.descartarTrabajo(supabase, r.trabajo);
    res.json({ ok: true });
  } catch (e) {
    console.error('[ia] no se pudo descartar el video generado:', e.message);
    res.status(500).json({ error: 'No se pudo descartar el video' });
  }
});

// ── FACTURACIÓN ───────────────────────────────────────────────
// Cuándo cobra la plataforma a cada restaurante y cuándo pagó por última
// vez. Vivía dentro de restaurantes.atributos, y esa tabla tiene lectura
// pública: la carta pide 'atributos' entero, así que estos dos datos
// viajaban al navegador de cada comensal y se veían en el inspector sin
// ninguna llave. Con la llave publishable, que está en el JS de la carta,
// se podían pedir los de todos a la vez.
//
// No es una credencial y con ella no se entra a ningún sitio. Es
// información comercial nuestra: quién paga, cuándo, y quién va atrasado.
//
// Ahora vive en restaurantes_facturacion, con RLS y sin políticas — solo
// la llave de servicio la alcanza, y esta API es la única puerta.
//
// SOLO ADMIN, las dos rutas. Un restaurante no tiene por qué ver ni
// escribir su propio estado de cobranza: es un dato de la plataforma
// sobre él, no suyo. Por eso no se usa canAccessRestaurante() aquí.

app.get('/api/facturacion', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });
  const { data, error } = await supabase.from('restaurantes_facturacion')
    .select('restaurante_id, dia_pago, ultimo_pago');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/facturacion/:restauranteId', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });

  const fila = { restaurante_id: req.params.restauranteId, actualizado_at: new Date().toISOString() };

  // Se distingue "no lo mandó" de "lo mandó vacío": lo primero deja el valor
  // como está, lo segundo lo borra. Sin esa diferencia no habría forma de
  // quitarle el día de pago a un restaurante.
  if (req.body.dia_pago !== undefined) {
    if (req.body.dia_pago === null || req.body.dia_pago === '') fila.dia_pago = null;
    else {
      const n = parseInt(req.body.dia_pago, 10);
      if (!Number.isInteger(n) || n < 1 || n > 31)
        return res.status(400).json({ error: 'El día de pago va del 1 al 31' });
      fila.dia_pago = n;
    }
  }

  if (req.body.ultimo_pago !== undefined) {
    if (req.body.ultimo_pago === null || req.body.ultimo_pago === '') fila.ultimo_pago = null;
    // Se valida la forma antes de ir a la base: una fecha mal escrita daría
    // un error de Postgres con nombres de tabla dentro.
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.ultimo_pago))) fila.ultimo_pago = req.body.ultimo_pago;
    else return res.status(400).json({ error: 'La fecha de pago debe ser AAAA-MM-DD' });
  }

  // upsert: un restaurante creado antes de que existiera esta tabla no tiene
  // fila, y anotarle un pago tiene que crearla en vez de fallar.
  const { error } = await supabase.from('restaurantes_facturacion')
    .upsert(fila, { onConflict: 'restaurante_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── CATEGORÍAS ────────────────────────────────────────────────
app.get('/api/categorias', auth, async (req, res) => {
  const rid = req.query.restaurante_id;
  if (!rid) return res.status(400).json({ error: 'Falta restaurante_id' });
  if (!canAccessRestaurante(req.user, rid)) return res.status(403).json({ error: 'Sin permiso' });
  const { data, error } = await supabase.from('categorias').select('*').eq('restaurante_id', rid).order('orden');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/categorias', auth, async (req, res) => {
  const { restaurante_id, nombre, slug, emoji, orden, sin_fotos, atributos } = req.body;
  if (!canAccessRestaurante(req.user, restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const { data: resto } = await supabase.from('restaurantes').select('atributos').eq('id', restaurante_id).single();
  const atributosFiltrados = atributosCategoria(atributos, null, req.user.rol === 'admin', planDe(resto?.atributos));
  const { data, error } = await supabase.from('categorias')
    .insert([{ restaurante_id, nombre, slug: slug || nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''), emoji: emoji || '', orden: parseInt(orden) || 0, sin_fotos: sin_fotos || false, atributos: atributosFiltrados }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/categorias/:id', auth, async (req, res) => {
  const { data: cat } = await supabase.from('categorias').select('restaurante_id, atributos').eq('id', req.params.id).single();
  if (!cat || !canAccessRestaurante(req.user, cat.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const permitidos = ['nombre', 'emoji', 'orden', 'sin_fotos', 'atributos'];
  const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));
  if (body.atributos !== undefined) {
    const { data: resto } = await supabase.from('restaurantes').select('atributos').eq('id', cat.restaurante_id).single();
    body.atributos = atributosCategoria(body.atributos, cat.atributos, req.user.rol === 'admin', planDe(resto?.atributos));
  }
  const { data, error } = await supabase.from('categorias').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/categorias/:id', auth, async (req, res) => {
  const { data: cat } = await supabase.from('categorias').select('restaurante_id').eq('id', req.params.id).single();
  if (!cat || !canAccessRestaurante(req.user, cat.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const { error } = await supabase.from('categorias').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── PRECIO: UN SOLO DATO ESCRITO DOS VECES ────────────────────
// 'precio' es lo que lee el cliente y 'precio_numerico' con lo que se ordena
// el menú y se suma el carrito. Cuando se separan, la carta muestra un precio
// y el carrito cobra otro: pasó con dos productos, uno con un cero de más
// ($4.500 mostrados contra 45000 internos).
//
// El panel ya deriva uno del otro, pero la API los aceptaba sueltos, así que
// la garantía va aquí: vale para el panel, para un script de importación y
// para cualquier llamada futura.
//
// El separador se arma a mano y no con toLocaleString: en Node depende de los
// datos ICU que traiga la imagen, y si faltan devuelve "4,500" en vez de
// "4.500", cambiando el formato de toda la carta sin avisar.
function formatoPrecio(n) {
  return '$ ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Normaliza los dos campos de 'body' para que no puedan contradecirse. Manda
// el número si viene; si solo llega el texto, se saca el número de ahí.
function normalizarPrecio(body) {
  if (body.precio_numerico !== undefined && body.precio_numerico !== null && body.precio_numerico !== '') {
    const n = parseFloat(body.precio_numerico);
    if (!Number.isFinite(n) || n < 0) return 'Precio inválido';
    body.precio_numerico = n;
    body.precio = formatoPrecio(n);
    return null;
  }
  if (body.precio !== undefined && body.precio !== null) {
    const digitos = String(body.precio).replace(/[^0-9]/g, '');
    if (!digitos) return 'Precio inválido';
    body.precio_numerico = Number(digitos);
    body.precio = formatoPrecio(body.precio_numerico);
  }
  return null;
}

// Lo que se puede escribir dentro de "atributos" de un PRODUCTO. Mismo
// criterio que ya se aplica a restaurantes y a categorías, que aquí faltaba:
// el objeto llegaba entero desde el navegador y se guardaba tal cual.
//
// Importa por una razón concreta. 'imagenes' se pinta en el panel, y el
// panel lo abre el SUPERADMIN para cualquier restaurante con su token en
// sessionStorage. Una lista de imágenes con algo que no es una imagen es la
// vía para que lo que escribe un restaurante acabe ejecutándose en la sesión
// de quien administra a todos. El escapado del panel es la otra mitad de
// esto; las dos hacen falta.
const ATRIBUTOS_PRODUCTO_PERMITIDOS = ['imagenes', 'personalizacion', 'filtros', 'popular', 'chef', 'nuevo'];

// 'video' lo escribe el worker cuando termina de convertir, nunca el
// navegador. Pero NO se puede simplemente descartar: el panel manda el
// objeto completo, así que ignorarlo sin más borraría el video del plato al
// guardar cualquier otro cambio. Se conserva el que ya estaba guardado.
const ATRIBUTOS_PRODUCTO_DEL_SERVIDOR = ['video'];

function atributosProducto(entrantes, actuales) {
  const out = {};
  for (const clave of ATRIBUTOS_PRODUCTO_PERMITIDOS)
    if (entrantes?.[clave] !== undefined) out[clave] = entrantes[clave];
  for (const clave of ATRIBUTOS_PRODUCTO_DEL_SERVIDOR)
    if (actuales?.[clave] !== undefined) out[clave] = actuales[clave];
  return out;
}

// Una categoría de OTRO restaurante no se puede usar. El permiso se
// comprueba sobre restaurante_id, que no dice nada sobre a quién pertenece la
// categoría: sin esto, un plato podía quedar colgado de una categoría ajena.
//
// El daño es callado, que es lo que lo hace molesto de encontrar: el plato se
// guarda bien y el panel dice que todo fue, pero la carta pública agrupa por
// las categorías DEL restaurante, así que ese plato no aparece en ningún
// sitio. Desde fuera parece que se perdió al guardar.
//
// Devuelve un mensaje de error, o null si la categoría vale.
async function categoriaAjena(categoriaId, restauranteId) {
  if (!categoriaId) return null;           // un plato sin categoría es válido
  const { data } = await supabase.from('categorias')
    .select('restaurante_id').eq('id', categoriaId).maybeSingle();
  if (!data) return 'Esa categoría no existe';
  if (data.restaurante_id !== restauranteId) return 'Esa categoría no es de este restaurante';
  return null;
}

// ── PRODUCTOS ─────────────────────────────────────────────────
app.get('/api/productos', auth, async (req, res) => {
  const rid = req.query.restaurante_id;
  if (!rid) return res.status(400).json({ error: 'Falta restaurante_id' });
  if (!canAccessRestaurante(req.user, rid)) return res.status(403).json({ error: 'Sin permiso' });
  const { data, error } = await supabase.from('productos').select('*').eq('restaurante_id', rid).order('precio_numerico');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/productos', auth, async (req, res) => {
  const { restaurante_id, categoria_id, nombre, descripcion, descripcion_avanzada, imagen_url, disponible, orden, atributos } = req.body;
  if (!canAccessRestaurante(req.user, restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const p = { precio: req.body.precio, precio_numerico: req.body.precio_numerico };
  const errPrecio = normalizarPrecio(p);
  if (errPrecio) return res.status(400).json({ error: errPrecio });
  const errCat = await categoriaAjena(categoria_id, restaurante_id);
  if (errCat) return res.status(400).json({ error: errCat });
  const { data, error } = await supabase.from('productos')
    .insert([{ restaurante_id, categoria_id, nombre, descripcion: descripcion || null, descripcion_avanzada: descripcion_avanzada || null, precio: p.precio ?? formatoPrecio(0), precio_numerico: p.precio_numerico ?? 0, imagen_url: imagen_url || null, disponible: disponible !== false, orden: parseInt(orden) || 0, atributos: atributosProducto(atributos, null) }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/productos/:id', auth, async (req, res) => {
  // 'atributos' hace falta para conservar lo que pone el worker (el video).
  const { data: prod } = await supabase.from('productos').select('restaurante_id, atributos').eq('id', req.params.id).single();
  if (!prod || !canAccessRestaurante(req.user, prod.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const permitidos = ['nombre', 'precio', 'precio_numerico', 'descripcion', 'descripcion_avanzada', 'imagen_url', 'disponible', 'categoria_id', 'orden', 'atributos'];
  const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));
  const errPrecio = normalizarPrecio(body);
  if (errPrecio) return res.status(400).json({ error: errPrecio });
  if (body.atributos !== undefined) body.atributos = atributosProducto(body.atributos, prod.atributos);
  // Mover un plato de categoría es normal; moverlo a la de otro negocio no.
  if (body.categoria_id !== undefined) {
    const errCat = await categoriaAjena(body.categoria_id, prod.restaurante_id);
    if (errCat) return res.status(400).json({ error: errCat });
  }
  const { data, error } = await supabase.from('productos').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/productos/:id', auth, async (req, res) => {
  const { data: prod } = await supabase.from('productos').select('restaurante_id, imagen_url').eq('id', req.params.id).single();
  if (!prod || !canAccessRestaurante(req.user, prod.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  // Borrar imagen del servidor si es local
  if (prod.imagen_url && prod.imagen_url.includes('/uploads/')) {
    const parts = prod.imagen_url.split('/uploads/')[1];
    const filepath = path.join(__dirname, 'uploads', parts);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  }
  const { error } = await supabase.from('productos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── IMÁGENES ──────────────────────────────────────────────────
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
  // Misma función que usó multer para elegir el destino: así la URL que se
  // devuelve siempre apunta a donde realmente quedó el archivo.
  const sub = carpetaDe(req);
  const url = `${process.env.BASE_URL}/uploads/${sub}/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// Express aplica decodeURIComponent a los parámetros de ruta, así que un
// '..%2F..%2Fserver.js' llega ya convertido en una ruta que se sale de
// uploads/. Se resuelve la ruta y se comprueba que el resultado siga dentro
// antes de borrar nada.
app.delete('/api/upload/:folder/:filename', auth, (req, res) => {
  const base = path.resolve(__dirname, 'uploads');
  const fp = path.resolve(base, req.params.folder, req.params.filename);
  const rel = path.relative(base, fp);
  // Todo lo subido vive exactamente a un nivel: uploads/<carpeta>/<archivo>.
  // Exigir esa profundidad descarta de una vez las rutas que se salen y las
  // que apuntan a la carpeta misma (un unlink sobre un directorio lanza).
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).length !== 2)
    return res.status(400).json({ error: 'Ruta inválida' });
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no encontrado' });
  // El borrado puede fallar igual (permisos, carrera con otro borrado); que no
  // se lleve por delante el proceso entero.
  try { fs.unlinkSync(fp); } catch { return res.status(500).json({ error: 'No se pudo borrar' }); }
  res.json({ ok: true });
});

// ── VIDEO ─────────────────────────────────────────────────────
// Recibe el archivo y responde enseguida. La conversión la hace video.js por
// su cuenta: son ~86 segundos por plato y ninguna petición HTTP debería
// esperar eso. Ver docs/cartas-en-video.md.
app.post('/api/video', auth,
  (req, res, next) => {
    // Antes de que multer escriba nada en el disco.
    if (espacioLibreMB() < MARGEN_DISCO_MB)
      return res.status(507).json({ error: 'No hay espacio suficiente en el servidor' });
    next();
  },
  // Va antes de multer a propósito: tiene que estar escuchando desde antes de
  // que se escriba el primer byte.
  limpiarSubidaCortada,
  subidaVideo.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió video' });
    // El archivo ya está en el disco cuando llegamos aquí, así que cualquier
    // salida por la puerta de atrás tiene que llevárselo.
    const descartar = () => { try { fs.unlinkSync(req.file.path); } catch {} };

    const { restaurante_id, producto_id } = req.body;
    if (!restaurante_id || !canAccessRestaurante(req.user, restaurante_id)) {
      descartar();
      return res.status(403).json({ error: 'Sin permiso' });
    }

    // Los atributos hacen falta siempre: de ahí salen el plan y el modelo.
    const { data: resto } = await supabase.from('restaurantes')
      .select('atributos').eq('id', restaurante_id).single();

    // La carta en video es de plan, y convertir cuesta minuto y medio de CPU
    // por archivo: sin esta comprobación cualquier restaurante podría llenar
    // la cola llamando aquí directamente. El superadmin siempre puede, igual
    // que en estadísticas.
    if (req.user.rol !== 'admin' && !planDe(resto?.atributos).videos) {
      descartar();
      return res.status(403).json({ error: 'La carta en video no está incluida en el plan actual' });
    }

    // La proporción la decide el modelo que va a pintar el video, y la mira el
    // servidor en vez de recibirla del navegador: así no hay nada que validar
    // y no puede quedar un trabajo pidiendo un formato que su carta no usa.
    // Se guarda en el trabajo, no se lee después del restaurante — si el
    // negocio cambia de modelo, sus videos ya convertidos no cambian solos.
    const formato = video.formatoDe(resto?.atributos);

    // Desde qué segundo del original se recorta. Llega como texto del
    // formulario, y lo que no sea un número razonable se trata como 0: es
    // preferible convertir desde el principio que rechazar la subida de un
    // archivo que ya está en el disco. El tope alto lo pone la columna.
    const desde = Math.max(0, Math.min(3599, Number(req.body.desde) || 0));

    // Sin esta comprobación un restaurante podría colgarle un video a un plato
    // de otro: el permiso sobre restaurante_id no dice nada sobre a quién
    // pertenece producto_id.
    if (producto_id) {
      const { data: prod } = await supabase.from('productos')
        .select('restaurante_id').eq('id', producto_id).maybeSingle();
      if (!prod || prod.restaurante_id !== restaurante_id) {
        descartar();
        return res.status(403).json({ error: 'Ese plato no es de este restaurante' });
      }
    }

    try {
      const trabajo = await video.encolar(supabase, {
        restaurante_id, producto_id, desde, formato,
        origen: path.join(video.CARPETAS.origen, req.file.filename),
      });
      res.json({ trabajo_id: trabajo.id, estado: trabajo.estado });
    } catch (e) {
      // Si no se pudo encolar, ese archivo no lo va a procesar nadie nunca.
      descartar();
      res.status(500).json({ error: e.message });
    }
  });

// Para que el panel pueda mostrar el progreso. No devuelve las rutas internas:
// la URL pública del video ya vive en productos.atributos.
app.get('/api/video/trabajos', auth, async (req, res) => {
  const rid = req.query.restaurante_id;
  if (!rid || !canAccessRestaurante(req.user, rid)) return res.status(403).json({ error: 'Sin permiso' });
  // origen_tipo y aprobado no son rutas internas: son dos banderas, y sin
  // ellas el panel no puede distinguir un video convertido que ya está en la
  // carta de uno generado que sigue esperando revisión. Los dos son 'listo'.
  const { data, error } = await supabase.from('trabajos_video')
    .select('id, producto_id, estado, error, intentos, origen_tipo, aprobado, formato, master, creado_en, actualizado_en')
    .eq('restaurante_id', rid).order('creado_en', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });

  // El master sigue sin salir de aquí: es un archivo interno y su carpeta ni
  // siquiera se sirve. Lo que el panel necesita saber no es dónde está sino si
  // existe — es lo que decide si se puede reconvertir sin volver a grabar.
  res.json((data || []).map(({ master, ...t }) => ({ ...t, tiene_master: !!master })));
});

// Descartar un trabajo fallido. Al borrar la fila, el original deja de estar
// referenciado y limpieza.js lo recoge en su siguiente pasada.
app.delete('/api/video/trabajos/:id', auth, async (req, res) => {
  const { data: t } = await supabase.from('trabajos_video')
    .select('restaurante_id, estado').eq('id', req.params.id).maybeSingle();
  if (!t || !canAccessRestaurante(req.user, t.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  // Borrarlo a mitad de conversión dejaría a ffmpeg escribiendo en archivos
  // que ya no le importan a nadie.
  if (t.estado === 'procesando') return res.status(409).json({ error: 'Ese video se está convirtiendo ahora mismo' });
  const { error } = await supabase.from('trabajos_video').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── RECONVERTIR DESDE EL MASTER ───────────────────────────────
// El master se guarda sin recortar para poder volver a cortarlo el día que la
// carta pida otra proporción — pasar de horizontal a vertical no debería
// significar volver a grabar veinticinco platos. Eso estaba escrito en video.js
// desde el principio y no era verdad: se guardaban los masters y no existía
// forma de usarlos. Estas dos rutas son lo que faltaba.
//
// No cuesta dinero y no gasta cupo: no se llama a nadie, solo se vuelve a
// recortar un archivo que ya está en el disco.

// Ya hay una conversión en marcha para ese plato. Dos a la vez compiten por el
// mismo campo del producto: gana la que termine después, que no tiene por qué
// ser la que se pidió, y la otra queda ocupando disco sin que nada la enseñe.
async function hayConversionEnMarcha(productoId) {
  if (!productoId) return false;
  const { data } = await supabase.from('trabajos_video')
    .select('id').eq('producto_id', productoId).in('estado', ['pendiente', 'procesando']).limit(1);
  return !!data?.length;
}

app.post('/api/video/trabajos/:id/reconvertir', auth, async (req, res) => {
  const { data: t } = await supabase.from('trabajos_video')
    .select('id, restaurante_id, producto_id, formato, master, origen_tipo, aprobado')
    .eq('id', req.params.id).maybeSingle();
  if (!t || !canAccessRestaurante(req.user, t.restaurante_id))
    return res.status(403).json({ error: 'Sin permiso' });

  const { data: resto } = await supabase.from('restaurantes')
    .select('atributos').eq('id', t.restaurante_id).single();

  // Por defecto, el formato que la carta usa AHORA — que es el motivo por el
  // que casi siempre se llega aquí. Se acepta pedir otro, pero solo uno real.
  const pedido = req.body?.formato;
  const formato = (pedido === 'horizontal' || pedido === 'vertical')
    ? pedido : video.formatoDe(resto?.atributos);

  if (await hayConversionEnMarcha(t.producto_id))
    return res.status(409).json({ error: 'Ese plato ya tiene una conversión en marcha' });

  try {
    const nuevo = await video.reconvertir(supabase, t, formato);
    res.json({ trabajo_id: nuevo.id, formato });
  } catch (e) {
    // "No tiene master" y "el master ya no está" son del que pide, no del
    // servidor: se contestan tal cual porque explican qué hacer.
    res.status(e.definitivo ? 400 : 500).json({ error: e.message });
  }
});

// Todos los videos de un restaurante que quedaron en el formato anterior. Es
// la operación de verdad detrás de "cambié el modelo de la carta": hacerla
// plato a plato con veinticinco platos no la hace nadie.
app.post('/api/video/reconvertir', auth, async (req, res) => {
  const rid = req.body?.restaurante_id;
  if (!rid || !canAccessRestaurante(req.user, rid)) return res.status(403).json({ error: 'Sin permiso' });

  const { data: resto } = await supabase.from('restaurantes')
    .select('atributos').eq('id', rid).single();
  const formato = video.formatoDe(resto?.atributos);

  // Solo los terminados, con master y en el formato que ya no toca. Un trabajo
  // en curso no se reconvierte: todavía no se sabe en qué va a quedar.
  const { data: viejos } = await supabase.from('trabajos_video')
    .select('id, restaurante_id, producto_id, formato, master, origen_tipo, aprobado')
    .eq('restaurante_id', rid).eq('estado', 'listo').neq('formato', formato)
    .not('master', 'is', null);

  const encolados = [];
  const saltados  = [];
  for (const t of viejos || []) {
    // Uno que no se pueda reconvertir no puede parar a los demás: con
    // veinticinco platos, fallar entero por un master perdido dejaría la carta
    // a medias y sin forma de saber cuáles sí se pudieron.
    try {
      if (await hayConversionEnMarcha(t.producto_id)) { saltados.push({ id: t.id, motivo: 'ya tiene una conversión en marcha' }); continue; }
      const nuevo = await video.reconvertir(supabase, t, formato);
      encolados.push(nuevo.id);
    } catch (e) {
      saltados.push({ id: t.id, motivo: e.message });
    }
  }

  console.log(`♻️  reconversión a ${formato}: ${encolados.length} encolados, ${saltados.length} saltados`);
  res.json({ formato, encolados: encolados.length, saltados });
});

// ── ANALÍTICA ─────────────────────────────────────────────────
// Registro de eventos: sin auth (lo llama el sitio público, que no
// tiene credenciales). Solo inserta, nunca lee.
app.post('/api/track', async (req, res) => {
  if (!dentroDelLimite(req.ip)) {
    // Se registra la IP resuelta: si aquí sale siempre la misma dirección
    // interna, TRUST_PROXY está mal y el límite está contando a todos los
    // visitantes como uno solo.
    console.warn(`[track] límite por minuto alcanzado para ${req.ip}`);
    return res.status(429).json({ error: 'Demasiadas peticiones' });
  }

  const { restaurante_id, tipo, producto_id } = req.body;
  // Se valida la forma del UUID antes de ir a la base: así una petición basura
  // no gasta una consulta ni provoca un error de Postgres.
  if (!UUID_RE.test(restaurante_id ?? '') || !TIPOS_EVENTO.includes(tipo))
    return res.status(400).json({ error: 'Datos inválidos' });
  // Los dos tipos que hablan de un producto necesitan saber cuál.
  if (tipo !== 'visita' && !UUID_RE.test(producto_id ?? ''))
    return res.status(400).json({ error: 'Falta producto_id' });

  const { error } = await supabase.from('eventos_analitica')
    .insert([{ restaurante_id, tipo, producto_id: producto_id || null }]);
  // Al otro lado no hay nadie autenticado: el mensaje de Postgres (nombres de
  // tablas, restricciones) no debe salir de aquí.
  if (error) {
    console.error('[track] error insertando evento:', error.message);
    return res.status(500).json({ error: 'No se pudo registrar el evento' });
  }
  res.status(204).end();
});

// Consulta agregada: sí requiere auth y respeta el mismo control de acceso
// que el resto (un cliente solo ve sus propias estadísticas).
app.get('/api/estadisticas', auth, async (req, res) => {
  const { restaurante_id, desde, hasta } = req.query;
  if (!restaurante_id || !desde || !hasta) return res.status(400).json({ error: 'Faltan parámetros' });
  if (!canAccessRestaurante(req.user, restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });

  // Los atributos hacen falta siempre (de ahí sale la zona horaria), no solo
  // para el chequeo de plan.
  const { data: resto } = await supabase.from('restaurantes').select('atributos').eq('id', restaurante_id).single();

  // El superadmin siempre puede consultarlas; para el restaurante dependen
  // del plan. Ocultar la pestaña no basta: la API responde igual.
  if (req.user.rol !== 'admin' && !planDe(resto?.atributos).estadisticas)
    return res.status(403).json({ error: 'Las estadísticas no están incluidas en el plan actual' });

  // 'desde' y 'hasta' llegan como días del calendario del restaurante. Sin
  // convertirlos a instantes de su zona, Postgres los leía como UTC y el
  // rango quedaba corrido cinco horas.
  const zona = zonaDe(resto?.atributos);
  const desdeInicio = instanteUTC(desde, '00:00:00', zona).toISOString();
  const hastaFin = instanteUTC(hasta, '23:59:59', zona).toISOString();

  // Antes se traían todos los eventos del rango y se agrupaban aquí, con dos
  // consultas más una tercera para los nombres. Ahora cuenta la base y solo
  // viaja el resultado: la memoria del proceso y el tamaño de la respuesta ya
  // no dependen de cuántos eventos haya, sino de cuántos días y productos
  // distintos tenga el rango.
  const { data: est, error } = await supabase.rpc('estadisticas_restaurante', {
    p_restaurante_id: restaurante_id,
    p_desde: desdeInicio,
    p_hasta: hastaFin,
    p_zona: zona
  });
  if (error) {
    console.error('[estadisticas] error agregando:', error.message);
    return res.status(500).json({ error: 'No se pudieron calcular las estadísticas' });
  }

  const totalVisitas = est?.totalVisitas ?? 0;
  const totalClics = est?.totalClics ?? 0;
  const totalAgregados = est?.totalAgregados ?? 0;

  res.json({
    zona,
    totalVisitas,
    totalClics,
    tasaInteraccion: totalVisitas ? +(totalClics / totalVisitas * 100).toFixed(1) : 0,
    visitasPorDia: est?.visitasPorDia ?? {},
    rankingProductos: est?.rankingProductos ?? [],
    // Los tres salen del mismo evento que ya se registraba; no hace falta
    // capturar nada nuevo, solo mirarlo de otra forma.
    porHora: est?.porHora ?? [],
    porCategoria: est?.porCategoria ?? [],
    nuncaAbiertos: est?.nuncaAbiertos ?? [],
    // Solo tienen sentido en los restaurantes con modelo carrito; en el
    // resto llegan a cero y el panel oculta la sección.
    totalAgregados,
    masAgregados: est?.masAgregados ?? [],
    // Sobre CLICS y no sobre visitas a propósito: una "visita" es una carga
    // de página, no una persona —quien recarga tres veces cuenta tres—, así
    // que una conversión calculada sobre eso engañaría. Esto responde algo
    // más honesto: de cada 100 fichas que se abren, cuántas acaban en el
    // carrito.
    tasaAnadido: totalClics ? +(totalAgregados / totalClics * 100).toFixed(1) : 0
  });
});

// ── VISTA PREVIA AL COMPARTIR (Open Graph) ────────────────────
// Cuando alguien manda el enlace de una carta por WhatsApp, el robot de
// WhatsApp pide la URL, lee el HTML CRUDO y se va. No ejecuta JavaScript.
//
// Y la carta pública es una página que se pinta en el navegador leyendo de
// Supabase: el HTML que sale del servidor no sabe todavía de qué restaurante
// es. Por eso hoy compartir cualquier carta manda un enlace pelado, sin foto
// ni nombre, y por eso NO se arregla desde loader.js — cuando ese código
// corre, la vista previa ya se decidió.
//
// La solución es que alguien conteste HTML con las etiquetas ya puestas, y
// ese alguien tiene que leer la base de datos: este servidor. nginx manda
// aquí SOLO a los robots (ver nginx.conf de vmenus-app); las personas siguen
// recibiendo la aplicación de siempre y no pasan por aquí. Si esto se cayera,
// se pierden las miniaturas, no las cartas.
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// La imagen de la tarjeta, por orden de lo que mejor representa al negocio.
// El logo antes que el fondo porque un fondo suele ser una textura, y una
// textura en la vista previa no dice de quién es la carta.
function imagenParaCompartir(r) {
  const at = r?.atributos || {};
  return at.portada_url || r?.logo_url || r?.fondo_url || null;
}

// Y si el restaurante no tiene ninguna de las tres, una foto de plato antes
// que rendirse. Sale de mirar los datos de verdad: de siete restaurantes,
// tres no tenían logo — y dos de ellos tenían seis platos fotografiados cada
// uno. Mandar una tarjeta sin foto teniendo eso es tirar lo que más llama la
// atención de un menú.
//
// Va como último recurso y no antes que el logo: el logo lo eligió el
// negocio para representarse, y una tarjeta de WhatsApp es pequeña. Pero
// entre un plato y nada, el plato.
//
// Solo se pregunta cuando hace falta, así que a los que tienen logo no les
// cuesta una consulta de más.
async function fotoDeAlgunPlato(restauranteId) {
  if (!restauranteId) return null;
  try {
    const { data } = await supabase.from('productos')
      .select('imagen_url')
      .eq('restaurante_id', restauranteId)
      .eq('disponible', true)
      .not('imagen_url', 'is', null)
      .limit(1).maybeSingle();
    return data?.imagen_url || null;
  } catch { return null; }
}

// 'imagenSuelta' la pasa quien llama cuando el restaurante no trae ninguna
// suya: así esta función sigue sin tocar la base y se puede comprobar sola.
function paginaOpenGraph(r, url, imagenSuelta) {
  const at = r?.atributos || {};
  const titulo = r?.nombre || 'Carta digital';
  const desc = at.subtitulo || `Mira la carta de ${titulo}`;
  const img = imagenParaCompartir(r) || imagenSuelta || null;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${escHtml(titulo)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escHtml(titulo)}">
<meta property="og:title" content="${escHtml(titulo)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(url)}">
${img ? `<meta property="og:image" content="${escHtml(img)}">
<meta property="og:image:alt" content="${escHtml(titulo)}">` : ''}
<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escHtml(titulo)}">
<meta name="twitter:description" content="${escHtml(desc)}">
${img ? `<meta name="twitter:image" content="${escHtml(img)}">` : ''}
<meta http-equiv="refresh" content="0;url=${escHtml(url)}">
</head><body>
<p>Cargando la carta de ${escHtml(titulo)}… <a href="${escHtml(url)}">Entrar</a></p>
</body></html>`;
}

// og:site_name lleva el nombre del restaurante y no "VMenus" a propósito. La
// tarjeta es del negocio, no de la plataforma — y los planes sin marca pagan
// justamente por eso.
// ⚠ ESTA REGLA ESTÁ DUPLICADA. La original es leerSlug() en
// vmenus-app/core/loader.js, y son dos aplicaciones desplegadas por separado
// así que no se puede compartir el módulo. Si allí cambia, aquí también.
//
// Que se desincronicen no rompe la carta: rompe la vista previa, que
// anunciaría un restaurante distinto del que se abre al pulsar. Peor que no
// tener tarjeta.
const SUBDOMINIOS_RESERVADOS = ['menu', 'www', 'admin', 'app', 'api'];

function slugDesde(host, ruta) {
  // A minúsculas ANTES de comparar con los reservados. En el navegador esto
  // no hace falta porque location.hostname ya viene normalizado, pero aquí el
  // host lo manda un robot y puede venir como quiera: sin esto,
  // MENU.VMENUS.CO/BONZAS trataría a "MENU" como si fuera un restaurante y la
  // tarjeta saldría genérica. Los nombres de dominio no distinguen caja.
  const h = String(host || '').toLowerCase();
  const porRuta = String(ruta || '').split('/').filter(Boolean)[0] || '';
  const partes = h.split('.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || partes.length < 3) return porRuta;
  return SUBDOMINIOS_RESERVADOS.includes(partes[0]) ? porRuta : partes[0];
}

app.get('/api/og', async (req, res) => {
  // host y path llegan de nginx, que es el único que sabe con qué dominio
  // entró la petición: la misma carta responde en menu.vmenus.co/bonzas y en
  // bonzas.vmenus.co.
  const host = String(req.query.host || '');
  const slug = slugDesde(host, req.query.path).toLowerCase();

  // El destino que verá quien pulse, y lo que va en og:url. Se construye
  // aquí en vez de aceptarlo de la petición: una URL que llegue de fuera y se
  // escriba en un href es una redirección abierta servida desde nuestro
  // dominio. Solo se admite el host que dice nginx, y con la forma de host.
  //
  // Y con la ruta que corresponda: en bonzas.vmenus.co el slug ya está en el
  // dominio, así que el destino es la raíz. Poner /bonzas ahí daría una URL
  // que no es la que el visitante compartió.
  const hostBueno = /^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/i.test(host);
  const enSubdominio = slug && !String(req.query.path || '').includes(slug);
  const destino = !hostBueno
    ? `https://menu.vmenus.co/${encodeURIComponent(slug)}`
    : enSubdominio ? `https://${host}/`
    : `https://${host}/${encodeURIComponent(slug)}`;

  // Cabecera puesta antes de cualquier salida: hasta el caso de error
  // devuelve HTML, porque quien pregunta es un robot que espera HTML.
  res.set('Content-Type', 'text/html; charset=utf-8');
  // Media hora de caché. Los robots de WhatsApp y Facebook piden la misma
  // URL muchas veces cuando un enlace circula, y esto no cambia por minuto.
  res.set('Cache-Control', 'public, max-age=1800');

  try {
    const { data } = await supabase.from('restaurantes')
      .select('id, nombre, slug, logo_url, fondo_url, activo, atributos')
      .eq('slug', slug).maybeSingle();

    // Un restaurante inactivo o inexistente NO se anuncia con su nombre: se
    // devuelve la tarjeta genérica. Enseñar "Restaurante X" de un negocio
    // suspendido, o confirmar qué slugs existen, no ayuda a nadie.
    if (!data || data.activo === false) {
      return res.status(200).send(paginaOpenGraph({ nombre: 'Carta digital' }, destino));
    }
    // Solo si no trae ninguna propia: a los que tienen logo no les cuesta
    // una consulta de más.
    const respaldo = imagenParaCompartir(data) ? null : await fotoDeAlgunPlato(data.id);
    res.send(paginaOpenGraph(data, destino, respaldo));
  } catch (e) {
    // Que un fallo de base de datos no deje al robot sin nada: peor tarjeta,
    // pero tarjeta. Y nunca un 500, que algunos robots recuerdan.
    console.error('[og] ', e.message);
    res.status(200).send(paginaOpenGraph({ nombre: 'Carta digital' }, destino));
  }
});

// multer lanza cuando el archivo pasa del límite o la extensión no vale. Sin
// esto Express responde con una página HTML de error y el panel enseña algo
// ilegible en vez de decir qué pasó. Va después de las rutas porque un
// manejador de errores solo recibe lo que ellas dejan escapar.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // El tope depende de la ruta: 200 MB para un video, 10 para una foto.
    // Anunciar siempre el del video le decía a quien subía una foto de 12 MB
    // que el límite eran 200, así que volvía a intentarlo con la misma foto.
    const tope = req.path === '/api/video' ? VIDEO_MAX_MB : IMAGEN_MAX_MB;
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE'
      ? `El archivo pasa del límite de ${tope} MB` : err.message });
  }
  if (/^Solo /.test(err?.message || '')) return res.status(400).json({ error: err.message });
  next(err);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`✅ Panel corriendo en puerto ${PORT}`);
  // Se puede apagar con VIDEO_WORKER=0 si algún día conviene moverlo a un
  // proceso aparte.
  if (process.env.VIDEO_WORKER !== '0') video.arrancar(supabase);
  // La cola de IA solo arranca si hay con qué llamar: sin token no haría más
  // que fallar cada veinte segundos y llenar los registros de ruido.
  if (process.env.VIDEO_WORKER !== '0' && process.env.REPLICATE_API_TOKEN) colaia.arrancar(supabase);
  else if (!process.env.REPLICATE_API_TOKEN) console.log('✨ cola de IA apagada: falta REPLICATE_API_TOKEN');
  limpieza.arrancar(supabase);
});
