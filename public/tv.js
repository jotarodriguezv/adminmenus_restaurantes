// La pestaña TV: la cartelera para los televisores del local.
//
// Salió de public/index.html el 15/09/2026, paso 3 de partirlo por pestañas
// (CLAUDE.md, «Partir public/index.html»). Se movió tal cual, sin cambiar lo
// que hace. El marcado de la pestaña sigue en index.html.
//
// Se carga con un <script> clásico antes del script principal, como comun.js,
// y comparte con él las declaraciones de nivel superior: no se puede repetir
// aquí un nombre que ya exista en otro archivo del panel.

// ── PANTALLA TV (cartelera para televisores) ───────────────────
// Pestaña propia y no dentro de Apariencia: es otro servicio, no una opción
// de la carta. La configuración vive en atributos.tv y la lee tv.html del
// repositorio público.
//
// Que la clave 'tv' exista es lo ÚNICO que enciende la cartelera: sin ella,
// tv.html deja la pantalla en reposo. El servidor filtra esa clave por plan,
// así que esconder esta pestaña no es la protección — es solo cortesía.
const TV_POR_DEFECTO = { activa: false, orientacion: 'horizontal', por_slide: 2,
                         segundos: 8, modo: 'todos', categoria_id: null,
                         productos: [], aleatorio: false, animacion: 'suave',
                         mostrar_categoria: false, color_categoria: 'oscuro',
                         tema: 'oscuro',
                         // Por defecto SÍ, que es lo que hacía la cartelera
                         // antes de existir esta clave.
                         respetar_horarios: true };

let tvSeleccion = [];   // ids de platos, cuando el modo es 'manual'
let tvFiltro = 'all';   // categoría que se está mirando en el selector

// Solo los platos que la cartelera puede enseñar. Sin foto no hay slide: es un
// medio visual y un hueco gris se ve peor que un plato de menos, así que aquí
// tampoco se ofrecen — elegir uno que no va a salir es una trampa.
function tvPlatosPosibles() {
  return (state.productos || []).filter(p => p.disponible && p.imagen_url);
}

