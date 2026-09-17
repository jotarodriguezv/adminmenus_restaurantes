// La pestaña Promoción: las tarjetas de cada promoción, su programación por
// días, horas y fechas, y el bloque de lo que se está viendo ahora mismo.
//
// tv.js usa de aquí DIAS_PROMO y programacionDe(): la cartelera enseña las
// mismas promociones y lee sus días igual. Se quedan en este archivo y no en
// comun.js a propósito —son de la promoción, no de todo el panel—, así que
// renombrarlas aquí obliga a mirar tv.js.
//
// La regla de horarios que comparten (zonaRestaurante, vigenteAhora…) sigue
// en index.html, con los horarios de categoría.
//
// Salió de public/index.html el 15/09/2026, paso 3 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace. El marcado de la pestaña sigue en index.html.
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// ── PROMO ─────────────────────────────────────────────────────

// ── PROMOCIONES ───────────────────────────────────────────────
// Hasta el 05/09/2026 la promoción era UNA, en columnas del restaurante. Ahora
// son filas de la tabla 'promociones', cada una con su programación.
//
// Cada tarjeta se guarda sola. Un botón único al final obligaría a leer cinco
// tarjetas para saber qué cambió, y a acertar con las cinco a la vez.
const DIAS_PROMO = [1, 2, 3, 4, 5, 6, 0];   // de lunes a domingo, como se lee

function programacionDe(p) {
  return (p && typeof p.programacion === 'object' && p.programacion) || {};
}

async function renderPromociones() {
  const lista = document.getElementById('promoLista');
  if (!lista) return;
  try {
    state.promociones = await apiFetch('GET',
      `/api/promociones?restaurante_id=${state.restaurante.id}`) || [];
  } catch (e) {
    lista.textContent = 'No se pudieron cargar las promociones: ' + e.message;
    return;
  }
  pintarPromociones();
}

function pintarPromociones() {
  const lista = document.getElementById('promoLista');
  const vacio = document.getElementById('promoVacio');
  const tope  = document.getElementById('promoTope');
  const boton = document.getElementById('btnNuevaPromo');
  if (!lista) return;

  lista.innerHTML = '';
  const promos = state.promociones || [];
  vacio.style.display = promos.length ? 'none' : 'block';
  for (const p of promos) lista.appendChild(tarjetaDePromo(p));

  // El tope lo pone el plan y lo hace cumplir el servidor; aquí solo se
  // enseña, porque esconder un botón no impide una llamada directa.
  const max = planActual().promociones || 5;
  boton.style.display = promos.length >= max ? 'none' : '';
  tope.style.display = promos.length >= max ? 'block' : 'none';
  tope.textContent = promos.length >= max
    ? `Has llegado a ${max} destacados, que es el máximo. Elimina uno para añadir otro.`
    : '';

  pintarQueSaleAhora();
  avisarSiCompitenPromociones();
}

// Cuántas saldrían AHORA MISMO. Con el azar y una sola visita por cliente, que
// haya cuatro vigentes significa que cada una la ve uno de cada cuatro — y eso
// hay que decirlo con ese lenguaje, no dejarlo a que se deduzca.
function avisarSiCompitenPromociones() {
  const el = document.getElementById('promoNuevaEstado');
  if (!el) return;
  const zona = zonaRestaurante();
  const vivas = (state.promociones || []).filter(p =>
    p.activa && p.en_popup && vigenteAhora(programacionDe(p), zona));
  const programadas = vivas.filter(p => tieneProgramacion(programacionDe(p)));
  const compiten = programadas.length ? programadas : vivas;

  if (compiten.length <= 1) { el.textContent = ''; return; }
  el.textContent = `Ahora mismo compiten ${compiten.length} destacados en la carta: ` +
                   'cada cliente verá una.';
  el.style.color = 'var(--text-muted)';
}

