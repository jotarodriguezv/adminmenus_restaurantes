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
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Leer folder desde query params (?folder=promos) porque en multipart
    // req.body aún no está disponible cuando multer procesa el archivo
    const sub = req.query.folder || 'productos';
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

  const { data } = await supabase.from('restaurantes').select('id, pin_hash').eq('slug', slug).single();
  if (!data || !data.pin_hash || !(await bcrypt.compare(pin, data.pin_hash)))
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
    .insert([{ nombre, slug, color_primario: color_primario||'#3dd68c', color_secundario: color_secundario||'#a374af', activo: activo!==false, promo_activa: false, pin_hash, atributos }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  const { pin_hash: _omit, ...safe } = data;
  res.json(safe);
});

app.patch('/api/restaurantes/:id/pin', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo superadmin' });
  const { pin } = req.body;
  if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN requerido (mínimo 4 caracteres)' });
  const pin_hash = await bcrypt.hash(pin, 10);
  const { error } = await supabase.from('restaurantes').update({ pin_hash }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Campos de nivel superior que cada rol puede tocar en un restaurante.
// El cliente NUNCA debe poder cambiar marca/estructura (eso es Apariencia,
// oculta en la UI pero antes también alcanzable a mano por API).
const CAMPOS_RESTAURANTE_ADMIN   = ['promo_activa', 'promo_imagen_url', 'color_primario', 'color_secundario', 'nombre', 'slug', 'logo_url', 'fondo_url', 'activo', 'atributos'];
const CAMPOS_RESTAURANTE_CLIENTE = ['promo_activa', 'promo_imagen_url', 'atributos'];
// Dentro de "atributos" (JSON libre), el cliente solo puede tocar estas claves
// (toppings, WhatsApp de pedidos y métodos de pago). nav, fuentes, redes,
// css_custom, etc. quedan fuera.
const ATRIBUTOS_CLIENTE_PERMITIDOS = ['toppings_platino', 'toppings_premium', 'salsas', 'whatsapp_pedidos', 'metodos_pago'];

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
    const entrantes = Object.fromEntries(Object.entries(body.atributos).filter(([k]) => ATRIBUTOS_CLIENTE_PERMITIDOS.includes(k)));
    body.atributos = { ...(actual?.atributos || {}), ...entrantes };
  }

  const { data, error } = await supabase.from('restaurantes').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const { pin_hash, ...safe } = data;
  res.json(safe);
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
  const { restaurante_id, nombre, slug, emoji, orden, sin_fotos } = req.body;
  if (!canAccessRestaurante(req.user, restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const { data, error } = await supabase.from('categorias')
    .insert([{ restaurante_id, nombre, slug: slug || nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''), emoji: emoji || '', orden: parseInt(orden) || 0, sin_fotos: sin_fotos || false }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/categorias/:id', auth, async (req, res) => {
  const { data: cat } = await supabase.from('categorias').select('restaurante_id').eq('id', req.params.id).single();
  if (!cat || !canAccessRestaurante(req.user, cat.restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const permitidos = ['nombre', 'emoji', 'orden', 'sin_fotos'];
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
  const { restaurante_id, categoria_id, nombre, descripcion, descripcion_avanzada, precio, precio_numerico, imagen_url, disponible, orden } = req.body;
  if (!canAccessRestaurante(req.user, restaurante_id)) return res.status(403).json({ error: 'Sin permiso' });
  const { data, error } = await supabase.from('productos')
    .insert([{ restaurante_id, categoria_id, nombre, descripcion: descripcion || null, descripcion_avanzada: descripcion_avanzada || null, precio, precio_numerico: parseFloat(precio_numerico) || 0, imagen_url: imagen_url || null, disponible: disponible !== false, orden: parseInt(orden) || 0 }])
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
  const sub = req.query.folder || 'productos';
  const url = `${process.env.BASE_URL}/uploads/${sub}/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

app.delete('/api/upload/:folder/:filename', auth, (req, res) => {
  const fp = path.join(__dirname, 'uploads', req.params.folder, req.params.filename);
  if (fs.existsSync(fp)) { fs.unlinkSync(fp); return res.json({ ok: true }); }
  res.status(404).json({ error: 'Archivo no encontrado' });
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

  const desdeInicio = `${desde}T00:00:00`;
  const hastaFin = `${hasta}T23:59:59`;

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
    const dia = v.created_at.slice(0, 10);
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
    totalVisitas: visitas.length,
    totalClics: clics.length,
    tasaInteraccion: visitas.length ? +(clics.length / visitas.length * 100).toFixed(1) : 0,
    visitasPorDia,
    rankingProductos
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`✅ Panel corriendo en puerto ${PORT}`));
