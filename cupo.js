'use strict';
// Cupo de generaciones con IA.
//
// Generar un video con IA no cuesta CPU: cuesta dinero, y lo cuesta cada vez.
// Eso lo hace distinto de todo lo demás que hace este servidor, donde el peor
// caso de un fallo es que algo vaya lento. Aquí el peor caso es una factura.
//
// Por eso el cupo existe antes que el botón. Este módulo se escribió y se
// probó ENTERO sin llamar a Replicate ni una vez.
//
// Dos ideas que conviene no deshacer:
//
// 1. Se cuentan GENERACIONES, no productos. Es lo que factura el proveedor: un
//    plato regenerado tres veces sigue siendo un producto y son tres cobros.
//    Contando productos, el gasto queda sin techo justo por el lado del
//    descarte, que es el que más pesa — la comida es de lo más difícil de
//    generar y se tira mucho.
//
// 2. Se RESERVA antes de llamar, no se cuenta al terminar. Contando al final,
//    veinte peticiones lanzadas a la vez pasan todas la comprobación antes de
//    que se cuente ninguna, y el cupo no sirve para nada.

const CUPO_POR_DEFECTO = Number(process.env.IA_CUPO_POR_DEFECTO || 24);

// El único estado que no consume. Se pone cuando la generación falló SIN que
// el proveedor cobrara. Un resultado feo sí consume: se pagó por él.
const ESTADO_LIBERADA = 'liberada';

// Cuántas puede generar este restaurante, y si puede siquiera. Sin fila, los
// valores por defecto: dar de alta a alguien no debería exigir tocar dos
// tablas.
//
// 'activa' y 'cupo' contestan cosas distintas y por eso son dos columnas:
//
//   activa = false   · esta carta NO genera. Decisión de producto.
//   cupo = 0         · podría, pero no se le ha dado ninguna.
//   usadas >= cupo   · se le acabaron. Ahí sí hay conversación comercial.
//
// Con una sola columna los tres casos dirían "no puedes" sin decir por qué, y
// el de en medio invitaría a ampliar un cupo que no es el problema.
async function limitesDe(supabase, restauranteId) {
  const { data } = await supabase.from('restaurantes_ia')
    .select('cupo, activa').eq('restaurante_id', restauranteId).maybeSingle();
  return {
    cupo: data?.cupo ?? CUPO_POR_DEFECTO,
    // Sin fila, activa. Es lo que hacía la plataforma antes de que esta
    // columna existiera, y el fallo seguro aquí es no quitarle a nadie algo
    // que ya tenía.
    activa: data?.activa ?? true,
  };
}

// Se mantiene por compatibilidad: había código y pruebas pidiendo solo el
// número.
async function cupoDe(supabase, restauranteId) {
  return (await limitesDe(supabase, restauranteId)).cupo;
}

async function usadas(supabase, restauranteId) {
  const { count, error } = await supabase.from('generaciones_ia')
    .select('id', { count: 'exact', head: true })
    .eq('restaurante_id', restauranteId)
    .neq('estado', ESTADO_LIBERADA);
  if (error) throw new Error(`leyendo el cupo: ${error.message}`);
  return count || 0;
}

// Lo que ve el panel: para pintar "te quedan N" sin tener que calcularlo por
// su cuenta y arriesgarse a que las dos cuentas discrepen.
async function estado(supabase, restauranteId) {
  const [limites, gastadas] = await Promise.all([
    limitesDe(supabase, restauranteId),
    usadas(supabase, restauranteId),
  ]);
  return {
    cupo: limites.cupo,
    activa: limites.activa,
    usadas: gastadas,
    // Apagada no deja ninguna disponible, mire el cupo lo que mire. Se calcula
    // aquí y no en el panel para que no haya dos cuentas que puedan discrepar.
    disponibles: limites.activa ? Math.max(0, limites.cupo - gastadas) : 0,
  };
}

