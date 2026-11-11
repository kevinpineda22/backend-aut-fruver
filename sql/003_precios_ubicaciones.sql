-- =============================================================================
-- Automatización Fruver — ubicación de cada producto en la tienda (2026-11-11)
--
-- Sección Precios (etiquetas de góndola). Cada tienda marca dónde exhibe cada
-- producto de fruver:
--   BANCARELLAS — lleva etiqueta de precio (es lo que se imprime)
--   NEVERA      — no lleva etiqueta de góndola
-- Sin registro = BANCARELLAS (igual que el sistema viejo de gestionFruver).
--
-- Reemplaza la columna `ubicacion` de la tabla MySQL `cambio_precios`, que se
-- guardaba POR LISTA de precios. Acá va por sede (bodega); hoy cada sede tiene
-- su propia lista, así que es lo mismo.
--
-- RLS sin políticas: solo el backend (clave secreta) lee y escribe, y escribe
-- solo con fruver_guardar_ubicaciones.
-- Correr UNA vez en el SQL Editor del Supabase de la intranet. Es idempotente.
-- =============================================================================

create table if not exists public.fruver_ubicaciones (
  bodega           text        not null,
  item             text        not null,
  ubicacion        text        not null check (ubicacion in ('BANCARELLAS', 'NEVERA')),
  actualizado_por  text        not null,
  actualizado_en   timestamptz not null default now(),
  primary key (bodega, item)
);

alter table public.fruver_ubicaciones enable row level security;

-- Guarda varios cambios de una sede en una sola transacción.
-- p_cambios: [{ "item": "5098", "ubicacion": "NEVERA" }, ...]
-- Devuelve cuántos productos quedaron guardados.
create or replace function public.fruver_guardar_ubicaciones(
  p_bodega  text,
  p_cambios jsonb,
  p_usuario text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  if coalesce(trim(p_bodega), '') = '' then
    raise exception 'BODEGA_INVALIDA';
  end if;
  if coalesce(trim(p_usuario), '') = '' then
    raise exception 'USUARIO_REQUERIDO';
  end if;

  insert into public.fruver_ubicaciones (bodega, item, ubicacion, actualizado_por, actualizado_en)
  select p_bodega, c->>'item', upper(c->>'ubicacion'), p_usuario, now()
    from jsonb_array_elements(p_cambios) as c
  on conflict (bodega, item) do update
    set ubicacion       = excluded.ubicacion,
        actualizado_por = excluded.actualizado_por,
        actualizado_en  = excluded.actualizado_en
    where fruver_ubicaciones.ubicacion is distinct from excluded.ubicacion;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke all on function public.fruver_guardar_ubicaciones(text, jsonb, text) from public, anon, authenticated;
