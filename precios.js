'use strict';
// ── PRECIO: UN SOLO DATO ESCRITO DOS VECES ────────────────────
// 'precio' es lo que lee el cliente y 'precio_numerico' con lo que se ordena el
// menú y se suma el carrito. Cuando se separan, la carta muestra un precio y el
// carrito cobra otro: pasó con dos productos, uno con un cero de más ($4.500
// mostrados contra 45000 internos).
//
// Vive en su propio módulo desde que existe la importación de cartas
// (docs/importar-carta.md §6). Antes estaba dentro de server.js, y el
// importador habría necesitado su propia copia: dos reglas de precio que se
// separan con el tiempo es exactamente cómo vuelve el fallo de arriba.

// El separador se arma a mano y no con toLocaleString: en Node depende de los
// datos ICU que traiga la imagen, y si faltan devuelve "4,500" en vez de
// "4.500", cambiando el formato de toda la carta sin avisar.
function formatoPrecio(n) {
  return '$ ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Se queda con los dígitos y tira lo demás, así que '$ 12.000' y '12000 pesos'
// dan lo mismo.
//
// Ojo con lo que esto implica: el punto es separador de MILES, no de decimales.
// Es lo correcto para Colombia, donde no hay precios con centavos, y es la
// regla que la API lleva usando desde siempre. Si algún día hay que atender una
// moneda con decimales, se cambia AQUÍ y en un solo sitio.
function numeroDeTexto(texto) {
  const digitos = String(texto).replace(/[^0-9]/g, '');
  return digitos ? Number(digitos) : null;
}

// ── OFERTA DE PRECIO ──────────────────────────────────────────
// Un plato puede tener un precio rebajado, con fechas opcionales (sql/35). Aquí
// va solo la validación al guardar; quién decide si rige HOY vive en la carta,
// la cartelera y el espejo del panel (oferta.js), con un juego de casos común.
//
// El precio de oferta se guarda solo como número. Escribirlo también como texto
// sería repetir el par precio/precio_numerico que ya costó un fallo: el texto
// se formatea al pintar con formatoPrecio().
const CAMPOS_OFERTA = ['oferta_activa', 'oferta_precio_numerico', 'oferta_desde', 'oferta_hasta'];

// 'AAAA-MM-DD' y que exista en el calendario: Date.UTC acepta el 31 de febrero
// y lo desborda a marzo, así que se vuelve a leer y se compara.
function esFechaValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

const vacio = (v) => v === undefined || v === null || v === '';

// Normaliza los campos de oferta de 'body' en su sitio, solo los que vienen
// (un PATCH es parcial). 'precioNormal' es el precio con el que quedará el
// plato: el que llega en el mismo guardado, o el que ya tenía.
//
// Devuelve un mensaje de error o null. Lo que pasa de aquí lo puede escribir
// la base sin que un check la rechace.
function normalizarOferta(body, precioNormal, guardada = {}) {
  if (!CAMPOS_OFERTA.some((c) => body[c] !== undefined)) return null;

  // Booleano de verdad: el texto "false" es verdadero para cualquier if, y
  // encendería una oferta que se apagó.
  if (body.oferta_activa !== undefined) body.oferta_activa = body.oferta_activa === true;

  if (body.oferta_precio_numerico !== undefined) {
    if (vacio(body.oferta_precio_numerico)) body.oferta_precio_numerico = null;
    else {
      const n = Number(body.oferta_precio_numerico);
      if (!Number.isFinite(n) || n < 0) return 'Precio de oferta inválido';
      body.oferta_precio_numerico = Math.round(n);
    }
  }

  for (const c of ['oferta_desde', 'oferta_hasta']) {
    if (body[c] === undefined) continue;
    if (vacio(body[c])) body[c] = null;
    else if (!esFechaValida(body[c])) return 'Fecha de oferta inválida';
  }

  // Lo que quedará guardado, mezclando lo que llega con lo que ya había.
  const queda = (c) => (body[c] !== undefined ? body[c] : guardada[c] ?? null);
  const desde = queda('oferta_desde');
  const hasta = queda('oferta_hasta');
  if (desde && hasta && desde > hasta) return 'La oferta no puede terminar antes de empezar';

  // Con la oferta encendida tiene que tener un precio, y menor que el normal:
  // una «oferta» más cara que el precio de siempre solo puede ser un error de
  // dedo. Apagada se deja pasar: el restaurante puede guardar un borrador, y
  // si después baja el precio normal no se le bloquea ese guardado.
  if (queda('oferta_activa') === true) {
    const precio = queda('oferta_precio_numerico');
    if (precio === null) return 'Falta el precio de la oferta';
    if (Number(precioNormal) > 0 && precio >= Number(precioNormal))
      return 'El precio de la oferta tiene que ser menor que el precio normal';
  }
  return null;
}

module.exports = { formatoPrecio, numeroDeTexto, normalizarOferta, esFechaValida, CAMPOS_OFERTA };
