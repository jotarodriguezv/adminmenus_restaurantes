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
        select(c, opciones) { st.cols = c; st.opciones = opciones; return q; },
        insert(r) { st.op = 'insert'; st.payload = r; return q; },
        update(o) { st.op = 'update'; st.payload = o; return q; },
        upsert(o, x) { st.op = 'upsert'; st.payload = o; st.opts = x; return q; },
        delete() { st.op = 'delete'; return q; },
        eq(c, v) { st.filtros[c] = v; return q; },
        neq() { return q; }, in() { return q; },
        // 'is' lo usan las consultas de "sin revisar" (aprobado is null). Sin
        // él la cadena revienta a mitad y lo que se mide es el fallo del
        // simulador, no el del servidor.
        is(c, v) { st.filtros[c] = `is.${v}`; return q; },
        // 'not' y 'limit' los usa la búsqueda de foto de respaldo del endpoint
        // de Open Graph. Sin ellos la cadena revienta, el try/catch del
        // servidor se lo traga y la prueba mide un null que no es el de verdad.
        not(c, op, v) { st.filtros[c] = `not.${op}.${v}`; return q; },
        limit(n) { st.limite = n; return q; },
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

// El servidor HTTP que crea server.js, para poder afirmar sobre lo que se le
// ajusta después de app.listen() —los tiempos de espera, por ejemplo—, que no
// se ve por HTTP de ninguna otra forma. Se intercepta antes del require porque
// server.js llama a listen() al cargarse.
let servidorHttp = null;
const listenOriginal = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  servidorHttp = this;
  return listenOriginal.apply(this, args);
};

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
// Los primeros bytes de un JPEG. Desde que /api/upload comprueba el contenido
// y no solo la extensión, un relleno de ceros se rechaza —con razón— así que el
// arnés manda algo que de verdad parece una imagen.
//
// A la ruta de video le da igual el contenido: quien valida que sea video es
// ffmpeg, ya en la cola. Con un solo relleno valen las dos.
const RELLENO_IMAGEN = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(1012),
]);

async function pedirArchivo(ruta, campos, token, nombre = 'plato.mp4', contenido = RELLENO_IMAGEN) {
  const p = await puertoListo();
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  fd.append('file', new Blob([contenido], { type: 'video/mp4' }), nombre);

  const res = await fetch(`http://127.0.0.1:${p}${ruta}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,   // sin Content-Type a mano: fetch pone el boundary
  });
  let json = null;
  try { json = await res.json(); } catch { /* puede no traer cuerpo */ }
  return { status: res.status, body: json };
}

// Como pedir(), pero devuelve el cuerpo como texto. La ruta de Open Graph
// contesta HTML, no JSON: pasarla por res.json() daría null y las pruebas
// medirían el vacío en vez de las etiquetas.
async function pedirTexto(ruta) {
  const p = await puertoListo();
  const res = await fetch(`http://127.0.0.1:${p}${ruta}`);
  return { status: res.status, tipo: res.headers.get('content-type'),
           cache: res.headers.get('cache-control'),
           nosniff: res.headers.get('x-content-type-options'),
           marco: res.headers.get('x-frame-options'),
           html: await res.text() };
}

// Una petición cruda, sin pasar por fetch(). Hace falta porque fetch()
// descomprime solo y devuelve el cuerpo ya expandido: con él no se puede
// distinguir "vino comprimido" de "vino tal cual", que es justo lo que
// comprueba la prueba de compresión. Aquí se leen los bytes como llegan.
function pedirCrudo(ruta, cabeceras = {}) {
  return puertoListo().then(p => new Promise((res, rej) => {
    const req = http.request(
      { host: '127.0.0.1', port: p, path: ruta, method: 'GET', headers: cabeceras },
      r => {
        const trozos = [];
        r.on('data', t => trozos.push(t));
        r.on('end', () => res({
          status: r.statusCode,
          codificacion: r.headers['content-encoding'] || null,
          tipo: r.headers['content-type'] || null,
          vary: r.headers['vary'] || null,
          bytes: Buffer.concat(trozos),
        }));
      });
    req.on('error', rej);
    req.end();
  }));
}

// Una petición SIN Content-Type, que es lo que manda un cliente mal escrito o
// un curl al que se le olvidó la cabecera.
//
// pedir() siempre pone 'application/json', así que ninguna prueba pasaba por
// aquí — y es justo el camino que cambió al pasar a Express 5: si ningún
// parser reconoce el cuerpo, req.body se queda en undefined en vez del objeto
// vacío que ponía Express 4.
async function pedirSinTipo(metodo, ruta, cuerpo = '', token) {
  const p = await puertoListo();
  const res = await fetch(`http://127.0.0.1:${p}${ruta}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo || undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* puede no traer cuerpo */ }
  return { status: res.status, body: json };
}

// Empieza a subir un archivo y corta el socket a media transferencia, que es
// lo que hace una conexión mala con un video de 70 MB.
//
// No sirve fetch() con AbortController: hay que prometer en Content-Length más
// de lo que se manda para que el servidor se quede esperando el resto, y eso
// pide hablar HTTP a mano.
function subirYCortar(ruta, campos, token, bytesAntesDeCortar = 64 * 1024) {
  return puertoListo().then(p => new Promise(resolve => {
    const limite = '----pruebas' + Date.now();
    let cabecera = '';
    for (const [k, v] of Object.entries(campos))
      cabecera += `--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    cabecera += `--${limite}\r\nContent-Disposition: form-data; name="file"; filename="plato.mp4"\r\n`
             +  'Content-Type: video/mp4\r\n\r\n';

    const req = http.request({
      host: '127.0.0.1', port: p, path: ruta, method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${limite}`,
        // Se promete mucho más de lo que se va a mandar: así el servidor sigue
        // esperando cuando el socket muere, igual que en el corte real.
        'Content-Length': String(Buffer.byteLength(cabecera) + 10 * 1024 * 1024),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    // Cortar el socket provoca ECONNRESET en este lado. Es lo que se busca.
    req.on('error', () => {});
    req.write(cabecera);
    req.write(Buffer.alloc(bytesAntesDeCortar));
    setTimeout(() => { req.destroy(); resolve(); }, 100);
  }));
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
  servidor: () => servidorHttp,
  pedir, pedirSinTipo, pedirArchivo, pedirTexto, pedirCrudo, subirYCortar, llamadas, ultimaEscritura, reiniciar, IDS, tokenCliente, tokenAdmin,
  conTabla: fn => { responderTabla = fn; },
  conRpc: fn => { responderRpc = fn; },
};
