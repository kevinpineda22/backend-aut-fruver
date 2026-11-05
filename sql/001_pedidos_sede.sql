-- =============================================================================
-- Automatización Fruver — pedidos de sede con trazabilidad
--
-- Se corre UNA vez en el Supabase de la intranet (SQL Editor). Es idempotente:
-- correrlo de nuevo no rompe ni duplica.
--
-- Qué guarda:
--   fruver_sedes          una fila por sede, con el código de su QR.
--   fruver_pedidos        el pedido de una sede para una fecha de entrega.
--   fruver_pedido_lineas  un renglón por producto: lo que SUGIRIÓ el sistema (y
--                         con qué datos), lo que PIDIÓ el líder, y si lo cambió.
--   fruver_pedido_eventos cada cosa que pasó: abrir, cambiar una cantidad, enviar.
--
-- Seguridad: RLS encendido y SIN políticas → con la anon key no se lee ni se
-- escribe nada. Solo el backend (service role) toca estas tablas, y es el backend
-- el que decide quién puede (FRUVER_AUTH + ruta asignada + QR de la sede).
--
-- Las funciones fruver_* hacen cada cambio Y su evento en una sola transacción:
-- no hay forma de cambiar una cantidad sin que quede registrado.
-- =============================================================================

create table if not exists public.fruver_sedes (
  bodega                text primary key,
  nombre                text not null,
  qr_token              text not null unique default replace(gen_random_uuid()::text, '-', ''),
  activa                boolean not null default true,
  token_actualizado_en  timestamptz not null default now(),
  token_actualizado_por text
);

insert into public.fruver_sedes (bodega, nombre) values
  ('PV001', 'Principal Copacabana'),
  ('00301', 'Girardota Parque'),
  ('00201', 'Villahermosa'),
  ('00701', 'Barbosa'),
  ('00401', 'Girardota Llano'),
  ('00601', 'Las Vegas'),
  ('00801', 'San Juan')
on conflict (bodega) do nothing;

create table if not exists public.fruver_pedidos (
  id                       bigint generated always as identity primary key,
  bodega                   text not null references public.fruver_sedes (bodega),
  fecha_entrega            date not null,
  dias_cobertura           smallint not null default 1 check (dias_cobertura between 1 and 4),
  estado                   text not null default 'borrador' check (estado in ('borrador', 'enviado')),
  creado_por               text not null,
  creado_por_id            uuid,
  creado_en                timestamptz not null default now(),
  enviado_por              text,
  enviado_en               timestamptz,
  -- Con qué datos se calculó el sugerido (hora, último día de ventas, cobertura…).
  parametros               jsonb not null default '{}'::jsonb,
  inventario_consultado_en timestamptz,
  unique (bodega, fecha_entrega)
);

create table if not exists public.fruver_pedido_lineas (
  pedido_id             bigint not null references public.fruver_pedidos (id) on delete cascade,
  item                  text not null,
  descripcion           text not null,
  subgrupo              text,
  um                    text,
  -- Lo que propuso el sistema. No cambia nunca después de abrir el pedido.
  sugerido              numeric not null,
  -- Lo que pide el líder. Arranca igual al sugerido.
  cantidad              numeric not null check (cantidad >= 0),
  origen                text generated always as (case when cantidad = sugerido then 'sugerido' else 'manual' end) stored,
  motivo                text,
  -- Los datos con que se calculó ESE sugerido, para poder evaluarlo después
  -- aunque la fórmula cambie.
  venta_esperada        numeric,
  disponible            numeric,
  inventario_al_recibir numeric,
  merma                 numeric,
  ultimo_precio         numeric,
  armado                boolean not null default false,
  actualizado_por       text,
  actualizado_en        timestamptz not null default now(),
  primary key (pedido_id, item)
);

create table if not exists public.fruver_pedido_eventos (
  id               bigint generated always as identity primary key,
  pedido_id        bigint not null references public.fruver_pedidos (id) on delete cascade,
  item             text,
  accion           text not null check (accion in ('abrir', 'cambiar_cantidad', 'enviar')),
  cantidad_antes   numeric,
  cantidad_despues numeric,
  motivo           text,
  usuario          text not null,
  en               timestamptz not null default now()
);

create index if not exists fruver_pedidos_entrega_idx on public.fruver_pedidos (fecha_entrega);
create index if not exists fruver_eventos_pedido_idx on public.fruver_pedido_eventos (pedido_id, en);

alter table public.fruver_sedes          enable row level security;
alter table public.fruver_pedidos        enable row level security;
alter table public.fruver_pedido_lineas  enable row level security;
alter table public.fruver_pedido_eventos enable row level security;

-- -----------------------------------------------------------------------------
-- Abrir el pedido de una sede para una entrega. Si ya existe, lo devuelve tal
-- cual (no pisa lo que el líder ya cambió). Si no, lo crea con las líneas del
-- sugerido. `p_lineas`: [{ item, descripcion, subgrupo, um, sugerido,
-- venta_esperada, disponible, inventario_al_recibir, merma, ultimo_precio, armado }]
-- -----------------------------------------------------------------------------
create or replace function public.fruver_abrir_pedido(
  p_bodega text, p_entrega date, p_dias smallint, p_usuario text, p_usuario_id uuid,
  p_parametros jsonb, p_inventario_en timestamptz, p_lineas jsonb
) returns jsonb
language plpgsql as $$
declare
  v_id bigint;
