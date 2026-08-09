-- ═══════════════════════════════════════════════════════════════
-- PASO 2 — EJECUTAR SOLO DESPUÉS DE DESPLEGAR EL CÓDIGO NUEVO
-- ═══════════════════════════════════════════════════════════════
--
-- ORDEN OBLIGATORIO:
--   1. Paso 1 (ya aplicado)                      ← la tabla privada existe
--   2. Desplegar adminmenus_restaurantes         ← el login ya lee de ella
--   3. Desplegar vmenus-app                      ← el menú ya no pide select=*
--   4. Este archivo                              ← se borra la columna vieja
--
-- Ejecutarlo ANTES del punto 2 deja a todos los restaurantes sin poder
-- entrar al panel, porque el login todavía buscaría restaurantes.pin_hash.
--
-- Comprobación previa: esto debe devolver 0 filas. Si devuelve algo, hay
-- credenciales que no se copiaron y NO hay que seguir.
--
--   select r.slug from public.restaurantes r
--   left join public.restaurantes_privado p on p.restaurante_id = r.id
--   where r.pin_hash is not null and p.restaurante_id is null;

begin;

alter table public.restaurantes drop column pin_hash;

-- El rol anon tenía INSERT y UPDATE sobre la tabla pública. Hoy no hacen
-- daño porque no existen políticas de escritura y RLS deniega por defecto,
-- pero son permisos que nadie usa: el menú público solo lee. Se quitan para
-- que RLS no sea lo único que separa a un visitante de poder escribir.
revoke insert, update on public.restaurantes  from anon, authenticated;
revoke insert, update on public.categorias    from anon, authenticated;
revoke insert, update on public.productos     from anon, authenticated;

commit;

-- Verificación posterior (debe devolver 0 filas):
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='restaurantes' and column_name='pin_hash';