// ── LO QUE SE ESTÁ VIENDO AHORA MISMO ─────────────────────────
// La pregunta que trae todo el mundo a esta pestaña es "¿qué está saliendo?", y
// hasta ahora había que deducirla de cinco tarjetas y un horario. Con la imagen
// delante se contesta de un vistazo.
//
// Se calcula con la MISMA regla que el menú y la cartelera, no con una
// aproximación: si esto y la carta discreparan, la vista previa sería peor que
// no tenerla — daría confianza en una respuesta falsa.
function pintarQueSaleAhora() {
  const caja = document.getElementById('promoAhora');
  const cuerpo = document.getElementById('promoAhoraCuerpo');
  if (!caja || !cuerpo) return;

  const promos = state.promociones || [];
  if (!promos.length) { caja.style.display = 'none'; return; }
  caja.style.display = 'block';
  cuerpo.innerHTML = '';

  const zona = zonaRestaurante();
  const ahora = ahoraEnZona(zona);
  const reloj = document.getElementById('promoAhoraReloj');
  const hh = String(Math.floor(ahora.minutos / 60)).padStart(2, '0');
  const mm = String(ahora.minutos % 60).padStart(2, '0');
  // La hora del RESTAURANTE, que es con la que se decide. Si el usuario está en
  // otro huso —o el portátil mal puesto— ver aquí su propia hora explicaría al
  // revés por qué algo no sale.
  reloj.textContent = `${DIAS_LARGOS[ahora.dia]} ${ahora.fecha} · ${hh}:${mm} ` +
                      `(hora de ${zona.split('/').pop().replace(/_/g, ' ')})`;

  cuerpo.appendChild(bloqueDeSuperficie('En la carta', elegiblesAhora(promos, 'en_popup', zona), true));
  // Una columna "En el televisor" en un restaurante sin cartelera solo puede
  // decir "Ninguna", y eso se lee como un problema que arreglar.
  if (restauranteTieneTv())
    cuerpo.appendChild(bloqueDeSuperficie('En el televisor', elegiblesAhora(promos, 'en_tv', zona), false));
}

// Las que saldrían en una superficie, con los dos niveles ya aplicados. Espejo
// de core/promociones.js: el filtro por superficie va ANTES que los niveles.
function elegiblesAhora(promos, donde, zona) {
  const candidatas = promos.filter(p => p.activa && p.imagen_url && p[donde]);
  const vivas = candidatas.filter(p => vigenteAhora(programacionDe(p), zona));
  const programadas = vivas.filter(p => tieneProgramacion(programacionDe(p)));
  return programadas.length ? programadas : vivas.filter(p => !tieneProgramacion(programacionDe(p)));
}

function bloqueDeSuperficie(titulo, lista, esPopup) {
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:200px';

  const h = document.createElement('div');
  h.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:8px';
  h.textContent = titulo;
  col.appendChild(h);

  if (!lista.length) {
    const nada = document.createElement('div');
    nada.style.cssText = 'font-size:12px;color:var(--text-dim);border:1px dashed var(--border2);' +
                         'border-radius:8px;padding:16px;text-align:center';
    nada.textContent = 'Ninguna';
    col.appendChild(nada);
    return col;
  }

  const fila = document.createElement('div');
  fila.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  for (const p of lista) {
    const m = document.createElement('img');
    m.src = p.imagen_url;
    m.title = p.nombre || '';
    m.style.cssText = 'width:96px;height:72px;object-fit:cover;border-radius:6px;' +
                      'border:1px solid var(--border)';
    fila.appendChild(m);
  }
  col.appendChild(fila);

  const pie = document.createElement('div');
  pie.style.cssText = 'font-size:11px;color:var(--text-dim);margin-top:8px;line-height:1.5';
  // El popup enseña UNA de las que hay; la cartelera las rota todas. Decirlo
  // aquí es lo que evita leer dos imágenes como "salen las dos a la vez".
  pie.textContent = esPopup
    ? (lista.length === 1
        ? 'Cada cliente ve esta.'
        : `Cada cliente ve UNA de estas ${lista.length}, al azar.`)
    : (lista.length === 1
        ? 'Sale esta, cada tantas pantallas de platos.'
        : `Se van turnando las ${lista.length} en el hueco de la cartelera.`);
  col.appendChild(pie);
  return col;
}

