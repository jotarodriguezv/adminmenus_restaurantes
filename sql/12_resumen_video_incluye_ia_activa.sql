-- ═══════════════════════════════════════════════════════════════
-- EL RESUMEN DICE SI LA IA ESTÁ ACTIVA — YA APLICADO el 26/08/2026
-- ═══════════════════════════════════════════════════════════════
-- Solo reemplaza una función: no toca tablas ni datos. Añade 'ia_activa' a
-- lo que ya devolvía (ver sql/10).
--
-- La lista del superadmin tiene que poder decir "esta carta no genera con
-- IA" sin pedir el estado de cada restaurante por separado: eso serían N
-- llamadas y crece con los clientes. Mismo motivo por el que este resumen
-- existe.
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
    'ia_cupo',            coalesce(i.cupo, 24),
    -- Sin fila en restaurantes_ia, activa: es lo que hacía la plataforma
    -- antes de que la columna existiera. Mismo criterio que cupo.limitesDe().
    'ia_activa',          coalesce(i.activa, true)
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
