// ── IMPRIMIR LA CARTA O GUARDARLA EN PDF ──────────────────────
// Pedido por el usuario el 18/09/2026, desde Inicio: una versión de la carta
// lista para imprimir o mandar a imprenta, como tienen otras plataformas.
//
// No se genera el PDF en el servidor. Se abre una vista previa en una ventana
// nueva, pensada para A4, y el botón de esa página abre el cuadro de impresión
// del navegador, que en todos los navegadores trae «Guardar como PDF». Así no
// hay librería de PDF que mantener, y lo que se imprime es lo que se ve.
//
// Decidido con el usuario:
//   · Con fotos por defecto, y un interruptor en la vista previa para quitarlas.
//     Sin fotos pasa a dos columnas: cabe más en cada hoja.
//   · En las cartas de video no se puede imprimir un video: sale la foto del
//     plato y, si no tiene, la portada de su video.
//   · Al final, el QR de la carta digital. Negro sobre blanco y sin logo, que
//     es lo que mejor se escanea en papel; el de la pestaña QR es para pantalla
//     y carteles, con sus colores.
//
// SEGURIDAD: la ventana se escribe desde el panel y comparte su origen, así que
// un nombre de plato con código dentro se ejecutaría con la sesión abierta.
// Todo lo que escribe el restaurante pasa por esc(), y el único script de la
// página es fijo, sin datos del restaurante dentro.

