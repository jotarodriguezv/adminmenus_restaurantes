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

const esAdminDeSedes = () => state.rol === 'admin';

// ── LA PESTAÑA ────────────────────────────────────────────────
// Existe solo si el superadmin encendió «Varias sedes» para este restaurante
// (Superadmin → Varias sedes): él decide quién las tiene, también para sí mismo.
// Esconderla es cortesía: el servidor es quien cierra el paso.
function restauranteTieneSedes() {
  return state.restaurante?.atributos?.con_sedes === true;
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
  document.getElementById('sedesAdmin').style.display = esAdminDeSedes() ? 'block' : 'none';
  if (sedeAbiertaId && !sedesLista.some(s => s.id === sedeAbiertaId)) sedeAbiertaId = null;
  pintarSedes();
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
      </div>
      <div class="sede-acciones">
        <button class="btn-sm accent" onclick="abrirPreciosDeSede('${esc(s.id)}')">Precios y platos</button>
        ${admin ? `<button class="btn-sm" onclick="editarSede('${esc(s.id)}')">Editar</button>
        <button class="btn-sm" onclick="alternarSedeActiva('${esc(s.id)}')">${s.activa ? 'Apagar' : 'Encender'}</button>
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
  return a;
}

async function guardarSede() {
  const nombre = document.getElementById('sedNombre').value.trim();
  if (!nombre) { showToast('Ponle un nombre a la sede', 'error'); return; }
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
      html += `<div class="sede-plato" data-plato="${esc(p.id)}">
        <div class="sede-plato-nombre">${esc(p.nombre)}</div>
        <div class="sede-plato-base">${esc(pesos(p.precio_numerico))}</div>
        <input type="number" class="form-input sede-precio" min="0" step="any" inputmode="numeric"
          value="${esc(propio)}" placeholder="${esc(Math.round(Number(p.precio_numerico) || 0))}"
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