function tarjetaDePromo(p) {
  const h = programacionDe(p);
  const caja = document.createElement('div');
  caja.className = 'section-card';
  caja.style.cssText = 'margin-bottom:14px;padding:14px';
  caja.dataset.promo = p.id;

  // El esqueleto no lleva ni un dato del restaurante: todo lo que viene de la
  // base se asigna después con .value y .textContent, así que no hay nada que
  // escapar y no puede haber un olvido.
  caja.innerHTML = `
    <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <img class="p-img" style="width:110px;height:82px;object-fit:cover;border-radius:8px;
        border:1px solid var(--border);cursor:pointer" title="Cambiar imagen">
      <div style="flex:1;min-width:220px">
        <div class="form-row" style="margin-bottom:8px">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Nombre interno <span style="color:var(--text-dim)">(también se ve en el televisor)</span></label>
            <input type="text" class="form-input p-nombre" maxlength="80" placeholder="2x1 en hamburguesas">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Precio <span style="color:var(--text-dim)">(solo en el televisor)</span></label>
            <input type="text" class="form-input p-precio" maxlength="30" placeholder="$ 30.000">
          </div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
          <div class="form-check"><label class="toggle"><input type="checkbox" class="p-activa"><span class="toggle-slider"></span></label>
            <span style="font-size:12px;color:var(--text-muted)">Publicado</span></div>
          <div class="p-destino form-check"><label class="toggle"><input type="checkbox" class="p-popup"><span class="toggle-slider"></span></label>
            <span style="font-size:12px;color:var(--text-muted)">En la carta</span></div>
          <div class="p-destino p-tv-fila form-check"><label class="toggle"><input type="checkbox" class="p-tv"><span class="toggle-slider"></span></label>
            <span style="font-size:12px;color:var(--text-muted)">En el televisor</span></div>
        </div>
      </div>
    </div>

    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
      <div class="form-check" style="margin-bottom:10px">
        <label class="toggle"><input type="checkbox" class="p-prog"><span class="toggle-slider"></span></label>
        <span style="font-size:12px;color:var(--text-muted)">Programar fecha, días u horas</span>
      </div>
      <div class="p-campos" style="display:none">
        <label class="form-label">Días</label>
        <div class="p-dias" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
        <div class="form-row" style="margin-bottom:4px">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Desde</label><span class="p-desde-hueco"></span>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Hasta</label><span class="p-hasta-hueco"></span>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;line-height:1.5">
          En formato de 24 horas: las 6 de la tarde son <strong>18:00</strong>. Déjalo
          en «Todo el día» si la promoción sale a cualquier hora de esos días.
        </div>
        <div class="form-row" style="margin-bottom:0">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Empieza el <span style="color:var(--text-dim)">(opcional)</span></label>
            <input type="date" class="form-input p-desdef">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Termina el <span style="color:var(--text-dim)">(opcional)</span></label>
            <input type="date" class="form-input p-hastaf">
          </div>
        </div>
      </div>
      <div class="p-nota" style="margin-top:10px;font-size:11px;line-height:1.6"></div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap">
      <button type="button" class="btn-save p-guardar" style="width:auto;padding:9px 22px">Guardar</button>
      <button type="button" class="p-borrar" style="padding:8px 12px;border-radius:6px;border:1px solid var(--danger);
        background:transparent;color:var(--danger);font-family:var(--mono);font-size:9px;letter-spacing:1px;cursor:pointer">
        🗑 Eliminar
      </button>
      <div class="p-estado" style="font-size:11px;font-family:var(--mono);color:var(--text-muted);flex:1"></div>
    </div>`;

  const q = c => caja.querySelector('.' + c);

  // Los dos selectores de hora se construyen en JS: sus 48 opciones no tienen
  // por qué vivir repetidas en el HTML de cada tarjeta.
  const selDesde = selectorDeHora('p-desde', h.desde || '');
  const selHasta = selectorDeHora('p-hasta', h.hasta || '');
  caja.querySelector('.p-desde-hueco').replaceWith(selDesde);
  caja.querySelector('.p-hasta-hueco').replaceWith(selHasta);

  q('p-img').src = p.imagen_url;
  q('p-nombre').value = p.nombre || '';
  q('p-precio').value = p.precio || '';
  q('p-activa').checked = !!p.activa;
  q('p-popup').checked = !!p.en_popup;
  q('p-tv').checked = !!p.en_tv;

  // Sin cartelera no se ofrece el interruptor: un control que promete algo que
  // el plan no incluye confunde y no lleva a ninguna parte.
  //
  // Se ESCONDE, no se quita del DOM ni se apaga. perroscriollos ya tenía dos
  // promociones marcadas para el televisor —marcadas cuando el interruptor
  // estaba a la vista— y leerlas como 'false' al guardar cualquier otra cosa de
  // la tarjeta les cambiaría el dato sin que nadie lo pidiera. Escondido, el
  // valor viaja de ida y vuelta intacto.
  if (!restauranteTieneTv()) q('p-tv-fila').style.display = 'none';
  q('p-prog').checked = !!h.activo;
  q('p-campos').style.display = h.activo ? 'block' : 'none';
  q('p-desdef').value = h.desde_fecha || '';
  q('p-hastaf').value = h.hasta_fecha || '';
  abrirCalendarioAlPulsar(q('p-desdef'));
  abrirCalendarioAlPulsar(q('p-hastaf'));

  const elegidos = new Set(Array.isArray(h.dias) ? h.dias : []);
  const pintarDias = () => {
    const cont = q('p-dias');
    cont.innerHTML = '';
    for (const d of DIAS_PROMO) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (elegidos.has(d) ? ' active' : '');
      b.style.cssText = 'min-width:38px;text-align:center;padding:7px 10px';
      b.textContent = DIAS_CORTOS[d];
      b.title = DIAS_LARGOS[d];
      b.onclick = () => {
        if (elegidos.has(d)) elegidos.delete(d); else elegidos.add(d);
        pintarDias(); nota();
      };
      cont.appendChild(b);
    }
  };

  // Qué está pasando AHORA con esta promoción. Es lo que evita la llamada de
  // "la configuré y no sale": lo dice la pantalla, no hay que deducirlo.
  const nota = () => {
    atenuarDestinos(caja);
    const el = q('p-nota');
    const h2 = programacionDelFormulario(caja, elegidos);
    if (!q('p-activa').checked) {
      el.textContent = 'Borrador: no sale en ningún sitio hasta que lo publiques.';
      el.style.color = 'var(--warn)'; return;
    }
    const conTv = restauranteTieneTv();
    if (!q('p-popup').checked && (!conTv || !q('p-tv').checked)) {
      el.textContent = conTv
        ? 'No está marcada ni para la carta ni para el televisor, así que no sale en ninguno.'
        : 'No está marcada para la carta, así que no sale en ningún sitio.';
      el.style.color = 'var(--warn)'; return;
    }
    if (!h2.activo) {
      el.textContent = 'Sale siempre, cualquier día y a cualquier hora.';
      el.style.color = 'var(--text-dim)'; return;
    }
    // Interruptor encendido y nada marcado: es lo mismo que tenerlo apagado, y
    // decirlo evita que alguien se quede pensando que ha programado algo. Al
    // guardar se normaliza a "sin programación" para que el dato no mienta.
    if (!tieneProgramacion(h2)) {
      el.textContent = 'No has marcado ningún día, hora ni fecha, así que sale ' +
                       'siempre — es lo mismo que dejar esta programación apagada.';
      el.style.color = 'var(--warn)'; return;
    }
    const partes = [describirHorario(h2)];
    if (h2.desde_fecha || h2.hasta_fecha) {
      partes.push('· del ' + (h2.desde_fecha || '…') + ' al ' + (h2.hasta_fecha || '…'));
    }
    const ahora = vigenteAhora(h2, zonaRestaurante());
    partes.push(ahora ? '· ahora mismo SÍ está saliendo' : '· ahora mismo no está saliendo');
    el.textContent = partes.join(' ');
    el.style.color = ahora ? 'var(--text-dim)' : 'var(--warn)';
  };

  pintarDias(); nota();

  for (const c of ['p-activa', 'p-popup', 'p-tv', 'p-desde', 'p-hasta', 'p-desdef', 'p-hastaf'])
    q(c).onchange = nota;
  q('p-prog').onchange = () => {
    q('p-campos').style.display = q('p-prog').checked ? 'block' : 'none';
    nota();
  };
  q('p-img').onclick = () => cambiarImagenDePromo(p.id);
  q('p-guardar').onclick = () => guardarPromo(p.id, caja, elegidos);
  q('p-borrar').onclick = () => eliminarPromo(p.id);
  return caja;
}

