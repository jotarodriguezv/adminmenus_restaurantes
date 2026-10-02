// El editor del horario de atención, dentro de Ajustes → «Datos del negocio».
//
// Es la forma de los horarios del panel de la televisión y de las promociones:
// una fila por franja, con las fichas de los días (L M X J V S D) y la hora de
// apertura y la de cierre en selectores de 24 horas. Se añaden filas para
// horarios distintos —«lunes a viernes de 11 a 22» y «fin de semana de 12 a
// 23»—, y un día que no sale en ninguna es un día cerrado.
//
// Las reglas —normalizar, describir, validar— y la copia de trabajo
// (`franjasEnEdicion`) viven en negocio.js, sin pantalla, para poder probarlas.
// Aquí solo está lo que dibuja y lo que reacciona a un clic. negocio.js llama a
// renderHorarioAtencion() si existe: las pruebas de Ajustes cargan negocio.js
// solas, y lo mismo hace aspecto.js con renderBienvenida().
//
// Se carga con un <script> clásico antes del script principal, como comun.js:
// no se puede repetir aquí un nombre que ya exista en otro archivo del panel.

// Los selectores de hora son los de siempre (opcionesDeHora, de index.html): 24 h
// y de media en media hora, porque <input type="time"> enseña a.m./p.m. según el
// sistema del visitante y no hay forma de forzarlo. Aquí no llevan la opción
// «Todo el día»: eso es una casilla de la franja, para que no pueda quedar una
// hora puesta y la otra no.
function selectorDeHoraDeAtencion(valor, alCambiar) {
  const sel = document.createElement('select');
  sel.className = 'form-input horario-hora';
  const horas = opcionesDeHora();
  // Una hora guardada fuera de la rejilla no puede desaparecer del selector.
  if (valor && !horas.includes(valor)) horas.push(valor);
  horas.sort();
  for (const h of horas) {
    const o = document.createElement('option');
    o.value = h; o.textContent = h;
    sel.appendChild(o);
  }
  sel.value = valor || '';
  sel.addEventListener('change', () => alCambiar(sel.value));
  return sel;
}

function filaDeFranjaDeAtencion(franja, indice) {
  const fila = document.createElement('div');
  fila.className = 'horario-franja';

  const dias = document.createElement('div');
  dias.className = 'horario-dias';
  for (const d of ORDEN_DIAS_ATENCION) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat-chip' + (franja.dias.includes(d) ? ' active' : '');
    b.style.cssText = 'min-width:38px;text-align:center;padding:7px 10px';
    b.textContent = DIAS_CORTOS[d];
    b.title = DIAS_LARGOS[d];
    b.setAttribute('aria-pressed', franja.dias.includes(d) ? 'true' : 'false');
    b.onclick = () => {
      franja.dias = franja.dias.includes(d) ? franja.dias.filter(x => x !== d) : [...franja.dias, d];
      renderHorarioAtencion();
    };
    dias.appendChild(b);
  }
  fila.appendChild(dias);

  const todoElDia = !franja.desde && !franja.hasta;
  const horas = document.createElement('div');
  horas.className = 'horario-horas';

  const caja = document.createElement('label');
  caja.className = 'horario-todo';
  const marca = document.createElement('input');
  marca.type = 'checkbox';
  marca.checked = todoElDia;
  marca.addEventListener('change', () => {
    // Al quitar «todo el día» se ofrece una franja corriente, no dos selectores
    // vacíos que obliguen a elegir las dos horas de cero.
    if (marca.checked) { franja.desde = ''; franja.hasta = ''; }
    else { franja.desde = '11:00'; franja.hasta = '22:00'; }
    renderHorarioAtencion();
  });
  caja.append(marca, ' Todo el día');
  horas.appendChild(caja);

  if (!todoElDia) {
    const abre = document.createElement('label');
    abre.className = 'horario-hora-campo';
    abre.append('Abre ', selectorDeHoraDeAtencion(franja.desde, v => { franja.desde = v; actualizarResumenHorario(); }));
    const cierra = document.createElement('label');
    cierra.className = 'horario-hora-campo';
    cierra.append('Cierra ', selectorDeHoraDeAtencion(franja.hasta, v => { franja.hasta = v; actualizarResumenHorario(); }));
    horas.append(abre, cierra);
  }
  fila.appendChild(horas);

  const quitar = document.createElement('button');
  quitar.type = 'button';
  quitar.className = 'btn-sm horario-quitar';
  quitar.textContent = 'Quitar';
  quitar.setAttribute('aria-label', `Quitar el horario ${indice + 1}`);
  quitar.onclick = () => { franjasEnEdicion.splice(indice, 1); renderHorarioAtencion(); };
  fila.appendChild(quitar);
  return fila;
}

function renderHorarioAtencion() {
  const cont = document.getElementById('ajHorarioFranjas');
  if (!cont) return;
  cont.replaceChildren();
  franjasEnEdicion.forEach((f, i) => cont.appendChild(filaDeFranjaDeAtencion(f, i)));
  document.getElementById('ajHorarioAgregar').disabled = franjasEnEdicion.length >= MAX_FRANJAS_ATENCION;
  actualizarResumenHorario();
}

// La primera franja que se añade es lo más corriente —de lunes a viernes— para
// no empezar de cero; las siguientes, el resto de la semana.
function agregarFranjaDeAtencion() {
  if (franjasEnEdicion.length >= MAX_FRANJAS_ATENCION) return;
  const usados = new Set(franjasEnEdicion.flatMap(f => f.dias));
  const libres = ORDEN_DIAS_ATENCION.filter(d => !usados.has(d));
  const dias = !franjasEnEdicion.length ? [1, 2, 3, 4, 5] : (libres.length ? libres : [1]);
  franjasEnEdicion.push({ dias, desde: '11:00', hasta: '22:00' });
  renderHorarioAtencion();
}

// Cómo lo leerá el cliente, con las mismas palabras que la carta: es lo que evita
// la duda de «lo puse y no sé cómo queda».
function actualizarResumenHorario() {
  const resumen = document.getElementById('ajHorarioResumen');
  if (!resumen) return;
  const error = errorDeHorarioAtencion(franjasEnEdicion);
  const texto = textoHorarioAtencion(franjasEnEdicion);
  if (error) { resumen.textContent = error; resumen.style.color = 'var(--warn)'; return; }
  resumen.textContent = texto
    ? `Tus clientes leen: ${texto}`
    : 'Sin horario: no sale en tu carta. Añade uno para que lo vean.';
  resumen.style.color = texto ? 'var(--accent)' : 'var(--text-muted)';
}
