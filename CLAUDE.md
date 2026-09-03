# adminmenus_restaurantes

Panel de administración de la plataforma de menús digitales. Node + Express,
sin framework de frontend. El menú que ve el comensal es **otro repositorio**,
`vmenus-app`; los dos comparten la misma base de datos Supabase
(`menu-restaurantes`, `tllpmdhkdlqoqpnqmuwn`).

## Reglas de trabajo

- **Nunca commitear sobre `main`.** Una rama por tarea, salida de `main`, y el
  merge lo hace el usuario por pull request.
- **No hacer `git commit` ni `git push` por iniciativa propia.** Se editan los
  archivos, se resume lo tocado y se espera el visto bueno del usuario.
- Código, comentarios y documentación en español. Los mensajes de commit son la
  excepción: van en inglés e imperativos ("Add…", "Enhance…", "Refactor…"),
  siguiendo el historial existente.

## Antes de tocar nada: leer `docs/`

Es documentación viva y densa, escrita para no repetir análisis ya hechos. Si
la tarea roza alguno de estos temas, leer el documento primero:

| Documento | Cubre |
|---|---|
| `docs/servidor.md` | La máquina real: qué vive en el servidor y **no** en el repositorio (credenciales, cron, scripts copiados a mano). |
| `docs/planesymodelos.md` | Qué tiene contratado cada restaurante. Responde "¿qué puede hacer este cliente?" sin leer código. |
| `docs/cartas-en-video.md` | Los parámetros de codificación de video y de dónde salió cada número. |
| `docs/video-con-ia.md` | La generación con Replicate (`minimax/hailuo-02`) y sus costes. |
| `docs/pantalla-tv.md` | La cartelera para televisores del local. |

Si el código y un documento se contradicen, manda el código — y hay que
corregir el documento en la misma tarea.

## Estructura

- `server.js` (~2000 líneas) — Express y todas las rutas HTTP. Incluye una red
  de captura (`conCaptura`) que envuelve los manejadores al registrarlos: sin
  ella, una promesa rechazada dentro de un `async` tumba el proceso entero, y
  con él el panel y las tres colas a la vez.
- `video.js` — cola de conversión de video. Un trabajo a la vez, porque ffmpeg
  y Express comparten un solo núcleo. **Límite por CPU.**
- `colaia.js` — cola de generación con IA. Carril aparte del anterior a
  propósito: generar no gasta CPU, solo espera una respuesta HTTP.
  **Límite por presupuesto.**
- `cupo.js` — cupo de generaciones. Reserva antes de llamar a Replicate, porque
  aquí el peor caso de un fallo no es lentitud, es una factura.
- `limpieza.js` — borra del disco los archivos que ya no referencia nadie.
- `public/` — el panel (HTML + JS servidos tal cual).
- `sql/` — migraciones numeradas.
- `respaldo/` — scripts de copia y restauración que se ejecutan en el servidor.

## Base de datos

Las migraciones se versionan en `sql/`, numeradas correlativamente. Un cambio
de esquema **añade un archivo nuevo**; no se edita uno ya aplicado ni se toca
el esquema solo desde la consola de Supabase.

La separación entre tablas públicas y privadas es deliberada y no es
negociable: `restaurantes` viaja entera al navegador de cualquier comensal.
Credenciales, cobranza y cualquier secreto van en `restaurantes_privado` y
`restaurantes_facturacion`. **Nunca meter un dato sensible en
`restaurantes.atributos`.**

## Comandos

```bash
npm test        # node --test sobre test/*.test.js
npm run dev     # nodemon
npm start       # node server.js
```

Las pruebas corren en GitHub Actions en cada push a `main` y en cada PR, con
Node 22 — la misma versión que la imagen de producción (`node:22-alpine`).
Correrlas antes de dar una tarea por terminada.

## Entorno

`.env` no está versionado. El servidor necesita al menos `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `PORT` y `TRUST_PROXY`. La lista real y dónde vive el
archivo en producción están en `docs/servidor.md`.

Ojo con `SUPABASE_SERVICE_KEY`: se salta las políticas RLS. Solo el servidor la
usa; jamás puede acabar en nada que se sirva al navegador.
