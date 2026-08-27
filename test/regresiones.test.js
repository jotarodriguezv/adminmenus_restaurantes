// Regresiones de la revisión del 27/08/2026.
//
// Cada bloque de aquí corresponde a un fallo que estaba en producción y se
// arregló ese día. Van juntos y no repartidos por los otros ficheros a
// propósito: lo que tienen en común no es el módulo que tocan sino que los
// seis se descubrieron leyendo, no fallando. Ninguno rompía una prueba.
//
// Se prueban contra el server.js REAL por HTTP, como el resto de api.test.js:
// tres de ellos —el envoltorio de las rutas async, el dueño de un archivo, la
// travesía de rutas— viven en el enrutado o en el orden de las
// comprobaciones, y una prueba de la función suelta no los habría visto.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const S = require('./helpers/servidor.js');

describe('01 · un throw en una ruta async ya no mata el proceso', () => {
  test('POST /api/categorias sin nombre contesta 500 en vez de caerse', async () => {
    S.reiniciar();
    S.conTabla(() => ({ data: { atributos: {} }, error: null }));
    const r = await S.pedir('POST', '/api/categorias',
      { restaurante_id: S.IDS.restaurante }, S.tokenCliente);
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.body.error, /toLowerCase|undefined/, 'sin filtrar la excepción');
    // Y lo que de verdad importa: el servidor sigue en pie.
    const sigue = await S.pedir('GET', '/api/productos?restaurante_id=' + S.IDS.restaurante, null, S.tokenCliente);
    assert.notEqual(sigue.status, undefined);
  });

  test('GET /api/estadisticas con una fecha inválida tampoco', async () => {
    S.reiniciar();
    S.conTabla(() => ({ data: { atributos: {} }, error: null }));
    const r = await S.pedir('GET',
      `/api/estadisticas?restaurante_id=${S.IDS.restaurante}&desde=basura&hasta=basura`, null, S.tokenCliente);
    assert.equal(r.status, 500);
    const sigue = await S.pedir('GET', '/api/productos?restaurante_id=' + S.IDS.restaurante, null, S.tokenCliente);
    assert.notEqual(sigue.status, undefined);
  });
});

describe('02 · borrar un archivo comprueba de quién es', () => {
  const dir = path.join(__dirname, '..', 'uploads', 'productos');
  test('no se puede borrar un archivo de otro restaurante', async () => {
    S.reiniciar();
    fs.mkdirSync(dir, { recursive: true });
    const nombre = 'verif-ajeno.jpg';
    fs.writeFileSync(path.join(dir, nombre), 'x');
    // La foto la referencia OTRO restaurante.
    S.conTabla(st => st.tabla === 'productos'
      ? { data: [{ restaurante_id: 'otro-resto', imagen_url: `http://localhost/uploads/productos/${nombre}` }], error: null }
      : { data: [], error: null });
    const r = await S.pedir('DELETE', `/api/upload/productos/${nombre}`, null, S.tokenCliente);
    assert.equal(r.status, 403);
    assert.equal(fs.existsSync(path.join(dir, nombre)), true, 'el archivo ajeno sigue ahí');
    fs.unlinkSync(path.join(dir, nombre));
  });

  test('una subida que no ha guardado nadie sí se puede borrar', async () => {
    S.reiniciar();
    fs.mkdirSync(dir, { recursive: true });
    const nombre = 'verif-huerfano.jpg';
    fs.writeFileSync(path.join(dir, nombre), 'x');
    S.conTabla(() => ({ data: [], error: null }));   // nadie lo referencia
    const r = await S.pedir('DELETE', `/api/upload/productos/${nombre}`, null, S.tokenCliente);
    assert.equal(r.status, 200);
    assert.equal(fs.existsSync(path.join(dir, nombre)), false);
  });

  test('las carpetas del worker no se tocan por HTTP', async () => {
    S.reiniciar();
    const r = await S.pedir('DELETE', '/api/upload/masters/loquesea.mp4', null, S.tokenCliente);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Carpeta inválida/);
  });
});

describe('03 · borrar un plato no sale de uploads/', () => {
  test('una imagen_url con ../ no borra nada fuera', async () => {
    S.reiniciar();
    const centinela = path.join(__dirname, '..', 'CENTINELA-no-borrar.txt');
    fs.writeFileSync(centinela, 'sigo aquí');
    S.conTabla(st => st.tabla === 'productos' && st.op === 'select'
      ? { data: { restaurante_id: S.IDS.restaurante, imagen_url: 'http://x/uploads/../CENTINELA-no-borrar.txt' }, error: null }
      : { data: null, error: null });
    const r = await S.pedir('DELETE', `/api/productos/${S.IDS.producto}`, null, S.tokenCliente);
    assert.equal(r.status, 200);
    assert.equal(fs.existsSync(centinela), true, 'el archivo de fuera de uploads/ tiene que seguir');
    fs.unlinkSync(centinela);
  });
});

describe('05 · /api/og no manda a dominios ajenos', () => {
  test('un host de fuera cae al dominio propio', async () => {
    S.reiniciar();
    S.conTabla(() => ({ data: { id: S.IDS.restaurante, nombre: 'Bonzas', slug: 'bonzas', activo: true, atributos: {} }, error: null }));
    const r = await S.pedirTexto('/api/og?host=atacante.example&path=/bonzas');
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.html, /atacante\.example/, 'el dominio ajeno no puede aparecer en la página');
    assert.match(r.html, /menu\.vmenus\.co/);
  });

  test('un host propio sigue funcionando', async () => {
    S.reiniciar();
    S.conTabla(() => ({ data: { id: S.IDS.restaurante, nombre: 'Bonzas', slug: 'bonzas', activo: true, atributos: {} }, error: null }));
    const r = await S.pedirTexto('/api/og?host=bonzas.vmenus.co&path=/');
    assert.match(r.html, /https:\/\/bonzas\.vmenus\.co\//);
  });
});

describe('08 · un trabajo terminado no se borra con su master', () => {
  test('listo con master → 409', async () => {
    S.reiniciar();
    S.conTabla(() => ({ data: { restaurante_id: S.IDS.restaurante, estado: 'listo', master: 'masters/x.mp4' }, error: null }));
    const r = await S.pedir('DELETE', '/api/video/trabajos/abc', null, S.tokenCliente);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /master/);
  });

  test('uno fallido se sigue pudiendo descartar', async () => {
    S.reiniciar();
    S.conTabla(() => ({ data: { restaurante_id: S.IDS.restaurante, estado: 'error', master: null }, error: null }));
    const r = await S.pedir('DELETE', '/api/video/trabajos/abc', null, S.tokenCliente);
    assert.equal(r.status, 200);
  });
});

describe('09 · un plato sin categoría se rechaza con un mensaje legible', () => {
  test('400, no 500 con el mensaje de Postgres', async () => {
    S.reiniciar();
    const r = await S.pedir('POST', '/api/productos',
      { restaurante_id: S.IDS.restaurante, nombre: 'Arepa', precio: '5000' }, S.tokenCliente);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /categoría/);
  });
});
