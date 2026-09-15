// La pestaña Estadísticas: rango de fechas, indicadores, gráfica de visitas,
// ranking de platos, carrito, horas y categorías, y cuándo los datos son
// demasiado pocos para concluir nada.
//
// Salió de public/index.html el 15/09/2026, paso 3 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace. El marcado de la pestaña sigue en index.html.
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// ── ESTADÍSTICAS ────────────────────────────────────────────────
let estadisticasCargadas = false;
let estadoRango = { tipo: '7', desde: null, hasta: null };
let vistaRanking = 'lista';
let ultimaEstadistica = null;

// Las fechas del selector son días del calendario del RESTAURANTE, no del
// navegador de quien mira el panel. toISOString() daba el día UTC: en
// Colombia, un dueño que abría "Hoy" a las 8 p. m. pedía el día siguiente y
// veía la gráfica vacía.
//
// Los días se manejan como fechas "flotantes" ancladas al mediodía UTC: así
// sumar o restar días nunca cruza de día por redondeo de zona.
//
// zonaRestaurante() vive con los horarios de categoría, arriba. Aquí había una
// SEGUNDA declaración con el mismo nombre, y las declaraciones de función se
// elevan: ganaba esta, así que era la que corría también en los horarios. Daban
// lo mismo —una devolvía ZONA_POR_DEFECTO y la otra el literal—, pero eso hacía
// que la constante pareciera la única fuente de verdad sin serlo: cambiarla no
// habría cambiado nada y no habría forma de entender por qué.

function fmtISO(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function diaFlotante(iso) { return new Date(`${iso}T12:00:00Z`); }

function hoyEnZona() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zonaRestaurante(), year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).map(x => [x.type, x.value])
  );
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, 12));
}

function seleccionarRango(tipo) {
  const hoy = hoyEnZona();
  if (tipo === 'custom') {
    const desde = document.getElementById('estDesde').value;
    const hasta = document.getElementById('estHasta').value;
    if (!desde || !hasta) return;
    estadoRango = { tipo: 'custom', desde, hasta };
  } else {
    let desde;
    if (tipo === 'hoy') desde = new Date(hoy);
    else if (tipo === 'todo') desde = new Date(Date.UTC(2020, 0, 1, 12));
    else { desde = new Date(hoy); desde.setUTCDate(desde.getUTCDate() - (parseInt(tipo, 10) - 1)); }
    estadoRango = { tipo, desde: fmtISO(desde), hasta: fmtISO(hoy) };
    document.getElementById('estDesde').value = estadoRango.desde;
    document.getElementById('estHasta').value = estadoRango.hasta;
  }
  document.querySelectorAll('#tabEstadisticas .cat-chip').forEach(c => c.classList.toggle('active', c.dataset.rango === estadoRango.tipo));
  cargarEstadisticas();
}

async function cargarEstadisticas() {
  try {
    const data = await apiFetch('GET', `/api/estadisticas?restaurante_id=${state.restaurante.id}&desde=${estadoRango.desde}&hasta=${estadoRango.hasta}`);
    ultimaEstadistica = data;
    avisoPocosDatos(data.totalVisitas);
    renderKpis(data);
    renderGraficaVisitas(data.visitasPorDia, estadoRango.desde, estadoRango.hasta);
    renderRanking(data.rankingProductos);
    renderHoras(data.porHora || []);
    renderCategorias(data.porCategoria || []);
    renderIgnorados(data.nuncaAbiertos || [], data.totalVisitas, platosQueSeAbren(), categoriasSinAbrir());
    renderCarrito(data);
  } catch (e) { showToast('Error cargando estadísticas', 'error'); }
}