function renderTV() {
  const cfg = { ...TV_POR_DEFECTO, ...(state.restaurante?.atributos?.tv || {}) };
  tvSeleccion = Array.isArray(cfg.productos) ? [...cfg.productos] : [];

  document.getElementById('tvActiva').checked = !!cfg.activa;
  document.getElementById('tvModo').value = cfg.modo || 'todos';
  document.getElementById('tvOrientacion').value = cfg.orientacion === 'vertical' ? 'vertical' : 'horizontal';
  document.getElementById('tvPorSlide').value = String(Math.min(4, Math.max(1, parseInt(cfg.por_slide, 10) || 2)));
  document.getElementById('tvSegundos').value = Math.min(60, Math.max(4, parseInt(cfg.segundos, 10) || 8));
  document.getElementById('tvAleatorio').checked = !!cfg.aleatorio;
  document.getElementById('tvAnimacion').checked = cfg.animacion !== 'ninguna';
  document.getElementById('tvMostrarCategoria').checked = !!cfg.mostrar_categoria;
  document.getElementById('tvColorCategoria').value =
    ['oscuro', 'claro', 'marca'].includes(cfg.color_categoria) ? cfg.color_categoria : 'oscuro';
  document.getElementById('tvTema').value = cfg.tema === 'carta' ? 'carta' : 'oscuro';
  // '!== false' y no '!!': quien no tenga la clave guardada tiene que salir
  // encendido, que es lo que su cartelera lleva haciendo desde siempre.
  document.getElementById('tvRespetarHorarios').checked = cfg.respetar_horarios !== false;
  tvPintarNotaHorarios();
  tvProgs = Array.isArray(cfg.programaciones) ? JSON.parse(JSON.stringify(cfg.programaciones)) : [];
  tvPintarProgramaciones();
  tvPintarImagenes();
  // La promoción son columnas del restaurante, no de atributos.tv: las mismas
  // que ya usa la pestaña de Promoción. Aquí solo se decide si entran en la
  // rotación del televisor y cada cuánto, que es otra decisión.
  // Lo guardado es 'atributos.tv.intercalados'. Quien no haya vuelto a guardar
  // desde este cambio no lo tiene: se arma desde las columnas de siempre, que
  // es exactamente lo que hace tv.html. Las dos lecturas tienen que coincidir.
  const guardados = Array.isArray(cfg.intercalados) && cfg.intercalados.length
    ? cfg.intercalados
    : ((state.promociones || []).some(p => p.en_tv) || state.restaurante?.promo_en_tv
      ? [{ tipo: 'promocion' }] : []);
  const laMarca = guardados.filter(i => i && i.tipo === 'marca')[0] || {};

  document.getElementById('tvIntercalaPromo').checked = guardados.some(i => i && i.tipo === 'promocion');
  document.getElementById('tvIntercalaMarca').checked = !!guardados.filter(i => i && i.tipo === 'marca').length;
  document.getElementById('tvMarcaLogo').checked = !!laMarca.logo;
  document.getElementById('tvMarcaFrase').value = laMarca.frase || '';
  document.getElementById('tvOrdenIntercalados').value =
    (guardados[0] && guardados[0].tipo === 'marca') ? 'marca' : 'promocion';

  // 'cada' es del televisor y manda sobre cualquier intercalado, no solo sobre
  // la promoción. 'promo_cada' queda de respaldo para quien no haya guardado.
  const cadaGuardado = parseInt(cfg.cada, 10) || parseInt(state.restaurante?.promo_cada, 10);
  document.getElementById('tvCada').value =
    String([2, 3, 4, 6, 8].includes(cadaGuardado) ? cadaGuardado : 4);
  document.getElementById('tvEnlace').value = urlPublica(state.restaurante) + '/tv';
  document.getElementById('tvStatus').textContent = '';

  // Solo categorías con platos que la cartelera pueda enseñar.
  const sel = document.getElementById('tvCategoria');
  const posibles = tvPlatosPosibles();
  sel.innerHTML = '';
  (state.categorias || []).forEach(c => {
    const n = posibles.filter(p => p.categoria_id === c.id).length;
    if (!n) return;
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.emoji || ''} ${c.nombre}`.trim() + ` (${n})`;
    sel.appendChild(o);
  });
  if (cfg.categoria_id) sel.value = cfg.categoria_id;

  tvFiltro = 'all';
  tvPintarFiltroCat();
  tvPintarPlatos();
  tvPintarMarcarTodos();
  tvAlternarActiva();
  tvAlternarCategoria();
  tvPintarTema();
  tvAlternarIntercalados();
  tvCambiarModo();
  tvAvisoTamano();
  tvPintarAhora();
}

function tvAlternarActiva() {
  const on = document.getElementById('tvActiva').checked;
  document.getElementById('tvCuerpo').style.display = on ? 'block' : 'none';
  document.getElementById('tvAjustes').style.display = on ? 'block' : 'none';
  tvPintarAhora();
}

// El color de la etiqueta de categoría. Tres presets y no un selector libre:
// un selector libre deja elegir gris sobre gris, y esto acaba colgado en una
// pared donde nadie lo va a volver a mirar.
//
// Los valores están copiados de vmenus-app/tv.html a propósito. Esa página no
// puede importar nada de aquí —corre en televisores de 2018, sin módulos ES, y
// además vive en el otro repositorio— así que la muestra de al lado es un
// espejo escrito a mano, no la misma función. Ninguna prueba puede comparar los
// dos: están en repositorios distintos. Al tocar uno hay que tocar el otro, y
// si se desincronizan el restaurante ve un color en el panel y otro en la
// pared. Es la misma clase de espejo que PLANES; está anotado en
// docs/pantalla-tv.md.
const TV_COLOR_CATEGORIA = {
  oscuro: { fondo: 'rgba(10, 10, 15, 0.62)', texto: '#e8e8ee' },
  claro:  { fondo: 'rgba(255, 255, 255, 0.88)', texto: '#14131c' },
};

// Espejo de paletaCategoria() en vmenus-app/tv.html.
function tvPaletaCategoria(valor, colorPrimario) {
  if (valor === 'claro') return TV_COLOR_CATEGORIA.claro;
  if (valor !== 'marca') return TV_COLOR_CATEGORIA.oscuro;

  const h = String(colorPrimario || '').replace('#', '');
  const seis = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  if (!/^[0-9a-fA-F]{6}$/.test(seis)) return null;   // null = no hay color guardado

  const r = parseInt(seis.slice(0, 2), 16);
  const g = parseInt(seis.slice(2, 4), 16);
  const b = parseInt(seis.slice(4, 6), 16);
  // Brillo percibido: el ojo pesa el verde seis veces más que el azul. Decide
  // si encima va texto negro o blanco. Hay cartas en amarillo y cartas en
  // azul marino, y ninguna de las dos combinaciones sirve para las dos.
  const brillo = (r * 299 + g * 587 + b * 114) / 1000;
  return { fondo: `rgba(${r}, ${g}, ${b}, 0.9)`, texto: brillo > 145 ? '#14131c' : '#ffffff' };
}

function tvPintarMuestraCategoria() {
  const valor = document.getElementById('tvColorCategoria').value;
  const pal = tvPaletaCategoria(valor, state.restaurante?.color_primario);
  const muestra = document.getElementById('tvMuestraCategoria');
  const aviso = document.getElementById('tvAvisoColorCategoria');
  // Sin color guardado no se inventa uno: la cartelera vuelve al oscuro, y
  // aquí se dice, en vez de enseñar una muestra que no es lo que se va a ver.
  const efectiva = pal || TV_COLOR_CATEGORIA.oscuro;
  muestra.style.background = efectiva.fondo;
  muestra.style.color = efectiva.texto;
  aviso.textContent = pal ? '' :
    'Tu carta todavía no tiene un color guardado, así que la etiqueta saldrá oscura. ' +
    'Se configura en Apariencia.';
}

function tvAlternarCategoria() {
  const on = document.getElementById('tvMostrarCategoria').checked;
  document.getElementById('tvColorCategoriaFila').style.display = on ? 'block' : 'none';
  tvPintarMuestraCategoria();
}

// Los colores de la página entera. La cartelera no repite aquí el cálculo de
// tv.html —aclarar un color oscuro hasta que se lea es cosa suya— porque
// enseñar aquí una muestra que no coincida sería peor que no enseñar ninguna.
// Lo que sí se hace es decir qué va a tomar y de dónde.
function tvPintarTema() {
  const carta = document.getElementById('tvTema').value === 'carta';
  document.getElementById('tvTemaAyuda').textContent = carta
    ? 'Toma el fondo y los colores que tienes en Apariencia: el precio de cada plato ' +
      'sale en tu color, y el fondo negro se tiñe muy suavemente. Si tu color es oscuro, ' +
      'la pantalla lo aclara lo justo para que el precio se lea desde el fondo del local.'
    : 'Fondo negro y precios en amarillo, igual para todos los restaurantes.';
}

// La promoción del televisor. Reutiliza la que ya está en la pestaña de
// Promoción: pedirle una segunda imagen sería pedirle el mismo trabajo dos
// veces. Lo que se decide aquí es solo si entra en la rotación y cada cuánto.
// ── LO QUE SE INTERCALA ENTRE LAS PANTALLAS DE PLATOS ─────────
//
// Antes solo cabía la promoción, con su propia frecuencia. Ahora es una lista
// ordenada que rota por UN SOLO ritmo: cada N pantallas de platos entra el
// siguiente elemento, y al acabar la lista se vuelve a empezar.
//
// Un ritmo por tipo —el logo cada 3 y la promoción cada 4— se pelearía por la
// pantalla 12, y el restaurante no podría predecir qué ve mirando esto. Con la
// lista el coste además se VE: añadir la marca le quita la mitad de los turnos
// a la promoción, en vez de diluirla a escondidas. Y la promoción es la que
// vende.
//
// Lo que se guarda es la lista, no las dos casillas: el día que haya un tipo
// más, ni tv.html ni los datos cambian. Lo que aquí no se construye es el
// editor de N entradas —dos veces "marca" para tener el logo y la frase en
// pantallas separadas, por ejemplo—; con dos tipos, ordenar es solo decir cuál
// va primero, y una lista con flechas para eso es más interfaz de la que el
// problema pide, sobre todo en un móvil.
function tvIntercaladosDelFormulario() {
  const lista = [];
  const conPromo = document.getElementById('tvIntercalaPromo')?.checked;
  const conMarca = document.getElementById('tvIntercalaMarca')?.checked;
  const marca = { tipo: 'marca',
                  logo: !!document.getElementById('tvMarcaLogo')?.checked,
                  frase: (document.getElementById('tvMarcaFrase')?.value || '').trim() };

  // Una marca sin logo y sin frase no es una pantalla: no se guarda aunque el
  // interruptor esté encendido, porque guardarla pintaría un hueco negro.
  const marcaVale = conMarca && (marca.logo || marca.frase);
  const primero = document.getElementById('tvOrdenIntercalados')?.value;

  if (marcaVale && primero === 'marca') lista.push(marca);
  if (conPromo) lista.push({ tipo: 'promocion' });
  if (marcaVale && primero !== 'marca') lista.push(marca);
  return lista;
}

// Encender "Mi marca" sin nada dentro era un estado muerto: el interruptor
// decía que sí, no se guardaba nada y la pantalla no salía. Lo que se quiere al
// marcarlo es enseñar la marca, y la marca es el logo, así que se enciende
// solo. Quien quiera la frase sola lo apaga después.
//
// Va en su propio manejador y no dentro de tvAlternarIntercalados porque ahí lo
// llaman también el logo y la frase: encenderlo desde allí impediría apagar el
// logo nunca.
function tvAlternarMarca() {
  const marca = document.getElementById('tvIntercalaMarca');
  const logo = document.getElementById('tvMarcaLogo');
  const frase = document.getElementById('tvMarcaFrase');
  if (marca.checked && !logo.checked && !frase.value.trim()) logo.checked = true;
  tvAlternarIntercalados();
}

function tvAlternarIntercalados() {
  const conPromo = document.getElementById('tvIntercalaPromo').checked;
  const conMarca = document.getElementById('tvIntercalaMarca').checked;
  document.getElementById('tvMarcaOpciones').style.display = conMarca ? 'block' : 'none';

  const lista = tvIntercaladosDelFormulario();
  document.getElementById('tvCadaFila').style.display = lista.length ? 'block' : 'none';
  // Ordenar solo tiene sentido con dos cosas que ordenar.
  document.getElementById('tvOrdenFila').style.display = lista.length > 1 ? 'block' : 'none';

  // Se avisa de lo que falta en vez de bloquear el interruptor: la promoción se
  // configura en otra pestaña y puede llegar después.
  // Se mira la TABLA, no las columnas viejas: desde el 05/09/2026 una
  // promoción puede estar marcada para el televisor sin estarlo para la carta,
  // y al revés. Contar solo las que sirven aquí es lo que hace que el aviso
  // diga algo cierto.
  const ayuda = document.getElementById('tvPromoAyuda');
  const paraTv = (state.promociones || []).filter(p => p.en_tv);
  const encendidas = paraTv.filter(p => p.activa);
  if (!(state.promociones || []).length) {
    ayuda.textContent = 'Todavía no has creado ningún destacado. Se crean en la ' +
                        'pestaña Destacados, y hasta entonces esto no muestra nada.';
    ayuda.style.color = 'var(--warn)';
  } else if (!paraTv.length) {
    ayuda.textContent = 'Ninguno de tus destacados está marcado «En el televisor». ' +
                        'Se marca en la pestaña Destacados.';
    ayuda.style.color = 'var(--warn)';
  } else if (!encendidas.length) {
    ayuda.textContent = 'Tus destacados del televisor están en borrador, así que tampoco ' +
                        'saldrán aquí.';
    ayuda.style.color = 'var(--warn)';
  } else {
    ayuda.textContent = encendidas.length === 1
      ? 'Tu destacado sale a pantalla completa cada tantas pantallas de platos.'
      : `Tus ${encendidas.length} destacados del televisor se van turnando en ese hueco.`;
    ayuda.style.color = 'var(--text-dim)';
  }

  // Marcar el logo sin haberlo subido es la trampa evidente: la casilla dice
  // que sí y la pantalla no enseña nada.
  const mAyuda = document.getElementById('tvMarcaAyuda');
  const quiereLogo = document.getElementById('tvMarcaLogo').checked;
  if (conMarca && quiereLogo && !state.restaurante?.logo_url) {
    mAyuda.textContent = 'Todavía no has subido tu logo. Se sube en Apariencia, y hasta ' +
                         'entonces esta pantalla sale solo con la frase.';
    mAyuda.style.color = 'var(--warn)';
  } else if (conMarca && !quiereLogo && !document.getElementById('tvMarcaFrase').value.trim()) {
    mAyuda.textContent = 'Incluye tu logo o escribe una frase: así como está no hay pantalla que enseñar, y no deja guardar.';
    mAyuda.style.color = 'var(--warn)';
  } else {
    mAyuda.textContent = '';
  }

  tvPintarResumen();
}

// La secuencia escrita tal cual se va a ver. Un restaurante no tiene por qué
// deducir de "cada 4" y dos casillas qué sale en qué momento.
// Qué se va a ver, dicho como pasa de verdad.
//
// La versión anterior dibujaba la secuencia DENTRO de una vuelta, y eso se leía
// mal en el caso más común: con seis pantallas de platos y una intercalada cada
// cuatro solo cabe una por vuelta, así que enseñaba "platos ×4 → PROMOCIÓN" y
// daba a entender que la marca no salía. Sale — en la vuelta siguiente.
function tvPintarSecuencia(pantallas) {
  const el = document.getElementById('tvSecuencia');
  if (!el) return;
  const lista = tvIntercaladosVisibles();
  const cada = tvCada();
  if (!lista.length || !pantallas) { el.textContent = ''; return; }

  const huecos = Math.floor(pantallas / cada);
  if (!huecos) { el.textContent = ''; return; }   // de eso avisa el resumen

  const nombre = it => it.tipo === 'promocion' ? 'tu destacado' : 'tu marca';

  if (lista.length === 1) {
    el.textContent = 'Sale ' + nombre(lista[0]) + ' cada ' + cada + ' pantallas de platos.';
    return;
  }
  if (huecos >= lista.length) {
    el.textContent = 'Cada vuelta salen las ' + lista.length + ': ' +
                     lista.map(nombre).join(' y luego ') + '.';
    return;
  }
  // El caso que se leía mal: no caben todas en una vuelta, así que se turnan.
  el.textContent = 'Cabe' + (huecos === 1 ? '' : 'n') + ' ' + huecos +
    ' por vuelta, así que se van turnando: esta vuelta ' +
    lista.slice(0, huecos).map(nombre).join(' y ') +
    ', la siguiente ' + nombre(lista[huecos % lista.length]) + '.';
}

// Los que la cartelera va a poder pintar de verdad. Una promoción apagada no
// ocupa turno, y contarla prometería una vuelta más larga de la que se ve en la
// pared. Es el mismo filtro que hace listaIntercalados() en tv.html.
function tvDestacadosVisibles() {
  const zona = zonaRestaurante();
  const todas = state.promociones || [];
  const vivas = todas.filter(p =>
    p && p.activa && p.en_tv && p.imagen_url && vigenteAhora(programacionDe(p), zona));
  // Respaldo para una cartelera guardada antes de la tabla de destacados.
  if (!todas.length && state.restaurante?.promo_activa && state.restaurante?.promo_imagen_url)
    return [{ imagen_url: state.restaurante.promo_imagen_url }];
  const programadas = vivas.filter(p => tieneProgramacion(programacionDe(p)));
  return programadas.length ? programadas : vivas.filter(p => !tieneProgramacion(programacionDe(p)));
}

function tvIntercaladosVisibles() {
  return tvIntercaladosDelFormulario().filter(it =>
    it.tipo === 'promocion'
      ? tvDestacadosVisibles().length > 0
      : (it.frase || (it.logo && !!state.restaurante?.logo_url)));
}

function tvCada() {
  const v = parseInt(document.getElementById('tvCada')?.value, 10);
  return (v && v > 0) ? v : 4;
}

// Qué implica el interruptor, dicho en los dos sentidos. Encendido no es
// "nada": es una regla que está actuando y que se configura en OTRA pestaña,
// que es justo la clase de cosa que nadie descubre solo.
function tvPintarNotaHorarios() {
  const el = document.getElementById('tvNotaHorarios');
  if (!el) return;
  const detalle = document.getElementById('tvCategoriasHorario');
  const on = document.getElementById('tvRespetarHorarios').checked;
  const conHorario = (state.categorias || []).filter(c => tieneProgramacion(c?.atributos?.horario));
  el.textContent = on
    ? 'Si una categoría solo se ve de 07:00 a 11:00, sus platos desaparecen de la ' +
      'cartelera fuera de esa franja, igual que de la carta. Se configura en Categorías.'
    : 'La cartelera enseña todos los platos, aunque su categoría esté fuera de horario. ' +
      'La carta del QR sigue respetándolos: esto solo cambia el televisor.';
  el.style.color = on ? 'var(--text-muted)' : 'var(--text-dim)';
  if (detalle) {
    detalle.innerHTML = '';
    detalle.style.display = on && conHorario.length ? 'block' : 'none';
    if (on && conHorario.length) {
      const titulo = document.createElement('div');
      titulo.className = 'tv-categorias-horario-titulo';
      titulo.textContent = 'Categorías con horario';
      detalle.appendChild(titulo);
      for (const categoria of conHorario) {
        const fila = document.createElement('div');
        fila.className = 'tv-categoria-horario';
        const nombre = document.createElement('strong');
        nombre.textContent = categoria.nombre;
        const horario = document.createElement('span');
        horario.textContent = ' · ' + describirHorario(categoria.atributos.horario);
        const estado = vigenteAhora(categoria.atributos.horario, zonaRestaurante())
          ? ' · ahora visible en la cartelera' : ' · ahora oculta en la cartelera';
        fila.append(nombre, horario, document.createTextNode(estado));
        detalle.appendChild(fila);
      }
    }
  }
  tvPintarResumen();
  tvPintarAhora();
}

// ── LAS IMÁGENES SUELTAS DE LA PANTALLA ───────────────────────
// Son promociones con 'en_tv'. No hay un tipo nuevo ni una tabla nueva: lo que
// faltaba era que se pudieran ver y crear DESDE AQUÍ, que es donde se buscan.
function tvPintarImagenes() {
  const cont = document.getElementById('tvImagenes');
  if (!cont) return;
  cont.innerHTML = '';
  const suyas = (state.promociones || []).filter(p => p.en_tv);
  if (!suyas.length) {
    const vacio = document.createElement('div');
    vacio.style.cssText = 'font-size:12px;color:var(--text-dim);border:1px dashed var(--border2);' +
                          'border-radius:8px;padding:14px;text-align:center;width:100%';
    vacio.textContent = 'Ninguna todavía.';
    cont.appendChild(vacio);
    return;
  }
  for (const p of suyas) {
    const caja = document.createElement('div');
    caja.style.cssText = 'width:120px';
    const img = document.createElement('img');
    img.src = p.imagen_url;
    img.style.cssText = 'width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid ' +
                        (p.activa ? 'var(--border)' : 'var(--danger)') + ';opacity:' + (p.activa ? '1' : '.5');
    const pie = document.createElement('div');
    pie.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:4px;line-height:1.4';
    // Se dice si está apagada o fuera de su horario: una miniatura que está ahí
    // pero no sale es justo lo que hace pensar que algo se rompió.
    const h = programacionDe(p);
    pie.textContent = !p.activa ? 'Borrador'
      : !tieneProgramacion(h) ? 'Siempre'
      : (vigenteAhora(h, zonaRestaurante()) ? 'Ahora sí' : 'Ahora no');
    caja.appendChild(img);
    caja.appendChild(pie);
    cont.appendChild(caja);
  }
}

// ── PROGRAMACIONES DE LA CARTELERA ────────────────────────────
// Excepciones con horario a la selección base. Manda la PRIMERA vigente, que es
// como lo resuelve tv.html: el orden lo pone el restaurante y se ve aquí. Una
// regla de "la más específica" habría que deducirla, y con dos solapadas nadie
// sabría explicar por qué salió una.
//
// Esta primera versión ofrece "todos los platos" o "una categoría". La lista
// manual se queda solo en la selección base a propósito: su selector es uno
// global y pensado para una sola selección, y montar uno por excepción es
// mucha interfaz para un caso que todavía nadie ha pedido. Los ejemplos que
// motivaron esto —desayunos por la mañana, almuerzos al mediodía— son todos
// de categoría.
let tvProgs = [];

function tvNuevaProgramacion() {
  tvProgs.push({ programacion: { activo: true, dias: [], desde: '', hasta: '',
                                 desde_fecha: '', hasta_fecha: '' },
                 modo: 'categoria', categoria_id: null });
  tvPintarProgramaciones();
  tvPintarResumen();
  const cont = document.getElementById('tvProgramaciones');
  const nueva = cont?.lastElementChild;
  if (nueva) {
    nueva.classList.add('tv-programacion-nueva');
    nueva.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nueva.querySelector('.tp-modo')?.focus();
  }
}

function tvPintarProgramaciones() {
  const cont = document.getElementById('tvProgramaciones');
  const vacio = document.getElementById('tvProgVacio');
  if (!cont) return;
  cont.innerHTML = '';
  vacio.style.display = tvProgs.length ? 'none' : 'block';
  tvProgs.forEach((pr, i) => cont.appendChild(tvTarjetaDeProgramacion(pr, i)));
}

function tvTarjetaDeProgramacion(pr, indice) {
  const caja = document.createElement('div');
  caja.className = 'tv-programacion';
  caja.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px';

  caja.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="tp-orden" style="font-family:var(--mono);font-size:10px;color:var(--accent)"></span>
      <select class="form-input tp-modo" style="max-width:190px">
        <option value="todos">Todos los platos</option>
        <option value="categoria">Una categoría</option>
        <option value="manual">Platos sueltos</option>
      </select>
      <select class="form-input tp-cat" style="max-width:220px"></select>
      <button type="button" class="btn-sm tp-elegir">Elegir platos</button>
      <div style="flex:1"></div>
      <button type="button" class="btn-sm tp-subir" title="Subir">↑</button>
      <button type="button" class="btn-sm tp-bajar" title="Bajar">↓</button>
      <button type="button" class="tp-borrar" style="padding:6px 10px;border-radius:6px;
        border:1px solid var(--danger);background:transparent;color:var(--danger);
        font-family:var(--mono);font-size:9px;cursor:pointer">🗑</button>
    </div>
    <div class="tp-rejilla" style="display:none;margin-bottom:12px">
      <div class="tp-platos" style="display:flex;flex-wrap:wrap;gap:10px;max-height:300px;overflow-y:auto;padding:4px"></div>
      <div class="tp-cuantos" style="font-size:11px;color:var(--text-dim);margin-top:8px"></div>
    </div>

    <!-- Sumar en vez de reemplazar. "Los martes añadimos alitas a las
         hamburguesas" es otra petición distinta de "los martes solo alitas". -->
    <div class="form-check" style="margin-bottom:10px">
      <label class="toggle"><input type="checkbox" class="tp-mezclar"><span class="toggle-slider"></span></label>
      <span style="font-size:12px;color:var(--text-muted)">Añadir a lo de siempre en vez de reemplazarlo</span>
    </div>

    <label class="form-label">Días</label>
    <div class="tp-dias" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
    <div class="form-row" style="margin-bottom:4px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Desde</label><span class="tp-desde-hueco"></span>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Hasta</label><span class="tp-hasta-hueco"></span>
      </div>
    </div>
    <div class="form-row" style="margin-bottom:0">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Empieza el <span style="color:var(--text-dim)">(opcional)</span></label>
        <input type="date" class="form-input tp-desdef">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Termina el <span style="color:var(--text-dim)">(opcional)</span></label>
        <input type="date" class="form-input tp-hastaf">
      </div>
    </div>
    <div class="tp-nota" style="margin-top:10px;font-size:11px;line-height:1.6"></div>`;

  const q = c => caja.querySelector('.' + c);
  const h = pr.programacion || {};

  q('tp-orden').textContent = (indice + 1) + '.º';
  q('tp-modo').value = pr.modo === 'todos' ? 'todos' : 'categoria';

  const cat = q('tp-cat');
  for (const c of state.categorias || []) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.nombre;
    cat.appendChild(o);
  }
  cat.value = pr.categoria_id || (state.categorias?.[0]?.id ?? '');
  q('tp-mezclar').checked = !!pr.mezclar;

  // La lista vive en el propio objeto de la excepción: la rejilla la muta en
  // el sitio, así que no hay que copiarla de vuelta al guardar.
  if (!Array.isArray(pr.productos)) pr.productos = [];

  const pintarRejilla = () => {
    tvRejillaDePlatos(q('tp-platos'), pr.productos, 'all', () => { pintarRejilla(); leer(); });
    const n = pr.productos.length;
    q('tp-cuantos').textContent = n
      ? `${n} plato${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'}`
      : 'Ninguno marcado: sin platos, esta excepción no enseñaría nada.';
    q('tp-cuantos').style.color = n ? 'var(--text-dim)' : 'var(--warn)';
  };

  const ajustarControles = () => {
    const m = q('tp-modo').value;
    cat.style.display = m === 'categoria' ? '' : 'none';
    q('tp-elegir').style.display = m === 'manual' ? '' : 'none';
    if (m !== 'manual') q('tp-rejilla').style.display = 'none';
  };
  ajustarControles();

  const selDesde = selectorDeHora('tp-desde', h.desde || '');
  const selHasta = selectorDeHora('tp-hasta', h.hasta || '');
  q('tp-desde-hueco').replaceWith(selDesde);
  q('tp-hasta-hueco').replaceWith(selHasta);
  q('tp-desdef').value = h.desde_fecha || '';
  q('tp-hastaf').value = h.hasta_fecha || '';
  abrirCalendarioAlPulsar(q('tp-desdef'));
  abrirCalendarioAlPulsar(q('tp-hastaf'));

  const elegidos = new Set(Array.isArray(h.dias) ? h.dias : []);
  const pintarDias = () => {
    const cont = q('tp-dias');
    cont.innerHTML = '';
    for (const d of DIAS_PROMO) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (elegidos.has(d) ? ' active' : '');
      b.style.cssText = 'min-width:38px;text-align:center;padding:7px 10px';
      b.textContent = DIAS_CORTOS[d];
      b.title = DIAS_LARGOS[d];
      b.onclick = () => { elegidos.has(d) ? elegidos.delete(d) : elegidos.add(d); pintarDias(); leer(); };
      cont.appendChild(b);
    }
  };

  // Lee la tarjeta al estado y repinta la nota. Se guarda en tvProgs en cada
  // cambio y no solo al pulsar Guardar: el resumen de arriba y la nota de aquí
  // tienen que hablar del mismo dato.
  const leer = () => {
    pr.modo = q('tp-modo').value;
    pr.categoria_id = pr.modo === 'categoria' ? (q('tp-cat').value || null) : null;
    pr.mezclar = q('tp-mezclar').checked;
    pr.programacion = {
      activo: true,
      dias: [...elegidos].sort(),
      desde: q('tp-desde').value || '',
      hasta: q('tp-hasta').value || '',
      desde_fecha: q('tp-desdef').value || '',
      hasta_fecha: q('tp-hastaf').value || '',
    };
    ajustarControles();
    nota();
    tvPintarResumen();
  };

  const nota = () => {
    const el = q('tp-nota');
    const h2 = pr.programacion;
    // Sin nada marcado sería vigente siempre y taparía la selección base para
    // siempre. tv.html se la salta a propósito; aquí hay que decir por qué.
    if (!tieneProgramacion(h2)) {
      el.textContent = 'Sin días, horas ni fechas esta excepción no se aplica: ' +
                       'taparía siempre a lo de arriba y nadie sabría por qué.';
      el.style.color = 'var(--warn)'; return;
    }
    const que = pr.modo === 'todos' ? 'todos los platos'
      : pr.modo === 'manual'
        ? `${pr.productos.length} plato${pr.productos.length === 1 ? '' : 's'} sueltos`
        : (state.categorias || []).find(c => c.id === pr.categoria_id)?.nombre || 'una categoría';
    const partes = [describirHorario(h2)];
    if (h2.desde_fecha || h2.hasta_fecha)
      partes.push('· del ' + (h2.desde_fecha || '…') + ' al ' + (h2.hasta_fecha || '…'));
    const ahora = vigenteAhora(h2, zonaRestaurante());
    el.textContent = `${partes.join(' ')} → ${pr.mezclar ? 'lo de siempre + ' : ''}${que}` +
                     (ahora ? ' · ahora mismo manda esta' : '');
    el.style.color = ahora ? 'var(--success)' : 'var(--text-dim)';
  };

  pintarDias(); nota();
  for (const c of ['tp-modo', 'tp-cat', 'tp-mezclar', 'tp-desde', 'tp-hasta', 'tp-desdef', 'tp-hastaf'])
    q(c).onchange = leer;
  q('tp-elegir').onclick = () => {
    const r = q('tp-rejilla');
    const abierta = r.style.display !== 'none';
    r.style.display = abierta ? 'none' : 'block';
    if (!abierta) pintarRejilla();
  };
  q('tp-subir').onclick = () => tvMoverProgramacion(indice, -1);
  q('tp-bajar').onclick = () => tvMoverProgramacion(indice, 1);
  q('tp-borrar').onclick = () => {
    tvProgs.splice(indice, 1);
    tvPintarProgramaciones();
    tvPintarResumen();
  };
  return caja;
}

