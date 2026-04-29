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

// ── Supabase (service role — solo vive en el servidor) ────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Multer ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subcarpeta = req.body.folder || 'productos';
    const carpeta = path.join(__dirname, 'uploads', subcarpeta);
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
    cb(null, carpeta);
  },
  filename: (req, file, cb) => {
    const ext    = path.extname(file.originalname).toLowerCase();
    const nombre = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, nombre);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const tipos = /jpeg|jpg|png|webp/;
    if (tipos.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
  }
});

// ── Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTH — LOGIN CON PIN
// ═══════════════════════════════════════════════════════════════
// PINs en variables de entorno: PIN_ADMIN, PIN_BONZAS, PIN_MALPARADOS
app.post('/api/login', async (req, res) => {
  const { slug, pin } = req.body;
  if (!slug || !pin) return res.status(400).json({ error: 'Faltan datos' });

  const envKey      = `PIN_${slug.toUpperCase().replace(/-/g, '_')}`;
  const pinCorrecto = process.env[envKey];
  if (!pinCorrecto || pin !== pinCorrecto) {
    return res.status(401).json({ error: 'PIN incorrecto' });
  }

  const rol = slug === 'admin' ? 'admin' : 'cliente';
  let restauranteId = null;

  if (rol === 'cliente') {
    const { data, error } = await supabase
      .from('restaurantes').select('id').eq('slug', slug).single();
    if (error || !data) return res.status(404).json({ error: 'Restaurante no encontrado' });
    restauranteId = data.id;
  }

  const token = jwt.sign(
    { slug, rol, restauranteId },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, rol, restauranteId });
});

// ═══════════════════════════════════════════════════════════════
// RESTAURANTES
// ═══════════════════════════════════════════════════════════════
app.get('/api/restaurantes', auth, async (req, res) => {
  let query = supabase.from('restaurantes').select('*').order('nombre');
  if (req.user.rol === 'cliente') query = query.eq('id', req.user.restauranteId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/restaurantes/:id', auth, async (req, res) => {
  if (req.user.rol === 'cliente' && req.params.id !== req.user.restauranteId)
    return res.status(403).json({ error: 'Sin permiso' });
  const campos = ['promo_activa', 'promo_imagen_url', 'color_primario', 'color_secundario'];
  const body   = Object.fromEntries(Object.entries(req.body).filter(([k]) => campos.includes(k)));
  const { data, error } = await supabase
    .from('restaurantes').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ═══════════════════════════════════════════════════════════════
// CATEGORÍAS
// ═══════════════════════════════════════════════════════════════
app.get('/api/categorias', auth, async (req, res) => {
  const rid = req.query.restaurante_id;
  if (!rid) return res.status(400).json({ error: 'Falta restaurante_id' });
  if (req.user.rol === 'cliente' && rid !== req.user.restauranteId)
    return res.status(403).json({ error: 'Sin permiso' });
  const { data, error } = await supabase
    .from('categorias').select('*').eq('restaurante_id', rid).order('orden');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ═══════════════════════════════════════════════════════════════
// PRODUCTOS
// ═══════════════════════════════════════════════════════════════
app.get('/api/productos', auth, async (req, res) => {
  const rid = req.query.restaurante_id;
  if (!rid) return res.status(400).json({ error: 'Falta restaurante_id' });
  if (req.user.rol === 'cliente' && rid !== req.user.restauranteId)
    return res.status(403).json({ error: 'Sin permiso' });
  const { data, error } = await supabase
    .from('productos').select('*').eq('restaurante_id', rid).order('precio_numerico');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/productos/:id', auth, async (req, res) => {
  if (req.user.rol === 'cliente') {
    const { data: prod } = await supabase
      .from('productos').select('restaurante_id').eq('id', req.params.id).single();
    if (!prod || prod.restaurante_id !== req.user.restauranteId)
      return res.status(403).json({ error: 'Sin permiso' });
  }
  const campos = ['nombre', 'precio', 'precio_numerico', 'descripcion',
                  'descripcion_avanzada', 'imagen_url', 'disponible'];
  const body   = Object.fromEntries(Object.entries(req.body).filter(([k]) => campos.includes(k)));
  const { data, error } = await supabase
    .from('productos').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ═══════════════════════════════════════════════════════════════
// IMÁGENES
// ═══════════════════════════════════════════════════════════════
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  const subcarpeta = req.body.folder || 'productos';
  const url = `${process.env.BASE_URL}/uploads/${subcarpeta}/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

app.delete('/api/upload/:folder/:filename', auth, (req, res) => {
  const filepath = path.join(__dirname, 'uploads', req.params.folder, req.params.filename);
  if (fs.existsSync(filepath)) { fs.unlinkSync(filepath); return res.json({ ok: true }); }
  res.status(404).json({ error: 'Archivo no encontrado' });
});

// ── Ruta raíz ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ Panel de menús corriendo en puerto ${PORT}`));
