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
// Desde el 17/09/2026 se dice CAMPO a campo y no solo «faltan los datos de
// Nequi»: el aviso salía abajo a la derecha y había que adivinar si lo que
// faltaba era el teléfono o el titular. Es el mismo trato que la ficha del
// plato, con pintarErroresEnCampos.
//
// Solo se miran los métodos encendidos: apagado no viaja a la carta, y exigir
// los datos de algo que nadie va a ver sería impedir guardar por nada.
const CAMPOS_METODOS_PAGO = [
  'mpNequiTelefono', 'mpNequiTitular',
  'mpDaviplataTelefono', 'mpDaviplataTitular',
  'mpBancolombiaNumero', 'mpBancolombiaTitular',
  'mpBrebLlave',
];

function erroresDeMetodosPago(mp) {
  const errores = [];
  const pedir = (activo, valor, campo, mensaje, metodo) => {
    if (activo && !valor) errores.push({ campo, mensaje, metodo });
  };
  pedir(mp.nequi.activo, mp.nequi.telefono, 'mpNequiTelefono', 'Escribe el teléfono de Nequi al que te pagan.', 'Nequi');
  pedir(mp.nequi.activo, mp.nequi.titular, 'mpNequiTitular', 'Escribe a nombre de quién está esa cuenta.', 'Nequi');
  pedir(mp.daviplata.activo, mp.daviplata.telefono, 'mpDaviplataTelefono', 'Escribe el teléfono de Daviplata al que te pagan.', 'Daviplata');
  pedir(mp.daviplata.activo, mp.daviplata.titular, 'mpDaviplataTitular', 'Escribe a nombre de quién está esa cuenta.', 'Daviplata');
  pedir(mp.bancolombia.activo, mp.bancolombia.numero_cuenta, 'mpBancolombiaNumero', 'Escribe el número de la cuenta.', 'Bancolombia');
  pedir(mp.bancolombia.activo, mp.bancolombia.titular, 'mpBancolombiaTitular', 'Escribe a nombre de quién está la cuenta.', 'Bancolombia');
  pedir(mp.breb.activo, mp.breb.llave, 'mpBrebLlave', 'Escribe tu llave Bre-B.', 'Bre-B');
  return errores;
}

// Los nombres de los métodos a los que les falta algo, sin repetir. Es lo que
// resume el aviso cuando falta más de un dato: «Faltan datos de Nequi y
// Bancolombia» se entiende de un vistazo; siete líneas de campos, no.
function metodosIncompletos(mp) {
  return [...new Set(erroresDeMetodosPago(mp).map(e => e.metodo))];
}
