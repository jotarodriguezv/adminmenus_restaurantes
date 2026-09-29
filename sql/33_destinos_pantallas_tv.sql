-- Cada destacado puede salir en una o varias de las tres carteleras del local.
-- {1} conserva exactamente el único destino que existía antes de esta columna.
alter table public.promociones
  add column if not exists pantallas_tv smallint[] not null default array[1]::smallint[];

alter table public.promociones
  drop constraint if exists promociones_pantallas_tv_validas;

alter table public.promociones
  add constraint promociones_pantallas_tv_validas
  check (pantallas_tv <@ array[1, 2, 3]::smallint[]);

comment on column public.promociones.pantallas_tv is
  'Números de las carteleras (1, 2, 3) donde puede aparecer este destacado.';
