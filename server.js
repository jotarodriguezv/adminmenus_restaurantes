require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos del panel
app.use(express.static(path.join(__dirname, 'public')));

// Servir imágenes subidas públicamente
// Accesibles en: https://admin.verificame.click/uploads/productos/img.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Multer ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // La carpeta viene en el body: 'productos' o 'promos'
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — el panel ya comprime antes de subir
  fileFilter: (req, file, cb) => {
    const tipos = /jpeg|jpg|png|webp/;
    if (tipos.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
  }
});

// ── Rutas de imágenes ─────────────────────────────────────────

// POST /upload — recibe la imagen, la guarda y devuelve la URL pública
// Body (multipart): file=<imagen>, folder=productos|promos
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  const subcarpeta = req.body.folder || 'productos';
  const url = `${process.env.BASE_URL}/uploads/${subcarpeta}/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// DELETE /upload/:folder/:filename — eliminar imagen del servidor
app.delete('/upload/:folder/:filename', (req, res) => {
  const filepath = path.join(__dirname, 'uploads', req.params.folder, req.params.filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return res.json({ ok: true });
  }
  res.status(404).json({ error: 'Archivo no encontrado' });
});

// ── Ruta raíz → panel ────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Iniciar ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Panel de menús corriendo en puerto ${PORT}`);
});
