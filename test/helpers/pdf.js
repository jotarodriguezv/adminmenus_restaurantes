'use strict';
// Construye PDF mínimos para las pruebas de lectorpdf.js.
//
// Se generan a mano y no se guardan archivos de ejemplo en el repositorio por
// dos motivos: las cartas reales son de restaurantes clientes y pesan decenas
// de megas, y sobre todo porque aquí hace falta poder construir el caso EXACTO
// —una fuente en subconjunto con este desplazamiento y no otro— que un archivo
// de verdad no deja elegir.

const zlib = require('zlib');

// Un objeto con stream. El /Length tiene que ser exacto: es lo que usa el
// lector para saber dónde acaba, justamente para no depender de buscar la
// palabra 'endstream' dentro de datos binarios.
function conStream(dic, datos, comprimido = false) {
  const crudos = Buffer.isBuffer(datos) ? datos : Buffer.from(datos, 'latin1');
  const bytes = comprimido ? zlib.deflateSync(crudos) : crudos;
  const filtro = comprimido ? ' /Filter /FlateDecode' : '';
  return Buffer.concat([
    Buffer.from(`<< ${dic}${filtro} /Length ${bytes.length} >>\nstream\n`, 'latin1'),
    bytes,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

// `cuerpos` es una lista de cadenas o Buffers; el objeto N es cuerpos[N - 1].
function construir(cuerpos, raiz = 1) {
  const partes = [Buffer.from('%PDF-1.7\n', 'latin1')];
  cuerpos.forEach((cuerpo, i) => {
    partes.push(Buffer.from(`${i + 1} 0 obj\n`, 'latin1'));
    partes.push(Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo), 'latin1'));
    partes.push(Buffer.from('\nendobj\n', 'latin1'));
  });
  partes.push(Buffer.from(`trailer\n<< /Root ${raiz} 0 R >>\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

// Una CMap /ToUnicode que desplaza todos los códigos una cantidad fija, que es
// exactamente lo que hace una fuente en subconjunto. Con `salto` = 0x1D se
// reproduce el caso real de la carta de A Ojo Cerrado.
function cmapDesplazada(salto) {
  const base = (0x20 + salto).toString(16).padStart(4, '0');
  return [
    '/CIDInit /ProcSet findresource begin',
    '1 begincmap',
    '1 beginbfrange',
    `<20> <7e> <${base}>`,
    'endbfrange',
    'endcmap end',
  ].join('\n');
}

function cmapUnoAUno(pares) {
  const lineas = pares.map(([codigo, caracter]) =>
    `<${codigo.toString(16).padStart(2, '0')}> <${caracter.codePointAt(0).toString(16).padStart(4, '0')}>`);
  return `1 beginbfchar\n${lineas.join('\n')}\nendbfchar`;
}

// Una página con su fuente y, si se pide, su tabla /ToUnicode.
//
//   1 catálogo · 2 nodo /Pages · 3 página · 4 contenido · 5 fuente · 6 CMap
function unaPagina(contenido, cmap = null, opciones = {}) {
  const fuente = cmap
    ? '<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Prueba /ToUnicode 6 0 R >>'
    : '<< /Type /Font /Subtype /TrueType /BaseFont /Helvetica >>';

  const cuerpos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R '
      + '/Resources << /XObject << /Im0 9 0 R >> /Font << /F1 5 0 R >> >> >>',
    conStream('', contenido, !!opciones.comprimido),
    fuente,
  ];
  if (cmap) cuerpos.push(conStream('', cmap));
  return construir(cuerpos);
}

// Un stream de objetos: así guardan los generadores modernos los objetos
// pequeños. Los desplazamientos se calculan aquí para que una prueba no
// dependa de haberlos contado a mano.
function objStm(entradas) {
  let cuerpo = '';
  const pares = [];
  for (const [num, texto] of entradas) {
    pares.push(num, cuerpo.length);
    cuerpo += texto + ' ';
  }
  const cabecera = pares.join(' ') + ' ';
  return conStream(`/Type /ObjStm /N ${entradas.length} /First ${cabecera.length}`, cabecera + cuerpo, true);
}

module.exports = { conStream, construir, cmapDesplazada, cmapUnoAUno, unaPagina, objStm };
