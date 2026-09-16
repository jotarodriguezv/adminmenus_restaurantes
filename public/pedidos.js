// Los pedidos: el número de WhatsApp al que llegan y los métodos de pago.
//
// Salió de public/index.html el 15/09/2026, paso 3 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace.
//
// El 16/09/2026 dejó de ser una pestaña: su marcado vive dentro de la tarjeta
// del carrito, en Ajustes, y guarda con el botón de Ajustes. Aquí quedó lo que
// lee y escribe los campos; el guardado está en ajustes.js, porque todo lo de
// esa pantalla va en una sola petición.
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// ── PEDIDOS (WhatsApp, cartas con carrito) ─────────────────────
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

// Qué impide guardar. Un método activo sin sus datos llega al checkout con la
// instrucción en blanco: el cliente lo elige, ve «Nequi: — a nombre de» y no
// sabe a dónde pagar. Mejor no dejar guardarlo que descubrirlo con un pedido
// perdido.
//
// El número de WhatsApp NO está aquí, y antes sí: era la pestaña Pedidos, a la
// que solo se llegaba con el carrito ya encendido y guardado. Ahora el
// interruptor y el número están en la misma pantalla, así que exigirlo
// impediría el primer guardado —encender el carrito— por algo que todavía no se
// ha podido escribir. Falta el número se avisa al guardar y en rojo dentro de
// la tarjeta, que es lo que ya hacía actualizarAvisoPedidos().
function metodosIncompletos(mp) {
  return [
    mp.nequi.activo       && (!mp.nequi.telefono || !mp.nequi.titular)                   && 'Nequi',
    mp.daviplata.activo   && (!mp.daviplata.telefono || !mp.daviplata.titular)           && 'Daviplata',
    mp.bancolombia.activo && (!mp.bancolombia.numero_cuenta || !mp.bancolombia.titular)  && 'Bancolombia',
    mp.breb.activo        && !mp.breb.llave                                              && 'Bre-B',
  ].filter(Boolean);
}