// «Activa» manda sobre los otros dos: con ella apagada la promoción no sale en
// ningún sitio (vmenus-app/core/promociones.js pide p.activa antes que el
// destino). Pero los tres interruptores se veían iguales, y con «Activa» apagada
// «En la carta» y «En el televisor» seguían encendidos a plena vista, afirmando
// algo que ya no era verdad. Ver B2.
//
// Se ATENÚAN, no se deshabilitan: dejar marcados los destinos antes de encender
// la promoción es una forma normal de prepararla, y bloquearlos obligaría a
// encender primero. Su valor se guarda igual, esté o no atenuado.
function atenuarDestinos(caja) {
  const activa = caja.querySelector('.p-activa').checked;
  for (const d of caja.querySelectorAll('.p-destino')) {
    d.style.opacity = activa ? '' : '0.4';
    d.title = activa ? '' : 'No tiene efecto mientras el destacado esté en borrador';
  }
}

function programacionDelFormulario(caja, elegidos) {
  const q = c => caja.querySelector('.' + c);
  if (!q('p-prog').checked) return {};
  return {
    activo: true,
    dias: [...elegidos].sort(),
    desde: q('p-desde').value || '',
    hasta: q('p-hasta').value || '',
    desde_fecha: q('p-desdef').value || '',
    hasta_fecha: q('p-hastaf').value || '',
  };
}

