// La pestaña Pedidos: el número de WhatsApp al que llegan y los métodos de pago.
//
// Salió de public/index.html el 15/09/2026, paso 3 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace. El marcado de la pestaña sigue en index.html.
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// ── PEDIDOS (WhatsApp, modelo carrito) ─────────────────────────
function renderPedidos() {
  document.getElementById('pedidosWhatsapp').value = state.restaurante.atributos?.whatsapp_pedidos || '';
  actualizarAvisoPedidos();
}

// El campo vacío enseña «573001234567» de placeholder, que a simple vista
// parece un número puesto. Sin esto no había forma de saber desde aquí que la
// carta estaba rechazando pedidos.
function actualizarAvisoPedidos() {
  const a = state.restaurante?.atributos;
  const roto = cartaTieneCarrito(a, planActual()) && !recibePedidos(a);
  document.getElementById('pedidosSinNumero').style.display = roto ? 'block' : 'none';
}

// ── MÉTODOS DE PAGO (modelo carrito) ───────────────────────────
function renderMetodosPago() {
  const mp = state.restaurante.atributos?.metodos_pago || {};

  document.getElementById('mpEfectivo').checked = mp.efectivo?.activo !== false;
  document.getElementById('mpTarjeta').checked = !!mp.tarjeta?.activo;

  document.getElementById('mpNequiActivo').checked = !!mp.nequi?.activo;
  document.getElementById('mpNequiTelefono').value = mp.nequi?.telefono || '';
  document.getElementById('mpNequiTitular').value = mp.nequi?.titular || '';
  document.getElementById('mpNequiCampos').style.display = mp.nequi?.activo ? 'block' : 'none';

  document.getElementById('mpDaviplataActivo').checked = !!mp.daviplata?.activo;
  document.getElementById('mpDaviplataTelefono').value = mp.daviplata?.telefono || '';
  document.getElementById('mpDaviplataTitular').value = mp.daviplata?.titular || '';
  document.getElementById('mpDaviplataCampos').style.display = mp.daviplata?.activo ? 'block' : 'none';

  document.getElementById('mpBancolombiaActivo').checked = !!mp.bancolombia?.activo;
  document.getElementById('mpBancolombiaNumero').value = mp.bancolombia?.numero_cuenta || '';
  document.getElementById('mpBancolombiaTipo').value = mp.bancolombia?.tipo_cuenta || 'ahorros';
  document.getElementById('mpBancolombiaTitular').value = mp.bancolombia?.titular || '';
  document.getElementById('mpBancolombiaCampos').style.display = mp.bancolombia?.activo ? 'block' : 'none';

  document.getElementById('mpBrebActivo').checked = !!mp.breb?.activo;
  document.getElementById('mpBrebLlave').value = mp.breb?.llave || '';
  document.getElementById('mpBrebCampos').style.display = mp.breb?.activo ? 'block' : 'none';
}

function recolectarMetodosPago() {
  return {
    efectivo: { activo: document.getElementById('mpEfectivo').checked },
    tarjeta: { activo: document.getElementById('mpTarjeta').checked },
    nequi: {
      activo: document.getElementById('mpNequiActivo').checked,
      telefono: document.getElementById('mpNequiTelefono').value.trim(),
      titular: document.getElementById('mpNequiTitular').value.trim()
    },
    daviplata: {
      activo: document.getElementById('mpDaviplataActivo').checked,
      telefono: document.getElementById('mpDaviplataTelefono').value.trim(),
      titular: document.getElementById('mpDaviplataTitular').value.trim()
    },
    bancolombia: {
      activo: document.getElementById('mpBancolombiaActivo').checked,
      numero_cuenta: document.getElementById('mpBancolombiaNumero').value.trim(),
      tipo_cuenta: document.getElementById('mpBancolombiaTipo').value,
      titular: document.getElementById('mpBancolombiaTitular').value.trim()
    },
    breb: {
      activo: document.getElementById('mpBrebActivo').checked,
      llave: document.getElementById('mpBrebLlave').value.trim()
    }
  };
}

// Qué impide guardar la pestaña. Un método activo sin sus datos llega al
// checkout con la instrucción en blanco: el cliente lo elige, ve «Nequi: — a
// nombre de» y no sabe a dónde pagar. Mejor no dejar guardarlo que descubrirlo
// con un pedido perdido. Y sin número no llega ningún pedido.
function erroresDePedidos(whatsapp, mp) {
  const errores = [];
  if (!whatsapp) errores.push('el número de WhatsApp');
  const incompletos = [
    mp.nequi.activo       && (!mp.nequi.telefono || !mp.nequi.titular)             && 'Nequi',
    mp.daviplata.activo   && (!mp.daviplata.telefono || !mp.daviplata.titular)     && 'Daviplata',
    mp.bancolombia.activo && (!mp.bancolombia.numero_cuenta || !mp.bancolombia.titular) && 'Bancolombia',
    mp.breb.activo        && !mp.breb.llave                                        && 'Bre-B',
  ].filter(Boolean);
  if (incompletos.length) errores.push(`los datos de ${incompletos.join(', ')}`);
  return errores;
}

async function savePedidos() {
  const whatsapp_pedidos = document.getElementById('pedidosWhatsapp').value.trim().replace(/[^0-9]/g, '');
  const metodos_pago = recolectarMetodosPago();
  const st = document.getElementById('pedidosStatus');
  const errores = erroresDePedidos(whatsapp_pedidos, metodos_pago);
  if (errores.length) {
    // «Falta el número» pero «Faltan los datos de Nequi»: concuerda con lo que falta.
    const verbo = errores.length > 1 || errores[0].startsWith('los ') ? 'Faltan' : 'Falta';
    const texto = `${verbo} ${errores.join(' y ')}`;
    st.textContent = texto; st.style.color = 'var(--danger)';
    showToast(texto, 'error');
    return;
  }
  // Solo sus claves: el servidor funde. Ver el comentario de saveToppings.
  const atributos = { whatsapp_pedidos, metodos_pago };
  try {
    const data = await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`, { atributos });
    if (data) state.restaurante = data;
    document.getElementById('pedidosWhatsapp').value = whatsapp_pedidos;
    actualizarAvisoPedidos();
    st.textContent = '✓ Guardado'; st.style.color = 'var(--success)';
    showToast('Pedidos y pagos guardados', 'success');
  } catch (e) {
    st.textContent = 'Error al guardar'; st.style.color = 'var(--danger)';
    showToast('Error: ' + e.message, 'error');
  }
}
