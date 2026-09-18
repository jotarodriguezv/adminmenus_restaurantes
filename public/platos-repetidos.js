// Dos platos con el mismo nombre en la misma categoría.
//
// Pedido el 18/09/2026 («¿qué pasa si dos productos se llaman igual?»). La
// respuesta era: nada, se creaban los dos sin un aviso, y en la carta salían dos
// filas idénticas que el comensal no sabe distinguir.
//
// Es un AVISO y no un bloqueo, a propósito. El mismo nombre en categorías
// distintas es legítimo —Bonzas tiene un «CHICKEN» en Sándwiches y otro en
// Desgranados, y son dos platos—, así que solo cuenta dentro de la misma
// categoría. Y aun ahí puede ser a propósito (dos tamaños que el restaurante
// distingue por la descripción): se dice, y se deja guardar.
//
// Se compara con impNormalizar (importar.js), la misma regla que usa la
// importación para decir «repetido»: sin tildes ni mayúsculas. Dos pantallas
// que dijeran cosas distintas sobre el mismo nombre enseñarían a no creer
// ninguna.
//
// Se carga con un <script> clásico, detrás de importar.js: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// El otro plato con el mismo nombre en esa categoría, o null. 'idActual' es el
// plato que se está editando: consigo mismo no se repite.
function platoConElMismoNombre(nombre, categoriaId, idActual, productos = state.productos) {
  const clave = impNormalizar(nombre);
  if (!clave || !categoriaId) return null;
  return (productos || []).find(p =>
    p.id !== idActual && p.categoria_id === categoriaId && impNormalizar(p.nombre) === clave) || null;
}

function avisarNombreRepetido() {
  const aviso = document.getElementById('nombreAviso');
  if (!aviso) return;
  const categoriaId = document.getElementById('editCategoria').value;
  const otro = platoConElMismoNombre(
    document.getElementById('editNombre').value, categoriaId,
    document.getElementById('editProductId').value);
  if (!otro) { aviso.textContent = ''; return; }
  const cat = (state.categorias || []).find(c => c.id === categoriaId);
  aviso.textContent = `Ya tienes «${otro.nombre}» en ${cat ? cat.nombre : 'esta categoría'}. ` +
    'En la carta saldrían dos iguales; si son distintos, cambia el nombre de uno.';
}
