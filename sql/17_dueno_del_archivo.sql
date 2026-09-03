-- ═══════════════════════════════════════════════════════════════
-- DE QUIÉN ES UN ARCHIVO, SIN TRAERSE LA BASE ENTERA — YA APLICADO el 03/09/2026
-- ═══════════════════════════════════════════════════════════════
-- Es aditivo: crea una función y no toca ninguna tabla ni ninguna fila.
-- Aplicarlo antes de desplegar el código no cambia nada. Primero la base,
-- después el código.
--
-- ── QUÉ ARREGLA ───────────────────────────────────────────────
-- restauranteDelArchivo() en server.js hacía un select('*') SIN filtro sobre
-- restaurantes, categorias, productos y trabajos_video, se traía todas las
-- filas por la red y buscaba el nombre del archivo serializando cada una a
-- JSON en Node. Cada vez que un cliente borra una imagen.
--
-- Con 9 restaurantes y 159 productos no se nota. El problema es la forma: el
-- coste crece con la base entera, no con lo que se busca, y es de las cosas
-- que no avisan — se van poniendo lentas hasta que un día el borrado de una
-- foto tarda y nadie sabe por qué.
--
-- No es un fallo de seguridad. La comprobación era CORRECTA; lo que estaba
-- mal era el camino.
--
-- ── POR QUÉ SE MIRA LA FILA ENTERA Y NO UNAS COLUMNAS ─────────
-- Un archivo se referencia desde sitios que no son columnas fijas:
-- imagen_url, logo_url, fondo_url, y también desde dentro de JSON —
-- atributos.video.url, atributos.imagenes[], portada_url. Enumerar columnas
-- aquí significaría que el día que alguien guarde una URL en una clave nueva
-- de 'atributos', esta función dejaría de verla y diría que el archivo no es
-- de nadie: permitiría borrar el archivo de otro restaurante.
--
-- Por eso se convierte la fila entera a texto con to_jsonb(t)::text y se
-- busca ahí, que es exactamente lo que hacía el JSON.stringify() del código
-- viejo. Se conserva la propiedad que importa —ve cualquier columna, exista
-- hoy o se añada mañana— y se pierde el viaje de todas las filas por la red.
--
-- ── strpos Y NO like ──────────────────────────────────────────
-- Los nombres de archivo llevan guiones bajos ('ia-1756...-abc.mp4' no, pero
-- las carpetas y los nombres de los toppings sí), y en LIKE el '_' significa
-- "un carácter cualquiera". Habría que escaparlo, y un escapado que alguien
-- olvide al tocar esto se convierte en coincidencias de más.
--
-- strpos busca el texto literal. Y si aun así coincidiera de más, el error
-- cae del lado bueno: decir que un archivo es de alguien impide borrarlo.
-- Decir que no es de nadie lo borra.
--
-- ── LA CLAVE VACÍA TIENE QUE REVENTAR ─────────────────────────
-- strpos(cualquier_cosa, '') devuelve 1, así que una clave vacía coincidiría
-- con TODAS las filas. Devolver null en ese caso sería lo peor posible: null
-- significa "no es de nadie" y el servidor borraría. Por eso lanza excepción:
-- el error sube, la ruta contesta 503 y no se borra nada. Ante la duda, no
-- tocar el disco.
--
-- ── EL ORDEN DE LAS TABLAS NO ES DECORATIVO ───────────────────
-- Se devuelve el dueño de la PRIMERA tabla que coincide, en el mismo orden
-- que recorría el código viejo. Un mismo archivo puede estar referenciado
-- desde dos sitios (la foto de un plato que además es la portada del
-- restaurante), y cambiar el orden cambiaría cuál de los dos dueños sale.
-- Hoy los dos son el mismo restaurante, pero eso es una casualidad del
-- modelo, no una garantía.

create or replace function public.restaurante_del_archivo(p_clave text)
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if p_clave is null or p_clave = '' then
    raise exception 'restaurante_del_archivo: la clave del archivo no puede venir vacía';
  end if;

  return (
    select dueno
    from (
      select r.id             as dueno, 1 as orden
        from public.restaurantes r
       where strpos(to_jsonb(r)::text, p_clave) > 0
      union all
      select c.restaurante_id, 2
        from public.categorias c
       where strpos(to_jsonb(c)::text, p_clave) > 0
      union all
      select p.restaurante_id, 3
        from public.productos p
       where strpos(to_jsonb(p)::text, p_clave) > 0
      union all
      select t.restaurante_id, 4
        from public.trabajos_video t
       where strpos(to_jsonb(t)::text, p_clave) > 0
    ) coincidencias
    order by orden
    limit 1
  );
end;
$$;

comment on function public.restaurante_del_archivo(text) is
  'De qué restaurante es un archivo de uploads/, mirando la fila entera como texto para no depender de qué columna guarde la URL. Sustituye al select(*) sin filtro que server.js hacía sobre cuatro tablas en cada borrado. Ver sql/17.';

-- Los dos revoke, como manda el CLAUDE.md: PostgreSQL concede EXECUTE a
-- PUBLIC en cada función nueva, y Supabase además se lo concede a anon y
-- authenticated de forma explícita. Ninguna se quita revocando la otra.
--
-- Aquí importa especialmente: la función lee las cuatro tablas y las lee
-- SIN filtro de restaurante. Es SECURITY INVOKER, así que la RLS seguiría
-- mandando, pero eso es la segunda barrera, no la primera.
revoke execute on function public.restaurante_del_archivo(text) from public;
revoke execute on function public.restaurante_del_archivo(text) from anon, authenticated;
grant  execute on function public.restaurante_del_archivo(text) to service_role;

-- Comprobar después de aplicar, que es la parte que se olvida:
--
--   select has_function_privilege('anon', oid, 'EXECUTE')
--     from pg_proc where proname = 'restaurante_del_archivo';   -- false
