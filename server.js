require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|webp/.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Solo JPG, PNG o WEBP'));
  }
});

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

  if (slug === 'admin') {
    if (!process.env.PIN_ADMIN || pin !== process.env.PIN_ADMIN)
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign({ slug, rol: 'admin', restauranteId: null }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token, rol: 'admin', restauranteId: null });
  }

  // El hash vive en restaurantes_privado, una tabla sin políticas RLS: solo
  // la llave de servicio (que las ignora) la puede leer. La tabla pública
  // 'restaurantes' se sirve entera al menú de cualquier visitante, así que
  // no puede contener secretos.
  const { data } = await supabase.from('restaurantes').select('id').eq('slug', slug).single();
  if (!data) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const { data: cred } = await supabase.from('restaurantes_privado')
    .select('pin_hash').eq('restaurante_id', data.id).maybeSingle();
  if (!cred?.pin_hash || !(await bcrypt.compare(pin, cred.pin_hash)))
    return res.status(401).json({ error: 'Credenciales incorrectas' });

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
const ATRIBUTOS_CLONABLES = ['nav', 'fuente_titulo', 'fuente_cuerpo', 'color_surface', 'color_card', 'fondo_tipo', 'fondo_color', 'fondo_intensidad', 'css_custom'];

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
  vitrina:  { qr_disenador: false, estadisticas: false, horarios: false },
  pedidos:  { qr_disenador: true,  estadisticas: true,  horarios: true  },
  completo: { qr_disenador: true,  estadisticas: true,  horarios: true  },
};
const PLAN_POR_DEFECTO = 'pedidos';
const planDe = atributos => PLANES[atributos?.plan] || PLANES[PLAN_POR_DEFECTO];

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

// Día calendario ('YYYY-MM-DD') al que pertenece un evento en esa zona.
function diaEn(iso, zona) {
  const p = partesEn(new Date(iso), zona);
  return `${p.year}-${p.month}-${p.day}`;
}

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
  const { data, error } = await supabase.from('categorias')
    .insert([{ restaurante_id, nombre, slug: slug || nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''), emoji: emoji || '', orden: parseInt(orden) || 0, sin_fotos: sin_fotos || false, atributos: atributos || {} }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/categorias/:id', auth, async (req, res) => {
  const { data: cat } = await supabase.from('categorias').select('restaurante_id').eq('id', req.params.id).single();
  if (!cat || !canAccessRestaurante(req.user, cat.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const permitidos = ['nombre', 'emoji', 'orden', 'sin_fotos', 'atributos'];
  const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));
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
  const { restaurante_id, categoria_id, nombre, descripcion, descripcion_avanzada, precio, precio_numerico, imagen_url, disponible, orden, atributos } = req.body;
  if (!canAccessRestaurante(req.user, restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const { data, error } = await supabase.from('productos')
    .insert([{ restaurante_id, categoria_id, nombre, descripcion: descripcion || null, descripcion_avanzada: descripcion_avanzada || null, precio, precio_numerico: parseFloat(precio_numerico) || 0, imagen_url: imagen_url || null, disponible: disponible !== false, orden: parseInt(orden) || 0, atributos: atributos || {} }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/productos/:id', auth, async (req, res) => {
  const { data: prod } = await supabase.from('productos').select('restaurante_id').eq('id', req.params.id).single();
  if (!prod || !canAccessRestaurante(req.user, prod.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const permitidos = ['nombre', 'precio', 'precio_numerico', 'descripcion', 'descripcion_avanzada', 'imagen_url', 'disponible', 'categoria_id', 'orden', 'atributos'];
  const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));
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

// ── ANALÍTICA ─────────────────────────────────────────────────
// Registro de eventos: sin auth (lo llama el sitio público, que no
// tiene credenciales). Solo inserta, nunca lee.
app.post('/api/track', async (req, res) => {
  const { restaurante_id, tipo, producto_id } = req.body;
  if (!restaurante_id || !['visita', 'clic'].includes(tipo))
    return res.status(400).json({ error: 'Datos inválidos' });
  if (tipo === 'clic' && !producto_id)
    return res.status(400).json({ error: 'Falta producto_id' });
  const { error } = await supabase.from('eventos_analitica')
    .insert([{ restaurante_id, tipo, producto_id: producto_id || null }]);
  if (error) return res.status(500).json({ error: error.message });
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

  const [visitasRes, clicsRes] = await Promise.all([
    supabase.from('eventos_analitica').select('created_at')
      .eq('restaurante_id', restaurante_id).eq('tipo', 'visita')
      .gte('created_at', desdeInicio).lte('created_at', hastaFin),
    supabase.from('eventos_analitica').select('producto_id, created_at')
      .eq('restaurante_id', restaurante_id).eq('tipo', 'clic')
      .gte('created_at', desdeInicio).lte('created_at', hastaFin)
  ]);
  if (visitasRes.error) return res.status(500).json({ error: visitasRes.error.message });
  if (clicsRes.error) return res.status(500).json({ error: clicsRes.error.message });
  const visitas = visitasRes.data;
  const clics = clicsRes.data;

  const visitasPorDia = {};
  visitas.forEach(v => {
    // slice(0,10) sobre el timestamp daba el día UTC, no el del restaurante.
    const dia = diaEn(v.created_at, zona);
    visitasPorDia[dia] = (visitasPorDia[dia] || 0) + 1;
  });

  const clicsPorProducto = {};
  clics.forEach(c => {
    if (!c.producto_id) return;
    clicsPorProducto[c.producto_id] = (clicsPorProducto[c.producto_id] || 0) + 1;
  });

  let nombres = {};
  const productIds = Object.keys(clicsPorProducto);
  if (productIds.length) {
    const { data: prods } = await supabase.from('productos').select('id, nombre').in('id', productIds);
    (prods || []).forEach(p => { nombres[p.id] = p.nombre; });
  }
  const rankingProductos = Object.entries(clicsPorProducto)
    .map(([producto_id, clics]) => ({ producto_id, nombre: nombres[producto_id] || '(producto eliminado)', clics }))
    .sort((a, b) => b.clics - a.clics);

  res.json({
    zona,
    totalVisitas: visitas.length,
    totalClics: clics.length,
    tasaInteraccion: visitas.length ? +(clics.length / visitas.length * 100).toFixed(1) : 0,
    visitasPorDia,
    rankingProductos
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`✅ Panel corriendo en puerto ${PORT}`));
