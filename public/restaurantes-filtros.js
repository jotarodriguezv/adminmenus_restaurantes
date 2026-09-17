// Los filtros de la lista de restaurantes del superadmin.
//
// Pedido el 17/09/2026: con la lista creciendo, encontrar «las de video» o «las
// que tienen carrito» era leer las etiquetas de todas, una por una. Los filtros
// siguen el orden en que está montado el sistema, que es como se pregunta:
// tipo de página (Fotos o Video, o sea el plan), modelo de ese tipo, y lo que
// cada carta tiene encendido.
//
// Cada funcionalidad se mide con la MISMA regla que su etiqueta en la ficha o
// que la carta —cartaTieneCarrito, el resumen de video para la IA—, no leyendo
// el interruptor a secas: «con pedidos» incluiría si no cartas cuyo modelo no
// pinta el carrito, que es justo el enredo que estas etiquetas ya resolvieron.
//
// Se filtra escondiendo tarjetas ya pintadas, no repintando la lista: cargarla
// vuelve a pedir tres cosas al servidor, y ocurre tras cada acción (suspender,
// «✓ Pagó»…), que es cuando el filtro tiene que seguir puesto.
//
// Se carga con un <script> clásico, como los demás: no se puede repetir aquí
// ningún nombre que ya exista en otro archivo del panel.

// ── QUÉ SE PUEDE FILTRAR ──────────────────────────────────────
// El tipo y los modelos salen de PLANES (index.html), que es donde ya vive qué
// modelos tiene cada tipo: repetirlos aquí sería una segunda lista que se
// queda atrás en cuanto se añada un modelo.
const FUNCIONES_RESTO = [
  ['pedidos', '🛒 Pedidos'], ['tv', '📺 Pantalla TV'], ['buscador', '🔎 Buscador'],
  ['filtros', '🏷️ Filtros'], ['toppings', '🧀 Adicionales'], ['redes', '🔗 Redes'],
  ['ia', '✨ IA'],
];
const FILTRO_RESTOS_VACIO = { tipo: 'todos', modelo: 'todos', funciones: [], entorno: 'todos' };
// Fuera de 'state' a propósito: logout() lo reemplaza entero, y esto es de quien
// mira la lista, no del restaurante abierto. Así entrar a una carta y volver a
// la lista no pierde lo que se estaba mirando.
let filtroRestos = { ...FILTRO_RESTOS_VACIO };

// Lo que de este restaurante se puede filtrar, ya resuelto. Se calcula una vez
// por pintada y no dentro de cada comparación: los contadores de los botones
// recorren la lista entera una vez por botón.
// ¿Los comensales de esta carta ven el buscador? No basta el interruptor: la
// carta no lo enseña por debajo de MINIMO_PLATOS_BUSCADOR platos, así que una
// carta corta con el interruptor encendido no lo tiene para quien la mira.
//
// Sin el recuento —si /api/resumen-cartas falló— se responde por el
// interruptor solo. Es lo único que se sabe, y dejar fuera a todos sería peor:
// el filtro diría que nadie lo tiene.
function enseñaBuscador(atributos, platos) {
  if (atributos?.buscador === false) return false;
  return platos == null || platos >= MINIMO_PLATOS_BUSCADOR;
}

