// La pestaña Importar: subir la carta en PDF o foto, revisar el borrador y
// aplicarlo. El lado del servidor está en docs/importar-carta.md.
//
// impNormalizar() e impRaiz() las usa también Categorías (index.html,
// «CATEGORÍA CASI REPETIDA»), para avisar al crear una categoría que ya existe
// en singular o plural. Se quedan aquí porque nacieron para casar las
// categorías del borrador con las del restaurante; cambiarlas cambia los dos
// sitios a la vez, que es lo que se busca.
//
// Salió de public/index.html el 15/09/2026, paso 3 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace. El marcado de la pestaña sigue en index.html.
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// ── IMPORTAR LA CARTA ─────────────────────────────────────────
// docs/importar-carta.md §7. Lo que se pinta aquí NO existe todavía en la
// carta: son filas propuestas. Nada llega a 'categorias' ni a 'productos'
// hasta que alguien le da al botón.
//
// Por eso esta pantalla es la funcionalidad, y no un adorno encima de ella: un
// modelo puede colar un plato que no existe, y encontrarlo DESPUÉS —con la
// carta publicada y el QR repartido— cuesta mucho más que mirarlo antes.

let impActual = null;   // la fila de importaciones_carta que se está revisando

// Espejo de importacion.js · normalizar(). Dos copias porque el panel no puede
// importar un módulo del servidor, y las dos tienen que decidir igual: si el
// servidor cree que 'POSTRES' es la categoría que ya existe y el panel cree que
// es nueva, el número del botón miente.
//
// Lo que impide que se separen es una prueba que las compara con la misma
// lista de nombres. Es el mismo trato que SLUGS_RESERVADOS.
function impNormalizar(nombre) {
  return String(nombre == null ? '' : nombre)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const IMP_SIN_CATEGORIA = 'Otros';

// Para reconocer que 'Hamburguesas' y 'HAMBURGUESA' son lo mismo. Se quita la
// -s o las -es del final de cada palabra.
//
// Esto NO se usa para juntar nada por su cuenta: solo para preguntar. Un
// restaurante puede tener a propósito 'POSTRE DEL DÍA' y 'POSTRES', y juntarlas
// sin avisar le mueve la carta de sitio.
// En español el plural es '+s' tras vocal (postre → postres) y '+es' tras
// consonante (raviol → ravioles). Quitar 'es' a secas deja 'postr' de un lado
// y 'postre' del otro, que es justo lo que no se quería.
//
// Así que se quita la 's' y después la 'e', a TODAS por igual: 'postres' y
// 'postre' acaban los dos en 'postr', y 'ravioles' y 'raviol' en 'raviol'. La
// raíz no tiene que ser una palabra, solo tiene que coincidir.
function impRaiz(nombre) {
  return impNormalizar(nombre).split(' ')
    .map(p => p.replace(/s$/, '').replace(/e$/, ''))
    .join(' ');
}

// Las cuentas que se le enseñan a la persona antes de pulsar. Tienen que
// cuadrar con lo que hace el servidor, que es quien las repite de vuelta.
function impTotales(borrador, existentes) {
  const previas = new Set((existentes || []).filter(c => c && c.nombre).map(c => impNormalizar(c.nombre)));
  const vistas = new Set();
  let nuevas = 0, existen = 0, platos = 0;

  for (const c of (borrador && borrador.categorias) || []) {
    if (!c || typeof c !== 'object') continue;
    const lista = (Array.isArray(c.platos) ? c.platos : [])
      .filter(p => p && String(p.nombre == null ? '' : p.nombre).trim());
    if (!lista.length) continue;   // una categoría sin platos no se crea

    const clave = impNormalizar(String(c.nombre || '').trim() || IMP_SIN_CATEGORIA);
    if (!vistas.has(clave)) {
      vistas.add(clave);
      if (previas.has(clave)) existen++; else nuevas++;
    }
    platos += lista.length;
  }
  return { nuevas, existen, platos };
}

// El borrador tal y como está AHORA en la pantalla, con las correcciones a
// mano y sin lo que se quitó. Se lee del DOM y no de una copia en memoria: lo
// que se ve es lo que se manda, sin un tercer sitio donde desincronizarse.
//
// 'precio' va como texto, igual que lo devuelve el modelo, para que el
// servidor lo normalice con la MISMA regla en los dos casos.
function impBorradorDelFormulario() {
  const categorias = [];
  for (const bloque of document.querySelectorAll('#impCategorias .imp-cat')) {
    const platos = [];
    for (const fila of bloque.querySelectorAll('.imp-plato')) {
      platos.push({
        nombre: fila.querySelector('.imp-p-nombre').value,
        descripcion: fila.querySelector('.imp-p-desc').value,
        precio: fila.querySelector('.imp-p-precio').value,
      });
    }
    categorias.push({ nombre: bloque.querySelector('.imp-cat-nombre').value, platos });
  }
  return { categorias };
}

function impActualizarResumen() {
  const t = impTotales(impBorradorDelFormulario(), state.categorias);
  const partes = [];
  if (t.nuevas) partes.push(`${t.nuevas} categoría${t.nuevas === 1 ? '' : 's'} nueva${t.nuevas === 1 ? '' : 's'}`);
  if (t.existen) partes.push(`${t.existen} que ya tienes`);
  document.getElementById('impResumen').textContent = partes.length ? partes.join(' · ') : '';

  const btn = document.getElementById('impAplicarBtn');
  // El número delante, para que se lea antes de pulsar y no después.
  btn.textContent = t.platos ? `Crear ${t.platos} plato${t.platos === 1 ? '' : 's'} en mi carta` : 'No queda nada que crear';
  btn.disabled = !t.platos;

  impMarcarRepetidos();

  // Las etiquetas de "nueva / ya existe" se recalculan porque el nombre de la
  // categoría es editable: si alguien escribe POSTRES sobre una categoría que
  // ya tiene, deja de ser nueva ahí mismo.
  for (const bloque of document.querySelectorAll('#impCategorias .imp-cat')) {
    const campo = bloque.querySelector('.imp-cat-nombre');
    const nombre = campo.value.trim() || IMP_SIN_CATEGORIA;
    const previas = (state.categorias || []).filter(c => c && c.nombre);
    const existe = previas.some(c => impNormalizar(c.nombre) === impNormalizar(nombre));
    const etiqueta = bloque.querySelector('.imp-cat-estado');

    // Una que se PARECE a la que ya tiene, pero no es igual. Pasó de verdad:
    // el restaurante tenía 'Hamburguesas' y el PDF decía 'HAMBURGUESA', así
    // que se crearon las dos y la carta acabó con dos secciones de lo mismo.
    //
    // No se juntan solas: singular y plural casi siempre son lo mismo, pero
    // "casi" no basta para mover platos sin que nadie lo vea. Se ofrece.
    const parecida = existe ? null : previas.find(c => impRaiz(c.nombre) === impRaiz(nombre));

    // Los platos que el modelo no pudo colgar de ningún título. Se dice, en vez
    // de dejar que salgan bajo un 'Otros' que parece una categoría de la carta:
    // en la primera importación real cayeron ahí varias ENTRADAS y hubo que
    // recolocarlas a mano DESPUÉS de crearlas.
    if (!campo.value.trim()) {
      etiqueta.textContent = 'sin título en la carta · escribe cuál es';
      etiqueta.style.color = 'var(--warn)';
      etiqueta.style.cursor = '';
      etiqueta.title = `Si lo dejas en blanco irán a "${IMP_SIN_CATEGORIA}"`;
      etiqueta.onclick = null;
    } else if (parecida) {
      etiqueta.textContent = `¿es la misma que "${parecida.nombre}"?`;
      etiqueta.style.color = 'var(--warn)';
      etiqueta.style.cursor = 'pointer';
      etiqueta.title = `Usar "${parecida.nombre}" y añadir estos platos ahí`;
      etiqueta.onclick = () => { campo.value = parecida.nombre; impActualizarResumen(); };
    } else {
      etiqueta.textContent = existe ? 'se añadirá a la que ya tienes' : 'categoría nueva';
      etiqueta.style.color = existe ? 'var(--text-dim)' : 'var(--accent)';
      etiqueta.style.cursor = '';
      etiqueta.title = '';
      etiqueta.onclick = null;
    }
  }
}

// Los platos que el restaurante YA TIENE, por categoría y nombre. Importar AÑADE
// y no reemplaza, así que sin esto una carta importada sobre un restaurante que
// ya tiene menú lo duplica entero — y la pantalla no dice nada.
//
// Se compara con la misma regla que las categorías: sin tildes ni mayúsculas,
// porque 'Hamburguesa clásica' y 'HAMBURGUESA CLASICA' son el mismo plato.
//
// Y DENTRO DE LA MISMA CATEGORÍA desde el 18/09/2026. Mirando solo el nombre,
// el «CHICKEN» de Desgranados salía como repetido del de Sándwiches —son dos
// platos distintos de Bonzas—, y «Quitar los repetidos» lo borraba del borrador.
// La categoría del plato es la de su bloque, casada por nombre igual que la
// casa el servidor al aplicar.
function impNombresQueYaTiene() {
  const catPorId = new Map((state.categorias || []).map(c => [c.id, impNormalizar(c.nombre)]));
  const previos = new Set();
  for (const p of state.productos || []) {
    if (!p || !p.nombre || !catPorId.has(p.categoria_id)) continue;
    previos.add(catPorId.get(p.categoria_id) + '\u0000' + impNormalizar(p.nombre));
  }
  return previos;
}

function impEsRepetido(previos, nombreCategoria, nombrePlato) {
  const cat = impNormalizar(String(nombreCategoria || '').trim() || IMP_SIN_CATEGORIA);
  return !!String(nombrePlato || '').trim() && previos.has(cat + '\u0000' + impNormalizar(nombrePlato));
}

// Marca y cuenta. NO los quita: que desaparezcan solos es peor que verlos
// duplicados, porque nadie se entera de lo que decidió el programa.
function impMarcarRepetidos() {
  const previos = impNombresQueYaTiene();
  let repetidos = 0;
  for (const fila of document.querySelectorAll('#impCategorias .imp-plato')) {
    const nombre = fila.querySelector('.imp-p-nombre').value;
    const categoria = fila.closest('.imp-cat')?.querySelector('.imp-cat-nombre')?.value;
    const repe = impEsRepetido(previos, categoria, nombre);
    fila.classList.toggle('repetido', repe);
    const chip = fila.querySelector('.imp-repe');
    if (chip) chip.style.display = repe ? '' : 'none';
    if (repe) repetidos++;
  }

  const banda = document.getElementById('impAvisoRepe');
  const total = (state.productos || []).length;
  if (!total) { banda.style.display = 'none'; return repetidos; }

  banda.style.display = 'block';
  banda.innerHTML = repetidos
    ? `Este restaurante ya tiene <b>${total}</b> ${total === 1 ? 'plato' : 'platos'}, y ${repetidos === 1 ? '<b>1</b> de los de aquí ya lo tiene' : `<b>${repetidos}</b> de los de aquí ya los tiene`}, con el mismo nombre y en la misma categoría.
       Importar <b>añade</b>, no reemplaza: si ${repetidos === 1 ? 'lo dejas, quedará' : 'los dejas, quedarán'} dos veces.
       <button type="button" onclick="impQuitarRepetidos()">${repetidos === 1 ? 'Quitar el repetido' : `Quitar los ${repetidos} repetidos`}</button>`
    : `Este restaurante ya tiene <b>${total}</b> ${total === 1 ? 'plato' : 'platos'}. Importar <b>añade</b>, no reemplaza; ninguno de los de aquí está ya en la misma categoría con el mismo nombre.`;
  return repetidos;
}

function impQuitarRepetidos() {
  for (const fila of [...document.querySelectorAll('#impCategorias .imp-plato.repetido')]) fila.remove();
  impActualizarResumen();
}

function impQuitarPlato(btn) {
  btn.closest('.imp-plato').remove();
  impActualizarResumen();
}

function impQuitarCategoria(btn) {
  btn.closest('.imp-cat').remove();
  impActualizarResumen();
}

function impEscapar(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function impPintarBorrador(fila) {
  impActual = fila;
  const cont = document.getElementById('impCategorias');
  cont.innerHTML = '';

  const cats = (fila && fila.borrador && fila.borrador.categorias) || [];
  for (const cat of cats) {
    const bloque = document.createElement('div');
    bloque.className = 'imp-cat';
    const platos = (cat.platos || []).map(p => `
      <div class="imp-plato">
        <input class="imp-p-nombre" value="${impEscapar(p.nombre)}" oninput="impActualizarResumen()" placeholder="Nombre del plato">
        <input class="imp-p-desc" value="${impEscapar(p.descripcion)}" placeholder="Descripción (opcional)">
        <input class="imp-p-precio" value="${impEscapar(p.precio)}" placeholder="Precio">
        <span class="imp-repe" style="display:none">ya lo tienes</span>
        <button type="button" class="imp-quitar" onclick="impQuitarPlato(this)" title="Quitar este plato">✕</button>
      </div>`).join('');

    bloque.innerHTML = `
      <div class="imp-cat-head">
        <input class="imp-cat-nombre" value="${impEscapar(cat.nombre)}" oninput="impActualizarResumen()" placeholder="Categoría">
        <span class="imp-cat-estado"></span>
        <button type="button" class="imp-quitar" onclick="impQuitarCategoria(this)" title="Quitar la categoría entera">✕</button>
      </div>
      <div class="imp-platos">${platos}</div>`;
    cont.appendChild(bloque);
  }

  // De dónde salió y qué costó. Sirve para contestar con números si la vía de
  // texto puede bajar a un modelo más barato — ver docs/importar-carta.md §9.
  const partes = [];
  if (fila.via) partes.push(fila.via === 'texto' ? 'leído del texto del PDF' : 'leído de la imagen');
  if (state.rol === 'admin' && fila.tokens_entrada)
    partes.push(`${fila.tokens_entrada}+${fila.tokens_salida} tokens`);
  document.getElementById('impOrigen').textContent = partes.join(' · ');

  document.getElementById('impRevision').style.display = cats.length ? 'block' : 'none';
  impActualizarResumen();
}

async function impSubir(input) {
  const archivo = input.files && input.files[0];
  if (!archivo) return;
  input.value = '';   // para poder volver a subir el mismo archivo

  const estado = document.getElementById('impEstado');
  // Leer una carta larga tarda decenas de segundos. Sin decirlo, la pantalla
  // parece colgada y la gente vuelve a pulsar — y cada intento se paga.
  estado.textContent = 'Leyendo la carta… esto puede tardar medio minuto.';
  document.getElementById('impRevision').style.display = 'none';

  const fd = new FormData();
  fd.append('file', archivo);
  const modelo = document.getElementById('impModelo').value;
  if (modelo) fd.append('modelo', modelo);
  try {
    const fila = await apiFetch('POST', `/api/importaciones?restaurante_id=${state.restaurante.id}`, fd, true);
    estado.textContent = '';
    impPintarBorrador(fila);
    if (!(fila.borrador && fila.borrador.categorias || []).length)
      showToast('No se encontró ningún plato en ese archivo', 'error');
  } catch (e) {
    // 'detalle' solo llega al superadmin, y es lo que evita tener que ir al
    // registro del servidor por un fallo de configuración. Va debajo del
    // mensaje, no en el aviso flotante: es texto técnico y hay que poder
    // copiarlo.
    const detalle = e.cuerpo && e.cuerpo.detalle;
    estado.textContent = e.message;
    if (detalle && detalle !== e.message) {
      const linea = document.createElement('div');
      linea.style.cssText = 'margin-top:6px;color:var(--text-dim);font-size:10px;line-height:1.5;user-select:text';
      linea.textContent = detalle;
      estado.appendChild(linea);
    }
    showToast(e.message, 'error');
  }
}

async function impAplicar() {
  if (!impActual) return;
  const btn = document.getElementById('impAplicarBtn');
  const borrador = impBorradorDelFormulario();
  if (!impTotales(borrador, state.categorias).platos) return;

  // Se bloquea mientras tanto: un segundo clic con la red lenta llega igual, y
  // aunque el servidor lo rechaza por estado, aquí se ve mejor.
  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    // Primero se guarda lo corregido y después se aplica, en dos pasos: así lo
    // que se crea es exactamente lo que quedó guardado y revisable, y no algo
    // que solo existió en el navegador.
    await apiFetch('PUT', `/api/importaciones/${impActual.id}`, { borrador });
    const r = await apiFetch('POST', `/api/importaciones/${impActual.id}/aplicar`, {});
    // El aviso solo llega cuando los platos SÍ se crearon pero la importación
    // no quedó marcada. Se enseña como error a propósito: es lo único que
    // impide que alguien vuelva a pulsar y duplique la carta entera.
    if (r.aviso) showToast(r.aviso, 'error');
    else avisarGuardadoConCarta(`Listo: ${r.platos_creados} platos en ${r.categorias_creadas + r.categorias_reutilizadas} categorías`);
    impActual = null;
    document.getElementById('impRevision').style.display = 'none';
    document.getElementById('impEstado').textContent = '';
    await loadData();
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    impActualizarResumen();
  }
}

async function impDescartar() {
  if (!impActual) return;
  try { await apiFetch('DELETE', `/api/importaciones/${impActual.id}`); } catch (e) { /* da igual: se quita de la vista */ }
  impActual = null;
  document.getElementById('impRevision').style.display = 'none';
  document.getElementById('impEstado').textContent = '';
}

// Al abrir la pestaña se recupera la última importación que quedó sin aplicar.
// Sin esto, cerrar el navegador a mitad de una revisión de 170 platos obliga a
// subir el archivo otra vez — y ese intento se paga.
// La lista de modelos la manda el servidor: es donde está la lista blanca, y
// tenerla también aquí escrita a mano sería una segunda copia que se queda
// vieja el día que se añada uno.
//
// Al restaurante le llega vacía a propósito, y entonces el selector no se
// pinta: elegir modelo no le significa nada y sí cambia lo que se paga. El
// servidor ya ignora el campo si llega de él, así que esconderlo no es la
// protección — es no enseñar un mando que no acciona nada.
function impCargarModelos() {
  const sel = document.getElementById('impModelo');
  const r = state.importar;
  const modelos = (r && r.modelos) || [];
  const caja = sel && sel.closest('.imp-modelo');
  if (caja) caja.style.display = modelos.length ? '' : 'none';
  if (!sel || sel.dataset.listo || !modelos.length) return;
  {
    for (const m of modelos) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.nombre} · ${m.precio} por millón · ${m.nota}`;
      sel.appendChild(o);
    }
    // La primera opción se queda seleccionada: sin elegir nada, cada vía usa el
    // modelo que le toca, que no es el mismo para texto que para imagen.
    const d = (r.por_defecto || {});
    sel.options[0].textContent = d.texto === d.vision
      ? `El configurado (${d.texto})`
      : `El configurado (texto: ${d.texto} · imagen: ${d.vision})`;
    sel.dataset.listo = '1';
  }
}

async function renderImportar() {
  impCargarModelos();
  if (impActual) return;
  try {
    const filas = await apiFetch('GET', `/api/importaciones?restaurante_id=${state.restaurante.id}`);
    const pendiente = (filas || []).find(f => f.estado === 'listo');
    if (pendiente) impPintarBorrador(pendiente);
  } catch (e) { /* la pestaña sirve igual para subir una nueva */ }
}
