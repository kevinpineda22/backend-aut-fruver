-- =============================================================================
-- Automatización Fruver — foto diaria del sugerido de compra (2026-11-18)
--
-- El sugerido se calcula al abrir la pantalla y se pierde: sin guardarlo no se
-- puede comparar lo que el sistema recomendó comprar contra lo que se compró
-- (SIESA) ni contra lo que se vendió. Tampoco queda el inventario de cada sede
-- de ese momento, que la réplica de SIESA no tiene.
--
-- Una foto por día (`momento = 'publicacion'`, la toma un cron poco después de
-- la publicación de las 4:00 p. m.) para la entrega de mañana, 1 día de
-- cobertura: siempre igual, para que la serie sea comparable día con día.
--
-- Cada renglón guarda el resultado (comprar) Y los ingredientes del cálculo:
-- venta esperada, merma, inventario del acopio, y por sede (jsonb) el
-- disponible, lo que se vende antes de recibir, la necesidad y el sugerido.
-- Con eso se puede recalcular y corregir la fórmula después.
--
-- RLS sin políticas: solo el backend (clave secreta) lee y escribe.
-- Correr UNA vez en el SQL Editor del Supabase de la intranet. Es idempotente.
-- =============================================================================

create table if not exists public.fruver_sugerido_fotos (
  id             bigint generated always as identity primary key,
  fecha          date        not null,               -- día del cálculo (Colombia)
  momento        text        not null default 'publicacion',
  tomada_en      timestamptz not null default now(),
  entrega        date        not null,
  dias           smallint    not null check (dias between 1 and 4),
  inventario_en  timestamptz,                        -- cuándo se leyó el inventario de SIESA
  parametros     jsonb       not null,               -- último dato de venta, cobertura, índice de quincena…
  resumen        jsonb       not null,               -- productos, valor estimado, sin inventario…
  unique (fecha, momento)
);

create table if not exists public.fruver_sugerido_foto_items (
  foto_id            bigint  not null references public.fruver_sugerido_fotos (id) on delete cascade,
  item               text    not null,
  descripcion        text    not null,
  subgrupo           text,
  um                 text,
  merma              numeric,
  armado             boolean not null default false,  -- se arma en tienda: no suma a la compra
  sin_inventario     boolean not null default false,
  ultimo_precio      numeric,
  venta_esperada     numeric,                         -- todas las sedes, días de cobertura
  pedido_tiendas     numeric,                         -- Σ sugerido de las sedes
  acopio_disponible  numeric,
  comprar            numeric,                         -- EL sugerido de compra (null = no se pudo calcular)
  valor_estimado     numeric,
  sedes              jsonb   not null default '{}',   -- { bodega: { disponible, ventaEsperada, necesidad, sugerido, … } }
  primary key (foto_id, item)
);

create index if not exists fruver_sugerido_fotos_entrega_idx on public.fruver_sugerido_fotos (entrega);

alter table public.fruver_sugerido_fotos enable row level security;
alter table public.fruver_sugerido_foto_items enable row level security;

-- Encabezado y renglones en UNA transacción. Si ya hay foto de ese día y
-- momento, no toca nada y devuelve null: la primera foto es la que vale (un
-- segundo cron de respaldo no la pisa).
create or replace function public.fruver_guardar_foto_sugerido(p_foto jsonb, p_items jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into fruver_sugerido_fotos (fecha, momento, entrega, dias, inventario_en, parametros, resumen)
  values (
    (p_foto->>'fecha')::date,
    coalesce(p_foto->>'momento', 'publicacion'),
    (p_foto->>'entrega')::date,
    (p_foto->>'dias')::smallint,
    nullif(p_foto->>'inventario_en', '')::timestamptz,
    coalesce(p_foto->'parametros', '{}'::jsonb),
    coalesce(p_foto->'resumen', '{}'::jsonb)
  )
  on conflict (fecha, momento) do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into fruver_sugerido_foto_items (foto_id, item, descripcion, subgrupo, um, merma, armado, sin_inventario,
                                          ultimo_precio, venta_esperada, pedido_tiendas, acopio_disponible,
                                          comprar, valor_estimado, sedes)
  select v_id, i.item, i.descripcion, i.subgrupo, i.um, i.merma, coalesce(i.armado, false), coalesce(i.sin_inventario, false),
         i.ultimo_precio, i.venta_esperada, i.pedido_tiendas, i.acopio_disponible,
         i.comprar, i.valor_estimado, coalesce(i.sedes, '{}'::jsonb)
  from jsonb_to_recordset(p_items) as i(
    item text, descripcion text, subgrupo text, um text, merma numeric, armado boolean, sin_inventario boolean,
    ultimo_precio numeric, venta_esperada numeric, pedido_tiendas numeric, acopio_disponible numeric,
    comprar numeric, valor_estimado numeric, sedes jsonb
  );

  return v_id;
end;
$$;

revoke all on function public.fruver_guardar_foto_sugerido(jsonb, jsonb) from public, anon, authenticated;
