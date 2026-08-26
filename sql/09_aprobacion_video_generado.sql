-- ═══════════════════════════════════════════════════════════════
-- APROBACIÓN DEL VIDEO GENERADO — YA APLICADO el 26/08/2026
-- ═══════════════════════════════════════════════════════════════
-- Se guarda como registro de lo que se ejecutó. Es aditivo y con valor por
-- defecto, así que se pudo aplicar ANTES de desplegar el código sin cambiar
-- nada: todo lo que ya existía queda como 'subido', que es lo que era, y
-- sigue publicándose solo.
--
-- Por qué existe: un video generado NO puede entrar solo en la carta. El
-- modelo no copia el plato, lo interpreta, y al orbitar hacia 3/4 tiene que
-- rellenar el lado que la foto no enseña. Si ahí aparece una guarnición que
-- el negocio no sirve, el comensal pide una cosa y le llega otra —publicidad
-- engañosa— y el expuesto ante la SIC es el restaurante.
--
-- Los subidos a mano no pasan por aquí: quien graba su plato ya lo vio, y
-- pedirle que lo apruebe sería preguntarle dos veces lo mismo.
--
-- Ver docs/video-con-ia.md §8 (fase 3) y §9, y video.esperaAprobacion().

-- De dónde salió el archivo. Con default para que las filas existentes
-- queden como lo que son —subidas— sin tener que tocarlas una a una.
alter table public.trabajos_video
  add column if not exists origen_tipo text not null default 'subido';

-- El CHECK va aparte y con nombre: así se puede quitar el día que aparezca
-- un tercer origen, en vez de tener que adivinar cómo se llama.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'origen_tipo_valido') then
    alter table public.trabajos_video
      add constraint origen_tipo_valido
      check (origen_tipo in ('subido', 'ia'));
  end if;
end $$;

-- Tres estados en una columna de dos valores, y el tercero es NULL:
--
--   null   · generado y convertido, esperando que alguien lo mire
--   true   · publicado: el plato lo enseña
--   false  · descartado: los archivos se borraron y el plato sigue con su foto
--
-- Sin default a propósito. Un default de false diría "descartado" de todo lo
-- que ya existe, y un default de true publicaría solo lo que se genere. El
-- que decide es esperaAprobacion(), que mira origen_tipo primero.
alter table public.trabajos_video
  add column if not exists aprobado boolean;

comment on column public.trabajos_video.aprobado is
  'Solo para origen_tipo=''ia''. null=espera revisión · true=publicado · false=descartado';

-- Índice parcial: la consulta del panel pregunta siempre por lo mismo —lo de
-- este restaurante que está esperando— y eso es un puñado de filas dentro de
-- una tabla que crece con cada video convertido. Parcial y no completo porque
-- indexar los publicados y los subidos sería pagar escritura por filas que
-- esta consulta nunca mira.
create index if not exists idx_trabajos_video_por_aprobar
  on public.trabajos_video (restaurante_id)
  where origen_tipo = 'ia' and aprobado is null;