// Lo que se guarda de verdad. Un interruptor encendido sin un solo día, hora ni
// fecha se guarda como SIN programación: se comporta igual —sale siempre— y así
// el dato dice lo que pasa. Guardar 'activo:true' con todo vacío deja una fila
// que promete una programación que no existe, y esa fila la lee después la
// regla de dos niveles: contaría como "programada" y le quitaría el turno a las
// de fondo sin motivo.
function programacionParaGuardar(caja, elegidos) {
  const h = programacionDelFormulario(caja, elegidos);
  return tieneProgramacion(h) ? h : {};
}

async function guardarPromo(id, caja, elegidos) {
  const q = c => caja.querySelector('.' + c);
  const st = q('p-estado');
  st.textContent = 'Guardando…'; st.style.color = 'var(--text-muted)';
  try {
    const data = await apiFetch('PATCH', `/api/promociones/${id}`, {
      nombre: q('p-nombre').value.trim(),
      precio: q('p-precio').value.trim(),
      activa: q('p-activa').checked,
      en_popup: q('p-popup').checked,
      en_tv: q('p-tv').checked,
      programacion: programacionParaGuardar(caja, elegidos),
    });
    const i = (state.promociones || []).findIndex(x => x.id === id);
    if (i >= 0 && data) state.promociones[i] = data;
    st.textContent = '✓ Guardado'; st.style.color = 'var(--success)';
    showToast('Destacado guardado', 'success');
    pintarQueSaleAhora();
    avisarSiCompitenPromociones();
  } catch (e) {
    st.textContent = e.message || 'Error al guardar'; st.style.color = 'var(--danger)';
    showToast('Error: ' + e.message, 'error');
  }
}

