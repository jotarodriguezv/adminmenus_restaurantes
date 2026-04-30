require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const jwt     = require('jsonwebtoken');
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
    const sub = req.body.folder || 'productos';
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
  const envKey = `PIN_${slug.toUpperCase().replace(/-/g, '_')}`;
  if (!process.env[envKey] || pin !== process.env[envKey])
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  const rol = slug === 'admin' ? 'admin' : 'cliente';
  let restauranteId = null;
  if (rol === 'cliente') {
    const { data } = await supabase.from('restaurantes').select('id').eq('slug', slug).single();
    if (!data) return res.status(404).json({ error: 'Restaurante no encontrado' });
    restauranteId = data.id;
  }
  const token = jwt.sign({ slug, rol, restauranteId }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, rol, restauranteId });
});

// ── RESTAURANTES ──────────────────────────────────────────────
app.get('/api/restaurantes', auth, async (req, res) => {
  let q = supabase.from('restaurantes').select('*').order('nombre');
  if (req.user.rol === 'cliente') q = q.eq('id', req.user.restauranteId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/restaurantes/:id', auth, async (req, res) => {
  if (!canAccessRestaurante(req.user, req.params.id))
    return res.status(403).json({ error: 'Sin permiso' });
  const permitidos = ['promo_activa', 'promo_imagen_url', 'color_primario', 'color_secundario', 'nombre', 'logo_url', 'fondo_url'];
  const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));
  const { data, error } = await supabase.from('restaurantes').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  const permitidos = ['nombre', 'precio', 'precio_numerico', 'descripcion', 'descripcion_avanzada', 'imagen_url', 'disponible', 'categoria_id', 'orden'];
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
  const sub = req.body.folder || 'productos';
  const url = `${process.env.BASE_URL}/uploads/${sub}/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

app.delete('/api/upload/:folder/:filename', auth, (req, res) => {
  const fp = path.join(__dirname, 'uploads', req.params.folder, req.params.filename);
  if (fs.existsSync(fp)) { fs.unlinkSync(fp); return res.json({ ok: true }); }
  res.status(404).json({ error: 'Archivo no encontrado' });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`✅ Panel corriendo en puerto ${PORT}`));
