# Reservas de mesa

Pedidas por el usuario el 01/10/2026. Un botón **«Reservar mesa»** en la pantalla
de bienvenida de la carta abre un formulario (nombre, celular, fecha, hora y
para cuántas personas). La reserva se guarda en la base y el restaurante la ve
en la pestaña **Reservas** del panel, la confirma o cancela y le escribe al
cliente por WhatsApp.

## Decisiones del usuario

- Todo se configura **donde ya está la bienvenida**: sección «Botón «Reservar
  mesa»». Estaba en la pestaña Apariencia y desde el 02/10/2026 está en
  **Ajustes → Bienvenida**.
- Las reservas **solo en la bienvenida**, no en la carta.
- **Sin aviso automático**: la lista y el contador de pendientes de la pestaña
  son el aviso. Nada de n8n ni Telegram.
- Activable y desactivable por el restaurante: `intro_reservas_activo` (y
  `intro_reservas_texto`, el texto del botón, tope de 40) en `atributos`.

## Cómo está hecho

| Pieza | Dónde |
|---|---|
| Tabla `reservas` (privada, RLS sin políticas) | `sql/34_reservas.sql` |
| Reglas: validación, enlace de WhatsApp, purga | `reservas.js` |
| `POST /api/reservas` (público), `GET` y `PATCH` (con sesión) | `server.js` |
| Interruptor y texto del botón | `public/bienvenida.js`, `public/index.html` |
| Pestaña y lista | `public/reservas.js` |
| El botón y el formulario de la carta | `vmenus-app/core/intro.js` |

La carta **no escribe en la base**: llama a `POST /api/reservas`, que no pide
sesión y por eso se protege con:

1. el campo trampa y el tiempo mínimo de `solicitudes.pareceRobot` (a un robot
   se le contesta «ok» sin guardar nada);
2. un tope de 10 por hora y por IP (`RESERVAS_MAX_POR_HORA` solo lo cambian las
   pruebas);
3. un tope de 3 pendientes por celular y restaurante;
4. que el restaurante exista, esté activo y tenga **`intro_reservas_activo` en
   `true` de verdad**;
5. validación estricta: la fecha, en el reloj **del restaurante** (no el de UTC:
   a las 9 pm en Bogotá ya es mañana en UTC), de hoy a 90 días; la hora `HH:MM`;
   personas, un entero de 1 a 50.

El cuerpo nunca decide el estado, el id ni la fecha de creación.

## Datos personales y retención

Guarda el nombre y el celular de un **comensal**. A los **90 días de la fecha de
la reserva** el panel las borra (`purgarPasadas`, una vez al día). Se cuenta
desde la fecha de la reserva, no desde que se pidió: una reserva para dentro de
dos meses no caduca antes de llegar.

La política de privacidad de `verificamecentral` lo recoge desde el 01/10/2026 (cláusula 06,
`#reservas`: datos, encargado, Supabase, 90 días). El formulario de la carta avisa en una
línea de para qué se usan los datos; no lleva casilla de autorización.

**Lo que no se ha visto funcionar:** la purga de los 90 días solo está probada con pruebas
unitarias (no había nada que borrar). Corre una vez al día desde el panel.

## Despliegue

**Primero la base, después el código**: aplicar `sql/34`, luego el panel, luego
la carta. Con el panel desplegado y sin la tabla, un restaurante que encendiera
el interruptor recibiría un 500 al reservar.

## Probado en producción (01/10/2026)
Con `ZZ Pruebas UX`: el botón en la carta real, el envío, la lista y el contador en el panel,
Confirmar y el enlace de WhatsApp, y los rechazos (fecha pasada, hora mala, restaurante sin el
interruptor; los robots se descartan en silencio). Salió un fallo —la pestaña no aparecía al
guardar el interruptor hasta recargar— y se arregló en #325.

## Qué no se hizo, a propósito

- Sin aviso automático (decidido).
- Sin disponibilidad ni aforo: la reserva es una **solicitud**, la confirma una
  persona.
- Sin campo de notas ni de ocasión especial. Se ofreció y no se pidió.
