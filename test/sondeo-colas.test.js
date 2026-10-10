'use strict';
// Las colas de video y de IA no preguntan a la base cada pocos segundos cuando
// no tienen nada que hacer (octubre de 2026: ~14.300 peticiones al día a
// trabajos_video y generaciones_ia, casi todas para oír «nada», contra la cuota
// de registros de Supabase).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

// Cuenta las llamadas a `from(tabla)`; cualquier cadena responde «sin filas».
function supabaseContado() {
  const llamadas = { trabajos_video: 0, generaciones_ia: 0 };
  const cadena = () => new Proxy(function () {}, {
    get(_, clave) {
      if (clave === 'then') return (ok, mal) => Promise.resolve({ data: [], error: null }).then(ok, mal);
      return () => cadena();
    },
    apply: () => cadena(),
  });
  return {
    sb: { from(t) { llamadas[t] = (llamadas[t] || 0) + 1; return cadena(); }, rpc: () => cadena() },
    llamadas,
  };
}

const respirar = () => new Promise(r => setImmediate(r));
async function pasar(t, ms) { t.mock.timers.tick(ms); await respirar(); await respirar(); }

describe('cola de video: ociosa casi no consulta', () => {
  test('con la cola vacía consulta una vez y luego espera OCIOSO_MS', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const video = require('../video.js');
    video._reiniciarParada();
    const { sb, llamadas } = supabaseContado();

    video.arrancar(sb);
    const alArrancar = llamadas.trabajos_video;          // el rescate de arranque
    await pasar(t, video.INTERVALO_MS);
    const primera = llamadas.trabajos_video;
    assert.ok(primera > alArrancar, 'la primera vuelta sí mira la cola');

    for (let ms = video.INTERVALO_MS; ms < video.OCIOSO_MS - video.INTERVALO_MS; ms += video.INTERVALO_MS)
      await pasar(t, video.INTERVALO_MS);
    assert.equal(llamadas.trabajos_video, primera, 'ociosa, no vuelve a la base antes de tiempo');

    await pasar(t, video.OCIOSO_MS);
    assert.ok(llamadas.trabajos_video > primera, 'pasado el ratito ocioso vuelve a mirar');
    await video.detener();
  });

  test('encolar() despierta la cola en la siguiente vuelta', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const video = require('../video.js');
    video._reiniciarParada();
    const { sb, llamadas } = supabaseContado();

    video.arrancar(sb);
    await pasar(t, video.INTERVALO_MS);                  // queda dormida
    await pasar(t, video.INTERVALO_MS);
    const dormida = llamadas.trabajos_video;

    await video.encolar(sb, { restaurante_id: 'r', producto_id: 'p', origen: 'originales/x.mp4' });
    const trasEncolar = llamadas.trabajos_video;          // el insert cuenta una
    await pasar(t, video.INTERVALO_MS);
    assert.ok(llamadas.trabajos_video > trasEncolar, 'tras encolar, la vuelta siguiente consulta');
    assert.ok(trasEncolar > dormida);
    await video.detener();
  });
});

describe('cola de IA: ociosa casi no consulta', () => {
  test('rescate cada RESCATE_CADA_MS y consulta de en curso solo al despertar', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const colaia = require('../colaia.js');
    const { sb, llamadas } = supabaseContado();

    colaia.arrancar(sb);
    await pasar(t, colaia.INTERVALO_MS);
    const primera = llamadas.generaciones_ia;            // rescate + en curso
    assert.equal(primera, 2);

    for (let ms = colaia.INTERVALO_MS; ms < colaia.RESCATE_CADA_MS - colaia.INTERVALO_MS; ms += colaia.INTERVALO_MS)
      await pasar(t, colaia.INTERVALO_MS);
    assert.equal(llamadas.generaciones_ia, primera, 'ni rescate ni consulta antes de tiempo');

    await pasar(t, colaia.RESCATE_CADA_MS);
    assert.ok(llamadas.generaciones_ia > primera, 'pasado el plazo vuelve a mirar');
    await colaia.detener();
  });
});
