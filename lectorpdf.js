'use strict';
// Sacar el texto de un PDF. Ver docs/importar-carta.md §2.1 y §5.
//
// Este módulo hace UNA cosa: convertir los bytes de un PDF en texto y decir si
// el archivo trae capa de texto o es un escaneo. No sabe de restaurantes, ni de
// la base de datos, ni de ningún modelo de IA. Se separó así por lo mismo que
// ia.js: es la pieza que depende de un formato ajeno, y el día que haya que
// cambiarla no debería arrastrar nada más.
//
// NO es un lector de PDF completo y no pretende serlo. Lee lo que hace falta
// para responder "¿qué dice esta carta?".
//
// ── LA TRAMPA, QUE ES EL MOTIVO DE QUE ESTO EXISTA ────────────
//
// Leer los operadores de texto a lo bruto devuelve basura. Sobre la carta de A
// Ojo Cerrado el primer intento dio '& $ 1 $ 6 7 , & 2' donde ponía
// 'CANASTICO': las fuentes van en SUBCONJUNTO —solo se incrustan los glifos que
// se usan— y se remapean los códigos empezando en 0x20, así que sale un
// desplazamiento constante.
//
// Lo que arregla eso no es una librería mejor: son las tablas /ToUnicode que el
// propio archivo trae, una por fuente. Hay que seguir el operador Tf para saber
// cuál está activa en cada momento, porque una página mezcla varias.
//
// Si alguien reescribe esto, que compruebe el resultado con acentos delante. El
// fallo es SILENCIOSO: no lanza, devuelve texto de aspecto plausible que no
// dice lo que dice la carta.

const zlib = require('zlib');

// Por debajo de esto una página se considera escaneada. No puede ser "cero
// caracteres": un escaneo con una marca de agua en texto, o con el número de
// página puesto aparte, tiene algo de texto y aun así no hay nada que leer.
// Ver docs/importar-carta.md §5: falta calibrarlo con archivos reales.
const MINIMO_POR_PAGINA = 200;

// ── LOS OBJETOS DEL ARCHIVO ───────────────────────────────────

// Un PDF es una lista de objetos numerados. Se recorren con una expresión
// regular en vez de seguir la tabla xref a propósito: la tabla se corrompe con
// facilidad —cualquier programa que reescriba el archivo sin actualizarla— y un
// lector que dependa de ella falla con archivos que se abren bien en cualquier
// visor.
function leerObjetos(buf) {
  const crudo = buf.toString('latin1');
  const objetos = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;

  while ((m = re.exec(crudo)) !== null) {
    const desde = m.index + m[0].length;
    const posStream = crudo.indexOf('stream', desde);
    const posEndobj = crudo.indexOf('endobj', desde);
    const conStream = posStream >= 0 && (posEndobj < 0 || posStream < posEndobj);

    if (!conStream) {
      if (posEndobj < 0) continue;
      objetos.set(+m[1], { dic: crudo.slice(desde, posEndobj), datos: null });
      continue;
    }

    const dic = crudo.slice(desde, posStream);
    let ini = posStream + 'stream'.length;
    if (crudo[ini] === '\r') ini++;
    if (crudo[ini] === '\n') ini++;

    // El /Length directo es la forma fiable de saber dónde acaba el stream.
    // Buscar 'endstream' es un apaño: los datos comprimidos son binarios y
    // pueden contener esos nueve bytes por dentro, y entonces el objeto se
    // corta a mitad sin que nada avise. Se usa solo cuando /Length es una
    // referencia indirecta y no se puede leer de aquí.
    const largo = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dic);
    const fin = largo ? ini + Number(largo[1]) : crudo.indexOf('endstream', ini);
    if (fin < 0 || fin > buf.length) continue;

    objetos.set(+m[1], { dic, datos: buf.slice(ini, fin) });

    // Saltarse el contenido del stream. Sin esto, unos bytes binarios que por
    // casualidad digan '12 0 obj' inventan un objeto que no existe.
    if (fin > re.lastIndex) re.lastIndex = fin;
  }
  return objetos;
}

function inflar(o) {
  if (!o || !o.datos) return null;
  if (/\/FlateDecode/.test(o.dic)) {
    try { return zlib.inflateSync(o.datos).toString('latin1'); } catch { return null; }
  }
  // DCTDecode y compañía son imágenes: no hay texto que sacar de ahí.
  return /\/Filter/.test(o.dic) ? null : o.datos.toString('latin1');
}