// El orden decide cuál manda cuando dos se solapan, así que moverlas tiene que
// ser tan fácil como marcarlas.
function tvMoverProgramacion(i, paso, lista = tvProgs) {
  const j = i + paso;
  if (j < 0 || j >= lista.length) return lista;
  const t = lista[i]; lista[i] = lista[j]; lista[j] = t;
  tvPintarProgramaciones();
  return lista;
}

// Solo las que dicen algo. Una entrada sin horario se descarta al guardar por
// la misma razón que tv.html se la salta: sería vigente siempre.
function tvProgramacionesParaGuardar(lista = tvProgs) {
  return lista
    .filter(pr => tieneProgramacion(pr.programacion))
    // 'productos' solo tiene sentido en el modo manual. Guardarlo en los otros
    // dejaría una lista que nadie lee y que confunde al leer la fila a mano.
    .map(pr => ({
      programacion: pr.programacion,
      modo: pr.modo,
      categoria_id: pr.modo === 'categoria' ? pr.categoria_id : null,
      productos: pr.modo === 'manual' ? (pr.productos || []) : [],
      mezclar: !!pr.mezclar,
    }));
}

function tvCambiarModo() {
  const modo = document.getElementById('tvModo').value;
  document.getElementById('tvCategoriaWrap').style.display = modo === 'categoria' ? 'block' : 'none';
  document.getElementById('tvManualWrap').style.display = modo === 'manual' ? 'block' : 'none';
  tvPintarResumen();
}

