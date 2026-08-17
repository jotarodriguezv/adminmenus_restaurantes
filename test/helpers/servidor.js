// Levanta el server.js REAL con un cliente de Supabase simulado.
//
// Se prueba contra la API por HTTP y no contra funciones sueltas a propósito:
// así lo que se comprueba es el comportamiento que ve el panel, incluidos el
// enrutado, la autenticación y el orden de las comprobaciones. Copiar la
// lógica a un fichero de pruebas verificaría la copia, no el servidor.
const Module = require('module');
const path = require('path');
const http = require('http');

const RAIZ = path.join(__dirname, '..', '..');

// Lo que devuelve el falso Supabase en cada llamada. Cada prueba lo ajusta.
let responderTabla = () => ({ data: null, error: null });
let responderRpc = () => ({ data: null, error: null });

// Todo lo que el servidor intentó hacer contra la base, para poder afirmar
// sobre ello (qué guardó, si llegó a consultar, con qué parámetros).
const llamadas = [];

function clienteFalso() {
  return {
    rpc(nombre, params) {
      llamadas.push({ tipo: 'rpc', nombre, params });
      return Promise.resolve(responderRpc(nombre, params));
    },
    from(tabla) {
      const st = { tipo: 'tabla', tabla, op: 'select', filtros: {} };
      const q = {
        select(c) { st.cols = c; return q; },
        insert(r) { st.op = 'insert'; st.payload = r; return q; },
        update(o) { st.op = 'update'; st.payload = o; return q; },
        upsert(o, x) { st.op = 'upsert'; st.payload = o; st.opts = x; return q; },
        delete() { st.op = 'delete'; return q; },
        eq(c, v) { st.filtros[c] = v; return q; },
        neq() { return q; }, in() { return q; },
        gte(_, v) { st.gte = v; return q; }, lte(_, v) { st.lte = v; return q; },
        order() { return q; }, single() { return q; }, maybeSingle() { return q; },
        then(res, rej) { llamadas.push(st); return Promise.resolve(responderTabla(st)).then(res, rej); },
      };
      return q;
    },
  };
}

const cargarOriginal = Module._load;
Module._load = function (peticion) {
  if (peticion === '@supabase/supabase-js') return { createClient: clienteFalso };
  return cargarOriginal.apply(this, arguments);
};

const JWT_SECRET = 'secreto-de-pruebas';
Object.assign(process.env, {
  SUPABASE_URL: 'https://falso.supabase.co',
  SUPABASE_SERVICE_KEY: 'falsa',
  JWT_SECRET,
  PIN_ADMIN: '9999',
  BASE_URL: 'http://localhost',
  PORT: '0',          // el sistema operativo elige un puerto libre
  VIDEO_WORKER: '0',  // sin cola de conversión: las pruebas no llaman a ffmpeg
  VIDEO_MARGEN_MB: '0', // el margen de disco real haría fallar la prueba en un
                        // contenedor pequeño por un motivo que no se prueba
});

require(path.join(RAIZ, 'server.js'));
const jwt = require(path.join(RAIZ, 'node_modules', 'jsonwebtoken'));

// server.js llama a app.listen() al cargarse. Se espera a que el servidor
// esté escuchando y se averigua el puerto que le tocó.
let puerto = null;
async function puertoListo() {
  if (puerto) return puerto;
  for (let i = 0; i < 100; i++) {
    for (const s of process._getActiveHandles?.() || []) {
      if (s instanceof http.Server && s.listening) {
        puerto = s.address().port;
        // Sin esto el socket mantiene vivo el proceso y el ejecutor de
        // pruebas se queda colgado al terminar en vez de salir.
        s.unref();
        return puerto;
      }
    }
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('el servidor no llegó a escuchar');
}

const IDS = {
  restaurante: '11111111-1111-4111-8111-111111111111',
  categoria:   '22222222-2222-4222-8222-222222222222',
  producto:    '33333333-3333-4333-8333-333333333333',
};

const tokenCliente = jwt.sign({ slug: 'pruebas', rol: 'cliente', restauranteId: IDS.restaurante }, JWT_SECRET);
const tokenAdmin   = jwt.sign({ slug: 'admin', rol: 'admin', restauranteId: null }, JWT_SECRET);

async function pedir(metodo, ruta, cuerpo, token) {
  const p = await puertoListo();
  const res = await fetch(`http://127.0.0.1:${p}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 no trae cuerpo */ }
  return { status: res.status, body: json };
}

// Igual que pedir(), pero multipart. La ruta de video pasa por multer y no
// entiende JSON, así que sin esto su comprobación de plan no se puede probar
// por HTTP como el resto.
async function pedirArchivo(ruta, campos, token, nombre = 'plato.mp4') {
  const p = await puertoListo();
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  // Contenido irrelevante: quien valida que sea video de verdad es ffmpeg,
  // ya en la cola. Aquí solo importa que llegue un archivo con extensión buena.
  fd.append('file', new Blob([Buffer.alloc(1024)], { type: 'video/mp4' }), nombre);

  const res = await fetch(`http://127.0.0.1:${p}${ruta}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,   // sin Content-Type a mano: fetch pone el boundary
  });
  let json = null;
  try { json = await res.json(); } catch { /* puede no traer cuerpo */ }
  return { status: res.status, body: json };
}

// Última escritura sobre una tabla, para comprobar qué se guardó de verdad.
function ultimaEscritura(tabla) {
  const w = llamadas.filter(l => l.tabla === tabla && ['insert', 'update', 'upsert'].includes(l.op)).pop();
  if (!w) return null;
  return w.op === 'insert' ? w.payload[0] : w.payload;
}

function reiniciar() {
  llamadas.length = 0;
  responderTabla = () => ({ data: null, error: null });
  responderRpc = () => ({ data: null, error: null });
}

module.exports = {
  pedir, pedirArchivo, llamadas, ultimaEscritura, reiniciar, IDS, tokenCliente, tokenAdmin,
  conTabla: fn => { responderTabla = fn; },
  conRpc: fn => { responderRpc = fn; },
};