// El alta empieza con una decisión explícita: imagen propia o producto ya
// guardado. Así el explorador de archivos no interrumpe antes de saber qué
// quiere destacar la persona.
let destinoNuevoDestacado = 'carta';
function abrirNuevoDestacado(destino) {
  destinoNuevoDestacado = destino === 'tv' ? 'tv' : 'carta';
  const productos = document.getElementById('destacadoProductos');
  const estado = document.getElementById('destacadoModalEstado');
  const titulo = document.getElementById('destacadoModalTitulo');
  const intro = document.getElementById('destacadoModalIntro');
  if (productos) { productos.style.display = 'none'; productos.innerHTML = ''; }
  if (estado) estado.textContent = '';
  if (titulo) titulo.textContent = destinoNuevoDestacado === 'tv' ? 'Añadir destacado para TV' : 'Añadir destacado';
  if (intro) intro.textContent = destinoNuevoDestacado === 'tv'
    ? 'Sube una imagen o reutiliza un producto de tu carta. Quedará como borrador, listo para programarlo o publicarlo en la pantalla.'
    : 'Empieza con una imagen nueva o reutiliza un producto que ya tienes en tu carta. Podrás revisar todo antes de publicarlo.';
  openModal('destacadoModal');
}

function destinosDeNuevoDestacado() {
  return destinoNuevoDestacado === 'tv'
    ? { en_popup: false, en_tv: true }
    : { en_popup: true, en_tv: false };
}

function mostrarProductosParaDestacado() {
  const cont = document.getElementById('destacadoProductos');
  if (!cont) return;
  cont.style.display = 'block';
  cont.innerHTML = `
    <div class="destacado-productos-head"><strong>Elige un producto</strong><span>Se copiarán su foto, nombre y precio.</span></div>
    <input type="search" id="buscarProductoDestacado" class="form-input" placeholder="Buscar en mi carta" autocomplete="off">
    <div class="destacado-producto-lista" id="listaProductosDestacado" style="margin-top:10px"></div>`;
  const buscar = document.getElementById('buscarProductoDestacado');
  buscar.oninput = () => pintarProductosParaDestacado(buscar.value);
  pintarProductosParaDestacado('');
  buscar.focus();
}

function pintarProductosParaDestacado(texto) {
  const lista = document.getElementById('listaProductosDestacado');
  if (!lista) return;
  lista.innerHTML = '';
  const filtro = String(texto || '').trim().toLocaleLowerCase('es');
  const productos = (state.productos || []).filter(p =>
    !filtro || String(p.nombre || '').toLocaleLowerCase('es').includes(filtro));
  if (!productos.length) {
    const nada = document.createElement('div');
    nada.className = 'form-ayuda';
    nada.textContent = 'No encontramos un producto con ese nombre.';
    lista.appendChild(nada);
    return;
  }
  for (const producto of productos) {
    const boton = document.createElement('button');
    boton.type = 'button'; boton.className = 'destacado-producto';
    if (!producto.imagen_url) {
      boton.disabled = true;
      boton.title = 'Este producto todavía no tiene foto.';
    }
    const imagen = producto.imagen_url ? document.createElement('img') : document.createElement('span');
    if (producto.imagen_url) imagen.src = producto.imagen_url;
    else { imagen.className = 'destacado-producto-sin-foto'; imagen.textContent = '📷'; }
    const nombre = document.createElement('span');
    nombre.className = 'destacado-producto-nombre';
    nombre.textContent = producto.nombre || 'Producto sin nombre';
    const precio = document.createElement('span');
    precio.className = 'destacado-producto-precio';
    precio.textContent = producto.imagen_url ? (producto.precio || '') : 'Falta foto';
    boton.append(imagen, nombre, precio);
    if (producto.imagen_url) boton.onclick = () => crearDestacadoDesdeProducto(producto.id);
    lista.appendChild(boton);
  }
}

