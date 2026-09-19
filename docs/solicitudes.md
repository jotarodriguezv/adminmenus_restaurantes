# Solicitudes de alta de restaurantes

Decidido con el usuario el 18-19/09/2026, para empezar a vender el panel con
publicidad en Facebook e Instagram. Código: `solicitudes.js` (reglas),
`server.js` (sección «SOLICITUDES DE ALTA»), `public/solicitud.html` y
`public/solicitud.js` (la página), `public/bandeja-solicitudes.js` (la bandeja
del superadmin). Tabla: `sql/25_solicitudes.sql`.

## Qué es

Nadie se crea una cuenta solo, y eso no cambia: el restaurante lo crea el
superadmin y le da el PIN. Lo nuevo es una forma de **pedirlo**, que llega a una
bandeja donde una persona aprueba o descarta.

```
Anuncio de Meta ──(formulario instantáneo)──► n8n ──(clave)──► panel ─┐
Equipo en campo ──(página /solicitud)─────────────────────────► panel ─┤
                                                                       ▼
                                  tabla solicitudes ──► n8n ──► Telegram
                                          │
                                          ▼
                               Superadmin: bandeja → «Aprobar y crear»
```

**Una solicitud nunca crea un restaurante.** Por eso un robot, en el peor caso,
ensucia la bandeja. «Aprobar y crear» rellena el formulario de «Nuevo
restaurante» (nombre, dirección y un PIN de seis cifras) y es la persona quien
lo crea; al crearlo, la solicitud queda aprobada y enlazada. **Antes de crear,
confirmar por WhatsApp que es ese negocio**: es lo que evita que alguien pida el
restaurante de otro.

**Se guarda primero y se avisa después.** Si n8n o Telegram fallan, la
solicitud sigue en la bandeja.

## Protecciones

| Contra qué | Cómo |
|---|---|
| Robots en la página | Captcha de Cloudflare Turnstile (si hay clave), campo trampa escondido, mínimo de 3 s entre abrir y enviar, 20 envíos por hora por IP. A un robot detectado se le contesta «ok» sin guardar, para que no aprenda. |
| Leads falsos por la entrada de n8n | Solo con `SOLICITUDES_CLAVE` en la cabecera `x-clave-solicitudes`. Sin la variable, la puerta está cerrada (503). |
| Código en los textos | La bandeja pinta todo con `textContent`, nunca como HTML. Una prueba falla si aparece `innerHTML` en `bandeja-solicitudes.js`. |
| Repetidas | Un número con una solicitud abierta no se guarda otra vez. Un lead de Meta repetido (n8n reintentó) choca con `meta_lead_id` único. |
| Datos personales | Casilla de autorización obligatoria (Ley 1581), guardada con su fecha. Tabla privada: nunca en `restaurantes`. |

## Configurar (en Dokploy, variables de entorno del panel)

| Variable | Qué es | Si falta |
|---|---|---|
| `TURNSTILE_SITE_KEY` | Clave pública de Turnstile (Cloudflare → Turnstile → añadir sitio con el dominio del panel) | La página va sin captcha |
| `TURNSTILE_SECRET` | Clave secreta del mismo sitio | No se comprueba el captcha (sale un aviso en el registro al arrancar) |
| `SOLICITUDES_CLAVE` | Una cadena larga inventada, la misma en n8n | La entrada de Meta no funciona, y el aviso a n8n va sin clave |
| `N8N_SOLICITUDES_WEBHOOK` | La URL del webhook de n8n que avisa a Telegram | No se avisa (las solicitudes se guardan igual) |
| `POLITICA_PRIVACIDAD_URL` | El enlace de la política de privacidad | La casilla sale sin enlace |

## Los flujos de n8n

**1. Aviso a Telegram** (el panel → n8n):

- Nodo **Webhook**, método POST. Autenticación **Header Auth** con el nombre
  `x-clave-solicitudes` y el valor de `SOLICITUDES_CLAVE`.
- Nodo **Telegram → Send Message** con el texto `{{ $json.body.texto }}`, **sin
  «Parse Mode»**: el texto va plano a propósito, y con Markdown un asterisco en
  el nombre de un negocio rompería el mensaje.
- Lo que llega: `evento`, `id`, `origen`, `negocio`, `contacto`, `whatsapp`,
  `whatsapp_enlace`, `ciudad`, `tipo_negocio`, `comercial`, `notas`,
  `creado_en`, `enlace_panel` y `texto` (el mensaje ya armado, con el teléfono).

**2. Leads de Meta** (Meta → n8n → el panel):

- Nodo **Facebook Lead Ads Trigger**, con la página y el formulario.
- Nodo **HTTP Request**: POST a `https://<panel>/api/solicitudes/meta`, cabecera
  `x-clave-solicitudes`, cuerpo JSON con:
  `negocio`, `contacto`, `whatsapp`, `ciudad`, `tipo_negocio`, `notas`,
  `autoriza_datos: true` (solo si el formulario de Meta tenía la casilla de
  autorización), `meta_lead_id`, y si se quiere `campana`, `anuncio`,
  `formulario`, `plataforma`.
- El aviso a Telegram lo hace el panel al guardarlo (flujo 1): no hace falta
  repetirlo aquí.

## El orden al desplegar

1. ~~Aplicar `sql/25_solicitudes.sql`~~ **Aplicado el 19/09/2026**, con el visto bueno del usuario. Comprobado: anon y authenticated sin acceso, RLS encendido, y la clave pública recibe «permission denied» al leer y al escribir. (Escritura en producción:
   avisar antes) y hacer las comprobaciones del final del archivo.
2. Desplegar el código.
3. Poner las variables de entorno y volver a desplegar.

Sin la tabla, la bandeja dice «No se pudieron cargar las solicitudes» y la lista
de restaurantes se ve igual.

## Pendiente

- Borrar las solicitudes descartadas pasado un tiempo (datos personales que ya
  no hacen falta). Decidir cuánto con el usuario.
- Al aprobar, avisar a Meta de la conversión (API de conversiones para CRM) para
  que optimice por calidad de lead. Se puede hacer desde n8n.