// ── MÁS AGREGADOS AL CARRITO ──────────────────────────────────
// Solo aplica a los restaurantes con modelo carrito. En el resto no hay
// ningún evento de este tipo, así que la sección se esconde entera en vez
// de enseñar ceros que no significan nada.
function renderCarrito(data) {
  const card = document.getElementById('estCardCarrito');
  const cont = document.getElementById('estCarrito');
  const resumen = document.getElementById('estCarritoResumen');
  if (!card) return;

  const lista = data.masAgregados || [];
  if (!data.totalAgregados) { card.style.display = 'none'; return; }
  card.style.display = '';

  // La tasa se calcula sobre CLICS, no sobre visitas: una visita es una
  // carga de página y no una persona.
  //
  // Y solo con muestra (E2): con cinco fichas abiertas salía «100 %», un número
  // redondo que invita a concluir algo que cinco eventos no sostienen. Por
  // debajo se enseña el número absoluto y se calla el porcentaje.
  resumen.textContent = data.totalClics >= MIN_EVENTOS_PORCENTAJE
    ? `${data.totalAgregados} en total · ${data.tasaAnadido}% de las fichas abiertas`
    : `${data.totalAgregados} en total`;

  const max = lista[0]?.agregados || 1;
  cont.innerHTML = lista.slice(0, 10).map(p => {
    // Cuántas de las veces que se abrió acabó en el carrito. Un número bajo
    // con muchos clics señala un plato que llama la atención y no convence.
    const conversion = p.clics >= MIN_EVENTOS_PORCENTAJE ? Math.round(p.agregados / p.clics * 100) : null;
    return `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;gap:8px;">
        <span style="color:var(--text);">${esc(p.nombre)}</span>
        <span style="color:var(--text-muted);font-family:var(--mono);white-space:nowrap;">
          ${p.agregados}${conversion !== null ? ` · ${conversion}% de ${p.clics}` : ''}
        </span>
      </div>
      <div style="background:var(--card);border-radius:4px;height:10px;overflow:hidden;">
        <div style="background:var(--accent);height:100%;border-radius:4px;width:${Math.max(4, Math.round(p.agregados / max * 100))}%;"></div>
      </div>
    </div>`;
  }).join('');
}