function rasgosDeResto(r, fact, resumenVideo, platos) {
  const at = r?.atributos || {};
  const plan = planDe(r);
  const carrito = cartaTieneCarrito(at, plan);
  const cuantos = clave => (Array.isArray(at[clave]) ? at[clave].length : 0);
  const funciones = [];
  if (carrito) funciones.push('pedidos');
  if (at.tv?.activa) funciones.push('tv');
  // Sin el dato, encendido si ya hay filtros elegidos: es como lo leen la carta
  // y la pestaña Ajustes, y lo contrario dejaría fuera a quien los configuró
  // antes de que existiera el interruptor.
  if (cuantos('filtros_disponibles') && (at.filtros_activos ?? true)) funciones.push('filtros');
  // Los toppings solo existen para el comensal si la carta tiene carrito.
  if (carrito && cuantos('toppings_platino') + cuantos('toppings_premium') + cuantos('salsas')) {
    funciones.push('toppings');
  }
  if (enseñaBuscador(at, platos)) funciones.push('buscador');
  if (at.social_bar) funciones.push('redes');
  // La IA solo se puede encender donde hay video, y ahí está encendida salvo
  // que se haya apagado a mano. Mismo criterio que la etiqueta de la ficha.
  if (plan.videos && resumenVideo?.ia_activa !== false) funciones.push('ia');
  return {
    tipo: nombrePlanDe(r),
    modelo: at.nav || MODELO_POR_DEFECTO,
    funciones,
    prueba: !!fact?.es_prueba,
  };
}

// Las funcionalidades se SUMAN: marcar dos deja las cartas que tienen las dos.
// Es lo que se busca al filtrar («las que ya tienen pedidos y toppings»), y lo
// contrario —cualquiera de las dos— ensancharía la lista al marcar más cosas.
function pasaFiltroRestos(rasgos, f) {
  if (f.tipo !== 'todos' && rasgos.tipo !== f.tipo) return false;
  if (f.modelo !== 'todos' && rasgos.modelo !== f.modelo) return false;
  if (f.entorno === 'reales' && rasgos.prueba) return false;
  if (f.entorno === 'prueba' && !rasgos.prueba) return false;
  return f.funciones.every(fn => rasgos.funciones.includes(fn));
}

function hayFiltroRestos(f = filtroRestos) {
  return f.tipo !== 'todos' || f.modelo !== 'todos' || f.entorno !== 'todos' || !!f.funciones.length;
}

// Los modelos que se ofrecen. Con un tipo elegido, solo los suyos: los del otro
// no tienen ni un restaurante posible y elegirlos solo puede vaciar la lista.
function modelosDelFiltro(tipo) {
  return tipo === 'todos'
    ? Object.values(PLANES).flatMap(p => p.modelos)
    : PLANES[tipo].modelos;
}

// Cambiar de tipo con un modelo del otro tipo marcado dejaría la lista vacía sin
// que se vea por qué: el botón del modelo ya ni siquiera estaría en pantalla.
function filtroTrasCambio(f, cambio) {
  const nuevo = { ...f, ...cambio };
  if (!modelosDelFiltro(nuevo.tipo).includes(nuevo.modelo)) nuevo.modelo = 'todos';
  return nuevo;
}

// ── PINTAR ────────────────────────────────────────────────────
function rasgosDeLista() {
  return (state.listaRestos || []).map(r => ({
    slug: r.slug,
    rasgos: rasgosDeResto(r, facturacionDe(r.id), state.resumenVideo?.[r.id], state.platosPorResto?.[r.id]),
  }));
}

function cambiarFiltroRestos(cambio) {
  filtroRestos = filtroTrasCambio(filtroRestos, cambio);
  pintarFiltrosRestos();
}

