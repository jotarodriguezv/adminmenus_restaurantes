// Las sedes: la pestaña donde se crean los locales de un restaurante y se pone
// el precio de cada plato en cada uno (sql/37, docs/sedes.md).
//
// El administrador crea, edita, apaga y borra sedes: es una decisión comercial.
// El dueño del restaurante ve las suyas y ajusta sus PRECIOS, que es el trabajo
// de todos los días.
//
// Se carga con un <script> clásico antes del script principal, como comun.js, y
// comparte con él las declaraciones de nivel superior: no se puede repetir aquí
// un nombre que ya exista en otro archivo del panel.

let sedesLista = [];
let sedeAbiertaId = null;   // la que tiene la tabla de precios abierta
let sedeEnEdicionId = null; // null = el formulario crea; un id = edita esa

// El horario propio de la sede que se está editando. Es una lista aparte de la de
// Ajustes (`franjasEnEdicion`): el editor trabaja sobre la que le diga su contexto.
let sedeFranjas = [];
const HORARIO_SEDE = {
  lista: () => sedeFranjas,
  ids: { franjas: 'sedHorarioFranjas', agregar: 'sedHorarioAgregar', resumen: 'sedHorarioResumen' },
};

const esAdminDeSedes = () => state.rol === 'admin';

// ── LA PESTAÑA ────────────────────────────────────────────────
// Existe solo si el superadmin encendió «Varias sedes» para este restaurante
// (Superadmin → Varias sedes): él decide quién las tiene, también para sí mismo.
// Esconderla es cortesía: el servidor es quien cierra el paso.
function restauranteTieneSedes() {
  return state.restaurante?.atributos?.con_sedes === true;
}

// Las sedes que tiene contratadas este restaurante. Misma regla que el servidor
// (topeDeSedes en server.js): un entero desde 1; sin él, dos.
function topeDeSedesDelRestaurante() {
  const n = state.restaurante?.atributos?.max_sedes;
  return Number.isInteger(n) && n >= 1 ? n : 2;
}

function ajustarPestanaSedes() {
  const boton = document.getElementById('tabBtnSedes');
  if (!boton) return;
  boton.style.display = restauranteTieneSedes() ? 'block' : 'none';
  if (!restauranteTieneSedes()) { sedesLista = []; sedeAbiertaId = null; state.sedes = undefined; }
}

// Dirección pública de una sede, con la forma oficial del restaurante: por ruta
// es menu.vmenus.co/<restaurante>/<sede>; por subdominio, <restaurante>.vmenus.co/<sede>.
function urlDeSede(sede) {
  return `${urlPublica(state.restaurante)}/${sede.slug}`;
}

async function renderSedes() {
  if (!state.restaurante) return;
  const cont = document.getElementById('sedesLista');
  cont.textContent = 'Cargando sedes…';
  try {
    sedesLista = await apiFetch('GET', `/api/sedes?restaurante_id=${state.restaurante.id}`) || [];
  } catch (e) {
    cont.textContent = 'No se pudieron cargar las sedes: ' + e.message;
    return;
  }
  // Inicio resume las sedes con lo mismo que acaba de leer esta pestaña.
  state.sedes = sedesLista;
  state.sedesDe = state.restaurante.id;
  // El formulario de crear solo aparece mientras quede cupo: el tope lo fija el superadmin.
  const tope = topeDeSedesDelRestaurante();
  const lleno = sedesLista.length >= tope;
  document.getElementById('sedesAdmin').style.display = esAdminDeSedes() && (!lleno || sedeEnEdicionId) ? 'block' : 'none';
  document.getElementById('sedesCupo').textContent = `${sedesLista.length} de ${tope} ${tope === 1 ? 'sede contratada' : 'sedes contratadas'}`
    + (lleno && esAdminDeSedes() ? ' · para añadir otra, súbele el tope en Superadmin → Varias sedes' : '');
  if (sedeAbiertaId && !sedesLista.some(s => s.id === sedeAbiertaId)) sedeAbiertaId = null;
  pintarSedes();
  pintarHorarioPropioDeSede();   // el aviso de qué horario hereda el formulario
  if (sedeAbiertaId) await abrirPreciosDeSede(sedeAbiertaId);
  else document.getElementById('sedesPrecios').style.display = 'none';
}

