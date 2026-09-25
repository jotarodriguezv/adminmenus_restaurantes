-- ═══════════════════════════════════════════════════════════════
-- CUÁNDO SE DESCARTÓ UNA SOLICITUD — APLICADO EL 24/09/2026
-- ═══════════════════════════════════════════════════════════════
-- Aplicado con el visto bueno del usuario. Comprobado después: las 2
-- descartadas con fecha (la de su última modificación, del mismo 24/09, así
-- que su plazo acaba el 24/03/2027), ninguna aprobada ni abierta con fecha, el
-- índice creado, y la tabla sigue cerrada a anon y con RLS.
-- ═══════════════════════════════════════════════════════════════
-- Decidido con el usuario el 24/09/2026: las solicitudes descartadas se borran
-- a los SEIS MESES de descartarse. Lo promete la política de privacidad de
-- verificame.co (cláusula 05, #solicitudes), así que no es una limpieza de
-- comodidad: es un compromiso legal (Ley 1581) y lo cumple
-- solicitudes.purgarDescartadas(), una vez al día desde el panel.
--
-- ── POR QUÉ UNA COLUMNA Y NO 'actualizado_en' ─────────────────
-- Una descartada se puede seguir tocando: las notas internas, o reabrirla y
-- volverla a descartar. Con 'actualizado_en' cada nota correría el plazo, y la
-- política dice «a más tardar seis meses después de descartarse». Esta columna
-- la escribe el servidor SOLO al pasar a descartada, y la vacía al reabrirla.
--
-- ── EL ORDEN: PRIMERO ESTO, DESPUÉS EL CÓDIGO ─────────────────
-- Aditiva: nadie la lee hasta que se despliegue el código que la usa. Al revés,
-- el panel escribiría una columna que no existe y descartar fallaría.

alter table public.solicitudes
  add column if not exists descartada_en timestamptz;

-- Las que ya estaban descartadas no tienen fecha. La mejor aproximación es su
-- última modificación: para ellas fue, en la práctica, el descarte.
update public.solicitudes
   set descartada_en = actualizado_en
 where estado = 'descartada' and descartada_en is null;

-- La purga busca justo esto cada día.
create index if not exists solicitudes_descartada_en_idx
  on public.solicitudes (descartada_en)
  where estado = 'descartada';

comment on column public.solicitudes.descartada_en is
  'Cuándo pasó a descartada. A los seis meses la borra el panel (política de privacidad, cláusula 05). Se vacía si se reabre.';

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
-- Ninguna descartada sin fecha, y ninguna fecha en una que no lo esté:
--
--   select estado, count(*) filter (where descartada_en is null)     as sin_fecha,
--                  count(*) filter (where descartada_en is not null) as con_fecha
--     from public.solicitudes group by estado;
