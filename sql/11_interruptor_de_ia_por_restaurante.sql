-- ═══════════════════════════════════════════════════════════════
-- INTERRUPTOR DE IA POR RESTAURANTE — YA APLICADO el 26/08/2026
-- ═══════════════════════════════════════════════════════════════
-- Se guarda como registro de lo que se ejecutó. Aditivo y con default, así
-- que aplicarlo antes de desplegar el código no cambió nada: todas las
-- cartas quedan activas, que es lo que ya eran.
--
-- Que una carta sea de VIDEO no significa que pueda GENERAR video con IA.
-- Son dos cosas distintas y hasta hoy eran la misma:
--
--   · el plan 'video' dice que la carta sirve archivos de video
--   · esto dice que además puede fabricarlos con un modelo, y eso cuesta
--     dinero cada vez
--
-- El caso que lo pide: un restaurante que ya tiene su carta completa no
-- necesita seguir generando, y dejarle la puerta abierta es dejar abierta
-- una forma de gastar. Apagarlo tiene que poder hacerse sin bajarle el plan
-- —seguiría necesitando servir sus videos— y sin tocarle el cupo, que
-- significa otra cosa.
--
-- Los tres estados quedan separados y cada uno lleva a una acción distinta:
--
--   activa = false     · esta carta no genera. El botón no existe.
--   cupo = 0           · podría, pero no se le ha dado ninguna.
--   usadas >= cupo     · se le acabaron. Ahí sí hay conversación comercial.
--
-- Ver docs/planes-y-modelos.md y cupo.limitesDe().
alter table public.restaurantes_ia
  add column if not exists activa boolean not null default true;

comment on column public.restaurantes_ia.activa is
  'Si esta carta puede generar video con IA. false = el botón no aparece. Distinto de cupo=0 (podría, pero no tiene) y de cupo agotado.';
