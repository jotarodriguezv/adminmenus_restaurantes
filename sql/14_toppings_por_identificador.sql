-- ═══════════════════════════════════════════════════════════════
-- TOPPINGS POR IDENTIFICADOR — APLICAR DESPUÉS DE DESPLEGAR EL CÓDIGO
-- ═══════════════════════════════════════════════════════════════
-- ── QUÉ ARREGLA ───────────────────────────────────────────────
-- El catálogo de toppings es del negocio (restaurantes.atributos) y cada plato
-- dice cuáles ofrece (productos.atributos.personalizacion). Esa referencia era
-- el NOMBRE, así que renombrar un topping desde el panel dejaba a los platos
-- apuntando a algo que ya no existe: el chip salía desmarcado en la ficha, el
-- carrito público no sabía cobrarlo, y nada avisaba.
--
-- Por eso el panel solo dejaba AÑADIR y BORRAR: renombrar era una operación
-- que rompía datos en silencio, y la forma de convivir con ello era no
-- ofrecerla. Con identificador propio, renombrar es seguro y el panel ya lo
-- permite.
--
-- ── EL ORDEN IMPORTA, Y ES AL REVÉS QUE EN EL 13 ──────────────
-- Aquí NO es aditivo: cambia la forma de datos que hay leyendo alguien ahora
-- mismo. Primero el código, después esto.
--
--   1. Desplegar adminmenus_restaurantes (panel) y vmenus-app (cartas).
--   2. Esperar a que las cartas abiertas se hayan recargado. nginx sirve el JS
--      con 'no-cache', así que basta con que el cliente vuelva a entrar; una
--      pestaña que lleve horas abierta sin tocar es el único caso lento.
--   3. Correr esto.
--
-- Al revés —los datos primero— una carta con el JavaScript anterior leería el
-- catálogo nuevo y no encontraría ningún topping: el modal de personalización
-- saldría vacío. No se pierde nada y se arregla recargando, pero es una hora
-- de pedidos sin toppings y no hace falta pasarla.
--
-- ── POR QUÉ SE PUEDE ESPERAR SIN PRISA ────────────────────────
-- El código nuevo lee las dos formas: un elemento del catálogo SIN
-- identificador usa su nombre como tal. Así que entre el paso 1 y el paso 3 no
-- hay ventana rota — todo sigue funcionando con nombres — y esto solo hace
-- permanente lo que el panel ya hace solo cada vez que alguien guarda la
-- pestaña Toppings o una ficha de plato.
--
-- ── ES IDEMPOTENTE ────────────────────────────────────────────
-- Solo toca lo que le falta el identificador y solo traduce los nombres que
-- todavía lo son. Correrlo dos veces no cambia nada la segunda vez, y correrlo
-- después de que el panel haya migrado media carta tampoco.
--
-- ── ALCANCE EL DÍA DE ESCRIBIRLO (28/08/2026) ─────────────────
-- Un solo restaurante tiene catálogo, 'perroscriollos': 10 toppings sin costo,
-- 4 con costo y 9 salsas, 23 en total. De los 159 platos de la plataforma, 17
-- tienen 'personalizacion' y solo 4 con algo dentro, todos suyos. Cero
-- huérfanos: todos los nombres guardados existen hoy en el catálogo.
--
-- Es justo el momento de hacerlo. Cada restaurante nuevo que configure sus
-- toppings lo vuelve más caro.
--
-- ── COMPROBADO ANTES DE ENTREGARLO ────────────────────────────
-- Corrido entero contra una copia temporal de las tablas de producción, con
-- los datos de verdad y deshecho al terminar:
--
--   · 23 elementos de catálogo, 23 identificadores distintos, en el mismo
--     orden y con los precios intactos.
--   · Los 4 platos con contenido traducidos correctamente, respetando el
--     orden de cada lista. Cero referencias sin traducir.
--   · Segunda pasada idéntica: 0 restaurantes y 0 platos modificados.
--   · Producción sin tocar (se verificó después).

begin;

-- ── 1. EL CATÁLOGO GANA IDENTIFICADORES ───────────────────────
-- Uno por elemento, conservando el orden (es el orden en que se pintan los
-- chips) y el resto de claves. 'with ordinality' es lo que garantiza el orden:
-- jsonb_agg sin ORDER BY no lo promete.