// Reserva una generación. Devuelve la fila si había sitio, o lanza si no.
//
// La comprobación y la reserva no son atómicas: entre contar y escribir cabe
// otra petición. Con un solo restaurante pulsando un botón eso no pasa, y la
// consecuencia de que pasara sería UNA generación de más, no un desbordamiento
// — el siguiente intento ya ve las dos. Resolverlo de verdad pediría un
// bloqueo en la base, y no compensa por una unidad.
//
// Lo que sí importa es el orden: primero se escribe la reserva, DESPUÉS se
// llama al proveedor. Nunca al revés.
async function reservar(supabase, { restaurante_id, producto_id }) {
  const { cupo, disponibles, activa } = await estado(supabase, restaurante_id);

  // Antes que el cupo: apagada no es "se te acabaron", y decirlo así llevaría
  // a ampliarle un cupo que no es el problema.
  if (!activa) {
    const e = new Error('La generación con IA no está activa para esta carta.');
    e.iaApagada = true;
    throw e;
  }

  if (disponibles <= 0) {
    const e = new Error(`Se agotaron las ${cupo} animaciones de este restaurante. Escríbenos para ampliar el cupo.`);
    e.sinCupo = true;
    throw e;
  }

  const { data, error } = await supabase.from('generaciones_ia')
    .insert([{ restaurante_id, producto_id: producto_id || null }])
    .select().single();
  if (error) {
    // 23505 es el índice único parcial de sql/13: ya hay una generación en
    // curso para este plato. Es lo único que cierra de verdad la carrera entre
    // dos peticiones simultáneas — la comprobación de la ruta lee y luego
    // escribe, y entre las dos cosas cabe otra petición.
    //
    // No es un fallo del sistema, es la respuesta correcta, y por eso lleva
    // marca propia: quien llama la traduce a un 409 con el mismo texto que da
    // la comprobación de arriba, para que el usuario lea siempre lo mismo.
    if (error.code === '23505') {
      const e = new Error('Ese plato ya tiene una generación en camino. Espera a que termine.');
      e.yaEnCurso = true;
      throw e;
    }
    throw new Error(`reservando la generación: ${error.message}`);
  }
  return data;
}

// El identificador del proveedor se guarda EN CUANTO SE CREA la predicción,
// antes de esperar el resultado.
//
// Si la respuesta se pierde por un corte de red y no se hubiera guardado, el
// reintento generaría —y pagaría— otra vez lo mismo. La cola reintenta hasta
// tres veces: con ffmpeg eso es gratis, aquí serían tres cobros por un plato.
// Esto es lo único que permite preguntar "¿en qué quedó aquella?" en vez de
// pedir otra.
async function anotarPrediccion(supabase, id, predictionId) {
  const { error } = await supabase.from('generaciones_ia')
    .update({ prediction_id: predictionId, estado: 'generando' }).eq('id', id);
  if (error) throw new Error(`anotando la predicción: ${error.message}`);
}

async function marcarLista(supabase, id) {
  await supabase.from('generaciones_ia').update({ estado: 'lista', error: null }).eq('id', id);
}

// Un fallo del proveedor SIN cobro devuelve el cupo: el restaurante no tiene
// por qué pagar un problema de red con una de sus animaciones.
//
// 'cobrada' lo decide quien llama, porque solo ahí se sabe: una predicción que
// llegó a ejecutarse y salió mal se pagó igual, y esa NO se libera.
async function marcarFallida(supabase, id, motivo, { cobrada = false } = {}) {
  await supabase.from('generaciones_ia').update({
    estado: cobrada ? 'error' : ESTADO_LIBERADA,
    error: String(motivo || '').slice(0, 500),
  }).eq('id', id);
}

// Una reserva que se quedó sin identificador de predicción es una llamada que
// nunca llegó a salir: no se cobró nada y el cupo se devuelve.
//
// Sin esto, un corte de red entre reservar y llamar le come una animación al
// restaurante en silencio, y solo se nota al final cuando no le cuadran las
// cuentas.
const RESCATE_MS = 15 * 60 * 1000;

async function rescatarReservas(supabase) {
  const limite = new Date(Date.now() - RESCATE_MS).toISOString();
  const { data } = await supabase.from('generaciones_ia')
    .update({ estado: ESTADO_LIBERADA, error: 'La petición nunca llegó a salir' })
    // Lo que define este caso no es el estado sino la falta de identificador
    // de predicción: sin él no hay nada que consultar ni nada que cobrar.
    //
    // Se miraba solo 'reservada', y eso dejaba fuera una fila que puede
    // quedarse en 'generando' sin identificador. La cola las salta
    // —colaia.pasada() hace `if (!gen.prediction_id) continue`— así que nadie
    // volvía a mirarlas nunca y consumían cupo para siempre.
    .in('estado', ['reservada', 'generando'])
    .is('prediction_id', null)
    .lt('creado_en', limite).select('id');
  if (data?.length) console.log(`♻️  ${data.length} reserva(s) de IA devueltas al cupo`);
  return data?.length || 0;
}

module.exports = {
  CUPO_POR_DEFECTO, ESTADO_LIBERADA, RESCATE_MS,
  cupoDe, limitesDe, usadas, estado, reservar,
  anotarPrediccion, marcarLista, marcarFallida, rescatarReservas,
};