function pintarFiltrosRestos() {
  const caja = document.getElementById('adminRestoFiltros');
  if (!caja) return;
  const lista = rasgosDeLista();
  // Cada botón dice cuántos restaurantes quedarían al pulsarlo, contando lo que
  // ya está elegido. Así se ve ANTES de pulsar que una combinación no tiene
  // ninguno, en vez de llegar a una lista vacía y tener que deshacer.
  const cuantos = cambio =>
    lista.filter(x => pasaFiltroRestos(x.rasgos, filtroTrasCambio(filtroRestos, cambio))).length;

  caja.replaceChildren();
  const chip = (texto, activo, n, alPulsar) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat-chip' + (activo ? ' active' : '');
    b.setAttribute('aria-pressed', String(activo));
    b.textContent = `${texto} · ${n}`;
    b.onclick = alPulsar;
    return b;
  };
  const fila = (titulo, botones) => {
    const f = document.createElement('div');
    f.className = 'resto-filtros-fila';
    f.setAttribute('role', 'group');
    f.setAttribute('aria-label', titulo);
    const t = document.createElement('span');
    t.className = 'resto-filtros-titulo';
    t.textContent = titulo;
    f.append(t, ...botones);
    caja.appendChild(f);
  };

  fila('Tipo', [
    chip('Todos', filtroRestos.tipo === 'todos', cuantos({ tipo: 'todos' }),
         () => cambiarFiltroRestos({ tipo: 'todos' })),
    ...Object.entries(PLANES).map(([id, p]) =>
      chip(`${p.videos ? '🎬' : '📷'} ${p.nombre}`, filtroRestos.tipo === id, cuantos({ tipo: id }),
           () => cambiarFiltroRestos({ tipo: id }))),
  ]);

  fila('Modelo', [
    chip('Todos', filtroRestos.modelo === 'todos', cuantos({ modelo: 'todos' }),
         () => cambiarFiltroRestos({ modelo: 'todos' })),
    ...modelosDelFiltro(filtroRestos.tipo).map(m =>
      chip(etiquetaModelo(m), filtroRestos.modelo === m, cuantos({ modelo: m }),
           () => cambiarFiltroRestos({ modelo: m }))),
  ]);

  fila('Tiene', FUNCIONES_RESTO.map(([id, texto]) => {
    const activo = filtroRestos.funciones.includes(id);
    const conEste = activo ? filtroRestos.funciones : [...filtroRestos.funciones, id];
    return chip(texto, activo, cuantos({ funciones: conEste }), () => cambiarFiltroRestos({
      funciones: activo ? filtroRestos.funciones.filter(x => x !== id) : conEste,
    }));
  }));

  // Los de prueba son ocho de once, así que sin esto «cuántos clientes de verdad
  // hay» obliga a mirar las insignias de la lista entera.
  fila('Entorno', [
    chip('Todos', filtroRestos.entorno === 'todos', cuantos({ entorno: 'todos' }),
         () => cambiarFiltroRestos({ entorno: 'todos' })),
    chip('Clientes reales', filtroRestos.entorno === 'reales', cuantos({ entorno: 'reales' }),
         () => cambiarFiltroRestos({ entorno: 'reales' })),
    chip('De prueba', filtroRestos.entorno === 'prueba', cuantos({ entorno: 'prueba' }),
         () => cambiarFiltroRestos({ entorno: 'prueba' })),
  ]);

  aplicarFiltroRestos(lista);
}

// Esconde las tarjetas que no pasan y cierra con la cuenta. La cuenta va debajo
// de los botones y no arriba porque es la respuesta, no el título.
function aplicarFiltroRestos(lista = rasgosDeLista()) {
  const cont = document.getElementById('adminRestoList');
  const caja = document.getElementById('adminRestoFiltros');
  if (!cont || !caja) return;
  const visibles = new Set(lista.filter(x => pasaFiltroRestos(x.rasgos, filtroRestos)).map(x => x.slug));
  // style.display y no el atributo 'hidden': .resto-card es display:flex en el
  // CSS del panel, y esa regla le gana a la del navegador para [hidden].
  for (const card of cont.querySelectorAll('.resto-card')) {
    card.style.display = visibles.has(card.dataset.slug) ? '' : 'none';
  }

  const pie = document.createElement('div');
  pie.className = 'resto-filtros-cuenta';
  if (!hayFiltroRestos()) {
    pie.textContent = `${lista.length} restaurante${lista.length === 1 ? '' : 's'}`;
  } else {
    pie.textContent = visibles.size
      ? `Mostrando ${visibles.size} de ${lista.length} · `
      : 'Ningún restaurante cumple todo lo elegido · ';
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'resto-filtros-quitar';
    quitar.textContent = 'Quitar los filtros';
    quitar.onclick = () => { filtroRestos = { ...FILTRO_RESTOS_VACIO }; pintarFiltrosRestos(); };
    pie.appendChild(quitar);
  }
  caja.appendChild(pie);
}