// Los generadores modernos —Word, InDesign, LaTeX— meten los objetos pequeños
// DENTRO de un stream comprimido en vez de dejarlos sueltos. Sin desenvolverlos
// no se encuentra ni una página ni una fuente, y el archivo parecería un
// escaneo teniendo todo el texto dentro.
function expandirObjStm(objetos) {
  for (const o of [...objetos.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dic)) continue;
    const datos = inflar(o);
    if (!datos) continue;

    const n = Number((/\/N\s+(\d+)/.exec(o.dic) || [])[1] || 0);
    const primero = Number((/\/First\s+(\d+)/.exec(o.dic) || [])[1] || 0);
    if (!n || !primero) continue;

    // La cabecera son N pares "número desplazamiento", y los desplazamientos
    // van desde /First.
    const cabecera = datos.slice(0, primero).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = cabecera[i * 2];
      const desde = cabecera[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(desde)) continue;
      const hasta = i + 1 < n && Number.isFinite(cabecera[i * 2 + 3])
        ? primero + cabecera[i * 2 + 3]
        : datos.length;
      // Un objeto suelto manda sobre el de dentro: si el archivo se actualizó
      // de forma incremental, el suelto es la versión nueva.
      if (objetos.has(num)) continue;
      objetos.set(num, { dic: datos.slice(primero + desde, hasta), datos: null });
    }
  }
}

// ── LAS TABLAS /ToUnicode ─────────────────────────────────────

// Una CMap dice, para cada código de la fuente, qué carácter Unicode es. Vienen
// en dos formatos: uno a uno (bfchar) y por rangos (bfrange).
//
// Devuelve también el ANCHO del código en bytes, y eso no es un detalle: una
// fuente compuesta (Type0/CID) usa dos bytes por carácter. Leerla de uno en uno
// mete un NUL entre cada letra y el resultado sale como
// 'C\0A\0N\0A\0S\0T\0I\0C\0O'. Se ve raro en un terminal y desaparece al
// pegarlo en cualquier sitio, así que es de los fallos que llegan lejos.
//
// Salió con la carta de A Ojo Cerrado, y NO lo cazó ninguna prueba: las de aquí
// construían fuentes de un byte. Por eso ahora hay una de dos.
function leerCMap(texto) {
  const mapa = new Map();
  const numero = (h) => parseInt(h.replace(/[<>\s]/g, ''), 16);
  let digitos = 0;   // los dígitos hexadecimales que ocupa un código de origen
  const anotar = (h) => { digitos = Math.max(digitos, h.replace(/[<>\s]/g, '').length); };

  // El destino va en UTF-16BE, así que son grupos de cuatro dígitos hex. Un
  // grupo puede traer varios caracteres: una ligadura 'fi' es un solo código.
  const aTexto = (h) => {
    const s = h.replace(/[<>\s]/g, '');
    let salida = '';
    for (let i = 0; i + 4 <= s.length; i += 4) salida += String.fromCharCode(parseInt(s.slice(i, i + 4), 16));
    return salida;
  };

  // La fuente lo declara aquí cuando se molesta en declararlo. Es lo más
  // fiable, porque lo dice el archivo en vez de deducirlo.
  const espacio = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(texto);
  if (espacio) for (const h of espacio[1].match(/<[0-9A-Fa-f]+>/g) || []) anotar(h);

  for (const bloque of texto.match(/beginbfchar([\s\S]*?)endbfchar/g) || [])
    for (const par of bloque.match(/<[0-9A-Fa-f]+>\s*<[0-9A-Fa-f]+>/g) || []) {
      const partes = par.match(/<[0-9A-Fa-f]+>/g);
      anotar(partes[0]);
      mapa.set(numero(partes[0]), aTexto(partes[1]));
    }

  for (const bloque of texto.match(/beginbfrange([\s\S]*?)endbfrange/g) || [])
    for (const trio of bloque.match(/<[0-9A-Fa-f]+>\s*<[0-9A-Fa-f]+>\s*<[0-9A-Fa-f]+>/g) || []) {
      const partes = trio.match(/<[0-9A-Fa-f]+>/g);
      anotar(partes[0]);
      const desde = numero(partes[0]);
      const hasta = numero(partes[1]);
      const base = numero(partes[2]);
      // El tope evita que un rango mal formado —o malicioso— haga crecer el
      // mapa sin límite con un archivo de dos líneas.
      for (let i = desde; i <= hasta && i - desde < 65536; i++) mapa.set(i, String.fromCharCode(base + (i - desde)));
    }

  return { mapa, ancho: digitos > 2 ? 2 : 1 };
}

