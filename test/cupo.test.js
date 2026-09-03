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
function supabaseFalso({ cupoConfigurado = null, filasQueCuentan = 0, fallarConteo = false, activa = true, errorAlInsertar = null } = {}) {
	const escrituras = [];
	const inserciones = [];
	const llamadasRpc = [];

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
			in()   { return q; },
			is()   { return q; },
			lt()   { return q; },
			single()      { return q; },
			maybeSingle() { return q; },

			then(res, rej) {
				if (st.op === 'insert') {
					inserciones.push(st.payload);
					// Con errorAlInsertar se simula el rechazo del índice único
					// parcial de sql/13: la fila llegó a intentarse y la base
					// dijo que no.
					return Promise.resolve(errorAlInsertar
						? { data: null, error: errorAlInsertar }
						: { data: { id: 'gen-1', ...st.payload }, error: null }).then(res, rej);
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
						data: cupoConfigurado === null ? null : { cupo: cupoConfigurado, activa },
						error: null,
					}).then(res, rej);
				}
				return Promise.resolve({ data: null, error: null }).then(res, rej);
			},
		};
		return q;
	}

	// Desde sql/15 la reserva no es un select seguido de un insert: es una sola
	// llamada que decide y escribe dentro de la base. Esto imita lo que hace
	// aquella función con los mismos mandos de arriba, para que las pruebas
	// sigan hablando de comportamiento y no de por dónde pasa la consulta.
	//
	// El orden de las comprobaciones es el de sql/15 a propósito: si aquí se
	// mirara el cupo antes que 'activa', una carta apagada y agotada daría el
	// motivo equivocado y la prueba que los distingue no se enteraría.
	function rpc(nombre, args) {
		llamadasRpc.push({ nombre, args });

		if (nombre !== 'reservar_generacion_ia') {
			return Promise.resolve({ data: null, error: { message: `rpc inesperada: ${nombre}` } });
		}

		if (fallarConteo) {
			return Promise.resolve({ data: null, error: { message: 'la base no responde' } });
		}

		// Sin fila en restaurantes_ia manda el que llega por parámetro, que es
		// el del servidor. La función SQL no lleva ningún número escrito.
		const cupoEfectivo = cupoConfigurado === null ? args.p_cupo_por_defecto : cupoConfigurado;

		if (!activa) {
			return Promise.resolve({ data: { ok: false, motivo: 'apagada' }, error: null });
		}

		if (filasQueCuentan >= cupoEfectivo) {
			return Promise.resolve({
				data: { ok: false, motivo: 'sin_cupo', cupo: cupoEfectivo, usadas: filasQueCuentan },
				error: null,
			});
		}

		// errorAlInsertar representa el choque del índice de sql/13. La función
		// lo captura dentro y sale por 'ya_en_curso': el 23505 no cruza la
		// frontera, así que el mensaje de Postgres no puede llegar al navegador.
		if (errorAlInsertar) {
			return Promise.resolve({ data: { ok: false, motivo: 'ya_en_curso' }, error: null });
		}

		const fila = {
			id: 'gen-1',
			restaurante_id: args.p_restaurante_id,
			producto_id: args.p_producto_id,
			estado: 'reservada',
		};
		inserciones.push({ restaurante_id: fila.restaurante_id, producto_id: fila.producto_id });
		return Promise.resolve({ data: { ok: true, fila }, error: null });
	}

	return { escrituras, inserciones, llamadasRpc, from: tabla, rpc };
}

