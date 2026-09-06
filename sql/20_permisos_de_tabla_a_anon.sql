-- ═══════════════════════════════════════════════════════════════
-- QUITARLE A anon LOS PERMISOS DE TABLA QUE NO USA — SIN APLICAR
-- ═══════════════════════════════════════════════════════════════
-- Sale de la revisión de seguridad del 06/09/2026 (docs/seguridad-subidas.md
-- §3.4) y es el mismo trabajo que hizo el sql/19 con 'promociones', ahora en
-- las seis tablas que quedaron.
--
-- ── NO HAY NADA EXPUESTO HOY ──────────────────────────────────
-- Las seis tienen RLS activo, y con RLS encendido un comando sin política
-- permisiva se deniega aunque el privilegio de tabla esté concedido. O sea que
-- esto NO tapa un agujero abierto.
--
-- Se hace porque toda la protección descansa en una sola barrera. El día que
-- alguien añada una política de más, o apague RLS un momento para depurar, el
-- privilegio ya está concedido y no hay nada detrás. Es el argumento del
-- sql/16 con las funciones, y allí la lección costó meses de una función
-- accesible PARECIENDO que no lo estaba.
--
-- ── DE DÓNDE SALEN ESOS PERMISOS ──────────────────────────────
-- No los concedió nadie a mano: Supabase da privilegios por defecto a 'anon' y
-- 'authenticated' sobre lo que nace en el esquema 'public'. Una tabla nueva
-- llega abierta, y estas seis son de antes de que eso se vigilara.
--
-- ── QUÉ SE COMPROBÓ ANTES DE ESCRIBIR ESTO ────────────────────
-- Qué tablas leen de verdad el menú y la cartelera, buscando en vmenus-app
-- todas las llamadas a sbFetch() y pedir():
--
--   categorias · productos · promociones · restaurantes
--
-- Y ninguna otra. Por eso a esas cuatro se les DEJA la lectura —quitarla
-- dejaría a los nueve restaurantes sin carta— y a las otras tres se les quita
-- también.

-- ── 1. LAS CUATRO QUE EL MENÚ LEE ─────────────────────────────
-- Conservan SELECT; pierden todo lo demás. Su política pública de lectura ya
-- acota QUÉ filas se ven (productos solo los disponibles, promociones solo las
-- encendidas); esto acota el verbo.
revoke insert, update, delete on public.categorias   from anon, authenticated, public;
revoke insert, update, delete on public.productos    from anon, authenticated, public;
revoke insert, update, delete on public.restaurantes from anon, authenticated, public;

-- ── 2. LAS TRES QUE NADIE LEE DESDE FUERA ─────────────────────
-- 'eventos_analitica' la escribe el servidor por /api/track con la clave de
-- servicio; el menú NO la lee. 'trabajos_video' es de la cola. 'menu_activo'
-- tampoco aparece en ninguna llamada pública.
--
-- Ninguna tiene política de SELECT, así que hoy anon ya no puede leerlas: esto
-- solo quita el privilegio que quedaba por debajo.
revoke select, insert, update, delete on public.eventos_analitica from anon, authenticated, public;
revoke select, insert, update, delete on public.menu_activo       from anon, authenticated, public;
revoke select, insert, update, delete on public.trabajos_video    from anon, authenticated, public;

-- ── 3. EL SERVIDOR SIGUE PUDIENDO ─────────────────────────────
-- 'service_role' se salta RLS pero necesita el privilegio de tabla. Se concede
-- explícito para no depender de un privilegio por defecto que mañana puede
-- cambiar — que es justo lo que ha pasado aquí.
grant select, insert, update, delete on public.categorias        to service_role;
grant select, insert, update, delete on public.productos         to service_role;
grant select, insert, update, delete on public.restaurantes      to service_role;
grant select, insert, update, delete on public.eventos_analitica to service_role;
grant select, insert, update, delete on public.menu_activo       to service_role;
grant select, insert, update, delete on public.trabajos_video    to service_role;

-- ── COMPROBAR DESPUÉS DE APLICAR ──────────────────────────────
-- No dar por hecho que funcionó. Lo de abajo tiene que salir así:
--
--   categorias, productos, restaurantes  → lee t · escribe f
--   los otros tres                       → lee f · escribe f
--   service_role en las seis             → escribe t
--
--   select c.relname,
--          has_table_privilege('anon', c.oid, 'SELECT') as anon_lee,
--          has_table_privilege('anon', c.oid, 'INSERT') as anon_ins,
--          has_table_privilege('anon', c.oid, 'UPDATE') as anon_upd,
--          has_table_privilege('anon', c.oid, 'DELETE') as anon_del,
--          has_table_privilege('service_role', c.oid, 'INSERT') as servidor
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--    order by c.relname;
--
-- Y DESPUÉS, abrir una carta de verdad. Si 'anon_lee' saliera en 'f' para
-- categorias, productos o restaurantes, los nueve restaurantes se quedan sin
-- carta y el aviso llega por teléfono, no por este archivo.