function mapasDeFuentes(objetos) {
  const mapas = new Map();   // número del objeto de la fuente → { mapa, ancho }
  for (const [num, o] of objetos) {
    const ref = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dic);
    if (!ref) continue;
    const cmap = inflar(objetos.get(+ref[1]));
    if (cmap) mapas.set(num, leerCMap(cmap));
  }
  return mapas;
}

// ── EL FLUJO DE CONTENIDO ─────────────────────────────────────

// Se recorre a mano en vez de con una expresión regular porque las cadenas de
// PDF admiten paréntesis anidados —'(salsa (de la casa))' es UNA cadena— y eso
// una expresión regular no lo ve. Con una, el texto se corta a mitad de plato.
function cadenaDesde(s, i) {
  let profundidad = 0;
  let salida = '';
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {                       // escape: el siguiente va literal
      const sig = s[i + 1];
      if (sig === undefined) break;
      if (sig >= '0' && sig <= '7') {       // \ddd en octal
        let oct = '';
        while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') { oct += s[++i]; }
        salida += String.fromCharCode(parseInt(oct, 8));
      } else {
        const especiales = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        salida += especiales[sig] || sig;
        i++;
      }
      continue;
    }
    if (c === '(') { profundidad++; salida += c; continue; }
    if (c === ')') {
      if (profundidad === 0) return { texto: salida, fin: i };
      profundidad--; salida += c; continue;
    }
    salida += c;
  }
  return { texto: salida, fin: s.length };
}

// `ancho` son los bytes que ocupa un código en esta fuente: 1 en las normales,
// 2 en las compuestas. Ver leerCMap().
function codigosDeCadena(texto, ancho) {
  const codigos = [];
  for (let i = 0; i + ancho <= texto.length; i += ancho) {
    let c = 0;
    for (let b = 0; b < ancho; b++) c = (c << 8) | (texto.charCodeAt(i + b) & 0xff);
    codigos.push(c);
  }
  return codigos;
}

function codigosDeHex(hex, ancho) {
  const s = hex.replace(/[^0-9A-Fa-f]/g, '');
  const paso = ancho * 2;
  const codigos = [];
  for (let i = 0; i + paso <= s.length; i += paso) codigos.push(parseInt(s.slice(i, i + paso), 16));
  return codigos;
}

