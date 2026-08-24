-- ═══════════════════════════════════════════════════════════════
-- RESUMEN DE VIDEO POR RESTAURANTE — YA APLICADO el 24/08/2026
-- ═══════════════════════════════════════════════════════════════
-- Para la lista del superadmin: cuántos videos lleva cada restaurante y
-- cuánto le queda de cupo de IA, sin entrar en cada uno.
--
-- Se agrega en la base y no en Node por lo mismo que
-- estadisticas_restaurante: pedirlo desde el panel serían dos consultas por
-- restaurante y eso crece con el número de clientes. Así viaja solo el
-- resultado.
--
-- Cuenta 'listo' aparte de 'pendiente/procesando' a propósito: es la
-- diferencia entre "va bien" y "hay algo atascado". Sumándolos, un trabajo
-- colgado se vería como un video más.
create or replace function public.resumen_video_restaurantes()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(jsonb_object_agg(r.id, jsonb_build_object(
    'videos_listos',    coalesce(v.listos, 0),
    'videos_en_curso',  coalesce(v.en_curso, 0),
    'videos_error',     coalesce(v.errores, 0),
    'ia_usadas',        coalesce(g.usadas, 0),
    'ia_cupo',          coalesce(i.cupo, 24)
  )), '{}'::jsonb)
  from public.restaurantes r
  left join (
    select restaurante_id,
           count(*) filter (where estado = 'listo')                     as listos,
           count(*) filter (where estado in ('pendiente','procesando')) as en_curso,
           count(*) filter (where estado = 'error')                     as errores
    from public.trabajos_video group by restaurante_id
  ) v on v.restaurante_id = r.id
  left join (
    -- Mismo criterio que cupo.js: solo 'liberada' no consume.
    select restaurante_id, count(*) as usadas
    from public.generaciones_ia where estado <> 'liberada' group by restaurante_id
  ) g on g.restaurante_id = r.id
  left join public.restaurantes_ia i on i.restaurante_id = r.id;
$$;
