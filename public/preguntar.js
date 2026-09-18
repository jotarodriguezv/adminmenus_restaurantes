// ── PREGUNTAR ANTES DE HACER ALGO ─────────────────────────────
// Sustituye al confirm() del navegador, que quedaba en ocho sitios del panel
// (18/09/2026, decidido con el equipo). Un diálogo del sistema en medio del
// panel rompe su aspecto, en el móvil se ve peor, y en algunos navegadores trae
// una casilla de «no volver a preguntar» que, marcada, hace que confirm()
// devuelva false para siempre sin enseñar nada: el botón deja de funcionar y
// nadie sabe por qué.
//
// Se usa igual que confirm(), pero con await:
//   if (!await preguntar({ titulo, texto, si: 'Eliminar', peligro: true })) return;
//
// Las mismas reglas que las ventanas de salida (cambiosModal): sin ✕, dos
// botones, y un clic fuera o Escape se entienden como «no», que es la opción
// que no hace nada. El foco empieza en «no» por lo mismo: un Enter de más no
// puede borrar un restaurante.

let respuestaPendiente = null;

// texto: lo principal. lista: filas que se enseñan una debajo de otra (platos,
// URLs). nota: la letra pequeña. Todo va por textContent: aquí se pintan
// nombres de restaurantes y de platos que escribió otra persona.
function preguntar({ titulo, texto, lista = [], nota = '', si = 'Aceptar', no = 'Cancelar', peligro = false }) {
  // Dos preguntas a la vez no pueden quedar las dos esperando: la de antes se
  // da por contestada que no.
  if (respuestaPendiente) responderPregunta(false);

  const $ = id => document.getElementById(id);
  $('preguntaTitulo').textContent = titulo || '¿Seguro?';
  $('preguntaTexto').textContent = texto || '';
  const ul = $('preguntaLista');
  ul.textContent = '';
  for (const fila of lista) {
    const li = document.createElement('li');
    li.textContent = fila;
    ul.appendChild(li);
  }
  ul.style.display = lista.length ? '' : 'none';
  $('preguntaNota').textContent = nota;
  $('preguntaNota').style.display = nota ? '' : 'none';
  $('preguntaNo').textContent = no;
  const boton = $('preguntaSi');
  boton.textContent = si;
  boton.classList.toggle('peligro', !!peligro);

  $('preguntaModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('preguntaNo').focus();
  return new Promise(resolver => { respuestaPendiente = resolver; });
}

function responderPregunta(valor) {
  const resolver = respuestaPendiente;
  respuestaPendiente = null;
  document.getElementById('preguntaModal').classList.remove('open');
  // closeModal() devolvería el scroll a la página entera, y esta ventana casi
  // siempre se abre ENCIMA de otra —la ficha del plato— que sigue abierta.
  if (!document.querySelector('.modal-bg.open')) document.body.style.overflow = '';
  if (resolver) resolver(valor);
}

function hayPreguntaAbierta() {
  return !!respuestaPendiente;
}
