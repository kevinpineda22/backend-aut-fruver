import { ErrorPublico } from "../http.js";
import { calcularSugerido } from "../pedidos/servicio.js";
import { sedePorToken } from "../sedes/sedes.js";
import { lineasDeSede, respuestaPedido } from "./reglas.js";

const COLUMNAS_LINEA = "item,descripcion,subgrupo,um,sugerido,cantidad,origen,motivo,venta_esperada,disponible,"
  + "inventario_al_recibir,merma,ultimo_precio,armado,actualizado_por,actualizado_en";

/** La sede del QR, o 403. Se pide en cada escritura: prueba que el líder está en la sede. */
export async function sedeDelQr(supabase, qr) {
  const sede = await sedePorToken(supabase, qr);
  if (!sede) throw new ErrorPublico("El código QR no corresponde a ninguna sede activa. Escanee el adhesivo de su sede.", 403);
  return sede;
}

async function leerPedido(supabase, filtro) {
  const pedidos = await supabase.select("fruver_pedidos", { select: "*", ...filtro });
  const pedido = pedidos?.[0];
  if (!pedido) return null;
  const lineas = await supabase.select("fruver_pedido_lineas", { select: COLUMNAS_LINEA, pedido_id: `eq.${pedido.id}` });
  return { pedido, lineas };
}

/**
 * Abre el pedido de la sede del QR para esa entrega. Si ya existe, lo devuelve
 * como está (con lo que el líder ya cambió). Si no, calcula el sugerido y lo
 * crea con esas cantidades. El sugerido queda fijo desde ese momento.
 */
export async function abrirPedido({ supabase, pool, inventario, qr, entrega, dias, usuario }) {
  const sede = await sedeDelQr(supabase, qr);
  const filtro = { bodega: `eq.${sede.bodega}`, fecha_entrega: `eq.${entrega}` };

  let existente = await leerPedido(supabase, filtro);
  if (!existente) {
    const sugerido = await calcularSugerido({ pool, inventario, entrega, dias });
    const lineas = lineasDeSede(sugerido, sede.bodega);
    if (!lineas.length) throw new ErrorPublico("Esta sede no tiene ventas de fruver recientes para sugerir un pedido.", 404);
    await supabase.rpc("fruver_abrir_pedido", {
      p_bodega: sede.bodega,
      p_entrega: entrega,
      p_dias: dias,
      p_usuario: usuario.email,
      p_usuario_id: usuario.userId || null,
      p_parametros: sugerido.parametros,
      p_inventario_en: sugerido.inventario.consultadoEn,
      p_lineas: lineas,
    });
    existente = await leerPedido(supabase, filtro);
  }
  return respuestaPedido(existente.pedido, existente.lineas, sede);
}

/** El pedido, verificando que sea de la sede del QR que tiene el líder en la mano. */
async function pedidoDeLaSede(supabase, qr, pedidoId) {
  const sede = await sedeDelQr(supabase, qr);
  const actual = await leerPedido(supabase, { id: `eq.${pedidoId}` });
  if (!actual) throw new ErrorPublico("El pedido no existe.", 404);
  if (actual.pedido.bodega !== sede.bodega) throw new ErrorPublico("Este pedido es de otra sede.", 403);
  return { sede, actual };
}

export async function cambiarCantidad({ supabase, qr, pedidoId, item, cantidad, motivo, usuario }) {
  await pedidoDeLaSede(supabase, qr, pedidoId);
  return supabase.rpc("fruver_cambiar_cantidad", {
    p_pedido: pedidoId, p_item: item, p_cantidad: cantidad, p_motivo: motivo || null, p_usuario: usuario.email,
  });
}

export async function enviarPedido({ supabase, qr, pedidoId, usuario }) {
  const { sede } = await pedidoDeLaSede(supabase, qr, pedidoId);
  await supabase.rpc("fruver_enviar_pedido", { p_pedido: pedidoId, p_usuario: usuario.email });
  const actual = await leerPedido(supabase, { id: `eq.${pedidoId}` });
  return respuestaPedido(actual.pedido, actual.lineas, sede);
}

/** Pedidos de todas las sedes para una entrega, con sus cantidades (para compras). */
export async function pedidosDeEntrega(supabase, entrega) {
  if (!supabase?.configurado) return null;
  return supabase.select("fruver_pedidos", {
    select: "bodega,estado,enviado_por,enviado_en,fruver_pedido_lineas(item,cantidad)",
    fecha_entrega: `eq.${entrega}`,
  });
}
