-- ═══════════════════════════════════════════════════════════════
-- UN SOLO WHATSAPP PARA EL NEGOCIO — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Hasta hoy había dos campos para el mismo número: `whatsapp_pedidos` (la
-- tarjeta del carrito) y `social_whatsapp` (la barra de redes y la bienvenida).
-- Cuatro restaurantes los tenían escritos dos veces con el mismo valor y otros
-- tres, uno solo. Decidido el 01/10/2026: un número, el del negocio, en
-- Ajustes → Datos del negocio (docs/datos-del-negocio.md).
--
-- ── QUÉ HACE ──────────────────────────────────────────────────
-- Copia lo que ya había a las dos claves nuevas:
--
--   whatsapp_negocio  el número: el de pedidos si lo hay y, si no, el de la
--                     barra de redes. Si hubiera los dos y distintos gana el de
--                     pedidos, que es el que de verdad recibía los pedidos.
--   whatsapp_boton    si la carta enseña el botón de WhatsApp. Verdadero solo
--                     donde ya se enseñaba, o sea donde `social_whatsapp` tenía
--                     número. Así NINGUNA carta cambia de aspecto: quien tenía el
--                     número solo para pedidos sigue sin botón.
--
-- ── LO QUE NO HACE ────────────────────────────────────────────
-- No borra las claves viejas. La carta y el panel con la página vieja en el
-- navegador todavía las leen, y se miran solo cuando la nueva NO EXISTE. Se
-- retirarán en una migración posterior, cuando nada las lea.
--
-- Tampoco toca a quien no tenía ningún número: sin clave nueva, la carta sigue
-- tratándolo como «sin número», igual que antes.
--
-- Es idempotente: no pisa un `whatsapp_negocio` ya escrito, así que se puede
-- volver a correr sin deshacer lo que el restaurante cambió después.
--
-- ── ORDEN DE DESPLIEGUE ───────────────────────────────────────
-- Primero esta migración, después la carta (vmenus-app) y por último el panel.
-- La carta nueva lee la clave nueva y, si no existe, la vieja; con esta
-- migración puesta antes ambas dicen lo mismo. Al revés —el panel primero—, un
-- restaurante cambiaría su número y la carta vieja seguiría usando el anterior.

update public.restaurantes r
   set atributos = coalesce(r.atributos, '{}'::jsonb)
                   || jsonb_build_object('whatsapp_negocio', x.numero, 'whatsapp_boton', x.boton)
  from (
    select id,
           coalesce(
             nullif(regexp_replace(coalesce(atributos->>'whatsapp_pedidos', ''), '\D', '', 'g'), ''),
             nullif(regexp_replace(coalesce(atributos->>'social_whatsapp', ''), '\D', '', 'g'), '')
           ) as numero,
           nullif(regexp_replace(coalesce(atributos->>'social_whatsapp', ''), '\D', '', 'g'), '') is not null as boton
      from public.restaurantes
  ) x
 where x.id = r.id
   and x.numero is not null
   and not (coalesce(r.atributos, '{}'::jsonb) ? 'whatsapp_negocio');