// ── HORAS DE MAYOR TRÁFICO ────────────────────────────────────
// Las 24 horas siempre, aunque no haya datos en algunas: los huecos son
// justamente lo que enseña dónde están los picos.
function renderHoras(porHora) {
  const cont = document.getElementById('estChartHoras');
  if (!cont) return;
  const porNumero = Object.fromEntries(porHora.map(h => [h.hora, h]));
  const horas = Array.from({ length: 24 }, (_, h) => porNumero[h] || { hora: h, visitas: 0, clics: 0 });
  const max = Math.max(1, ...horas.map(h => h.visitas + h.clics));

  if (!porHora.length) { cont.innerHTML = '<div class="empty-state">Sin datos en este rango</div>'; return; }

  const pico = horas.reduce((a, b) => (b.visitas + b.clics) > (a.visitas + a.clics) ? b : a);
  const dosCifras = n => String(n).padStart(2, '0');

  cont.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:2px;height:110px;padding-bottom:4px;">
      ${horas.map(h => {
        const total = h.visitas + h.clics;
        const alto = total ? Math.max(4, Math.round(total / max * 100)) : 2;
        const esPico = h.hora === pico.hora && total > 0;
        return `<div title="${dosCifras(h.hora)}:00 — ${h.visitas} visita${h.visitas === 1 ? '' : 's'}, ${h.clics} clic${h.clics === 1 ? '' : 's'}"
          style="flex:1;height:${alto}%;min-height:2px;border-radius:3px 3px 0 0;background:${esPico ? 'var(--accent)' : 'var(--border)'};"></div>`;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;color:var(--text-dim);font-family:var(--mono);">
      <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text-muted);">
      Hora punta: <strong style="color:var(--accent)">${dosCifras(pico.hora)}:00</strong>
      · ${pico.visitas} visitas y ${pico.clics} clics
    </div>`;
}

// ── CATEGORÍAS MÁS MIRADAS ────────────────────────────────────
function renderCategorias(porCategoria) {
  const cont = document.getElementById('estCategorias');
  if (!cont) return;
  if (!porCategoria.length) { cont.innerHTML = '<div class="empty-state">Sin clics registrados en este rango</div>'; return; }
  const max = porCategoria[0].clics;
  cont.innerHTML = porCategoria.map(c => `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span style="color:var(--text);">${esc(c.emoji || '')} ${esc(c.nombre)}</span>
        <span style="color:var(--text-muted);font-family:var(--mono);">${c.clics}</span>
      </div>
      <div style="background:var(--card);border-radius:4px;height:10px;overflow:hidden;">
        <div style="background:var(--accent);height:100%;border-radius:4px;width:${Math.max(4, Math.round(c.clics / max * 100))}%;"></div>
      </div>
    </div>`).join('');
}

// ── PLATOS QUE NADIE ABRIÓ ────────────────────────────────────
// El dato más accionable de todos: dice qué sobra de la carta o qué está
// mal presentado. Solo cuenta lo que el cliente podía ver, así que un
// producto marcado como no disponible no aparece aquí.
//
// Pero se calcula por AUSENCIA, y eso necesita muestra. Con cero visitas «nadie
// lo abrió» es verdad para toda la carta (M6: a un restaurante recién creado le
// decía que su único plato era ignorado), y con 27 visitas sobre 97 platos que 86
// no se abran es aritmética, no una señal (B3). La regla: al menos una visita por
// plato disponible, y nunca menos de MIN_VISITAS_FIABLE.
function visitasParaIgnorados(platos) {
  return Math.max(MIN_VISITAS_FIABLE, platos);
}

function renderIgnorados(lista, totalVisitas = 0, platos = 0, sinAbrir = []) {
  const cont = document.getElementById('estIgnorados');
  const resumen = document.getElementById('estIgnoradosResumen');
  if (!cont) return;
  // B3: fuera las categorías marcadas «se pide sin abrir la ficha». El servidor
  // devuelve el NOMBRE de la categoría, no su id, y filtrar aquí evita cambiar la
  // función SQL; con el aviso de P3, dos categorías con el mismo nombre ya se ven.
  const fuera = new Set(sinAbrir);
  lista = lista.filter(p => !fuera.has(p.categoria));
  const nota = fuera.size
    ? ` · sin contar ${fuera.size === 1 ? `«${[...fuera][0]}»` : `${fuera.size} categorías que se piden sin abrir`}`
    : '';

  const hacenFalta = visitasParaIgnorados(platos);
  if (totalVisitas < hacenFalta) {
    resumen.textContent = '';
    cont.innerHTML = '';
    const vacio = document.createElement('div');
    vacio.className = 'empty-state';
    vacio.textContent = totalVisitas
      ? `Todavía no hay visitas suficientes para saberlo: hacen falta al menos ${hacenFalta} en el rango y hay ${totalVisitas}. Prueba con un rango más largo.`
      : 'Sin visitas en este rango.';
    cont.appendChild(vacio);
    return;
  }

  if (!lista.length) {
    resumen.textContent = '';
    cont.innerHTML = '<div class="empty-state">Todos los platos disponibles se abrieron al menos una vez</div>';
    return;
  }
  resumen.textContent = `${lista.length} en total${nota}`;

  const porCategoria = {};
  lista.forEach(p => { (porCategoria[p.categoria] ||= []).push(p.nombre); });

  cont.innerHTML = Object.entries(porCategoria).map(([cat, nombres]) => `
    <div style="padding:8px 4px;border-bottom:1px solid var(--border);">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px;">
        ${esc(cat)} · ${nombres.length}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${nombres.map(n => `<span style="font-size:12px;color:var(--text-muted);background:var(--card);border:1px solid var(--border);border-radius:6px;padding:3px 8px;">${esc(n)}</span>`).join('')}
      </div>
    </div>`).join('');
}

// ── CUÁNTO SE PUEDE CONCLUIR ───────────────────────────────────
// Los números de abajo salen de datos reales del 13/09/2026: el restaurante con
// más tráfico tenía 31 visitas en 7 días y 96 en 30, con 97 platos; el resto,
// entre 0 y 41 al mes. Por debajo de estos mínimos, un solo comensal curioso
// mueve los porcentajes lo que quiere.
const MIN_VISITAS_FIABLE = 30;
const MIN_EVENTOS_PORCENTAJE = 20;

function platosDisponibles() {
  return (state.productos || []).filter(p => p.disponible !== false).length;
}

// B3: las categorías que el restaurante marcó como «se pide sin abrir la ficha».
function categoriasSinAbrir() {
  return (state.categorias || []).filter(c => c.atributos?.se_pide_sin_abrir).map(c => c.nombre);
}

// Los platos con los que se mide si hay visitas suficientes: sin los de esas
// categorías, que ya no se listan. Si contaran, una carta con 40 bebidas
// seguiría pidiendo 40 visitas más para una lista que no las incluye.
function platosQueSeAbren() {
  const fuera = new Set((state.categorias || []).filter(c => c.atributos?.se_pide_sin_abrir).map(c => c.id));
  return (state.productos || []).filter(p => p.disponible !== false && !fuera.has(p.categoria_id)).length;
}

// E3. No se esconde nada: se dice cuánto pesa lo que se ve.
function avisoPocosDatos(totalVisitas) {
  const el = document.getElementById('estPocosDatos');
  if (!el) return;
  if (totalVisitas >= MIN_VISITAS_FIABLE) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent = totalVisitas
    ? `En este rango hay ${totalVisitas} visita${totalVisitas === 1 ? '' : 's'}. Con tan pocas, un solo cliente cambia mucho los números: tómalos como una pista, no como una conclusión. Un rango más largo da más datos.`
    : 'Tu carta todavía no tiene visitas en este rango. Las estadísticas se llenan a medida que tus clientes escanean el QR.';
}

// E1. Era «Tasa de interacción: 125 %»: una tasa con signo de porcentaje promete
// una proporción que no pasa de 100, y esto sí pasa en cuanto alguien mira dos
// platos. Peor aún cuando parece sano: «70 %» se leía como «el 70 % de mis
// clientes interactuó», y eran 0,7 clics por visita. Es el mismo dato, dicho
// como lo que es. Sin visitas no hay cociente que enseñar.
function clicsPorVisita(clics, visitas) {
  if (!visitas) return '—';
  return (clics / visitas).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function renderKpis(data) {
  const tile = (label, valor, color) => `
    <div class="section-card" style="text-align:center;padding:18px;">
      <div style="font-family:var(--mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">${label}</div>
      <div style="font-size:28px;font-weight:700;color:${color};">${valor}</div>
    </div>`;
  document.getElementById('estKpis').innerHTML =
    tile('Visitas', data.totalVisitas.toLocaleString('es-CO'), 'var(--text)') +
    tile('Clics en productos', data.totalClics.toLocaleString('es-CO'), 'var(--text)') +
    tile('Clics por visita', clicsPorVisita(data.totalClics, data.totalVisitas), 'var(--accent)');
}

// Cuántas barras caben antes de que la gráfica deje de decir nada. Con una
// por día, el rango "Todo" —que arranca en 2020— pinta hoy 2.431 barras: unos
// 41.000 px de desplazamiento horizontal que nadie va a recorrer.
//
// Pasado el tope se agrupan varios días por barra. Se prefiere agrupar a
// recortar el rango: la forma de la curva es justamente lo que se mira, y
// enseñar solo los últimos noventa días de un rango de tres años sería
// contestar otra pregunta.
const MAX_BARRAS_VISITAS = 92;

// Función pura y aparte del pintado para poder comprobarla: aquí es donde
// está la aritmética, y el resto es marcado.
//
// Devuelve las barras y cuántos días cubre cada una. El bucle avanza día a
// día pero solo guarda una entrada por barra, así que un rango absurdo
// —el selector de fecha acepta cualquier año— no llena la memoria ni revienta
// el `Math.max(...)` de abajo, que antes recibía un argumento por día.
function agruparVisitas(visitasPorDia, desde, hasta, maxBarras = MAX_BARRAS_VISITAS) {
  const ini = diaFlotante(desde), fin = diaFlotante(hasta);
  if (!(ini <= fin)) return { barras: [], porBarra: 0, invertido: true };

  const totalDias = Math.round((fin - ini) / 86400000) + 1;
  const porBarra = Math.max(1, Math.ceil(totalDias / maxBarras));

  const barras = [];
  const cur = new Date(ini);
  while (cur <= fin) {
    const desdeISO = fmtISO(cur);
    let hastaISO = desdeISO, visitas = 0;
    for (let i = 0; i < porBarra && cur <= fin; i++) {
      hastaISO = fmtISO(cur);
      visitas += visitasPorDia?.[hastaISO] || 0;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    barras.push({ desde: desdeISO, hasta: hastaISO, visitas });
  }
  return { barras, porBarra, invertido: false };
}

function renderGraficaVisitas(visitasPorDia, desde, hasta) {
  const cont = document.getElementById('estChartVisitas');
  if (!cont) return;

  const { barras, porBarra, invertido } = agruparVisitas(visitasPorDia, desde, hasta);
  if (invertido) {
    cont.innerHTML = '<div class="empty-state">La fecha de inicio es posterior a la de fin.</div>';
    return;
  }
  // Sin una sola visita eran barras mínimas de 3 px que parecían datos (E3).
  if (!barras.length || barras.every(b => !b.visitas)) { cont.innerHTML = '<div class="empty-state">Sin visitas en este rango</div>'; return; }

  const max = Math.max(1, ...barras.map(b => b.visitas));
  // Se formatea en UTC porque las fechas van ancladas al mediodía UTC: leerlas
  // en la zona del navegador podría mover la etiqueta un día.
  const corta = d => diaFlotante(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const rotulo = b => b.desde === b.hasta ? corta(b.desde) : `${corta(b.desde)} – ${corta(b.hasta)}`;

  cont.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:3px;height:120px;overflow-x:auto;padding-bottom:4px;">
      ${barras.map(b => {
        const alturaPct = Math.max(4, Math.round(b.visitas / max * 100));
        return `<div title="${esc(rotulo(b))}: ${b.visitas} visita${b.visitas === 1 ? '' : 's'}" style="flex-shrink:0;width:14px;height:${alturaPct}%;background:var(--accent);border-radius:3px 3px 0 0;min-height:3px;"></div>`;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;color:var(--text-dim);font-family:var(--mono);">
      <span>${esc(corta(barras[0].desde))}</span>
      ${porBarra > 1 ? `<span>cada barra: ${porBarra} días</span>` : ''}
      <span>${esc(corta(barras[barras.length - 1].hasta))}</span>
    </div>`;
}

function renderRanking(ranking) {
  const cont = document.getElementById('estRankingContenido');
  if (!ranking.length) { cont.innerHTML = '<div class="empty-state">Sin clics registrados en este rango</div>'; return; }

  if (vistaRanking === 'grafica') {
    const max = ranking[0].clics;
    cont.innerHTML = ranking.slice(0, 10).map(r => `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
          <span style="color:var(--text);">${esc(r.nombre)}</span>
          <span style="color:var(--text-muted);font-family:var(--mono);">${r.clics}</span>
        </div>
        <div style="background:var(--card);border-radius:4px;height:10px;overflow:hidden;">
          <div style="background:var(--accent);height:100%;border-radius:4px;width:${Math.max(4, Math.round(r.clics / max * 100))}%;"></div>
        </div>
      </div>`).join('');
  } else {
    cont.innerHTML = ranking.map((r, i) => `
      <div style="display:grid;grid-template-columns:32px 1fr 50px;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border);gap:8px;">
        <span style="color:var(--text-dim);font-family:var(--mono);font-size:12px;">#${i + 1}</span>
        <span style="color:var(--text);font-size:13px;">${esc(r.nombre)}</span>
        <span style="color:var(--accent);font-family:var(--mono);font-size:13px;text-align:right;">${r.clics}</span>
      </div>`).join('');
  }
}

function cambiarVistaRanking(v) {
  vistaRanking = v;
  document.getElementById('btnVistaGrafica').className = 'btn-sm' + (v === 'grafica' ? ' accent' : '');
  document.getElementById('btnVistaLista').className = 'btn-sm' + (v === 'lista' ? ' accent' : '');
  if (ultimaEstadistica) renderRanking(ultimaEstadistica.rankingProductos);
}