describe('cuántas le quedan', () => {
	test('un restaurante sin fila usa el cupo por defecto', async () => {
		// Dar de alta a alguien no debería exigir tocar dos tablas.
		const sb = supabaseFalso({ cupoConfigurado: null, filasQueCuentan: 0 });
		assert.deepEqual(await cupo.estado(sb, RESTO),
			{ cupo: cupo.CUPO_POR_DEFECTO, activa: true, usadas: 0, disponibles: cupo.CUPO_POR_DEFECTO });
	});

	test('un cupo propio manda sobre el de por defecto', async () => {
		const sb = supabaseFalso({ cupoConfigurado: 40, filasQueCuentan: 10 });
		assert.deepEqual(await cupo.estado(sb, RESTO), { cupo: 40, activa: true, usadas: 10, disponibles: 30 });
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

describe('reservar · el choque del índice único no es un error del sistema', () => {
	// El freno de la ruta lee y después escribe, y entre las dos cosas cabe
	// otra petición. Lo que cierra esa carrera es el índice único parcial de
	// sql/13, y lo que llega aquí cuando salta es un 23505.
	//
	// Importa cómo se traduce: si saliera como un fallo genérico, el panel
	// enseñaría "no se pudo pedir la generación" y quien lo lee vuelve a
	// pulsar. Tiene que decir lo mismo que dice el freno de arriba.
	const CHOQUE = {
		code: '23505',
		message: 'duplicate key value violates unique constraint "generaciones_ia_una_en_curso_por_plato"',
	};

	test('se marca como "ya en curso" y no como fallo genérico', async () => {
		const sb = supabaseFalso({ cupoConfigurado: 24, filasQueCuentan: 3, errorAlInsertar: CHOQUE });
		await assert.rejects(
			() => cupo.reservar(sb, { restaurante_id: RESTO, producto_id: PLATO }),
			e => {
				assert.equal(e.yaEnCurso, true, 'quien llama tiene que poder contestar un 409');
				assert.match(e.message, /ya tiene una generación en camino/);
				assert.doesNotMatch(e.message, /constraint|duplicate key/,
					'el mensaje de Postgres no puede llegar al navegador');
				return true;
			});
	});
});

describe('reservar · la decisión y la escritura van juntas', () => {
	// sql/13 cerró que un mismo plato se generara dos veces. Lo que cierra
	// sql/15 es el otro lado: dos platos DISTINTOS del mismo restaurante
	// pedidos a la vez contaban los dos 23 de 24 y reservaban los dos. El
	// índice de sql/13 no los ve porque los platos no chocan entre sí.
	//
	// Lo que estas pruebas NO hacen, para no engañar a quien las lea: no
	// demuestran que la carrera esté cerrada. Eso lo hace el cerrojo de
	// pg_advisory_xact_lock dentro de la base, y un Supabase de mentira no
	// tiene transacciones que serializar.
	//
	// Lo que sí sujetan es que este archivo no vuelva a contar por su cuenta.
	// Mientras la decisión la tome la base en una sola llamada, el cerrojo
	// sirve de algo; el día que alguien reintroduzca un conteo aquí arriba
	// para "ahorrarse una consulta", el cerrojo pasa a proteger una decisión
	// que ya se tomó fuera y vuelve el agujero sin que nada se queje.

	test('se resuelve en una sola llamada, sin contar antes por aquí', async () => {
		const sb = supabaseFalso({ cupoConfigurado: 24, filasQueCuentan: 3 });
		await cupo.reservar(sb, { restaurante_id: RESTO, producto_id: PLATO });

		assert.equal(sb.llamadasRpc.length, 1, 'una sola operación decide y escribe');
		assert.equal(sb.llamadasRpc[0].nombre, 'reservar_generacion_ia');
		assert.equal(sb.inserciones.length, 1);
	});

	test('el cupo por defecto lo pone el servidor, no la base', async () => {
		// Si la función SQL lo llevara escrito, cambiar IA_CUPO_POR_DEFECTO
		// dejaría a la base contando con el número viejo y solo se notaría en
		// la factura.
		const sb = supabaseFalso({ cupoConfigurado: null, filasQueCuentan: 0 });
		await cupo.reservar(sb, { restaurante_id: RESTO, producto_id: PLATO });

		assert.equal(sb.llamadasRpc[0].args.p_cupo_por_defecto, cupo.CUPO_POR_DEFECTO);
	});

	test('un motivo desconocido no se interpreta como permiso', async () => {
		// Pasa si la función de la base es más nueva que este archivo. Ante algo
		// que no se entiende, no gastar: lo contrario sería generar sin saber si
		// había cupo.
		const sb = supabaseFalso();
		sb.rpc = () => Promise.resolve({ data: { ok: false, motivo: 'algo_nuevo' }, error: null });

		await assert.rejects(
			() => cupo.reservar(sb, { restaurante_id: RESTO, producto_id: PLATO }),
			e => e.sinCupo === undefined && e.iaApagada === undefined && e.yaEnCurso === undefined);
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

// ═══════════════════════════════════════════════════════════════
describe('activa · que una carta sea de video no la habilita a generar', () => {
	// Son dos cosas distintas y hasta el 26/08/2026 eran la misma. El caso que
	// lo pide: un restaurante con la carta ya completa no necesita seguir
	// generando, y dejarle la puerta abierta es dejar abierta una forma de
	// gastar. Apagarlo no puede exigir bajarle el plan —seguiría necesitando
	// servir sus videos— ni tocarle el cupo, que significa otra cosa.

	test('sin fila en restaurantes_ia, activa', async () => {
		// Es lo que hacía la plataforma antes de que la columna existiera. El
		// fallo seguro aquí es no quitarle a nadie algo que ya tenía.
		const e = await cupo.estado(supabaseFalso({ cupoConfigurado: null }), RESTO);
		assert.equal(e.activa, true);
		assert.equal(e.disponibles, cupo.CUPO_POR_DEFECTO);
	});

	test('apagada no deja ninguna disponible, mire el cupo lo que mire', async () => {
		// Se calcula en el servidor y no en el panel para que no haya dos
		// cuentas que puedan discrepar.
		const e = await cupo.estado(supabaseFalso({ cupoConfigurado: 24, activa: false }), RESTO);
		assert.equal(e.activa, false);
		assert.equal(e.cupo, 24, 'el cupo se conserva: encenderla lo devuelve donde iba');
		assert.equal(e.disponibles, 0);
	});

	test('apagada se rechaza como apagada, no como sin cupo', async () => {
		// Decir "se te acabaron" llevaría a ampliarle un cupo que no es el
		// problema. Son dos conversaciones distintas y la ruta las distingue.
		await assert.rejects(
			() => cupo.reservar(supabaseFalso({ cupoConfigurado: 24, activa: false }), { restaurante_id: RESTO }),
			e => e.iaApagada === true && e.sinCupo === undefined);
	});

	test('apagada no llega a reservar nada', async () => {
		// Si insertara la fila, la generación contaría como gastada sin que
		// nadie la pidiera.
		const sb = supabaseFalso({ cupoConfigurado: 24, activa: false });
		await assert.rejects(() => cupo.reservar(sb, { restaurante_id: RESTO, producto_id: PLATO }));
		assert.deepEqual(sb.inserciones, []);
	});

	test('encendida pero agotada sigue siendo "sin cupo"', async () => {
		await assert.rejects(
			() => cupo.reservar(supabaseFalso({ cupoConfigurado: 24, filasQueCuentan: 24 }), { restaurante_id: RESTO }),
			e => e.sinCupo === true && e.iaApagada === undefined);
	});

	test('los tres estados no se confunden entre sí', async () => {
		// La tabla que hace legible el sistema: cada "no" tiene su motivo, y
		// cada motivo lleva a una acción distinta.
		const apagada = await cupo.estado(supabaseFalso({ cupoConfigurado: 24, activa: false }), RESTO);
		const sinNada = await cupo.estado(supabaseFalso({ cupoConfigurado: 0 }), RESTO);
		const agotada = await cupo.estado(supabaseFalso({ cupoConfigurado: 24, filasQueCuentan: 24 }), RESTO);

		assert.deepEqual(
			[apagada, sinNada, agotada].map(e => [e.activa, e.cupo, e.disponibles]),
			[[false, 24, 0],   // no genera: decisión de producto
			 [true,   0, 0],   // podría, pero no se le ha dado ninguna
			 [true,  24, 0]]); // se le acabaron: conversación comercial
	});
});
