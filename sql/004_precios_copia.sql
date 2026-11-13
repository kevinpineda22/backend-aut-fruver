-- =============================================================================
-- Automatización Fruver — última lectura de precios de SIESA (2026-11-13)
--
-- Leer los precios de fruver en Connekta tarda ~13 s (10 páginas de 1000 filas;
-- Connekta vuelve a correr la consulta entera por cada página y no deja pedir
-- más de 1000). Con la copia solo en memoria, cada instancia nueva de Vercel
-- hacía esperar esos 13 s a quien abría la pantalla.
--
-- Acá se guarda la ÚLTIMA lectura (una sola fila). La pantalla abre con esta
-- copia al instante y, si tiene más de 5 minutos, pide la fresca y NO deja
-- imprimir hasta tenerla: nunca sale una etiqueta con un precio viejo.
--
-- `filas` va en columnas: { "campos": [...], "datos": [[...], ...] } — los
-- nombres no se repiten en cada una de las ~7.300 filas.
--
-- RLS sin políticas: solo el backend (clave secreta) lee y escribe, y escribe
-- solo con fruver_guardar_copia_precios.
-- Correr UNA vez en el SQL Editor del Supabase de la intranet. Es idempotente.
-- =============================================================================

create table if not exists public.fruver_precios_copia (
  id              smallint    primary key default 1 check (id = 1),
  filas           jsonb       not null,
  consultado_en   timestamptz not null,
  actualizado_en  timestamptz not null default now()
);

alter table public.fruver_precios_copia enable row level security;

-- Guarda la lectura solo si es MÁS NUEVA que la guardada: dos instancias que
-- leen SIESA a la vez no se pisan con una lectura más vieja.
-- Devuelve true si la guardó.
create or replace function public.fruver_guardar_copia_precios(
  p_filas         jsonb,
  p_consultado_en timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fruver_precios_copia (id, filas, consultado_en, actualizado_en)
  values (1, p_filas, p_consultado_en, now())
  on conflict (id) do update
    set filas          = excluded.filas,
        consultado_en  = excluded.consultado_en,
        actualizado_en = excluded.actualizado_en
    where fruver_precios_copia.consultado_en < excluded.consultado_en;
  return found;
end;
$$;

revoke all on function public.fruver_guardar_copia_precios(jsonb, timestamptz) from public, anon, authenticated;
