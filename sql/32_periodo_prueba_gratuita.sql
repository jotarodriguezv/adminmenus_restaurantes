-- Período de cortesía para clientes reales. No usar es_prueba: esa marca es
-- exclusivamente para las demos internas del equipo.
alter table public.restaurantes_facturacion
  add column if not exists prueba_gratuita_hasta date;

create index if not exists restaurantes_facturacion_prueba_hasta_idx
  on public.restaurantes_facturacion (prueba_gratuita_hasta)
  where prueba_gratuita_hasta is not null;

comment on column public.restaurantes_facturacion.prueba_gratuita_hasta is
  'Último día incluido de la prueba comercial gratuita. El servidor suspende la carta al día siguiente.';
