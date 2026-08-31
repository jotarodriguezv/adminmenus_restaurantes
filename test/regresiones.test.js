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
  test('POST /api/categorias sin nombre ya no derriba nada', async () => {
    // Este fue el ejemplo del fallo: el slug se deriva del nombre, así que
    // `nombre.toLowerCase()` sobre undefined mataba el proceso entero. Ahora
    // la ruta lo comprueba antes y contesta un 400 que se puede leer, que es
    // lo que toca cuando falta un dato obligatorio. El envoltorio sigue
    // detrás por si algo se escapa: quien lo prueba es el caso de
    // estadísticas, aquí abajo.
    S.reiniciar();
    S.conTabla(() => ({ data: { atributos: {} }, error: null }));
    const r = await S.pedir('POST', '/api/categorias',
      { restaurante_id: S.IDS.restaurante }, S.tokenCliente);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /nombre/i, 'tiene que decir qué falta');
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

describe('01b · atributos se funde, no se reemplaza', () => {
	// El superadmin abre la carta a las 10:00, el dueño cambia su WhatsApp a
	// las 10:05, el superadmin guarda Apariencia a las 10:10. Antes eso
	// devolvía el WhatsApp al valor de las 10:00: el panel mandaba el JSON
	// entero con la copia que había cargado al entrar.
	const guardado = { whatsapp_pedidos: '573001112233', nav: 'topnav', plan: 'video' };

	function responder(nuevo = {}) {
		S.conTabla(st => st.op === 'update'
			? { data: { id: S.IDS.restaurante, atributos: st.payload.atributos, ...nuevo }, error: null }
			: { data: { atributos: guardado }, error: null });
	}

	test('lo que la petición no menciona sobrevive', async () => {
		S.reiniciar(); responder();
		const r = await S.pedir('PATCH', `/api/restaurantes/${S.IDS.restaurante}`,
			{ atributos: { color_card: '#111111' } }, S.tokenAdmin);

		assert.equal(r.status, 200);
		const escrito = S.ultimaEscritura('restaurantes').atributos;
		assert.equal(escrito.color_card, '#111111', 'lo que sí venía se escribe');
		assert.equal(escrito.whatsapp_pedidos, '573001112233', 'y lo que no venía no se pierde');
		assert.equal(escrito.nav, 'topnav');
	});

	test('poner una clave a null sigue funcionando', async () => {
		// Es como el panel quita la portada. Si la fusión se comiera los nulos,
		// no habría forma de borrar nada.
		S.reiniciar(); responder();
		await S.pedir('PATCH', `/api/restaurantes/${S.IDS.restaurante}`,
			{ atributos: { portada_url: null, portada_activa: false } }, S.tokenAdmin);

		const escrito = S.ultimaEscritura('restaurantes').atributos;
		assert.equal(escrito.portada_url, null);
		assert.equal(escrito.portada_activa, false);
		assert.equal(escrito.whatsapp_pedidos, '573001112233', 'y no se lleva lo demás por delante');
	});

	test('la cobranza nunca acaba en la tabla de lectura pública', async () => {
		S.reiniciar(); responder();
		await S.pedir('PATCH', `/api/restaurantes/${S.IDS.restaurante}`,
			{ atributos: { dia_pago: 5, ultimo_pago: '2026-08-01', nav: 'video' } }, S.tokenAdmin);

		const escrito = S.ultimaEscritura('restaurantes').atributos;
		assert.equal('dia_pago' in escrito, false);
		assert.equal('ultimo_pago' in escrito, false);
		assert.equal(escrito.nav, 'video', 'lo demás de la misma petición sí pasa');
	});

	test('las columnas de la promoción llegan a la tabla', async () => {
		// Fase 3 de la cartelera. El filtro por campos es una lista explícita:
		// una columna que no esté en ella se descarta en silencio, y el panel
		// diría "guardado" sin haber guardado nada. Pasó ya con otras.
		S.reiniciar(); responder();
		await S.pedir('PATCH', `/api/restaurantes/${S.IDS.restaurante}`, {
			promo_nombre: '2x1 en hamburguesas', promo_precio: '$ 30.000',
			promo_en_tv: true, promo_cada: 3,
		}, S.tokenCliente);

		const escrito = S.ultimaEscritura('restaurantes');
		assert.equal(escrito.promo_nombre, '2x1 en hamburguesas');
		assert.equal(escrito.promo_precio, '$ 30.000');
		assert.equal(escrito.promo_en_tv, true);
		assert.equal(escrito.promo_cada, 3);
	});

	test('la promoción no abre la puerta a otras columnas', async () => {
		// La lista es lo único que separa "el dueño edita su promoción" de "el
		// dueño se cambia el slug".
		S.reiniciar(); responder();
		await S.pedir('PATCH', `/api/restaurantes/${S.IDS.restaurante}`,
			{ promo_en_tv: true, slug: 'otro', activo: false }, S.tokenCliente);

		const escrito = S.ultimaEscritura('restaurantes');
		assert.equal(escrito.promo_en_tv, true);
		assert.equal('slug' in escrito, false);
		assert.equal('activo' in escrito, false);
	});

	test('un cliente sigue sin poder tocar lo que no es suyo', async () => {
		// La fusión no puede haber aflojado el filtro por rol.
		S.reiniciar(); responder();
		await S.pedir('PATCH', `/api/restaurantes/${S.IDS.restaurante}`,
			{ atributos: { nav: 'vertical', plan: 'video', whatsapp_pedidos: '573009998877' } },
			S.tokenCliente);

		const escrito = S.ultimaEscritura('restaurantes').atributos;
		assert.equal(escrito.nav, 'topnav', 'el modelo de carta no lo cambia el cliente');
		assert.equal(escrito.plan, 'video', 'ni se asciende de plan');
		assert.equal(escrito.whatsapp_pedidos, '573009998877', 'lo suyo sí lo cambia');
	});
});

describe('04 · dos conversiones del mismo plato', () => {
  // El panel lo impide apagando el botón mientras convierte, y su comentario
  // explica por qué: dos conversiones compiten por el mismo campo del
  // producto, gana la que termine después —que no tiene por qué ser la que se
  // pidió— y la otra se queda ocupando disco sin que nada la enseñe.
  //
  // Pero el panel es la puerta bonita. Las otras tres rutas que encolan
  // trabajo ya lo comprobaban; la subida manual, que es la más usada, no.
  const enCurso = (hay) => S.conTabla(st => {
    if (st.tabla === 'productos') return { data: { restaurante_id: S.IDS.restaurante }, error: null };
    if (st.tabla === 'restaurantes') return { data: { atributos: { plan: 'video' } }, error: null };
    if (st.tabla === 'trabajos_video' && st.op === 'select') return { data: hay ? [{ id: 'otro' }] : [], error: null };
    return { data: { id: 'nuevo', estado: 'pendiente' }, error: null };
  });

  test('la segunda subida se rechaza con un 409 que se puede leer', async () => {
    S.reiniciar(); enCurso(true);
    const r = await S.pedirArchivo('/api/video',
      { restaurante_id: S.IDS.restaurante, producto_id: S.IDS.producto }, S.tokenCliente);

    assert.equal(r.status, 409);
    assert.match(r.body.error, /ya tiene una conversión en marcha/);
    // Y no se encola nada: la fila que se habría creado no existe.
    assert.equal(S.llamadas.some(l => l.tabla === 'trabajos_video' && l.op === 'insert'), false);
  });

  test('sin ninguna en curso, la subida sigue funcionando', async () => {
    // Esta subida SÍ llega a escribir el archivo en uploads/originales, y esa
    // carpeta la comparten los dos ficheros de prueba — que el ejecutor corre
    // en procesos paralelos. api.test.js cuenta los archivos de ahí antes y
    // después de una subida rechazada, así que un archivo nuestro apareciendo
    // entre las dos cuentas le hacía fallar una de cada tres veces.
    //
    // Se limpia lo que se deja. Una prueba que ensucia un recurso compartido
    // hace fallar a otra que no tiene nada que ver, y eso enseña a mirar el
    // rojo sin leerlo.
    const dir = path.join(__dirname, '..', 'uploads', 'originales');
    const antes = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);

    S.reiniciar(); enCurso(false);
    const r = await S.pedirArchivo('/api/video',
      { restaurante_id: S.IDS.restaurante, producto_id: S.IDS.producto }, S.tokenCliente);

    assert.equal(r.status, 200);
    assert.equal(S.llamadas.some(l => l.tabla === 'trabajos_video' && l.op === 'insert'), true);

    for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : []))
      if (!antes.has(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  });
});

