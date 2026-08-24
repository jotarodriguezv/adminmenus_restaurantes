-- ═══════════════════════════════════════════════════════════════
-- COBRANZA FUERA DE LA TABLA PÚBLICA
-- ═══════════════════════════════════════════════════════════════
-- Problema: 'dia_pago' y 'ultimo_pago' vivían dentro de
-- restaurantes.atributos, y 'restaurantes' tiene una política de lectura
-- pública (USING true). La carta pide 'atributos' entero, así que estos dos
-- datos viajaban al navegador de CADA COMENSAL y se veían en las
-- herramientas de desarrollo sin ninguna llave. Con la llave publishable
-- —que está, como debe, dentro de core/supabase.js— se podían pedir los de
-- todos los restaurantes a la vez.
--
-- No son credenciales y con ellas no se entra a ningún sitio. Son datos de
-- NUESTRA cobranza: quién paga, cuándo, y quién va atrasado.
--
-- Es el mismo patrón que resolvió el paso 1 con el PIN —"los secretos no se
-- crean en la tabla pública"— pero aplicado a COLUMNAS: 'atributos' es una
-- columna pública, y dentro de ella se metieron datos administrativos. RLS
-- filtra filas, no claves de un JSON.
--
-- ORDEN OBLIGATORIO. Es el mismo error que evita docs/servidor.md §7:
-- "migrar datos y desplegar código el mismo día deja una ventana de código
-- viejo con datos nuevos".
--
--   1. Este archivo, parte A                     ← la tabla existe y hay copia
--   2. Desplegar adminmenus_restaurantes         ← el panel ya lee de ella
--   3. Este archivo, parte B                     ← se borra la copia vieja
--
-- Entre 1 y 2 el dato está DUPLICADO a propósito: el panel viejo sigue
-- leyendo de 'atributos' y funcionando. Correr B antes del punto 2 deja al
-- superadmin sin ver quién le debe.

-- ───────────────────────────────────────────────────────────────
-- PARTE A — YA APLICADA el 24/08/2026 (proyecto menu-restaurantes)
-- ───────────────────────────────────────────────────────────────
-- Se guarda como registro de lo que se ejecutó. Es idempotente.

-- Tabla propia y NO restaurantes_privado: ahí viven los secretos de acceso
-- y su pin_hash es NOT NULL. Un restaurante puede no tener PIN todavía y
-- aun así deberte una mensualidad; mezclarlos obligaría a inventarle una
-- credencial para poder anotarle una fecha de pago.
create table if not exists public.restaurantes_facturacion (
  restaurante_id uuid primary key references public.restaurantes(id) on delete cascade,
  dia_pago       smallint,
  ultimo_pago    date,
  actualizado_at timestamptz not null default now(),
  constraint dia_pago_del_mes check (dia_pago is null or (dia_pago between 1 and 31))
);

-- RLS activo y CERO políticas: PostgreSQL deniega por defecto. Ni anon ni
-- authenticated la alcanzan. Solo la llave de servicio del panel, que
-- ignora RLS. Mismo patrón que restaurantes_privado.
alter table public.restaurantes_facturacion enable row level security;
revoke all on public.restaurantes_facturacion from anon, authenticated;

comment on table public.restaurantes_facturacion is
  'Cobranza de la plataforma. NUNCA en restaurantes.atributos: esa columna es de lectura pública y viaja entera al navegador de cada comensal.';

-- Copia de lo que había. 'on conflict do nothing' para poder repetirla sin
-- pisar una edición hecha después desde el panel nuevo.
insert into public.restaurantes_facturacion (restaurante_id, dia_pago, ultimo_pago)
select r.id,
       nullif(r.atributos->>'dia_pago', '')::smallint,
       nullif(r.atributos->>'ultimo_pago', '')::date
from public.restaurantes r
where r.atributos ? 'dia_pago' or r.atributos ? 'ultimo_pago'
on conflict (restaurante_id) do nothing;


-- ───────────────────────────────────────────────────────────────
-- PARTE B — EJECUTAR SOLO DESPUÉS DE DESPLEGAR EL PANEL
-- ───────────────────────────────────────────────────────────────
-- Comprobación previa: esto debe devolver 0 filas. Si devuelve algo, hay un
-- dato que no se copió y NO hay que seguir — se perdería al borrar.
--
--   select r.slug
--   from public.restaurantes r
--   left join public.restaurantes_facturacion f on f.restaurante_id = r.id
--   where (r.atributos ? 'dia_pago' or r.atributos ? 'ultimo_pago')
--     and (f.restaurante_id is null
--          or coalesce(f.dia_pago::text, '')    <> coalesce(r.atributos->>'dia_pago', '')
--          or coalesce(f.ultimo_pago::text, '') <> coalesce(r.atributos->>'ultimo_pago', ''));
--
-- Y comprobar en el panel desplegado que la lista de restaurantes sigue
-- enseñando las insignias de cobro. Si las enseña, está leyendo de la tabla
-- nueva y esto se puede borrar sin perder nada.

-- begin;
--
-- update public.restaurantes
-- set atributos = atributos - 'dia_pago' - 'ultimo_pago'
-- where atributos ? 'dia_pago' or atributos ? 'ultimo_pago';
--
-- -- Debe devolver 0.
-- select count(*) from public.restaurantes
-- where atributos ? 'dia_pago' or atributos ? 'ultimo_pago';
--
-- commit;
