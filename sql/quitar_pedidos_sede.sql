-- =============================================================================
-- Quita las tablas y funciones del "pedido de sede con QR" (versión del
-- 2026-11-05, ya retirada del sistema: hoy solo se muestra el sugerido).
--
-- OPCIONAL. Solo hace falta si esas tablas se instalaron en el Supabase de la
-- intranet. Antes de correrlo, confirmar que no hay pedidos que guardar:
--   select count(*) from public.fruver_pedidos;
-- Borra datos: no tiene vuelta atrás.
-- =============================================================================

begin;

drop function if exists public.fruver_regenerar_token(text, text);
drop function if exists public.fruver_enviar_pedido(bigint, text);
drop function if exists public.fruver_cambiar_cantidad cascade;
drop function if exists public.fruver_abrir_pedido cascade;

drop table if exists public.fruver_pedido_eventos;
drop table if exists public.fruver_pedido_lineas;
drop table if exists public.fruver_pedidos;
drop table if exists public.fruver_sedes;

commit;
