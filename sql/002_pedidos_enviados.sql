-- =============================================================================
-- Automatización Fruver — pedidos que envían las sedes (2026-11-06)
--
-- El líder revisa el sugerido de su sede, cambia cantidades, quita o agrega
-- productos y ENVÍA. Lo enviado queda acá, una vez por sede y fecha de entrega:
--   · Compra lo lee para armar la compra consolidada.
--   · Seguimiento lo compara con el sugerido (¿lo siguió?, ¿cuánto cambió?).
--
-- Cada renglón guarda el sugerido que vio el líder y lo que pidió, y su ORIGEN:
--   sugerido   — pidió exactamente lo sugerido
--   modificado — cambió la cantidad sugerida
--   quitado    — el sistema sugería y el líder lo sacó del pedido (cantidad 0)
--   agregado   — el sistema no lo sugería y el líder lo pidió
--
-- RLS sin políticas: solo el backend (clave secreta) lee y escribe.
-- Correr UNA vez en el SQL Editor del Supabase de la intranet. Es idempotente.
-- =============================================================================

create table if not exists public.fruver_envios (
  id               bigint generated always as identity primary key,
  bodega           text        not null,
  sede_nombre      text        not null,
  fecha_entrega    date        not null,
  dias             smallint    not null check (dias between 1 and 4),
  enviado_por      text        not null,
  enviado_por_id   uuid,
  enviado_en       timestamptz not null default now(),
  -- Con qué datos se calculó el sugerido que vio el líder.
  inventario_en    timestamptz,
  parametros       jsonb,
  unique (bodega, fecha_entrega)
);

create table if not exists public.fruver_envio_lineas (
  envio_id         bigint  not null references public.fruver_envios (id) on delete cascade,
  item             text    not null,
  descripcion      text    not null,
  subgrupo         text,
  um               text,
  sugerido         numeric check (sugerido is null or sugerido >= 0),
  cantidad         numeric not null check (cantidad >= 0),
  origen           text    not null check (origen in ('sugerido', 'modificado', 'quitado', 'agregado')),
  disponible       numeric,
  venta_esperada   numeric,
  merma            numeric,
  ultimo_precio    numeric,
  primary key (envio_id, item)
);

create index if not exists fruver_envios_entrega_idx on public.fruver_envios (fecha_entrega);

alter table public.fruver_envios enable row level security;
alter table public.fruver_envio_lineas enable row level security;

-- El encabezado y sus renglones en UNA transacción: nunca queda un pedido a medias.
-- Si la sede ya envió para esa fecha, falla con PEDIDO_YA_ENVIADO.
create or replace function public.fruver_registrar_envio(p_envio jsonb, p_lineas jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
begin
  begin
    insert into fruver_envios (bodega, sede_nombre, fecha_entrega, dias, enviado_por, enviado_por_id, inventario_en, parametros)
    values (
      p_envio->>'bodega',
      p_envio->>'sede_nombre',
      (p_envio->>'fecha_entrega')::date,
      (p_envio->>'dias')::smallint,
      p_envio->>'enviado_por',
      nullif(p_envio->>'enviado_por_id', '')::uuid,
      nullif(p_envio->>'inventario_en', '')::timestamptz,
      p_envio->'parametros'
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'PEDIDO_YA_ENVIADO';
  end;

  insert into fruver_envio_lineas (envio_id, item, descripcion, subgrupo, um, sugerido, cantidad, origen,
                                   disponible, venta_esperada, merma, ultimo_precio)
  select v_id, l.item, l.descripcion, l.subgrupo, l.um, l.sugerido, l.cantidad, l.origen,
         l.disponible, l.venta_esperada, l.merma, l.ultimo_precio
  from jsonb_to_recordset(p_lineas) as l(
    item text, descripcion text, subgrupo text, um text, sugerido numeric, cantidad numeric, origen text,
    disponible numeric, venta_esperada numeric, merma numeric, ultimo_precio numeric
  );

  return v_id;
end;
$$;

revoke all on function public.fruver_registrar_envio(jsonb, jsonb) from public, anon, authenticated;
