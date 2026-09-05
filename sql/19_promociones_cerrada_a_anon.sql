-- ═══════════════════════════════════════════════════════════════
-- CERRAR LA ESCRITURA DE 'promociones' A anon — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- ── QUÉ ARREGLA ───────────────────────────────────────────────
-- Al crear la tabla en el 18 se comprobó qué permisos habían quedado, y
-- salió esto:
--
--   has_table_privilege('anon','public.promociones','INSERT')  → true
--   has_table_privilege('anon','public.promociones','UPDATE')  → true
--   has_table_privilege('anon','public.promociones','DELETE')  → true
--
-- Es el mismo mecanismo que documenta el CLAUDE.md para las funciones:
-- Supabase concede privilegios por defecto a 'anon' y 'authenticated' sobre lo
-- que nace en el esquema 'public'. Una tabla nueva llega abierta.
--
-- ── NO HAY NADA EXPUESTO HOY, Y AUN ASÍ SE CIERRA ─────────────
-- RLS está activo y la única política es de SELECT, así que un INSERT de anon
-- se deniega igual: con RLS encendido, un comando sin política permisiva no
-- pasa. O sea que esto NO tapa un agujero abierto.
--
-- Se hace porque toda la protección descansa hoy en una sola cosa. El día que
-- alguien añada una política permisiva de más, o toque RLS un momento para
-- depurar, el privilegio de tabla ya está concedido y no hay segunda barrera.
-- Es el mismo argumento del sql/16 con las funciones, y allí la lección costó
-- meses de una función accesible PARECIENDO que no lo estaba.
--
-- ── LO QUE ESTE ARCHIVO NO TOCA ───────────────────────────────
-- La misma comprobación encontró que 'anon' tiene DELETE concedido sobre
-- 'productos', 'categorias' y 'restaurantes', y las tres cosas sobre
-- 'trabajos_video', 'eventos_analitica' y 'menu_activo'. Todas tienen RLS
-- activo, así que tampoco hay nada expuesto — pero están en la misma
-- situación.
--
-- No se tocan aquí a propósito: son tablas que llevan tiempo funcionando y
-- cambiarles los permisos de rebote, dentro de una migración que va de otra
-- cosa, es como se rompe algo sin saber por qué. Va anotado para la revisión
-- de seguridad, que es donde toca mirarlas una por una.

revoke insert, update, delete on public.promociones from anon;
revoke insert, update, delete on public.promociones from authenticated;
revoke insert, update, delete on public.promociones from public;

-- El servidor escribe con service_role, que se salta RLS y necesita el
-- privilegio de tabla. Se concede explícito para no depender de un
-- privilegio por defecto que mañana puede cambiar.
grant select, insert, update, delete on public.promociones to service_role;

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
--   select has_table_privilege('anon','public.promociones','SELECT') as lee,   -- t
--          has_table_privilege('anon','public.promociones','INSERT') as ins,   -- f
--          has_table_privilege('anon','public.promociones','UPDATE') as upd,   -- f
--          has_table_privilege('anon','public.promociones','DELETE') as del;   -- f
--
-- La lectura tiene que seguir en 't': la carta y la cartelera leen con la
-- clave publicable. Si sale 'f', el menú se queda sin promoción.
