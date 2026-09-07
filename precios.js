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

module.exports = { formatoPrecio, numeroDeTexto };
