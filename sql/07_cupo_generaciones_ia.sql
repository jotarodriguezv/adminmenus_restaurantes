-- ═══════════════════════════════════════════════════════════════
-- CUPO DE GENERACIONES CON IA — YA APLICADO el 24/08/2026
-- ═══════════════════════════════════════════════════════════════
-- Se guarda como registro de lo que se ejecutó. Es aditivo: dos tablas
-- nuevas y vacías, así que aplicarlo antes de desplegar el código no
-- cambió nada. Es el orden correcto — primero la tabla, después el código.
--
-- Se cuentan GENERACIONES y no productos porque es lo que factura
-- Replicate: un plato regenerado tres veces sigue siendo un producto y son
-- tres cobros. Contando productos, el gasto queda sin techo justo por el
-- lado del descarte, que es el que más pesa.
--
-- Ver docs/video-con-ia.md §5 y cupo.js.

-- El tope por restaurante. Fila propia y no una clave en 'atributos':
-- atributos es de lectura pública y esto es un dato de la plataforma sobre
-- el negocio. Mismo criterio que restaurantes_facturacion.
create table if not exists public.restaurantes_ia (
  restaurante_id uuid primary key references public.restaurantes(id) on delete cascade,
  cupo           smallint    not null default 24,
  actualizado_at timestamptz not null default now(),
  constraint cupo_no_negativo check (cupo >= 0)
);

-- Una fila por generación RESERVADA, no por generación exitosa.
--
-- La reserva ocurre ANTES de llamar a Replicate. Contando al terminar,
-- veinte peticiones lanzadas a la vez pasarían todas la comprobación antes
-- de que se contara ninguna y el cupo no serviría de nada.
--
-- 'liberada' es el único estado que no consume, y se pone solo cuando la
-- generación falló SIN que el proveedor cobrara. Un resultado feo sí
-- consume: se pagó por él.
create table if not exists public.generaciones_ia (
  id             uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  producto_id    uuid          references public.productos(id)    on delete set null,

  -- El identificador que devuelve Replicate al crear la predicción. Se
  -- guarda EN CUANTO SE CREA, antes de esperar el resultado: si la
  -- respuesta se pierde por un corte de red, es lo único que permite
  -- preguntar por ella en vez de generar —y pagar— otra vez. La cola
  -- reintenta hasta tres veces; con ffmpeg eso es gratis, aquí serían tres
  -- cobros por un plato.
  prediction_id  text,

  estado         text not null default 'reservada',
  error          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint estado_valido check (estado in ('reservada', 'generando', 'lista', 'error', 'liberada'))
);

-- El cupo se consulta en cada intento: que no recorra la tabla.
create index if not exists idx_generaciones_ia_restaurante
  on public.generaciones_ia (restaurante_id) where estado <> 'liberada';

create index if not exists idx_generaciones_ia_prediction
  on public.generaciones_ia (prediction_id) where prediction_id is not null;

create trigger generaciones_ia_actualizado
  before update on public.generaciones_ia
  for each row execute function public.tocar_actualizado_en();

-- RLS activo y CERO políticas en las dos: solo la llave de servicio.
alter table public.restaurantes_ia  enable row level security;
alter table public.generaciones_ia  enable row level security;
revoke all on public.restaurantes_ia  from anon, authenticated;
revoke all on public.generaciones_ia  from anon, authenticated;

comment on table public.generaciones_ia is
  'Una fila por generación RESERVADA. La reserva va antes de llamar a Replicate; solo "liberada" no consume cupo.';
