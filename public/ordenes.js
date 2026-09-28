// Pedidos declarados como enviados por WhatsApp. El estado inicial no promete
// una venta: el restaurante lo confirma al atenderlo.
let ordenesCargadas = false;
const ETIQUETAS_ORDEN = { enviado_cliente: 'Por confirmar', recibido: 'Recibido', en_preparacion: 'En preparación', completado: 'Completado', cancelado: 'Cancelado' };

function dineroOrden(n) { return `$${Number(n || 0).toLocaleString('es-CO')}`; }
function fechaOrden(iso) { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); }

async function cargarOrdenes() {
  const lista = document.getElementById('ordenesLista');
  if (!lista || !state.restaurante) return;
  lista.textContent = 'Cargando pedidos…';
  try {
    const ordenes = await apiFetch('GET', `/api/pedidos?restaurante_id=${state.restaurante.id}`) || [];
    state.ordenes = ordenes; ordenesCargadas = true; pintarOrdenes();
  } catch { lista.textContent = 'No se pudieron cargar los pedidos.'; }
}

function pintarOrdenes() {
  const lista = document.getElementById('ordenesLista'); const resumen = document.getElementById('ordenesResumen');
  if (!lista || !resumen) return;
  const ordenes = state.ordenes || [];
  const abiertos = ordenes.filter(o => !['completado', 'cancelado'].includes(o.estado));
  resumen.textContent = `${ordenes.length} registrados · ${abiertos.length} por atender · Total informado ${dineroOrden(ordenes.reduce((s, o) => s + Number(o.total_reportado || 0), 0))}`;
  resumen.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:14px;';
  lista.replaceChildren();
  if (!ordenes.length) { lista.textContent = 'Aún no hay pedidos registrados.'; return; }
  ordenes.forEach(o => {
    const caja = document.createElement('article'); caja.className = 'orden-card';
    const items = (o.items || []).map(i => `${i.nombre} ×${i.cantidad}`).join(', ');
    caja.innerHTML = `<div><strong>${esc(o.cliente_nombre)}</strong> · ${esc(o.cliente_telefono)}<br><span>${esc(ETIQUETAS_ORDEN[o.estado] || o.estado)} · ${esc(o.tipo_entrega)} · ${dineroOrden(o.total_reportado)} · ${fechaOrden(o.creado_en)}</span><br><span>${esc(items)}${o.direccion_entrega ? ` · ${esc(o.direccion_entrega)}` : ''}</span></div>`;
    const select = document.createElement('select'); select.className = 'form-input';
    Object.entries(ETIQUETAS_ORDEN).forEach(([valor, texto]) => { const op = document.createElement('option'); op.value = valor; op.textContent = texto; op.selected = valor === o.estado; select.appendChild(op); });
    select.onchange = async () => { await apiFetch('PATCH', `/api/pedidos/${o.id}`, { estado: select.value }); o.estado = select.value; pintarOrdenes(); };
    caja.appendChild(select); lista.appendChild(caja);
  });
}
