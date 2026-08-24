// Cupo de generaciones con IA. Aquí no se protege el rendimiento: se protege
// una factura. Cada generación que se cuenta mal es dinero real, así que el
// módulo se prueba entero SIN llamar a Replicate ni una vez.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const cupo = require('../cupo.js');

const RESTO = '11111111-1111-4111-8111-111111111111';
const PLATO = '33333333-3333-4333-8333-333333333333';

// Un Supabase de mentira con lo justo: el tope configurado, cuántas filas
// cuentan hoy, y un registro de lo que se le mandó escribir.
function supabaseFalso({ cupoConfigurado = null, filasQueCuentan = 0, fallarConteo = false } = {}) {
	const escrituras = [];
	const inserciones = [];

	function tabla(nombre) {
		const st = { tabla: nombre };
		const q = {
			select(cols, opts) {
				// usadas() pide un conteo con head:true; el resto pide columnas.
				if (opts?.head) {
					st.esConteo = true;
					return q;
				}
				return q;
			},
			insert(filas) { st.op = 'insert'; st.payload = filas[0]; return q; },
			update(obj)   { st.op = 'update'; st.payload = obj;      return q; },
			eq()   { return q; },
			neq()  { return q; },
			lt()   { return q; },
			single()      { return q; },
			maybeSingle() { return q; },

			then(res, rej) {
				if (st.op === 'insert') {
					inserciones.push(st.payload);
					return Promise.resolve({ data: { id: 'gen-1', ...st.payload }, error: null }).then(res, rej);
				}
				if (st.op === 'update') {
					escrituras.push({ tabla: nombre, ...st.payload });
					return Promise.resolve({ data: [{ id: 'gen-1' }], error: null }).then(res, rej);
				}
				if (st.esConteo) {
					return Promise.resolve(fallarConteo
						? { count: null, error: { message: 'la base no responde' } }
						: { count: filasQueCuentan, error: null }).then(res, rej);
				}
				if (nombre === 'restaurantes_ia') {
					return Promise.resolve({
						data: cupoConfigurado === null ? null : { cupo: cupoConfigurado },
						error: null,
					}).then(res, rej);
				}
				return Promise.resolve({ data: null, error: null }).then(res, rej);
			},
		};
		return q;
	}

	return { escrituras, inserciones, from: tabla };
}

describe('cuántas le quedan', () => {
	test('un restaurante sin fila usa el cupo por defecto', async () => {
		// Dar de alta a alguien no debería exigir tocar dos tablas.
		const sb = supabaseFalso({ cupoConfigurado: null, filasQueCuentan: 0 });
		assert.deepEqual(await cupo.estado(sb, RESTO),
			{ cupo: cupo.CUPO_POR_DEFECTO, usadas: 0, disponibles: cupo.CUPO_POR_DEFECTO });
	});

	test('un cupo propio manda sobre el de por defecto', async () => {
		const sb = supabaseFalso({ cupoConfigurado: 40, filasQueCuentan: 10 });
		assert.deepEqual(await cupo.estado(sb, RESTO), { cupo: 40, usadas: 10, disponibles: 30 });
	});

	test('gastadas de más no da disponibles negativas', async () => {
		// Puede pasar si se le baja el cupo a alguien que ya generó.
		const sb = supabaseFalso({ cupoConfigurado: 5, filasQueCuentan: 8 });
		assert.equal((await cupo.estado(sb, RESTO)).disponibles, 0);
	});
});