// Los chips de categoría del selector. Filtran lo que se VE, no lo que está
// marcado: cambiar de categoría no puede perderle al restaurante lo que ya
// eligió en otra, que es el susto obvio al pulsar aquí.
function tvPintarFiltroCat() {
  const cont = document.getElementById('tvFiltroCat');
  if (!cont) return;
  cont.innerHTML = '';
  const posibles = tvPlatosPosibles();
  const conPlatos = (state.categorias || []).filter(c => posibles.some(p => p.categoria_id === c.id));
  // Con una sola categoría el filtro no filtra nada; estorba más que ayuda.
  if (conPlatos.length < 2) return;

  const chip = (id, etiqueta, n) => {
    const b = document.createElement('button');
    b.type = 'button';
    const activo = tvFiltro === id;
    const marcados = id === 'all'
      ? tvSeleccion.length
      : posibles.filter(p => p.categoria_id === id && tvSeleccion.includes(p.id)).length;
    b.style.cssText =
      'padding:5px 11px;border-radius:14px;cursor:pointer;font-size:11.5px;font-family:inherit;' +
      'transition:all .15s;border:1px solid ' + (activo ? 'var(--accent)' : 'var(--border)') + ';' +
      'background:' + (activo ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent') + ';' +
      'color:' + (activo ? 'var(--accent)' : 'var(--text-muted)') + ';';
    // El contador de marcados es lo que evita tener que recorrer categoría por
    // categoría para saber qué se lleva elegido.
    b.textContent = etiqueta + ' ' + (marcados ? `(${marcados}/${n})` : `(${n})`);
    b.onclick = () => { tvFiltro = id; tvPintarFiltroCat(); tvPintarPlatos(); tvPintarMarcarTodos(); };
    return b;
  };

  cont.appendChild(chip('all', 'Todas', posibles.length));
  conPlatos.forEach(c => {
    const n = posibles.filter(p => p.categoria_id === c.id).length;
    cont.appendChild(chip(c.id, `${c.emoji || ''} ${c.nombre}`.trim(), n));
  });
}

// El botón de marcar o quitar toda la categoría que se está mirando. Con diez
// hamburguesas, marcarlas una a una para enseñarlas todas es trabajo tonto.
//
// Es un solo botón que cambia de sentido: si ya están todas marcadas ofrece
// quitarlas. Dos botones —marcar y quitar— obligan a mirar cuál toca; uno que
// dice lo que va a hacer, no.
function tvPintarMarcarTodos() {
  const cont = document.getElementById('tvMarcarTodos');
  if (!cont) return;
  cont.innerHTML = '';
  const todos = tvPlatosPosibles();
  const visibles = tvFiltro === 'all' ? todos : todos.filter(p => p.categoria_id === tvFiltro);
  if (!visibles.length) return;

  const marcados = visibles.filter(p => tvSeleccion.includes(p.id)).length;
  const todasPuestas = marcados === visibles.length;
  const donde = tvFiltro === 'all' ? 'los platos' : 'esta categoría';

  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-sm';
  b.textContent = todasPuestas ? `Quitar ${donde} (${visibles.length})` : `Marcar todos ${donde} (${visibles.length})`;
  b.onclick = () => {
    if (todasPuestas) {
      tvSeleccion = tvSeleccion.filter(id => !visibles.some(p => p.id === id));
    } else {
      visibles.forEach(p => { if (!tvSeleccion.includes(p.id)) tvSeleccion.push(p.id); });
    }
    tvPintarPlatos();
    tvPintarFiltroCat();
    tvPintarMarcarTodos();
    tvPintarResumen();
  };
  cont.appendChild(b);
}

// ── LA REJILLA DE PLATOS, REUTILIZABLE ────────────────────────
// Antes pintaba siempre en #tvPlatos y escribía siempre en tvSeleccion. Ahora
// recibe dónde pintar, qué lista tocar y qué hacer después, para que cada
// excepción de horario pueda elegir sus propios platos sin una segunda copia de
// esta rejilla — que es como se acaban comportando distinto sin que nadie sepa
// por qué.
function tvRejillaDePlatos(cont, seleccion, filtro, alCambiar) {
  cont.innerHTML = '';
  const todos = tvPlatosPosibles();
  if (!todos.length) {
    cont.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">Ningún plato tiene foto todavía. La cartelera solo puede mostrar platos con fotografía.</span>';
    return;
  }
  const posibles = filtro === 'all' ? todos : todos.filter(p => p.categoria_id === filtro);
  posibles.forEach(p => {
    const marcado = seleccion.includes(p.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText =
      'width:112px;padding:0;border-radius:10px;cursor:pointer;overflow:hidden;text-align:left;' +
      'font-family:inherit;background:var(--card);transition:all .15s;border:2px solid ' +
      (marcado ? 'var(--accent)' : 'var(--border)') + ';' +
      'opacity:' + (marcado ? '1' : '.62') + ';';
    // Marcado con innerHTML pero sin datos dentro: el nombre se pone después
    // con textContent, que es donde estaría el riesgo.
    b.innerHTML = '<div style="height:74px;background:#16151f center/cover no-repeat"></div>' +
                  '<div style="padding:6px 7px;font-size:10.5px;line-height:1.25;height:38px;overflow:hidden"></div>';
    b.firstChild.style.backgroundImage = `url("${String(p.imagen_url).replace(/"/g, '%22')}")`;
    b.lastChild.textContent = p.nombre || '';
    b.onclick = () => {
      const i = seleccion.indexOf(p.id);
      if (i === -1) seleccion.push(p.id); else seleccion.splice(i, 1);
      alCambiar();
    };
    cont.appendChild(b);
  });
}

function tvPintarPlatos() {
  tvRejillaDePlatos(document.getElementById('tvPlatos'), tvSeleccion, tvFiltro, () => {
    tvPintarPlatos();
    tvPintarFiltroCat();
    tvPintarMarcarTodos();
    tvPintarResumen();
  });

  // Cuántos hay marcados en total. Filtrando por categoría es fácil perder de
  // vista que quedan otros elegidos fuera de lo que se está mirando.
  const pie = document.getElementById('tvSeleccionados');
  if (pie) {
    const n = tvSeleccion.length;
    pie.textContent = n
      ? `${n} plato${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'} en total` +
        (tvFiltro !== 'all' ? ', contando los de otras categorías' : '')
      : 'Ninguno marcado todavía';
  }
}

// Cuántos platos va a enseñar de verdad. Es la cuenta que evita la llamada
// de "puse la tele y no sale nada": si aquí dice 0, no va a salir nada.
function tvCuantos() {
  const modo = document.getElementById('tvModo').value;
  const posibles = tvPlatosPosibles();
  if (modo === 'categoria') {
    const cat = document.getElementById('tvCategoria').value;
    return posibles.filter(p => p.categoria_id === cat).length;
  }
  if (modo === 'manual') return posibles.filter(p => tvSeleccion.includes(p.id)).length;
  return posibles.length;
}

// La pregunta real no es solo cómo quedó configurada la pantalla, sino qué
// está mostrando ahora. Las excepciones ya dicen cuál manda en su tarjeta;
// este resumen lo junta con la selección base y los destacados intercalados.
function tvPintarAhora() {
  const el = document.getElementById('tvAhoraTexto');
  if (!el) return;
  if (!document.getElementById('tvActiva').checked) {
    el.textContent = 'La cartelera está apagada.';
    return;
  }
  const vigente = (tvProgs || []).find(pr =>
    tieneProgramacion(pr.programacion) && vigenteAhora(pr.programacion, zonaRestaurante()));
  const modo = vigente?.modo || document.getElementById('tvModo').value;
  const categoriaId = vigente?.categoria_id || document.getElementById('tvCategoria').value;
  const categoria = (state.categorias || []).find(c => c.id === categoriaId)?.nombre;
  const contenido = modo === 'todos' ? 'toda la carta'
    : modo === 'manual' ? `${(vigente?.productos || tvSeleccion || []).length} platos elegidos`
    : (categoria || 'una categoría');
  const destacados = tvDestacadosVisibles().length;
  el.textContent = (vigente ? 'Está aplicando un horario: ' : 'Está usando la selección base: ') +
    contenido + '. ' + (destacados
      ? `${destacados} destacado${destacados === 1 ? '' : 's'} entra${destacados === 1 ? '' : 'n'} en la rotación.`
      : 'No hay destacados intercalados vigentes ahora.');
}

function tvPintarResumen() {
  const n = tvCuantos();
  const el = document.getElementById('tvResumen');
  if (!n) {
    el.textContent = '⚠ Con esto la pantalla no mostraría ningún plato: saldría solo tu logo.';
    el.style.color = 'var(--warn)';
    tvPintarSecuencia(0);
    tvPintarAhora();
    return;
  }
  const porSlide = parseInt(document.getElementById('tvPorSlide').value, 10) || 1;
  const seg = Math.min(60, Math.max(4, parseInt(document.getElementById('tvSegundos').value, 10) || 8));
  const pantallas = Math.ceil(n / porSlide);

  // Los intercalados alargan la vuelta: si no se cuentan, el resumen miente.
  const lista = tvIntercaladosVisibles();
  const cada = tvCada();
  const dePromo = lista.length ? Math.floor(pantallas / cada) : 0;

  tvPintarSecuencia(pantallas);

  const vueltas = (pantallas + dePromo) * seg;
  const min = Math.floor(vueltas / 60), s = vueltas % 60;

  const partes = [`${n} plato${n === 1 ? '' : 's'} · ${pantallas} pantalla${pantallas === 1 ? '' : 's'}` +
    (dePromo ? ` + ${dePromo} intercalada${dePromo === 1 ? '' : 's'}` : '') + ' · ' +
    'la vuelta dura ' + (min ? `${min} min ${s ? s + ' s' : ''}`.trim() : `${s} s`)];

  // Encender la promoción y que no salga nunca porque el ciclo es más corto
  // que la frecuencia es exactamente el tipo de cosa que se descubre con la
  // tele puesta.
  if (lista.length && !dePromo) {
    partes.push(`Con ${pantallas} pantalla${pantallas === 1 ? '' : 's'} de platos y una intercalada cada ${cada}, ` +
                'no llegaría a salir nunca: baja ese número.');
  }

  // Menos platos que huecos. No es un fallo —salen más grandes y llenan igual—
  // pero elegir "4 a la vez" y ver dos descoloca si nadie lo avisa.
  if (n < porSlide) {
    partes.push(`Solo hay ${n}, así que se verán ${n} a la vez aunque elijas ${porSlide}. ` +
                'Salen más grandes y llenan la pantalla igual.');
  }

  // Un ciclo de una o dos pantallas se repite muy rápido y se nota. Barajar no
  // añade platos, pero cambia las parejas en cada vuelta y disimula el bucle.
  const aleatorio = document.getElementById('tvAleatorio');
  if (pantallas <= 2 && n > porSlide && aleatorio && !aleatorio.checked) {
    partes.push('Con tan pocas pantallas el ciclo se nota mucho: prueba a encender el orden aleatorio.');
  }

  el.textContent = partes.join(' · ');
  el.style.color = partes.length > 1 ? 'var(--warn)' : 'var(--text-muted)';
  tvPintarAhora();
}

// Las fotos se guardan a 800 px de ancho. Repartidas entre dos o más platos
// eso sobra; ocupando un televisor entero, se nota. Vale más decirlo aquí que
// dejar que lo descubra con la tele puesta delante de los clientes.
function tvAvisoTamano() {
  const el = document.getElementById('tvAvisoTamano');
  const uno = document.getElementById('tvPorSlide').value === '1';
  el.style.display = uno ? 'block' : 'none';
  el.textContent = uno
    ? '⚠ Con un plato por pantalla la foto se ve a tamaño completo y puede salir algo borrosa en televisores grandes. Míralo en tu televisor antes de dejarlo así.'
    : '';
  tvPintarResumen();
}

function tvCopiarEnlace() {
  const enlace = document.getElementById('tvEnlace').value;
  navigator.clipboard.writeText(enlace)
    .then(() => showToast('Enlace copiado', 'success'))
    .catch(() => showToast('No se pudo copiar', 'error'));
}

function tvAbrir() { window.open(document.getElementById('tvEnlace').value, '_blank'); }

// ── LA VISTA PREVIA DE LA CARTELERA ───────────────────────────
// Un televisor son 1280×720 (o 720×1280 en vertical). Se pinta a ese tamaño y
// se encoge con transform: así las proporciones son las de la pantalla real y
// no las de un hueco inventado. Escalar el iframe por su ancho en vez de
// encogerlo daría una cartelera con otras proporciones, y lo que se está
// mirando aquí es justo si algo cabe o no.
const TV_ANCHO_PREVIA = 560;

function tvMedidasDePrevia() {
  const vertical = document.getElementById('tvOrientacion')?.value === 'vertical';
  const w = vertical ? 720 : 1280;
  const h = vertical ? 1280 : 720;
  // En vertical, 560 de ancho daría casi mil de alto: se limita por altura.
  const escala = vertical ? Math.min(TV_ANCHO_PREVIA / w, 420 / h) : TV_ANCHO_PREVIA / w;
  return { w, h, escala };
}

function tvPintarMedidasDePrevia() {
  const marco = document.getElementById('tvPreviaCaja');
  const marcoIframe = document.getElementById('tvPrevia');
  if (!marco || !marcoIframe) return;
  const { w, h, escala } = tvMedidasDePrevia();
  marcoIframe.style.width = w + 'px';
  marcoIframe.style.height = h + 'px';
  marcoIframe.style.transform = 'scale(' + escala + ')';
  // La caja se queda con el tamaño ya encogido; si no, dejaría un hueco
  // enorme debajo, porque el iframe sigue midiendo 720 px para el diseño.
  marco.style.width = Math.round(w * escala) + 'px';
  marco.style.height = Math.round(h * escala) + 'px';
}

function tvAlternarVistaPrevia() {
  const marco = document.getElementById('tvPreviaMarco');
  const boton = document.getElementById('btnVistaPrevia');
  const recargar = document.getElementById('btnRecargarPrevia');
  const abierta = marco.style.display !== 'none';

  if (abierta) {
    // Cerrar VACÍA el iframe, no lo esconde. Escondido seguiría rotando,
    // pidiendo fotos y sondeando Supabase cada cinco minutos detrás de una
    // pestaña que nadie mira.
    document.getElementById('tvPrevia').src = 'about:blank';
    marco.style.display = 'none';
    recargar.style.display = 'none';
    boton.textContent = 'Ver cómo está quedando';
    return;
  }
  marco.style.display = 'block';
  recargar.style.display = '';
  boton.textContent = 'Ocultar vista previa';
  tvPintarMedidasDePrevia();
  tvRecargarVistaPrevia();
}

function tvRecargarVistaPrevia() {
  const marco = document.getElementById('tvPreviaMarco');
  if (!marco || marco.style.display === 'none') return;
  tvPintarMedidasDePrevia();
  // El parámetro con la hora fuerza una carga nueva: sin él, cambiar el src al
  // mismo valor no vuelve a pedir nada y la vista previa se quedaría con la
  // configuración anterior justo después de guardar.
  const base = document.getElementById('tvEnlace').value;
  if (base) document.getElementById('tvPrevia').src = base + '?v=' + Date.now();
}

// Lo que se guarda de la cartelera. Aparte de saveTV porque es también con lo
// que se mide si la pestaña tiene cambios sin guardar (switchTab): medirlo con
// otra cosa avisaría de cambios que al guardar no cambian nada.
function tvDelFormulario() {
  const modo = document.getElementById('tvModo').value;
  return {
    activa: document.getElementById('tvActiva').checked,
    orientacion: document.getElementById('tvOrientacion').value,
    por_slide: parseInt(document.getElementById('tvPorSlide').value, 10) || 2,
    segundos: Math.min(60, Math.max(4, parseInt(document.getElementById('tvSegundos').value, 10) || 8)),
    modo,
    categoria_id: modo === 'categoria' ? (document.getElementById('tvCategoria').value || null) : null,
    productos: modo === 'manual' ? tvSeleccion : [],
    aleatorio: document.getElementById('tvAleatorio').checked,
    animacion: document.getElementById('tvAnimacion').checked ? 'suave' : 'ninguna',
    mostrar_categoria: document.getElementById('tvMostrarCategoria').checked,
    color_categoria: document.getElementById('tvColorCategoria').value,
    tema: document.getElementById('tvTema').value,
    respetar_horarios: document.getElementById('tvRespetarHorarios').checked,
    programaciones: tvProgramacionesParaGuardar(),
    // La lista manda sobre las columnas de siempre. 'promo_cada' ya no se
    // escribe: el ritmo es del televisor, no de la promoción, y tv.html solo lo
    // lee de respaldo mientras queden restaurantes sin volver a guardar.
    cada: tvCada(),
    intercalados: tvIntercaladosDelFormulario(),
  };
}

async function saveTV() {
  const st = document.getElementById('tvStatus');
  const activa = document.getElementById('tvActiva').checked;

  // Encender una cartelera que no va a mostrar nada deja al restaurante con un
  // televisor enseñando su logo y sin saber por qué. Se avisa antes, no después.
  if (activa && !tvCuantos()) {
    showToast('Con esa selección no se mostraría ningún plato', 'error');
    st.textContent = 'Revisa qué platos se muestran'; st.style.color = 'var(--danger)';
    return;
  }

  // Lo mismo con la pantalla de marca. Antes esto SÍ se guardaba: la entrada se
  // descartaba en silencio, el interruptor se quedaba encendido y en el
  // televisor no salía nada. Quien lo veía no tenía forma de saber por qué, y
  // el interruptor encendido decía justo lo contrario de lo que pasaba.
  if (document.getElementById('tvIntercalaMarca').checked &&
      !document.getElementById('tvMarcaLogo').checked &&
      !document.getElementById('tvMarcaFrase').value.trim()) {
    showToast('La pantalla de marca necesita el logo o una frase', 'error');
    st.textContent = 'Incluye tu logo o escribe una frase';
    st.style.color = 'var(--danger)';
    return;
  }

  const tv = tvDelFormulario();

  // De 'atributos', solo su clave: el servidor funde. Ver recolectarAjustes.
  //
  // 'promo_en_tv' sigue siendo columna del restaurante y se deriva de la lista,
  // no de una casilla aparte: así no pueden discrepar. Es una propiedad de la
  // PROMOCIÓN —"esta promoción puede salir en el televisor"—, que es lo que
  // será 'promociones.en_tv' cuando haya varias (docs/promociones.md §5.1), y
  // además es de lo que se entera la pestaña Promoción para avisar.
  //
  // 'promo_cada' ya NO se escribe. El ritmo es del televisor, no de la
  // promoción: manda sobre cualquier intercalado. Queda en la tabla como
  // respaldo de lectura para las pantallas de quien todavía no haya guardado.
  const cuerpo = {
    atributos: { tv },
    promo_en_tv: tv.intercalados.some(i => i.tipo === 'promocion'),
  };
  try {
    const data = await apiFetch('PATCH', `/api/restaurantes/${state.restaurante.id}`, cuerpo);
    if (data) state.restaurante = data;
    document.getElementById('tvSegundos').value = tv.segundos;
    fijarFotoDePestana('tv');
    st.textContent = '✓ Guardado'; st.style.color = 'var(--success)';
    showToast('Pantalla TV guardada', 'success');
    // Lo que se acaba de guardar es lo que la cartelera va a leer, así que la
    // vista previa se recarga sola: pedirle al usuario que pulse dos botones
    // para ver su propio cambio es la clase de paso que nadie da.
    tvRecargarVistaPrevia();
  } catch (e) {
    st.textContent = 'Error al guardar'; st.style.color = 'var(--danger)';
    showToast('Error: ' + e.message, 'error');
  }
}