function estadoNuevoDestacado(texto, color) {
  const modal = document.getElementById('destacadoModalEstado');
  const lista = document.getElementById('promoNuevaEstado');
  for (const el of [modal, lista]) {
    if (!el) continue;
    el.textContent = texto;
    el.style.color = color || 'var(--text-muted)';
  }
}

async function crearDestacadoDesdeProducto(id) {
  const producto = (state.productos || []).find(p => p.id === id);
  if (!producto || !producto.imagen_url) return;
  estadoNuevoDestacado('Creando el destacado…');
  try {
    const nueva = await apiFetch('POST', '/api/promociones', {
      restaurante_id: state.restaurante.id,
      imagen_url: producto.imagen_url,
      nombre: producto.nombre || '', precio: producto.precio || '',
      activa: false, ...destinosDeNuevoDestacado(),
      programacion: {}, orden: (state.promociones || []).length,
    });
    state.promociones = [...(state.promociones || []), nueva];
    pintarPromociones();
    if (destinoNuevoDestacado === 'tv' && typeof tvPintarImagenes === 'function') {
      tvPintarImagenes(); tvAlternarIntercalados();
    }
    closeModal('destacadoModal');
    estadoNuevoDestacado('');
    showToast('Destacado creado como borrador. Publícalo cuando esté listo.', 'success');
  } catch (e) {
    estadoNuevoDestacado(e.message || 'Error al crear el destacado', 'var(--danger)');
    showToast('Error: ' + e.message, 'error');
  }
}

async function crearDestacadoConImagen(input) {
  const file = input.files[0]; if (!file) return;
  estadoNuevoDestacado('Subiendo la imagen…');
  try {
    const blob = await compressImage(file, 1200, .85);
    const url = await uploadImg(blob, 'promos');
    const nueva = await apiFetch('POST', '/api/promociones', {
      restaurante_id: state.restaurante.id,
      imagen_url: url,
      activa: false, ...destinosDeNuevoDestacado(),
      programacion: {},
      orden: (state.promociones || []).length,
    });
    state.promociones = [...(state.promociones || []), nueva];
    pintarPromociones();
    if (destinoNuevoDestacado === 'tv' && typeof tvPintarImagenes === 'function') {
      tvPintarImagenes(); tvAlternarIntercalados();
    }
    closeModal('destacadoModal');
    estadoNuevoDestacado('');
    showToast('Destacado creado como borrador. Publícalo cuando esté listo.', 'success');
  } catch (e) {
    estadoNuevoDestacado(e.message || 'Error al añadir', 'var(--danger)');
    showToast('Error: ' + e.message, 'error');
  }
  input.value = '';
}

let promoCambiandoImagen = null;
function cambiarImagenDePromo(id) {
  promoCambiandoImagen = id;
  document.getElementById('promoCambioInput').click();
}

async function reemplazarImagenDePromo(input) {
  const file = input.files[0]; if (!file || !promoCambiandoImagen) return;
  const id = promoCambiandoImagen;
  try {
    const blob = await compressImage(file, 1200, .85);
    const url = await uploadImg(blob, 'promos');
    const data = await apiFetch('PATCH', `/api/promociones/${id}`, { imagen_url: url });
    const i = (state.promociones || []).findIndex(x => x.id === id);
    if (i >= 0 && data) state.promociones[i] = data;
    pintarPromociones();
    showToast('Imagen actualizada', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
  input.value = '';
  promoCambiandoImagen = null;
}

// La imagen del disco NO se borra: puede estar referenciada desde otra fila, y
// quien sabe si sobra es el limpiador, que mira las tablas enteras.
function eliminarPromo(id) {
  const p = (state.promociones || []).find(x => x.id === id);
  confirmDelete('promocion', id, (p && p.nombre) || 'este destacado');
}