describe('10 · el endpoint de salud', () => {
  // Dokploy no sabía distinguir un proceso colgado de uno sano. Esto es lo que
  // le da la señal, así que tiene que cumplir tres cosas: contestar sin
  // credenciales, no tocar la base de datos, y no contar nada del negocio.
  test('contesta sin credenciales', async () => {
    S.reiniciar();
    const r = await S.pedir('GET', '/salud');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.arriba_desde_s, 'number');
  });

  test('no consulta la base de datos', async () => {
    // Un healthcheck corre cada pocos segundos. Si preguntara a Supabase sería
    // carga constante por nada, y además un fallo de la base reiniciaría el
    // contenedor en bucle — reiniciar no arregla una base caída.
    S.reiniciar();
    await S.pedir('GET', '/salud');
    assert.equal(S.llamadas.length, 0, 'no debe tocar ninguna tabla ni rpc');
  });

  test('no cuenta nada del negocio', async () => {
    // No lleva autenticación: lo único que puede decir es que está vivo.
    S.reiniciar();
    const r = await S.pedir('GET', '/salud');
    assert.deepEqual(Object.keys(r.body).sort(), ['arriba_desde_s', 'ok']);
  });

  test('sigue contestando aunque la base falle', async () => {
    S.reiniciar();
    S.conTabla(() => { throw new Error('la base no responde'); });
    const r = await S.pedir('GET', '/salud');
    assert.equal(r.status, 200, 'una base caída no puede marcar el proceso como enfermo');
  });
});
