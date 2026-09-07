'use strict';
// Pasar un borrador de importación a categorías y platos de verdad.
// Ver docs/importar-carta.md §7.
//
// Aquí NO se escribe nada: se decide qué habría que escribir. La ruta hace las
// inserciones. Está separado así porque esta es la parte con reglas —qué
// categoría se reutiliza, en qué orden queda cada plato— y probar reglas contra
// una base de datos es lento y se prueba poco.
//
// ── LAS DOS REGLAS QUE NO SE NEGOCIAN ─────────────────────────
//
//   1. AÑADIR, NUNCA REEMPLAZAR. Si el restaurante ya tiene productos, la
//      importación suma. No borra nada, no renombra nada, no reordena nada.
//      Reemplazar es irreversible y nadie lo pidió.
//   2. NADA LLEGA AQUÍ SIN QUE UNA PERSONA LO APRUEBE. Este módulo se ejecuta
//      después de la pantalla de revisión, no antes.

// Para decidir si 'POSTRES' y 'Postres' son la misma categoría. Se quitan
// tildes, mayúsculas y espacios de más: son diferencias de cómo está impresa la
// carta, no categorías distintas.
function normalizar(nombre) {
  return String(nombre == null ? '' : nombre)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // fuera las tildes
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// La misma regla que usa la ruta de crear categorías. Se copia el
// comportamiento a conciencia, tildes incluidas —'CAFÉ' da 'caf'— porque una
// importación no puede generar slugs con otra forma que los escritos a mano: la
// carta acabaría con dos convenciones dentro.
function slugDe(nombre) {
  return String(nombre || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Los platos que la carta no pone bajo ningún título tienen que ir a alguna
// parte: la columna 'categoria_id' de productos es NOT NULL.
const SIN_CATEGORIA = 'Otros';

// Decide qué se va a crear.
//
//   borrador     { categorias: [ { nombre, platos: [...] } ] }
//   existentes   [ { id, nombre, orden } ]  las categorías que ya tiene
//   ordenPorCat  { <id de categoría>: <orden más alto de sus platos> }
//
// Devuelve una lista de categorías con sus platos. Las que ya existían llevan
// 'id'; las nuevas llevan 'id: null' y hay que crearlas antes de insertar sus
// platos.
function planDeAplicacion(borrador, existentes = [], ordenPorCat = {}) {
  const previas = new Map();
  let ordenCategoria = 0;
  for (const c of existentes) {
    if (c && c.nombre) previas.set(normalizar(c.nombre), c.id);
    ordenCategoria = Math.max(ordenCategoria, (c && Number(c.orden)) || 0);
  }

  const entrada = borrador && Array.isArray(borrador.categorias) ? borrador.categorias : [];
  const plan = [];
  const porClave = new Map();   // clave normalizada → entrada del plan
  let platos = 0;
  let nuevas = 0;

  for (const cruda of entrada) {
    if (!cruda || typeof cruda !== 'object') continue;
    // Se recorta ANTES de decidir: un nombre de solo espacios es truthy y se
    // colaba, creando un producto sin nombre. Aquí importa más que en la ruta
    // de crear un plato, porque esto escribe en 'productos' directamente y no
    // pasa por errorDeNombre().
    const lista = Array.isArray(cruda.platos)
      ? cruda.platos.filter((p) => p && String(p.nombre == null ? '' : p.nombre).trim())
      : [];
    if (!lista.length) continue;

    const nombre = String(cruda.nombre || '').trim() || SIN_CATEGORIA;
    const clave = normalizar(nombre);

    // Dos categorías del borrador con el mismo nombre son una sola. Pasa
    // cuando la carta repite un título al principio de la página siguiente.
    let destino = porClave.get(clave);
    if (!destino) {
      const id = previas.has(clave) ? previas.get(clave) : null;
      if (id === null) { ordenCategoria++; nuevas++; }
      destino = {
        id,
        nombre,
        slug: slugDe(nombre),
        // Las nuevas van al final. Meterlas en medio movería de sitio las
        // categorías que el restaurante ya tenía colocadas.
        orden: id === null ? ordenCategoria : null,
        // Los platos nuevos van DETRÁS de los que ya había en esa categoría:
        // si empezaran en cero se intercalarían con ellos.
        siguienteOrden: (id !== null && Number(ordenPorCat[id])) || 0,
        platos: [],
        existia: id !== null,
      };
      porClave.set(clave, destino);
      plan.push(destino);
    }

    for (const p of lista) {
      destino.siguienteOrden++;
      destino.platos.push({
        nombre: String(p.nombre).trim(),
        descripcion: p.descripcion ? String(p.descripcion) : null,
        // Un plato sin precio entra a cero, que es lo que hace la ruta de crear
        // productos cuando no se le manda ninguno. Se ve en la carta y se
        // corrige; inventarle un precio no.
        precio_numerico: Number.isFinite(Number(p.precio_numerico)) ? Number(p.precio_numerico) : 0,
        orden: destino.siguienteOrden,
      });
      platos++;
    }
  }

  return {
    categorias: plan,
    totales: {
      categorias_nuevas: nuevas,
      categorias_reutilizadas: plan.length - nuevas,
      platos,
    },
  };
}

module.exports = { planDeAplicacion, normalizar, slugDe, SIN_CATEGORIA };