update restaurantes r
set atributos = jsonb_set(r.atributos, '{toppings_platino}', n.lista)
from (
  select r2.id,
         coalesce(jsonb_agg(
           case when jsonb_typeof(e.v) = 'object' and e.v ? 'id' then e.v
                when jsonb_typeof(e.v) = 'object'
                  then e.v || jsonb_build_object('id', 'top_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
                else jsonb_build_object(
                       'id',     'top_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
                       'nombre', e.v #>> '{}')
           end order by e.ord), '[]'::jsonb) as lista
  from restaurantes r2,
       lateral jsonb_array_elements(r2.atributos->'toppings_platino') with ordinality e(v, ord)
  where jsonb_typeof(r2.atributos->'toppings_platino') = 'array'
  group by r2.id
) n
where r.id = n.id and n.lista is distinct from r.atributos->'toppings_platino';

-- Los premium llevan además precio. Si alguno estuviera guardado como cadena
-- suelta —no debería, pero atributos es JSON libre— entra con precio 0, que es
-- lo que ya le cobraba el menú.
update restaurantes r
set atributos = jsonb_set(r.atributos, '{toppings_premium}', n.lista)
from (
  select r2.id,
         coalesce(jsonb_agg(
           case when jsonb_typeof(e.v) = 'object' and e.v ? 'id' then e.v
                when jsonb_typeof(e.v) = 'object'
                  then e.v || jsonb_build_object('id', 'top_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
                else jsonb_build_object(
                       'id',     'top_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
                       'nombre', e.v #>> '{}',
                       'precio', 0)
           end order by e.ord), '[]'::jsonb) as lista
  from restaurantes r2,
       lateral jsonb_array_elements(r2.atributos->'toppings_premium') with ordinality e(v, ord)
  where jsonb_typeof(r2.atributos->'toppings_premium') = 'array'
  group by r2.id
) n
where r.id = n.id and n.lista is distinct from r.atributos->'toppings_premium';

update restaurantes r
set atributos = jsonb_set(r.atributos, '{salsas}', n.lista)
from (
  select r2.id,
         coalesce(jsonb_agg(
           case when jsonb_typeof(e.v) = 'object' and e.v ? 'id' then e.v
                when jsonb_typeof(e.v) = 'object'
                  then e.v || jsonb_build_object('id', 'top_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
                else jsonb_build_object(
                       'id',     'top_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
                       'nombre', e.v #>> '{}')
           end order by e.ord), '[]'::jsonb) as lista
  from restaurantes r2,
       lateral jsonb_array_elements(r2.atributos->'salsas') with ordinality e(v, ord)
  where jsonb_typeof(r2.atributos->'salsas') = 'array'
  group by r2.id
) n
where r.id = n.id and n.lista is distinct from r.atributos->'salsas';

-- Ningún identificador repetido dentro de un mismo restaurante. Son ocho
-- caracteres de un uuid, así que chocar es improbable, no imposible — y dos
-- toppings con el mismo identificador harían que marcar uno marcara el otro.
do $$
declare chocan int;
begin
  select count(*) into chocan
  from restaurantes r,
       lateral (
         select count(*) as n, count(distinct x->>'id') as d
         from jsonb_array_elements(
                coalesce(r.atributos->'toppings_platino', '[]'::jsonb) ||
                coalesce(r.atributos->'toppings_premium', '[]'::jsonb) ||
                coalesce(r.atributos->'salsas',           '[]'::jsonb)) x
       ) c
  where c.n <> c.d;
  if chocan > 0 then
    raise exception 'Hay % restaurante(s) con identificadores de topping repetidos. Se deshace todo.', chocan;
  end if;
end $$;

-- ── 2. LOS PLATOS PASAN DE NOMBRES A IDENTIFICADORES ──────────
-- Lee el catálogo YA migrado por los pasos de arriba: van en la misma
-- transacción, así que ve las filas nuevas.
--
-- Casa por identificador O por nombre, en ese orden: lo primero deja quietos
-- los platos que el panel ya migró, lo segundo traduce los que no.
--
-- Un nombre que no case con nada se queda tal cual en vez de desaparecer. Es
-- un topping que el restaurante borró del catálogo: no se puede ni cobrar ni
-- preparar, el menú ya lo ignora, y borrarlo aquí sería tirar la única pista
-- de que ese plato lo ofrecía. El día de escribir esto no hay ninguno.

update productos p
set atributos = jsonb_set(p.atributos, '{personalizacion}', n.pers)
from (
  select p2.id,
         jsonb_build_object(
           'platino', traducidos.pl,
           'premium', traducidos.pr,
           'salsas',  traducidos.sa
         ) as pers
  from productos p2
  join restaurantes r on r.id = p2.restaurante_id,
  lateral (
    select
      (select coalesce(jsonb_agg(to_jsonb(coalesce(m.id_nuevo, s.val)) order by s.ord), '[]'::jsonb)
       from jsonb_array_elements_text(coalesce(p2.atributos->'personalizacion'->'platino', '[]'::jsonb))
            with ordinality s(val, ord)
       left join lateral (
         select e.v->>'id' as id_nuevo
         from jsonb_array_elements(coalesce(r.atributos->'toppings_platino', '[]'::jsonb)) e(v)
         where e.v->>'id' = s.val or e.v->>'nombre' = s.val
         limit 1
       ) m on true) as pl,
      (select coalesce(jsonb_agg(to_jsonb(coalesce(m.id_nuevo, s.val)) order by s.ord), '[]'::jsonb)
       from jsonb_array_elements_text(coalesce(p2.atributos->'personalizacion'->'premium', '[]'::jsonb))
            with ordinality s(val, ord)
       left join lateral (
         select e.v->>'id' as id_nuevo
         from jsonb_array_elements(coalesce(r.atributos->'toppings_premium', '[]'::jsonb)) e(v)
         where e.v->>'id' = s.val or e.v->>'nombre' = s.val
         limit 1
       ) m on true) as pr,
      (select coalesce(jsonb_agg(to_jsonb(coalesce(m.id_nuevo, s.val)) order by s.ord), '[]'::jsonb)
       from jsonb_array_elements_text(coalesce(p2.atributos->'personalizacion'->'salsas', '[]'::jsonb))
            with ordinality s(val, ord)
       left join lateral (
         select e.v->>'id' as id_nuevo
         from jsonb_array_elements(coalesce(r.atributos->'salsas', '[]'::jsonb)) e(v)
         where e.v->>'id' = s.val or e.v->>'nombre' = s.val
         limit 1
       ) m on true) as sa
  ) traducidos
  where jsonb_typeof(p2.atributos->'personalizacion') = 'object'
) n
where p.id = n.id and n.pers is distinct from p.atributos->'personalizacion';

-- Ningún plato puede quedar apuntando a algo que no está en el catálogo de su
-- restaurante. Si alguno lo hace es que ya estaba huérfano antes de empezar:
-- esto no lo crea, pero es el sitio donde se ve.
do $$
declare colgados int;
begin
  select count(*) into colgados
  from productos p
  join restaurantes r on r.id = p.restaurante_id,
  lateral jsonb_array_elements_text(
    coalesce(p.atributos->'personalizacion'->'platino', '[]'::jsonb) ||
    coalesce(p.atributos->'personalizacion'->'premium', '[]'::jsonb) ||
    coalesce(p.atributos->'personalizacion'->'salsas',  '[]'::jsonb)) s(val)
  where not exists (
    select 1
    from jsonb_array_elements(
           coalesce(r.atributos->'toppings_platino', '[]'::jsonb) ||
           coalesce(r.atributos->'toppings_premium', '[]'::jsonb) ||
           coalesce(r.atributos->'salsas',           '[]'::jsonb)) e(v)
    where e.v->>'id' = s.val
  );
  if colgados > 0 then
    raise notice 'Aviso: % referencia(s) de plato no existen en el catálogo de su restaurante. No se deshace nada: son toppings borrados de antes.', colgados;
  end if;
end $$;

commit;

-- ── COMPROBAR DESPUÉS ─────────────────────────────────────────
-- Debe salir 0 en las dos columnas: ningún elemento del catálogo sin
-- identificador y ninguna referencia de plato que no sea un identificador.
--
--   select
--     (select count(*) from restaurantes r,
--        lateral jsonb_array_elements(
--          coalesce(r.atributos->'toppings_platino','[]'::jsonb) ||
--          coalesce(r.atributos->'toppings_premium','[]'::jsonb) ||
--          coalesce(r.atributos->'salsas','[]'::jsonb)) x
--      where not (x ? 'id')) as catalogo_sin_id,
--     (select count(*) from productos p,
--        lateral jsonb_array_elements_text(
--          coalesce(p.atributos->'personalizacion'->'platino','[]'::jsonb) ||
--          coalesce(p.atributos->'personalizacion'->'premium','[]'::jsonb) ||
--          coalesce(p.atributos->'personalizacion'->'salsas','[]'::jsonb)) s(val)
--      where s.val not like 'top\_%') as platos_sin_id;