function pintarSedes() {
  const cont = document.getElementById('sedesLista');
  if (!sedesLista.length) {
    cont.innerHTML = `<p class="bienvenida-ayuda">${esAdminDeSedes()
      ? 'Este restaurante todavía no tiene sedes. Crea la primera abajo: desde ese momento su carta pregunta en qué sede estás.'
      : 'Tu restaurante todavía no tiene sedes.'}</p>`;
    return;
  }
  cont.innerHTML = sedesLista.map(s => {
    const url = urlDeSede(s);
    const a = s.atributos || {};
    const admin = esAdminDeSedes();
    return `<div class="sede-fila${s.activa ? '' : ' sede-apagada'}" data-sede="${esc(s.id)}">
      <div class="sede-info">
        <div class="sede-nombre">${esc(s.nombre)}${s.activa ? '' : ' <span class="sede-etiqueta">apagada</span>'}</div>
        <a class="sede-enlace" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>
        ${a.direccion ? `<div class="sede-dato">${esc(a.direccion)}</div>` : ''}
        <div class="sede-dato">${a.horario_atencion !== undefined && a.horario_atencion !== null
          ? `Horario propio: ${esc(textoHorarioAtencion(franjasNormalizadas(a.horario_atencion)) || 'sin horario')}`
          : 'Horario del restaurante'}</div>
      </div>
      <div class="sede-acciones">
        <button class="btn-sm accent" onclick="abrirPreciosDeSede('${esc(s.id)}')">Precios y platos</button>
        ${admin ? `<button class="btn-sm sede-editar" onclick="editarSede('${esc(s.id)}')">✎ Editar</button>
        <button class="btn-sm sede-encendido" onclick="alternarSedeActiva('${esc(s.id)}')">${s.activa ? '⏻ Apagar' : '⏻ Encender'}</button>
        <button class="btn-sm eliminar" onclick="borrarSede('${esc(s.id)}')">Borrar</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── CREAR Y EDITAR (solo el administrador) ────────────────────
const CAMPOS_SEDE = [
  ['sedNombre', null], ['sedSlug', null],
  ['sedDireccion', 'direccion'], ['sedWhatsapp', 'whatsapp_negocio'],
  ['sedMapa', 'mapa_url'], ['sedResena', 'resena_url'], ['sedCorreo', 'correo'],
];

function limpiarFormularioSede() {
  sedeEnEdicionId = null;
  for (const [id] of CAMPOS_SEDE) document.getElementById(id).value = '';
  document.getElementById('sedSlugGrupo').style.display = 'none';
  sedeFranjas = [];
  document.getElementById('sedHorarioPropio').checked = false;
  pintarHorarioPropioDeSede();
  document.getElementById('sedFormularioTitulo').textContent = 'Nueva sede';
  document.getElementById('sedGuardar').textContent = 'Crear sede';
  document.getElementById('sedCancelar').style.display = 'none';
}

function editarSede(id) {
  const s = sedesLista.find(x => x.id === id);
  if (!s) return;
  sedeEnEdicionId = id;
  const a = s.atributos || {};
  document.getElementById('sedNombre').value = s.nombre;
  document.getElementById('sedSlug').value = s.slug;
  for (const [campo, clave] of CAMPOS_SEDE) if (clave) document.getElementById(campo).value = a[clave] ?? '';
  document.getElementById('sedSlugGrupo').style.display = 'block';
  // Con la clave puesta la sede tiene horario propio (aunque sea vacío: «sin horario»);
  // sin ella, hereda el del restaurante.
  const propio = a.horario_atencion !== undefined && a.horario_atencion !== null;
  sedeFranjas = propio ? franjasNormalizadas(a.horario_atencion) : [];
  document.getElementById('sedHorarioPropio').checked = propio;
  pintarHorarioPropioDeSede();
  document.getElementById('sedFormularioTitulo').textContent = `Editar «${s.nombre}»`;
  document.getElementById('sedGuardar').textContent = 'Guardar cambios';
  document.getElementById('sedCancelar').style.display = 'inline-flex';
  document.getElementById('sedesAdmin').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Los datos del negocio de la sede, tal como los lee el servidor. Un campo vacío
// SÍ se manda: en la carta '' quiere decir «esta sede no tiene», y no heredar el
// del restaurante (otro local, otro teléfono).
function atributosDelFormularioDeSede() {
  const a = {};
  for (const [campo, clave] of CAMPOS_SEDE) if (clave) a[clave] = document.getElementById(campo).value.trim();
  // El horario SOLO viaja si la sede tiene uno propio. Sin la clave, la sede hereda el
  // del restaurante: es lo que hace que cambiarlo en Ajustes llegue a las sedes que no
  // lo cambiaron. Mandarlo siempre las desligaría de él sin que nadie lo decidiera.
  if (document.getElementById('sedHorarioPropio').checked) a.horario_atencion = franjasNormalizadas(sedeFranjas);
  return a;
}

// Muestra u oculta el editor según la casilla, y dice qué horario hereda si no hay propio.
function pintarHorarioPropioDeSede() {
  const propio = document.getElementById('sedHorarioPropio').checked;
  document.getElementById('sedHorarioBloque').style.display = propio ? 'block' : 'none';
  const heredado = textoHorarioAtencion(franjasDelNegocio(state.restaurante?.atributos));
  document.getElementById('sedHorarioHeredado').textContent = propio
    ? 'Solo esta sede usa este horario; las demás siguen con el del restaurante.'
    : (heredado ? `Usa el horario del restaurante: ${heredado}.` : 'El restaurante todavía no tiene horario (se pone en Ajustes → Datos del negocio).');
  if (propio) renderHorarioAtencion(HORARIO_SEDE);
}

// Al encender la casilla se parte del horario del restaurante, no de una lista vacía:
// lo normal es que la sede difiera en un día o en una hora.
function alternarHorarioPropioDeSede() {
  if (document.getElementById('sedHorarioPropio').checked && !sedeFranjas.length)
    sedeFranjas = franjasDelNegocio(state.restaurante?.atributos).map(f => ({ ...f, dias: [...f.dias] }));
  pintarHorarioPropioDeSede();
}

async function guardarSede() {
  const nombre = document.getElementById('sedNombre').value.trim();
  if (!nombre) { showToast('Ponle un nombre a la sede', 'error'); return; }
  if (document.getElementById('sedHorarioPropio').checked) {
    const malHorario = errorDeHorarioAtencion(sedeFranjas);
    if (malHorario) { showToast(malHorario, 'error'); return; }
  }
  const cuerpo = { nombre, atributos: atributosDelFormularioDeSede() };
  try {
    if (sedeEnEdicionId) {
      cuerpo.slug = document.getElementById('sedSlug').value.trim();
      await apiFetch('PATCH', `/api/sedes/${sedeEnEdicionId}`, cuerpo);
      showToast('Sede guardada', 'success');
    } else {
      cuerpo.restaurante_id = state.restaurante.id;
      const nueva = await apiFetch('POST', '/api/sedes', cuerpo);
      sedeAbiertaId = nueva?.id || null;
      showToast('Sede creada', 'success');
    }
    limpiarFormularioSede();
    await renderSedes();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function alternarSedeActiva(id) {
  const s = sedesLista.find(x => x.id === id);
  if (!s) return;
  try {
    await apiFetch('PATCH', `/api/sedes/${id}`, { activa: !s.activa });
    await renderSedes();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function borrarSede(id) {
  const s = sedesLista.find(x => x.id === id);
  if (!s) return;
  // Borrar se lleva los precios de la sede: se avisa, y se ofrece apagarla, que
  // es lo que los conserva.
  if (!await preguntar({
    titulo: 'Borrar la sede',
    texto: `Se borra «${s.nombre}»: se pierden sus precios y su enlace deja de funcionar.`,
    nota: 'Si solo quieres quitarla un tiempo, mejor apágala: así se conservan sus precios.',
    si: 'Borrar', peligro: true,
  })) return;
  try {
    await apiFetch('DELETE', `/api/sedes/${id}`);
    if (sedeAbiertaId === id) sedeAbiertaId = null;
    showToast('Sede borrada', 'success');
    await renderSedes();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ── PRECIOS Y PLATOS DE UNA SEDE ──────────────────────────────
// Una fila por plato: el precio base (el de siempre), el de esta sede (vacío =
// el mismo) y si se sirve aquí. Solo se guarda lo que difiere del base.
const pesos = n => '$ ' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

async function abrirPreciosDeSede(id) {
  const sede = sedesLista.find(s => s.id === id);
  if (!sede) return;
  sedeAbiertaId = id;
  const cont = document.getElementById('sedesPrecios');
  cont.style.display = 'block';
  document.getElementById('sedesPreciosTitulo').textContent = `Precios de ${sede.nombre}`;
  const tabla = document.getElementById('sedesPreciosTabla');
  tabla.textContent = 'Cargando precios…';
  let filas = [];
  try {
    filas = await apiFetch('GET', `/api/productos-sedes?sede_id=${id}`) || [];
  } catch (e) { tabla.textContent = 'No se pudieron cargar los precios: ' + e.message; return; }
  const porPlato = new Map(filas.map(f => [f.producto_id, f]));

  const cats = [...state.categorias].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  let html = '';
  for (const c of cats) {
    const platos = state.productos.filter(p => p.categoria_id === c.id);
    if (!platos.length) continue;
    html += `<div class="sede-cat">${esc(c.emoji || '')} ${esc(c.nombre)}</div>`;
    for (const p of platos) {
      const f = porPlato.get(p.id);
      const propio = f && f.precio_numerico !== null && f.precio_numerico !== undefined ? Number(f.precio_numerico) : '';
      const sirve = !(f && f.disponible === false);
      // Un plato con presentaciones no tiene UN precio por sede: no sabría a cuál se refiere. Se queda con las
      // suyas en todas las sedes (precio por sede de cada presentación: pendiente) y solo se decide si se sirve.
      const conPres = typeof presentacionesDelPlato === 'function' && presentacionesDelPlato(p).length > 0;
      html += `<div class="sede-plato" data-plato="${esc(p.id)}">
        <div class="sede-plato-nombre">${esc(p.nombre)}</div>
        <div class="sede-plato-base">${esc(conPres ? 'Desde ' + pesos(p.precio_numerico) : pesos(p.precio_numerico))}</div>
        <input type="${conPres ? 'text' : 'number'}" class="form-input sede-precio" min="0" step="any" inputmode="numeric"
          value="${conPres ? '' : esc(propio)}" placeholder="${conPres ? 'Tiene presentaciones' : esc(Math.round(Number(p.precio_numerico) || 0))}"
          ${conPres ? 'disabled title="Un plato con presentaciones conserva las suyas en todas las sedes (el precio por sede de cada presentación, pendiente)"' : ''}
          aria-label="Precio de ${esc(p.nombre)} en ${esc(sede.nombre)}">
        <label class="sede-sirve"><input type="checkbox" class="sede-sirve-caja"${sirve ? ' checked' : ''}> Se sirve</label>
      </div>`;
    }
  }
  tabla.innerHTML = html || '<p class="bienvenida-ayuda">Este restaurante todavía no tiene platos.</p>';
  cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Lo que se manda: una fila por plato con lo que la sede cambia. El servidor
// borra las que no cambian nada, así que mandarlas todas es seguro.
function filasDePreciosDeSede() {
  return [...document.querySelectorAll('#sedesPreciosTabla .sede-plato')].map(fila => {
    const precio = fila.querySelector('.sede-precio').value.trim();
    return {
      producto_id: fila.dataset.plato,
      precio_numerico: precio === '' ? null : Number(precio),
      disponible: fila.querySelector('.sede-sirve-caja').checked ? null : false,
    };
  });
}

async function guardarPreciosDeSede() {
  if (!sedeAbiertaId) return;
  const boton = document.getElementById('sedesPreciosGuardar');
  boton.disabled = true;
  try {
    const r = await apiFetch('PUT', '/api/productos-sedes', { sede_id: sedeAbiertaId, filas: filasDePreciosDeSede() });
    showToast(`Guardado: ${r.guardados} con cambios en esta sede`, 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  finally { boton.disabled = false; }
}

function cerrarPreciosDeSede() {
  sedeAbiertaId = null;
  document.getElementById('sedesPrecios').style.display = 'none';
}

// ── HERRAMIENTAS PARA CARGAR PRECIOS ──────────────────────────
// Una carta de 75 platos con precios propios no se teclea plato por plato. Estas dos
// herramientas solo RELLENAN las cajas de la tabla; nada se guarda hasta «Guardar
// precios», así que se puede probar y deshacer recargando.
//
// Las reglas van aparte del pintado para poder probarlas sin navegador.

// «Burger Clásica» y «burger clasica» son el mismo plato: sin tildes, sin mayúsculas,
// sin signos, con los espacios unidos.
function normalizarNombreDePlato(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// El base subido un porcentaje y redondeado al múltiplo elegido (en pesos
// colombianos lo normal es 500). null si no hay forma de calcularlo.
function precioConPorcentaje(base, porcentaje, redondeo = 500) {
  const b = Number(base), p = Number(porcentaje);
  const r = Math.max(1, Math.round(Number(redondeo)) || 1);
  if (!Number.isFinite(b) || !Number.isFinite(p) || b < 0 || p <= -100) return null;
  return Math.round(b * (1 + p / 100) / r) * r;
}

// «26000», «$ 26.000» y «26,000» son veintiséis mil; «19,5» no es un precio en
// pesos y se rechaza en vez de adivinar si son diecinueve pesos o diecinueve mil
// quinientos. null si no es un precio.
function numeroDePrecio(texto) {
  const s = String(texto ?? '').replace(/[$\s]/g, '');
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  return null;
}

// Una línea por plato: «nombre» y «precio» separados por tabulador (lo que sale de
// copiar dos columnas de Excel o Sheets), «;», «|» o dos espacios o más; y, si no, por
// el último espacio antes de un número. Devuelve lo que coincidió y, aparte, lo que
// no: que se vea qué quedó fuera es lo que permite fiarse de lo que entró.
function analizarPreciosPegados(texto, platos) {
  const porNombre = new Map();
  for (const p of platos) {
    const k = normalizarNombreDePlato(p.nombre);
    if (k && !porNombre.has(k)) porNombre.set(k, p.id);
  }
  const resultado = { coinciden: [], sinPlato: [], sinPrecio: [] };
  for (const cruda of String(texto ?? '').split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    const m = linea.match(/^(.*?)\s*[\t;|]\s*([^\t;|]+)$/) || linea.match(/^(.+?)\s{2,}(\S.*)$/) || linea.match(/^(.+?)\s+(\$?\s*\d[\d.,]*)$/);
    const precio = m ? numeroDePrecio(m[2]) : null;
    if (precio === null) { resultado.sinPrecio.push(linea); continue; }
    const id = porNombre.get(normalizarNombreDePlato(m[1]));
    if (!id) { resultado.sinPlato.push(m[1].trim()); continue; }
    resultado.coinciden.push({ producto_id: id, precio_numerico: precio });
  }
  return resultado;
}

// Las filas de la tabla de precios, con su caja y su plato base.
function filasDeLaTablaDeSede() {
  return [...document.querySelectorAll('#sedesPreciosTabla .sede-plato')].map(fila => ({
    fila,
    caja: fila.querySelector('.sede-precio'),
    sirve: fila.querySelector('.sede-sirve-caja').checked,
    plato: state.productos.find(p => p.id === fila.dataset.plato),
  }));
}

function aplicarPorcentajeASede(aTodos) {
  const pct = document.getElementById('sedPorcentaje').value.trim();
  if (pct === '' || !Number.isFinite(Number(pct))) { showToast('Escribe el porcentaje', 'error'); return; }
  const redondeo = document.getElementById('sedRedondeo').value;
  let n = 0;
  for (const { caja, sirve, plato } of filasDeLaTablaDeSede()) {
    if (!plato || !sirve) continue;            // un plato que no se sirve aquí no necesita precio
    if (!aTodos && caja.value.trim() !== '') continue;
    const precio = precioConPorcentaje(plato.precio_numerico, pct, redondeo);
    if (precio === null) continue;
    caja.value = precio; n++;
  }
  showToast(n ? `Precios puestos en ${n} ${n === 1 ? 'plato' : 'platos'}. Revisa y guarda.` : 'No había platos a los que aplicarlo', n ? 'success' : 'info');
}

function aplicarPreciosPegados() {
  const filas = filasDeLaTablaDeSede();
  const r = analizarPreciosPegados(document.getElementById('sedPegado').value, state.productos);
  const porId = new Map(filas.map(f => [f.plato?.id, f]));
  for (const c of r.coinciden) {
    const f = porId.get(c.producto_id);
    if (f) f.caja.value = c.precio_numerico;
  }
  // Lo que no entró, a la vista y por textContent: son líneas que escribió una persona.
  const caja = document.getElementById('sedPegadoResultado');
  caja.replaceChildren();
  const linea = (clase, texto) => { const d = document.createElement('div'); d.className = clase; d.textContent = texto; caja.appendChild(d); };
  linea('sede-pegado-ok', `${r.coinciden.length} ${r.coinciden.length === 1 ? 'precio puesto' : 'precios puestos'}. Revisa y guarda.`);
  if (r.sinPlato.length) linea('sede-pegado-falta', `Sin plato con ese nombre (${r.sinPlato.length}): ${r.sinPlato.join(' · ')}`);
  if (r.sinPrecio.length) linea('sede-pegado-falta', `Sin un precio que se entienda (${r.sinPrecio.length}): ${r.sinPrecio.join(' · ')}`);
}

// ── EL WHATSAPP DE CADA SEDE ──────────────────────────────────
// El número al que sale el pedido de una sede: el suyo si lo trae —aunque sea '', que es «no
// hay», y no se hereda: es la regla de negocio.js— y, si no, el del restaurante. Es lo mismo que
// hace la carta al mezclar los datos de la sede por encima de los del restaurante.
function whatsappDeLaSede(atributosDelRestaurante, sede) {
  const propio = sede?.atributos?.whatsapp_negocio;
  if (propio !== undefined && propio !== null) return String(propio).replace(/\D/g, '');
  return whatsappDelNegocio(atributosDelRestaurante);
}

// Los nombres de las sedes ACTIVAS que no tienen a dónde mandar un pedido.
function sedesSinWhatsApp(atributosDelRestaurante, sedes) {
  return (sedes || []).filter(s => s.activa && !whatsappDeLaSede(atributosDelRestaurante, s)).map(s => s.nombre);
}

// Con sedes cargadas, las que no tienen número; si no se sabe, ninguna (no se alarma sin datos).
function nombresDeSedesSinWhatsApp(atributos) {
  if (atributos?.con_sedes !== true || !state.restaurante || state.sedesDe !== state.restaurante.id) return [];
  return sedesSinWhatsApp(atributos, state.sedes);
}