begin
  select id into v_id from public.fruver_pedidos where bodega = p_bodega and fecha_entrega = p_entrega;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'creado', false);
  end if;

  insert into public.fruver_pedidos (bodega, fecha_entrega, dias_cobertura, creado_por, creado_por_id, parametros, inventario_consultado_en)
  values (p_bodega, p_entrega, p_dias, p_usuario, p_usuario_id, coalesce(p_parametros, '{}'::jsonb), p_inventario_en)
  on conflict (bodega, fecha_entrega) do nothing
  returning id into v_id;

  -- Otro líder lo abrió en el mismo instante: se devuelve el suyo.
  if v_id is null then
    select id into v_id from public.fruver_pedidos where bodega = p_bodega and fecha_entrega = p_entrega;
    return jsonb_build_object('id', v_id, 'creado', false);
  end if;

  insert into public.fruver_pedido_lineas (
    pedido_id, item, descripcion, subgrupo, um, sugerido, cantidad,
    venta_esperada, disponible, inventario_al_recibir, merma, ultimo_precio, armado, actualizado_por)
  select v_id, l.item, l.descripcion, l.subgrupo, l.um, l.sugerido, l.sugerido,
         l.venta_esperada, l.disponible, l.inventario_al_recibir, l.merma, l.ultimo_precio, coalesce(l.armado, false), p_usuario
    from jsonb_to_recordset(p_lineas) as l(
      item text, descripcion text, subgrupo text, um text, sugerido numeric, venta_esperada numeric,
      disponible numeric, inventario_al_recibir numeric, merma numeric, ultimo_precio numeric, armado boolean);

  insert into public.fruver_pedido_eventos (pedido_id, accion, usuario) values (v_id, 'abrir', p_usuario);
  return jsonb_build_object('id', v_id, 'creado', true);
end $$;

-- -----------------------------------------------------------------------------
-- Cambiar la cantidad de un producto. Solo en borrador. Deja el evento con el
-- antes y el después. Devuelve el renglón como quedó.
-- -----------------------------------------------------------------------------
create or replace function public.fruver_cambiar_cantidad(
  p_pedido bigint, p_item text, p_cantidad numeric, p_motivo text, p_usuario text
) returns jsonb
language plpgsql as $$
declare
  v_estado text;
  v_antes  numeric;
  v_linea  public.fruver_pedido_lineas;
begin
  select estado into v_estado from public.fruver_pedidos where id = p_pedido for update;
  if v_estado is null then raise exception 'PEDIDO_NO_EXISTE'; end if;
  if v_estado <> 'borrador' then raise exception 'PEDIDO_ENVIADO'; end if;
  if p_cantidad is null or p_cantidad < 0 then raise exception 'CANTIDAD_INVALIDA'; end if;

  select cantidad into v_antes from public.fruver_pedido_lineas where pedido_id = p_pedido and item = p_item for update;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;

  update public.fruver_pedido_lineas
     set cantidad = p_cantidad,
         -- Volver al sugerido borra el motivo: ya no hay nada que justificar.
         motivo = case when p_cantidad = sugerido then null else nullif(trim(p_motivo), '') end,
         actualizado_por = p_usuario, actualizado_en = now()
   where pedido_id = p_pedido and item = p_item
  returning * into v_linea;

  if v_antes is distinct from p_cantidad then
    insert into public.fruver_pedido_eventos (pedido_id, item, accion, cantidad_antes, cantidad_despues, motivo, usuario)
    values (p_pedido, p_item, 'cambiar_cantidad', v_antes, p_cantidad, v_linea.motivo, p_usuario);
  end if;
  return to_jsonb(v_linea);
end $$;

-- -----------------------------------------------------------------------------
-- Enviar el pedido: queda cerrado para cambios.
-- -----------------------------------------------------------------------------
create or replace function public.fruver_enviar_pedido(p_pedido bigint, p_usuario text)
returns jsonb
language plpgsql as $$
declare
  v_pedido public.fruver_pedidos;
begin
  update public.fruver_pedidos
     set estado = 'enviado', enviado_por = p_usuario, enviado_en = now()
   where id = p_pedido and estado = 'borrador'
  returning * into v_pedido;
  if v_pedido.id is null then
    if exists (select 1 from public.fruver_pedidos where id = p_pedido) then raise exception 'PEDIDO_ENVIADO'; end if;
    raise exception 'PEDIDO_NO_EXISTE';
  end if;
  insert into public.fruver_pedido_eventos (pedido_id, accion, usuario) values (p_pedido, 'enviar', p_usuario);
  return to_jsonb(v_pedido);
end $$;

-- -----------------------------------------------------------------------------
-- Cambiar el código QR de una sede (si un adhesivo se pierde o se filtra).
-- El adhesivo viejo deja de servir en el acto.
-- -----------------------------------------------------------------------------
create or replace function public.fruver_regenerar_token(p_bodega text, p_usuario text)
returns jsonb
language plpgsql as $$
declare
  v_sede public.fruver_sedes;
begin
  update public.fruver_sedes
     set qr_token = replace(gen_random_uuid()::text, '-', ''), token_actualizado_en = now(), token_actualizado_por = p_usuario
   where bodega = p_bodega
  returning * into v_sede;
  if v_sede.bodega is null then raise exception 'SEDE_NO_EXISTE'; end if;
  return to_jsonb(v_sede);
end $$;

-- Las funciones las llama solo el backend con la service role.
revoke all on function public.fruver_abrir_pedido(text, date, smallint, text, uuid, jsonb, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.fruver_cambiar_cantidad(bigint, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.fruver_enviar_pedido(bigint, text) from public, anon, authenticated;
revoke all on function public.fruver_regenerar_token(text, text) from public, anon, authenticated;
grant execute on function public.fruver_abrir_pedido(text, date, smallint, text, uuid, jsonb, timestamptz, jsonb) to service_role;
grant execute on function public.fruver_cambiar_cantidad(bigint, text, numeric, text, text) to service_role;
grant execute on function public.fruver_enviar_pedido(bigint, text) to service_role;
grant execute on function public.fruver_regenerar_token(text, text) to service_role;
