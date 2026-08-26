-- ═══════════════════════════════════════════════════════════════
-- EL RESUMEN NO PUEDE LLAMAR "VIDEO" A LO QUE NO ESTÁ EN LA CARTA
--                                    — YA APLICADO el 26/08/2026
-- ═══════════════════════════════════════════════════════════════
-- Se guarda como registro de lo que se ejecutó. Solo reemplaza una función:
-- no toca tablas, no toca datos, y se puede aplicar antes o después de
-- desplegar el panel. Si se aplica antes, el panel viejo ignora la clave
-- nueva; si se aplica después, el panel enseña 0 hasta que llegue.
--
-- Por qué: contaba como "video" todo trabajo en estado 'listo'. Desde que
-- existe el paso de aprobación eso miente — un video generado que nadie ha
-- revisado está 'listo' (se convirtió bien) pero NO está en la carta.
--
-- Se vio en producción: la lista decía "2 videos" de Pizzería Pierrot y sus
-- platos seguían enseñando la foto, sin ninguna forma de saber por qué.
-- Ahora son dos cuentas separadas, que es lo que siempre fueron.
--
-- Ver docs/video-con-ia.md §8 (fase 3) y video.esperaAprobacion().
create or replace function public.resumen_video_restaurantes()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_object_agg(r.id, jsonb_build_object(
    'videos_listos',      coalesce(v.listos, 0),
    'videos_por_aprobar', coalesce(v.por_aprobar, 0),
    'videos_en_curso',    coalesce(v.en_curso, 0),
    'videos_error',       coalesce(v.errores, 0),
    'ia_usadas',          coalesce(g.usadas, 0),
    'ia_cupo',            coalesce(i.cupo, 24)
  )), '{}'::jsonb)
  from public.restaurantes r
  left join (
    select restaurante_id,
           -- En la carta: convertido Y (subido, o generado y aprobado).
           count(*) filter (
             where estado = 'listo'
               and not (origen_tipo = 'ia' and aprobado is null)
           ) as listos,
           -- Convertido pero esperando que alguien lo mire. El plato sigue
           -- enseñando su foto.
           count(*) filter (
             where estado = 'listo' and origen_tipo = 'ia' and aprobado is null
           ) as por_aprobar,
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
$function$;