describe('reservar · lo que protege la factura', () => {
	test('con cupo, la reserva se escribe ANTES de llamar a nadie', async () => {
		// El orden es lo que hace que el cupo sirva. Si se contara al terminar,
		// veinte peticiones a la vez pasarían todas la comprobación antes de que
		// se contara ninguna.
		const sb = supabaseFalso({ cupoConfigurado: 24, filasQueCuentan: 3 });
		const fila = await cupo.reservar(sb, { restaurante_id: RESTO, producto_id: PLATO });

		assert.equal(sb.inserciones.length, 1, 'tiene que quedar constancia antes de generar');
		assert.equal(sb.inserciones[0].restaurante_id, RESTO);
		assert.equal(sb.inserciones[0].producto_id, PLATO);
		assert.equal(fila.id, 'gen-1');
	});

	test('sin cupo NO se reserva nada y se explica por qué', async () => {
		const sb = supabaseFalso({ cupoConfigurado: 24, filasQueCuentan: 24 });
		await assert.rejects(
			() => cupo.reservar(sb, { restaurante_id: RESTO }),
			e => e.sinCupo === true && /24 animaciones/.test(e.message));

		assert.equal(sb.inserciones.length, 0, 'agotado el cupo no se escribe ni una fila');
	});

	test('si no se puede leer el cupo, NO se genera', async () => {
		// Ante la duda, no gastar. Un error de red leyendo el conteo no puede
		// convertirse en una generación gratis: el fallo tiene que caer del lado
		// de no gastar dinero.
		const sb = supabaseFalso({ cupoConfigurado: 24, fallarConteo: true });
		await assert.rejects(() => cupo.reservar(sb, { restaurante_id: RESTO }), /leyendo el cupo/);
		assert.equal(sb.inserciones.length, 0);
	});

	test('un plato sin id sigue reservando', async () => {
		// Se puede generar sin tener el plato guardado todavía; el cupo se cobra
		// igual porque el dinero se gasta igual.
		const sb = supabaseFalso({ cupoConfigurado: 24, filasQueCuentan: 0 });
		await cupo.reservar(sb, { restaurante_id: RESTO });
		assert.equal(sb.inserciones[0].producto_id, null);
	});
});

describe('el identificador de la predicción', () => {
	test('se guarda junto al paso a "generando"', async () => {
		// Es lo único que evita pagar dos veces por el mismo plato cuando la
		// respuesta se pierde: permite preguntar "¿en qué quedó aquella?" en vez
		// de pedir otra.
		const sb = supabaseFalso();
		await cupo.anotarPrediccion(sb, 'gen-1', 'pred_abc123');

		assert.deepEqual(sb.escrituras[0],
			{ tabla: 'generaciones_ia', prediction_id: 'pred_abc123', estado: 'generando' });
	});
});

describe('qué consume cupo y qué no', () => {
	test('una generación lista lo consume', async () => {
		const sb = supabaseFalso();
		await cupo.marcarLista(sb, 'gen-1');
		assert.equal(sb.escrituras[0].estado, 'lista');
		assert.notEqual(sb.escrituras[0].estado, cupo.ESTADO_LIBERADA);
	});

	test('un fallo SIN cobro devuelve el cupo', async () => {
		// El restaurante no tiene por qué pagar un problema de red con una de
		// sus animaciones.
		const sb = supabaseFalso();
		await cupo.marcarFallida(sb, 'gen-1', 'se cayó la red');
		assert.equal(sb.escrituras[0].estado, cupo.ESTADO_LIBERADA);
	});

	test('un fallo YA COBRADO no lo devuelve', async () => {
		// Una predicción que llegó a ejecutarse y salió mal se pagó igual.
		// Devolver el cupo ahí sería regalar dinero en cada resultado malo.
		const sb = supabaseFalso();
		await cupo.marcarFallida(sb, 'gen-1', 'salió deforme', { cobrada: true });
		assert.equal(sb.escrituras[0].estado, 'error');
	});

	test('el motivo se recorta para que no reviente la columna', async () => {
		const sb = supabaseFalso();
		await cupo.marcarFallida(sb, 'gen-1', 'x'.repeat(900));
		assert.equal(sb.escrituras[0].error.length, 500);
	});
});

describe('rescatarReservas · el cupo que se pierde en silencio', () => {
	test('devuelve las reservas que nunca llegaron a salir', async () => {
		// Un corte de red entre reservar y llamar deja una fila 'reservada' que
		// consume cupo para siempre sin haber generado nada. Sin esto, al
		// restaurante le faltan animaciones y no hay forma de saber por qué.
		const sb = supabaseFalso();
		await cupo.rescatarReservas(sb);

		assert.equal(sb.escrituras[0].estado, cupo.ESTADO_LIBERADA);
		assert.match(sb.escrituras[0].error, /nunca llegó a salir/);
	});

	test('el margen es holgado frente a lo que tarda una generación', async () => {
		// Si fuera más corto que una generación normal, se liberaría el cupo de
		// algo que todavía se está haciendo — y se cobraría sin contarlo.
		assert.ok(cupo.RESCATE_MS >= 10 * 60 * 1000,
			'una generación tarda minutos; el rescate tiene que esperar más');
	});
});