// Recorre el flujo quedándose con lo poco que importa: qué fuente está activa
// (Tf), qué se dibuja (Tj, TJ, ' y ") y dónde se corta la línea.
function textoDeFlujo(contenido, mapaPorNombre) {
  let salida = '';
  let activo = null;            // { mapa, ancho } de la fuente en curso
  let ultimoNombre = null;      // el /F3 más reciente, candidato del próximo Tf
  let pendientes = [];          // los códigos del último operando de texto

  // Sin tabla se leen los códigos de uno en uno: es lo que hace una fuente
  // normal, y una compuesta sin tabla no hay forma de descifrarla igualmente.
  const ancho = () => (activo ? activo.ancho : 1);

  const escribir = (codigos) => {
    for (const c of codigos)
      salida += activo && activo.mapa.has(c) ? activo.mapa.get(c) : String.fromCharCode(c);
  };

  for (let i = 0; i < contenido.length; i++) {
    const c = contenido[i];

    if (c === '(') {
      const { texto, fin } = cadenaDesde(contenido, i + 1);
      pendientes.push(codigosDeCadena(texto, ancho()));
      i = fin;
      continue;
    }

    if (c === '<' && contenido[i + 1] !== '<') {
      const cierre = contenido.indexOf('>', i);
      if (cierre < 0) break;
      pendientes.push(codigosDeHex(contenido.slice(i + 1, cierre), ancho()));
      i = cierre;
      continue;
    }

    if (c === '/') {
      let j = i + 1;
      while (j < contenido.length && /[^\s/[\]<>()]/.test(contenido[j])) j++;
      ultimoNombre = contenido.slice(i + 1, j);
      i = j - 1;
      continue;
    }

    // '[' y ']' delimitan el operando de TJ. No hace falta tratarlos: las
    // cadenas de dentro ya se recogieron y los ajustes de espaciado son
    // números, que aquí no significan nada.
    if (/[A-Za-z'"*]/.test(c)) {
      let j = i;
      while (j < contenido.length && /[A-Za-z0-9*'"]/.test(contenido[j])) j++;
      const op = contenido.slice(i, j);
      i = j - 1;

      if (op === 'Tf') { activo = mapaPorNombre.get(ultimoNombre) || null; pendientes = []; continue; }

      if (op === 'Tj' || op === 'TJ' || op === "'" || op === '"') {
        for (const codigos of pendientes) escribir(codigos);
        pendientes = [];
        // Un salto de línea de verdad: ' y " empiezan línea nueva por
        // definición, y lo demás lo separa la posición.
        if (op === "'" || op === '"') salida += '\n';
        continue;
      }

      if (op === 'Td' || op === 'TD' || op === 'T*') {
        // Un cambio de posición separa palabras. Se marca con un espacio y no
        // con un salto porque el mismo operador se usa para el interletraje
        // dentro de una palabra; distinguirlos es justo lo que hace
        // espaciadoPorGlifo() más abajo.
        salida += ' ';
        pendientes = [];
        continue;
      }

      if (op === 'ET') { salida += '\n'; pendientes = []; continue; }

      pendientes = [];
      continue;
    }
  }
  return salida;
}

// ── LAS PÁGINAS, EN ORDEN ─────────────────────────────────────

function referencias(texto) {
  return (texto.match(/(\d+)\s+\d+\s+R/g) || []).map((r) => +/(\d+)/.exec(r)[1]);
}

// Se cuentan las aperturas y los cierres en vez de cortar en el primer '>>'.
// Un diccionario lleva otros dentro —/Resources contiene /Font, que contiene
// las fuentes— y pararse en el primero devuelve medio valor. Ahí el fallo es de
// los malos: no lanza, se queda sin encontrar la fuente y la página sale con el
// texto sin descifrar.
function bloqueEquilibrado(s, desde, abre, cierra) {
  let profundidad = 0;
  for (let i = desde; i < s.length; i++) {
    if (s.startsWith(abre, i)) { profundidad++; i += abre.length - 1; continue; }
    if (s.startsWith(cierra, i)) {
      profundidad--;
      if (profundidad === 0) return s.slice(desde, i + cierra.length);
      i += cierra.length - 1;
    }
  }
  return null;
}

function valorDe(dic, clave) {
  // El límite evita que /T encuentre /Type.
  const m = new RegExp('/' + clave + '(?![A-Za-z0-9])\\s*').exec(dic);
  if (!m) return null;
  const desde = m.index + m[0].length;
  if (dic.startsWith('<<', desde)) return bloqueEquilibrado(dic, desde, '<<', '>>');
  if (dic[desde] === '[') return bloqueEquilibrado(dic, desde, '[', ']');
  const suelto = /^(\d+\s+\d+\s+R|\/?[A-Za-z0-9.+-]+)/.exec(dic.slice(desde));
  return suelto ? suelto[1] : null;
}

// El orden importa: una carta lleva las categorías en un orden que el
// restaurante eligió, y salir con los postres antes de las entradas convierte
// una importación buena en una que hay que recolocar a mano.
//
// Recorrer el árbol /Pages es la única forma de saberlo. El orden en que
// aparecen los objetos en el archivo suele coincidir, pero no lo garantiza
// nada, y deja de coincidir en cuanto alguien reordena páginas con un editor.
function paginasEnOrden(objetos, crudo) {
  const raiz = /\/Root\s+(\d+)\s+\d+\s+R/.exec(crudo);
  const orden = [];
  const vistos = new Set();

  const bajar = (num) => {
    if (vistos.has(num) || vistos.size > 5000) return;
    vistos.add(num);
    const o = objetos.get(num);
    if (!o) return;
    if (/\/Type\s*\/Page(?![s])/.test(o.dic)) { orden.push(num); return; }
    const kids = valorDe(o.dic, 'Kids');
    if (kids) for (const hijo of referencias(kids)) bajar(hijo);
  };

  if (raiz) {
    const catalogo = objetos.get(+raiz[1]);
    const paginas = catalogo && valorDe(catalogo.dic, 'Pages');
    if (paginas) for (const n of referencias(paginas)) bajar(n);
  }

  // Sin catálogo utilizable —archivo reparado, o partido— se cae al orden del
  // archivo. Es peor, pero es mejor que devolver cero páginas.
  if (!orden.length)
    for (const [num, o] of objetos)
      if (/\/Type\s*\/Page(?![s])/.test(o.dic)) orden.push(num);

  return orden;
}

// /Resources puede estar en la página, ser una referencia, o heredarse del
// nodo padre. Se buscan las tres, en ese orden.
function fuentesDe(objetos, num, saltos = 0) {
  const o = objetos.get(num);
  if (!o || saltos > 8) return new Map();

  let recursos = valorDe(o.dic, 'Resources');
  if (recursos && /^\d+\s+\d+\s+R$/.test(recursos.trim())) {
    const ref = objetos.get(referencias(recursos)[0]);
    recursos = ref ? ref.dic : null;
  }

  const nombres = new Map();
  const bloque = recursos && valorDe(recursos, 'Font');
  if (bloque)
    for (const par of bloque.match(/\/([A-Za-z0-9#+.-]+)\s+\d+\s+\d+\s+R/g) || []) {
      const p = /\/([A-Za-z0-9#+.-]+)\s+(\d+)/.exec(par);
      nombres.set(p[1], +p[2]);
    }

  if (nombres.size) return nombres;

  const padre = valorDe(o.dic, 'Parent');
  return padre ? fuentesDe(objetos, referencias(padre)[0], saltos + 1) : nombres;
}

// ── LIMPIEZA DEL INTERLETRAJE ─────────────────────────────────

// Algunos PDF colocan cada letra por separado para ajustar el espaciado. Al
// leerlos sale 'PLÁT ANO' en vez de 'PLÁTANO'.
//
// La regla que lo arregla —quitar los espacios simples y dejar los dobles— es
// DESTRUCTIVA en un PDF normal, donde los espacios simples son las palabras.
// Por eso se decide por documento y no siempre: en uno colocado glifo a glifo
// las separaciones de palabra de verdad acaban siendo de dos o más espacios,
// que en un PDF normal casi no aparecen nunca.
function espaciadoPorGlifo(texto) {
  const simples = (texto.match(/[^ \n]( )[^ \n]/g) || []).length;
  const multiples = (texto.match(/ {2,}/g) || []).length;
  if (simples + multiples < 20) return false;      // muy poco texto para decidir
  return multiples / (simples + multiples) > 0.2;
}

function limpiarInterletraje(texto) {
  const MARCA = '';
  return texto
    .replace(/ {2,}/g, MARCA)
    .replace(/ /g, '')
    .split(MARCA).join(' ');
}

function normalizar(texto, porGlifo) {
  return (porGlifo ? limpiarInterletraje(texto) : texto)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// ── LA PUERTA DE ENTRADA ──────────────────────────────────────

function esPdf(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 && buf.slice(0, 5).toString('latin1') === '%PDF-';
}

// Devuelve { paginas, escaneado, cifrado, fuentesConTabla }.
//
// 'escaneado' es la decisión que reparte el trabajo entre las dos vías de
// docs/importar-carta.md §5. Va aquí y no en quien llama para que sea una sola
// regla y no tres copias que se separan con el tiempo.
function leerPdf(buf) {
  if (!esPdf(buf)) throw Object.assign(new Error('El archivo no es un PDF'), { definitivo: true });

  const crudo = buf.toString('latin1');
  const objetos = leerObjetos(buf);
  expandirObjStm(objetos);

  // Un PDF con contraseña devuelve cadenas cifradas: texto de aspecto correcto
  // que no dice nada. Más vale decirlo que entregar una carta de basura.
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(crudo))
    return { paginas: [], escaneado: false, cifrado: true, fuentesConTabla: 0 };

  const mapas = mapasDeFuentes(objetos);
  const paginas = [];

  for (const num of paginasEnOrden(objetos, crudo)) {
    const o = objetos.get(num);
    const mapaPorNombre = new Map();
    for (const [nombre, objFuente] of fuentesDe(objetos, num))
      if (mapas.has(objFuente)) mapaPorNombre.set(nombre, mapas.get(objFuente));

    const contenidos = valorDe(o.dic, 'Contents');
    let texto = '';
    for (const ref of contenidos ? referencias(contenidos) : []) {
      const flujo = inflar(objetos.get(ref));
      if (flujo) texto += textoDeFlujo(flujo, mapaPorNombre) + '\n';
    }
    paginas.push(texto);
  }

  const todo = paginas.join('\n');
  const porGlifo = espaciadoPorGlifo(todo);
  const limpias = paginas.map((p) => normalizar(p, porGlifo));

  const utiles = limpias.reduce((n, p) => n + p.replace(/\s/g, '').length, 0);
  const escaneado = !limpias.length || utiles / limpias.length < MINIMO_POR_PAGINA;

  return { paginas: limpias, escaneado, cifrado: false, fuentesConTabla: mapas.size };
}

module.exports = {
  leerPdf,
  esPdf,
  // Expuestos para poder probarlos por separado: son las piezas donde un fallo
  // no se nota a simple vista.
  leerObjetos,
  leerCMap,
  textoDeFlujo,
  espaciadoPorGlifo,
  limpiarInterletraje,
  cadenaDesde,
  MINIMO_POR_PAGINA,
};