// Los mismos criterios que usa la carta (vmenus-app/core/loader.js,
// ORDEN_PRODUCTOS): el papel tiene que salir en el orden que ve el comensal.
const ORDEN_IMPRESO = {
  precio_asc:  (a, b) => (a.precio_numerico ?? 0) - (b.precio_numerico ?? 0),
  precio_desc: (a, b) => (b.precio_numerico ?? 0) - (a.precio_numerico ?? 0),
  nombre_az:   (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'),
  personalizado: (a, b) => ((a.orden ?? 0) - (b.orden ?? 0)) ||
    String(a.nombre).localeCompare(String(b.nombre), 'es'),
};

// Solo acepta direcciones http(s) o relativas al panel: el valor acaba en un
// atributo src, y cualquier otra cosa no es una foto.
function fotoImprimible(url) {
  const u = String(url || '');
  return /^(https?:\/\/|\/)/i.test(u) ? u : null;
}

// Qué sale en el papel y en qué orden. Pura, para probarla sin navegador.
//
// Solo platos disponibles —lo que no se puede pedir no va en una carta
// impresa, que además no se actualiza sola— y solo categorías con alguno.
// La foto respeta lo mismo que la carta: nada en una categoría de vista lista
// ni en un plato marcado «no lleva foto».
function cartaParaImprimir({ categorias = [], productos = [], atributos = {} } = {}) {
  const ordenar = ORDEN_IMPRESO[atributos.orden_productos] || ORDEN_IMPRESO.precio_asc;
  return [...categorias]
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map(cat => ({
      nombre: cat.nombre,
      emoji: cat.emoji || '',
      platos: productos
        .filter(p => p.categoria_id === cat.id && p.disponible !== false)
        .sort(ordenar)
        .map(p => ({
          nombre: p.nombre,
          descripcion: p.descripcion_avanzada || p.descripcion || '',
          precio: p.atributos?.precio_gratis === true ? 'Gratis' : formatPrecio(p.precio_numerico),
          foto: (cat.sin_fotos || p.atributos?.sin_foto === true) ? null
            : fotoImprimible(p.imagen_url) || fotoImprimible(p.atributos?.video?.portada),
        })),
    }))
    .filter(c => c.platos.length);
}

// El QR de la carta digital, como SVG. vendor/qrcode.js solo da la matriz.
function qrImpreso(enlace) {
  if (typeof qrcode !== 'function') return '';
  const qr = qrcode(0, 'M');
  qr.addData(enlace);
  qr.make();
  const n = qr.getModuleCount(), margen = 2, total = n + margen * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (qr.isDark(r, c)) d += `M${c + margen} ${r + margen}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// La página entera, como texto. Aparte de abrirla para poder probarla.
function paginaParaImprimir({ restaurante, secciones, enlace }) {
  const logo = fotoImprimible(restaurante.logo_url);
  const plato = p => `
      <div class="plato${p.foto ? ' con-foto' : ''}">
        ${p.foto ? `<img class="foto" src="${esc(p.foto)}" alt="">` : ''}
        <div class="texto">
          <div class="linea"><span class="nombre">${esc(p.nombre)}</span><span class="puntos"></span><span class="precio">${esc(p.precio)}</span></div>
          ${p.descripcion ? `<div class="descripcion">${esc(p.descripcion)}</div>` : ''}
        </div>
      </div>`;
  const seccion = s => `
    <section class="categoria">
      <h2>${s.emoji ? `<span class="emoji">${esc(s.emoji)}</span> ` : ''}${esc(s.nombre)}</h2>
      <div class="platos">${s.platos.map(plato).join('')}</div>
    </section>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carta · ${esc(restaurante.nombre)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #111; background: #f2f2f2; }
  .hoja { max-width: 190mm; margin: 0 auto; background: #fff; padding: 12mm; }
  .barra { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center;
    justify-content: center; padding: 12px 16px; background: #111; color: #fff; font: 14px system-ui, sans-serif; }
  .barra button { font: 600 14px system-ui, sans-serif; padding: 9px 16px; border-radius: 8px; border: 0; background: #3ecf8e; color: #062b1c; cursor: pointer; }
  .barra label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .barra .nota { color: #bbb; font-size: 12px; }
  header { text-align: center; margin-bottom: 8mm; }
  header img { max-height: 26mm; max-width: 60mm; object-fit: contain; }
  header h1 { margin: 3mm 0 0; font-size: 26pt; letter-spacing: .02em; }
  .categoria { margin-bottom: 7mm; }
  .categoria h2 { font-size: 15pt; margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 1.5px solid #111;
    text-transform: uppercase; letter-spacing: .06em; break-after: avoid; }
  .plato { display: flex; gap: 4mm; align-items: flex-start; margin-bottom: 3.2mm; break-inside: avoid; }
  .foto { width: 22mm; height: 22mm; object-fit: cover; border-radius: 2mm; flex: 0 0 auto; }
  .texto { flex: 1; min-width: 0; }
  .linea { display: flex; align-items: baseline; gap: 2mm; }
  .nombre { font-weight: bold; font-size: 11.5pt; }
  .puntos { flex: 1; border-bottom: 1px dotted #999; transform: translateY(-1mm); min-width: 6mm; }
  .precio { font-weight: bold; font-size: 11.5pt; white-space: nowrap; }
  .descripcion { font-size: 9.5pt; color: #444; margin-top: .8mm; line-height: 1.35; }
  /* Sin fotos: dos columnas, que es lo que cabe en una hoja de texto. */
  body.sin-fotos .foto { display: none; }
  body.sin-fotos .platos { column-count: 2; column-gap: 9mm; }
  footer { display: flex; align-items: center; justify-content: center; gap: 5mm; margin-top: 9mm;
    padding-top: 5mm; border-top: 1px solid #ccc; break-inside: avoid; }
  footer svg { width: 26mm; height: 26mm; }
  footer .qr-texto { font-size: 10pt; max-width: 70mm; }
  footer .qr-enlace { font-size: 8.5pt; color: #555; word-break: break-all; margin-top: 1mm; }
  @media print {
    body { background: #fff; }
    .barra { display: none; }
    .hoja { max-width: none; padding: 0; }
    img, svg { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @media (max-width: 600px) { .hoja { padding: 16px; } body.sin-fotos .platos { column-count: 1; } }
</style></head>
<body>
  <div class="barra">
    <button type="button" id="imprimir">🖨 Imprimir o guardar en PDF</button>
    <label><input type="checkbox" id="conFotos" checked> Con fotos</label>
    <span class="nota">En el cuadro de impresión, elige «Guardar como PDF» para descargarla.</span>
  </div>
  <div class="hoja">
    <header>
      ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
      <h1>${esc(restaurante.nombre)}</h1>
    </header>
    ${secciones.map(seccion).join('')}
    <footer>
      ${qrImpreso(enlace)}
      <div>
        <div class="qr-texto">Escanea para ver la carta digital, con fotos y precios al día.</div>
        <div class="qr-enlace">${esc(enlace)}</div>
      </div>
    </footer>
  </div>
  <script>
    document.getElementById('imprimir').onclick = function () { window.print(); };
    document.getElementById('conFotos').onchange = function () {
      document.body.classList.toggle('sin-fotos', !this.checked);
    };
  </script>
</body></html>`;
}

function imprimirCarta() {
  if (!state.restaurante) return;
  const secciones = cartaParaImprimir({
    categorias: state.categorias || [],
    productos: state.productos || [],
    atributos: state.restaurante.atributos || {},
  });
  if (!secciones.length) {
    showToast('Tu carta no tiene platos disponibles que imprimir.', 'error');
    return;
  }
  const html = paginaParaImprimir({
    restaurante: state.restaurante, secciones, enlace: urlPublica(state.restaurante),
  });
  // Primero, una pestaña nueva: es donde mejor se imprime, también en el móvil.
  // Se abre en blanco y se escribe después, en el mismo clic, para que el
  // bloqueador de ventanas emergentes la deje pasar.
  const ventana = window.open('', '_blank');
  if (ventana) {
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    return;
  }
  // Si el navegador la bloquea igual, la vista previa se abre dentro del panel.
  // Antes solo se avisaba, y eso dejaba al restaurante sin carta impresa hasta
  // que supiera cambiar un permiso del navegador.
  abrirImpresionEnElPanel(html);
}

function abrirImpresionEnElPanel(html) {
  cerrarImpresionEnElPanel();
  const capa = document.createElement('div');
  capa.id = 'capaImpresion';
  capa.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(0,0,0,.6);display:flex;flex-direction:column';
  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.textContent = '✕ Cerrar la vista previa';
  cerrar.style.cssText = 'align-self:flex-end;margin:8px;padding:8px 14px;border-radius:8px;border:0;cursor:pointer;font:600 13px system-ui,sans-serif';
  cerrar.onclick = cerrarImpresionEnElPanel;
  const marco = document.createElement('iframe');
  marco.title = 'Vista previa para imprimir';
  marco.style.cssText = 'flex:1;border:0;background:#fff';
  // srcdoc y no un documento escrito a mano: es la forma directa de meter la
  // página, y el botón de imprimir de dentro imprime solo el marco.
  marco.srcdoc = html;
  capa.append(cerrar, marco);
  document.body.appendChild(capa);
  document.body.style.overflow = 'hidden';
  cerrar.focus();
}

function cerrarImpresionEnElPanel() {
  const capa = document.getElementById('capaImpresion');
  if (!capa) return;
  capa.remove();
  if (!document.querySelector('.modal-bg.open')) document.body.style.overflow = '';
}
