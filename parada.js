'use strict';
// Parada ordenada del panel.
//
// Cada despliegue para el contenedor viejo. Docker le manda SIGTERM al proceso
// principal, espera 10 segundos y, si sigue vivo, lo mata con SIGKILL. Sin
// nada que atendiera SIGTERM —y `node` como PID 1 no aplica la acción por
// defecto de la señal, así que la ignora— el panel moría SIEMPRE por la vía
// mala: `Exited (137)` en cada despliegue, visto en el servidor el 14/09/2026.
//
// Morir así no es solo feo. Lo que se rompía de verdad:
//
//   · Una conversión a medias dejaba el trabajo en 'procesando', y el rescate
//     solo recoge los que llevan más de una hora así. El restaurante veía
//     "convirtiendo" entre 60 y 90 minutos por un despliegue de segundos.
//   · Los archivos que ffmpeg estaba escribiendo quedaban a medias en el disco
//     hasta que el limpiador los recogiera, siete días después.
//   · Las peticiones en curso se cortaban en seco, en vez de terminar.
//
// Lo que se hace, en este orden: dejar de aceptar conexiones nuevas, dejar
// terminar las que hay, pedirle a cada cola que suelte lo que tenga, y salir.
// Todo dentro de un plazo por debajo de los 10 s de Docker: si algo se cuelga,
// se sale igual antes de que llegue el SIGKILL, que no deja registrar nada.
//
// La cola de IA y el limpiador no se esperan a propósito. Una generación en
// curso vive en Replicate, no aquí: queda 'generando' y el panel nuevo la
// vuelve a recoger. Una pasada del limpiador cortada a mitad no deja nada
// inconsistente —solo borra lo que ya sobraba— y la siguiente sigue.

const PLAZO_MS = Number(process.env.PARADA_MAX_MS || 8_000);

function pararOrdenadamente({ servidor, colas = [], plazoMs = PLAZO_MS, salir = process.exit, log = console.log }) {
  let enMarcha = null;

  return function parar(senal) {
    // Docker puede repetir la señal, y un Ctrl+C impaciente también. La
    // segunda no vuelve a empezar: espera a la primera.
    if (enMarcha) return enMarcha;

    enMarcha = (async () => {
      const inicio = Date.now();
      log(`🛑 ${senal} recibido: parando el panel (plazo ${plazoMs} ms)`);

      // close() deja de aceptar conexiones y espera a que terminen las
      // abiertas; desde Node 19 cierra además las que están ociosas, que con
      // Traefik delante son casi todas.
      const http = new Promise(r => servidor.close(() => r()));

      let vencido = false;
      let temporizador;
      const plazo = new Promise(r => {
        temporizador = setTimeout(() => { vencido = true; r(); }, plazoMs);
      });

      // allSettled y no all: que una cola falle al soltar su trabajo no puede
      // impedir que las demás lo suelten ni que el proceso salga.
      const todo = Promise.allSettled([http, ...colas.map(detener => Promise.resolve().then(detener))]);
      await Promise.race([todo, plazo]);
      clearTimeout(temporizador);

      if (vencido) {
        log(`🛑 plazo agotado: se cortan las conexiones que quedan`);
        servidor.closeAllConnections?.();
      }
      log(`🛑 panel parado en ${Date.now() - inicio} ms`);
      salir(0);
    })();

    return enMarcha;
  };
}

module.exports = { pararOrdenadamente, PLAZO_MS };
