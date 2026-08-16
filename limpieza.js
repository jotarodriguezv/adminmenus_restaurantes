'use strict';
// Limpiador de archivos huérfanos.
//
// Hoy solo hay un sitio que borre archivos del disco: DELETE de un producto
// suelto. Todo lo demás los deja tirados:
//
//   · PATCH de producto — cambias la foto y la anterior se queda
//   · DELETE de restaurante — borra las filas en bloque sin pasar por la
//     ruta que limpia, así que sus 40 imágenes quedan huérfanas
//   · Subidas abandonadas — el panel sube el archivo al elegirlo; si cierras
//     el formulario sin guardar, ya está en el disco y no lo referencia nadie
//
// Con fotos de 200 KB eso es cosmético. Con originales de video de 25 MB
// llena el disco, y con el disco lleno se para el servidor entero.
//
// En vez de parchear ruta por ruta, este proceso compara lo que hay en el
// disco con lo que la base de datos menciona, y borra lo que sobra.

const path = require('path');
const fs   = require('fs');

const RAIZ = path.join(__dirname, 'uploads');

// Todas las carpetas que maneja el sistema. Si algún día se añade una y no
// se apunta aquí, sus archivos simplemente no se limpian — que es el fallo
// seguro. Al revés sería borrar lo que no toca.
const CARPETAS = [
  'productos', 'categorias', 'promos', 'logos', 'fondos', 'portadas',
  'originales', 'videos', 'masters', 'miniaturas',
];

const TABLAS = ['restaurantes', 'productos', 'categorias', 'trabajos_video'];

// Margen de gracia. Sin él se borrarían archivos recién subidos que el
// usuario todavía no ha guardado: el panel sube la foto en cuanto la
// eliges, pero la fila no se escribe hasta que le das a guardar.
const DIAS_GRACIA  = Number(process.env.LIMPIEZA_DIAS || 7);
const INTERVALO_MS = 24 * 60 * 60 * 1000;

// Borrar archivos no tiene vuelta atrás, así que por defecto solo informa.
// Déjalo así unos días, mira en los registros qué borraría, y cuando la
// lista tenga sentido pon LIMPIEZA_BORRAR=1.
const BORRAR = process.env.LIMPIEZA_BORRAR === '1';

// Reconoce tanto la URL completa que guarda productos.imagen_url
// (https://dominio/uploads/logos/x.jpg) como la ruta relativa que guarda
// trabajos_video (originales/x.mp4). Anclar a la lista de carpetas evita
// que un texto cualquiera del menú se confunda con un nombre de archivo.
const PATRON = new RegExp(`(?:^|[/"'\\s])(${CARPETAS.join('|')})/([A-Za-z0-9._-]+)`, 'g');

function recogerNombres(texto, destino) {
  for (const [, carpeta, archivo] of String(texto).matchAll(PATRON)) {
    destino.add(`${carpeta}/${archivo}`);
  }
  return destino;
}

// Se serializa la fila entera en vez de leer columnas concretas. Es a
// propósito: así una columna nueva queda cubierta sola. Enumerar columnas
// significaría que el día que alguien añada un campo con una imagen, este
// proceso empiece a borrar archivos que sí se usan.
async function referencias(supabase) {
  const nombres = new Set();
  for (const tabla of TABLAS) {
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase.from(tabla).select('*').range(desde, desde + 999);
      if (error) throw new Error(`leyendo ${tabla}: ${error.message}`);
      if (!data?.length) break;
      for (const fila of data) recogerNombres(JSON.stringify(fila), nombres);
      if (data.length < 1000) break;
    }
  }
  return nombres;
}

function archivosEnDisco() {
  const lista = [];
  for (const carpeta of CARPETAS) {
    const dir = path.join(RAIZ, carpeta);
    if (!fs.existsSync(dir)) continue;
    for (const archivo of fs.readdirSync(dir)) {
      const abs = path.join(dir, archivo);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isFile()) continue;
      lista.push({ clave: `${carpeta}/${archivo}`, abs, bytes: st.size, edadMs: Date.now() - st.mtimeMs });
    }
  }
  return lista;
}

async function pasada(supabase) {
  const referenciados = await referencias(supabase);

  // Guardia contra el peor fallo posible. Si la consulta devolviera vacío
  // por un problema de red o de permisos, TODO el disco parecería huérfano
  // y este proceso lo borraría entero. Cero referencias con archivos en
  // disco no es un estado real: es un error.
  if (referenciados.size === 0) {
    console.warn('🧹 limpieza abortada: la base de datos no devolvió ninguna referencia');
    return { revisados: 0, huerfanos: 0, bytes: 0, borrados: 0 };
  }

  const gracia = DIAS_GRACIA * 24 * 60 * 60 * 1000;
  const archivos = archivosEnDisco();
  let huerfanos = 0, bytes = 0, borrados = 0;

  for (const a of archivos) {
    if (referenciados.has(a.clave)) continue;
    if (a.edadMs < gracia) continue;

    huerfanos++;
    bytes += a.bytes;

    if (!BORRAR) {
      console.log(`🧹 [simulacro] sobra ${a.clave} (${(a.bytes / 1024).toFixed(0)} KB, ${Math.floor(a.edadMs / 86400000)} días)`);
      continue;
    }
    try { fs.unlinkSync(a.abs); borrados++; } catch (e) {
      console.error(`🧹 no se pudo borrar ${a.clave}: ${e.message}`);
    }
  }

  const mb = (bytes / 1048576).toFixed(1);
  console.log(BORRAR
    ? `🧹 limpieza: ${borrados}/${huerfanos} huérfanos borrados, ${mb} MB liberados (de ${archivos.length} archivos)`
    : `🧹 limpieza en simulacro: ${huerfanos} huérfanos, ${mb} MB recuperables (de ${archivos.length} archivos). Pon LIMPIEZA_BORRAR=1 para borrar de verdad.`);

  return { revisados: archivos.length, huerfanos, bytes, borrados };
}

function arrancar(supabase) {
  const correr = () => pasada(supabase).catch(e => console.error('🧹 limpieza falló:', e.message));

  // No al arrancar: un despliegue reinicia el proceso y no tiene sentido
  // ponerse a recorrer el disco mientras el servidor todavía se levanta.
  setTimeout(correr, 5 * 60 * 1000).unref();
  setInterval(correr, INTERVALO_MS).unref();
  console.log(`🧹 limpieza programada cada 24 h · gracia ${DIAS_GRACIA} días · ${BORRAR ? 'BORRANDO' : 'simulacro'}`);
}

module.exports = { arrancar, pasada, recogerNombres, archivosEnDisco, CARPETAS };
