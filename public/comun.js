// Lo común del panel: lo que usan todas las pestañas y no es de ninguna.
//
// Salió de public/index.html el 15/09/2026, paso 2 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace.
//
// Se carga con un <script> clásico ANTES del script principal de index.html,
// y eso es lo que permite que el resto lo use sin importar nada: en scripts
// clásicos, las declaraciones de nivel superior —también 'let' y 'const'— se
// comparten entre todos los de la página. Por la misma razón aquí no se puede
// declarar nada con un nombre que ya use otro archivo: el navegador se niega a
// cargar el segundo.
//
// Aquí solo hay declaraciones. Nada que se ejecute al cargar salvo leer la
// sesión guardada, que es lo que hacía antes en el mismo sitio.

const API = '';

// ── UTILIDADES ────────────────────────────────────────────────
function formatPrecio(num) {
  const n = parseFloat(num);
  if (!n && n !== 0) return '—';
  return '$ ' + Math.round(n).toLocaleString('es-CO');
}

// ── ESCAPADO DE HTML ──────────────────────────────────────────
// El panel muestra datos que escriben los restaurantes: nombres de producto,
// toppings, filtros. La mayoría del código usa textContent y está a salvo,
// pero unas cuantas plantillas van a innerHTML.
//
// Aquí no es cosmético como en el menú público: el superadmin abre el panel
// de CUALQUIER restaurante, y su token vive en sessionStorage. Un producto
// llamado <img src=x onerror=...> se ejecutaría con la sesión del superadmin
// en cuanto este mirara las estadísticas de ese restaurante.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ── SESIÓN Y ESTADO ───────────────────────────────────────────
// 'state' guarda lo de todas las pestañas, y por eso vive aquí aunque casi
// todos sus campos sean de una sola.
let token = sessionStorage.getItem('menuAdminToken') || null;
let state = {
  rol: sessionStorage.getItem('menuAdminRol') || null,
  restauranteSlug: sessionStorage.getItem('menuAdminSlug') || null,
  restaurante: null, categorias: [], productos: [],
  catFiltro: 'all', pendingImgUrl: null,
  extraImgs: [],
  facturacion: [],           // cobranza por restaurante, fuera de atributos
  facturacionCargada: false, // si es false el campo vacío significa "no se sabe"
  cupoIA: null,              // cuántas animaciones le quedan al restaurante
  videosPorAprobar: [],      // generados y convertidos, esperando que alguien los mire
  generandoIA: null,         // plato con una generación pedida y todavía sin trabajo
  videoEnRevisionActual: null, // el que se está mirando en la ficha abierta
  resumenVideo: {},          // videos y cupo de IA por restaurante, para la lista
  filtrosDisponibles: [],   // filtros que el restaurante activó (modelo explorar)
  prodFiltros: [],          // filtros marcados en el producto que se edita
  prodBadges: {},           // badges (popular/chef/nuevo) del producto que se edita
  pendingCatImgUrl: null,   // imagen de cabecera de categoría pendiente
  deleteAction: null
};

// ── API ───────────────────────────────────────────────────────
async function apiFetch(method, endpoint, body=null, isForm=false) {
  const opts = { method, headers: { 'Authorization': `Bearer ${token}` } };
  if (body && !isForm) { opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify(body); }
  else if (body && isForm) { opts.body=body; }
  const res = await fetch(`${API}${endpoint}`, opts);
  if (res.status===401) { logout(); return null; }
  // Un cuerpo que no es JSON no lo pone esta aplicación: lo pone algo por
  // delante (el proxy que corta por tamaño, una pasarela que se cansa de
  // esperar) o algo que se rompió antes de llegar. Decir "Error" a secas en
  // ese caso deja al usuario sin nada que contar y a nosotros sin nada que
  // buscar — pasó con una subida de video y costó una noche de rastreo.
  // El código de estado es lo único que distingue esos casos, así que va en
  // el mensaje.
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    const err = new Error(e?.error || `El servidor respondió ${res.status} sin explicación`);
    // El cuerpo entero, para lo que la ruta añada además del mensaje. Hoy lo
    // usa la importación de cartas, que al superadmin le manda el motivo
    // técnico en 'detalle'.
    err.cuerpo = e;
    throw err;
  }
  return res.json();
}

// ── MODALES ───────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow='hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow='';
}
function handleModalBg(e,id) { if(e.target.id===id) closeModal(id); }

// ── TOAST ─────────────────────────────────────────────────────
let toastTimer=null;
function showToast(msg,type='info',accion=null) {
  const t=document.getElementById('toast');
  clearTimeout(toastTimer);
  if (!accion) {
    // textContent y className sobrescriben lo que hubiera: si había un toast
    // con botón a la vista, este lo reemplaza entero, botón y clase incluidos.
    t.textContent=msg; t.className=`toast ${type} show`;
    toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
    return;
  }
  // Con acción dura más que los 3 s de siempre: hay que leerlo, darse cuenta
  // de que el restaurante no era ese, y llegar al botón.
  t.textContent='';
  const texto=document.createElement('span'); texto.textContent=msg;
  const boton=document.createElement('button');
  boton.type='button'; boton.className='toast-accion';
  const etiqueta=document.createElement('span'); etiqueta.textContent=accion.texto;
  boton.appendChild(etiqueta);
  boton.onclick=()=>{
    clearTimeout(toastTimer);
    t.classList.remove('show','con-accion');
    accion.alPulsar();
  };
  t.appendChild(texto); t.appendChild(boton);
  t.className=`toast ${type} con-accion show`;
  toastTimer=setTimeout(()=>t.classList.remove('show','con-accion'), accion.duracionMs || 8000);
}
