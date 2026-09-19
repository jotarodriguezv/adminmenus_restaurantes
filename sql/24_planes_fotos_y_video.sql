-- ═══════════════════════════════════════════════════════════════
-- PLANES FOTOS Y VIDEO, Y RETIRAR EL MODELO CARRITO — APLICADO EL 17/09/2026
-- ═══════════════════════════════════════════════════════════════
-- Paso 2 de 3 de los planes nuevos (CLAUDE.md, «Los planes nuevos»). No cambia
-- el esquema: mueve datos dentro de restaurantes.atributos.
--
-- ── POR QUÉ ───────────────────────────────────────────────────
-- Desde el 17/09/2026 hay dos planes, que son los dos tipos de carta: 'fotos'
-- (Topnav, Sidebar, Explorar) y 'video' (Video, Vertical). Todo lo demás va
-- incluido en los dos. El paso 1 (vmenus-app#34 y el PR #169 del panel) ya lee
-- 'vitrina', 'pedidos' y 'completo' como 'fotos', así que esto no cambia nada
-- de lo que se ve: deja la base diciendo lo mismo que el código, para que el
-- paso 3 pueda borrar esos nombres viejos.
--
-- ── LA REGLA: EL PLAN SIGUE AL MODELO ─────────────────────────
-- Un modelo de fotos no sirve para una carta de video ni al revés, así que el
-- plan se deduce del modelo guardado. Se escribe por regla y no restaurante por
-- restaurante para que valga también para uno que se cree entre hoy y el día
-- que se aplique. Comprobado el 17/09/2026 que no había ninguno con un plan que
-- contradiga su modelo, así que la regla no le cambia el tipo a nadie.
--
-- ── EL MODELO CARRITO ─────────────────────────────────────────
-- Lo usaban aojocerrado y perroscriollos, los dos de prueba. Pasan a Sidebar,
-- que es la misma cabecera fija y el mismo menú lateral, con el interruptor del
-- carrito encendido: su carta sigue dejando pedir. Va primero porque cambia el
-- modelo, y el plan se decide a partir del modelo.
--
-- ── ESTADO EL 17/09/2026, ANTES DE APLICAR ────────────────────
--   aojocerrado     pedidos   carrito   → fotos · sidebar · carrito encendido
--   perroscriollos  completo  carrito   → fotos · sidebar · carrito encendido
--   bonzas          completo  topnav    → fotos   (producción)
--   malparados      completo  sidebar   → fotos   (producción)
--   gale            (ninguno) sidebar   → fotos
--   sanjavier       (ninguno) explorar  → fotos
--   indigo, pierrot, zz-pruebas-ux  video  vertical  → sin cambios
--   juanmar, voro                   video  video     → sin cambios
--
-- Aplicado con el visto bueno del usuario; la comprobación del final devolvió
-- cero filas y las cartas de bonzas, malparados, aojocerrado y perroscriollos
-- cargaron bien justo después.
--
-- Se puede volver a ejecutar: cada update solo toca las filas que aún no
-- cumplen su regla.

begin;

update public.restaurantes
   set atributos = jsonb_set(jsonb_set(atributos, '{nav}', '"sidebar"'), '{carrito}', 'true')
 where atributos->>'nav' = 'carrito';

update public.restaurantes
   set atributos = jsonb_set(coalesce(atributos, '{}'::jsonb), '{plan}', '"video"')
 where atributos->>'nav' in ('video', 'vertical')
   and coalesce(atributos->>'plan', '') <> 'video';

update public.restaurantes
   set atributos = jsonb_set(coalesce(atributos, '{}'::jsonb), '{plan}', '"fotos"')
 where coalesce(atributos->>'nav', 'topnav') not in ('video', 'vertical')
   and coalesce(atributos->>'plan', '') <> 'fotos';

commit;

-- Comprobación: no puede quedar ningún plan viejo, ni un modelo Carrito, ni un
-- plan que no corresponda a su modelo. Tiene que devolver cero filas.
--
-- select slug, atributos->>'plan' as plan, atributos->>'nav' as nav
--   from public.restaurantes
--  where atributos->>'nav' = 'carrito'
--     or coalesce(atributos->>'plan', '') not in ('fotos', 'video')
--     or (atributos->>'plan' = 'video') <> (coalesce(atributos->>'nav', 'topnav') in ('video', 'vertical'));
