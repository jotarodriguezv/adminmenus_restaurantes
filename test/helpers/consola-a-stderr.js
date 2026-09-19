// ── EN LAS PRUEBAS, console.log ESCRIBE EN STDERR ─────────────
// Lo carga `npm test` con --require, que Node pasa a cada archivo de prueba.
//
// Es el arreglo del fallo intermitente de CI «Unable to deserialize cloned data
// due to invalid or unsupported version», encontrado el 18/09/2026 después de
// dos semanas persiguiéndolo (historia en el CLAUDE.md del panel).
//
// QUÉ PASA. Cada archivo de prueba corre en un proceso hijo que le habla al
// padre por su stdout con mensajes binarios: una cabecera de 2 bytes, 4 de
// tamaño y el contenido. Por el MISMO stdout salen los console.log del servidor
// que se está probando. El padre separa lo uno de lo otro, y en Node 22 tiene un
// fallo: cuando acaba de leer un mensaje y detrás viene texto pegado en el mismo
// bloque, no comprueba que sea texto. Lee sus bytes 3 a 6 como el tamaño del
// siguiente mensaje, con signo (`<< 24`). Una línea que empieza por un emoji
// —«🎬 video retirado…», «✅ Panel corriendo…»— tiene el tercer byte por encima
// de 0x7F, el tamaño sale negativo, el padre intenta leer el texto como un
// mensaje y revienta. Si el texto empieza por letras, el tamaño sale enorme,
// espera, y al siguiente intento se da cuenta de que era texto: por eso solo
// fallaba con emoji, y solo cuando los dos caían en el mismo bloque.
//
// Los diez fallos de las cien ejecuciones anteriores al arreglo se rompieron
// justo después de una línea «🎬 …». Reproducido a voluntad en Node 22.23.2.
// Node lo arregló el 26/07/2026 (`>>> 0`, commit 1ba3ce45b) en la rama 24, no
// en la 22, y aquí se usa la 22 a propósito: es la de producción.
//
// POR QUÉ ASÍ. El padre no mira stderr: lo enseña tal cual. Mandando ahí lo
// que las pruebas escriben por consola, por stdout solo viajan los mensajes del
// ejecutor y el fallo no tiene por dónde entrar. Los registros se siguen viendo
// igual en la salida de las pruebas.
//
// Solo en los hijos (NODE_TEST_CONTEXT lo pone el ejecutor): el padre no se
// toca, que es quien escribe el informe.
//
// El día que el panel pase a Node 24 esto sobra, y se puede quitar.
if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  const { Console } = require('node:console');
  const aStderr = new Console({ stdout: process.stderr, stderr: process.stderr });
  for (const metodo of ['log', 'info', 'debug', 'dir', 'dirxml', 'table', 'group', 'groupCollapsed', 'groupEnd', 'count', 'timeLog', 'timeEnd'])
    console[metodo] = aStderr[metodo].bind(aStderr);
}
