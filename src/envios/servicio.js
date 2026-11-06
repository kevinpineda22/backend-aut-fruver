/* Lectura y escritura de los pedidos enviados (Supabase de la intranet). */

import { respuestaEnvio } from "./reglas.js";

const SELECT = "id,bodega,sede_nombre,fecha_entrega,dias,enviado_por,enviado_en,"
  + "fruver_envio_lineas(item,descripcion,subgrupo,um,sugerido,cantidad,origen,disponible,venta_esperada,merma,ultimo_precio)";

/** Guarda el pedido y devuelve cómo quedó. Falla con PEDIDO_YA_ENVIADO si la sede ya envió. */
export async function registrarEnvio({ supabase, envio, lineas, usuario }) {
  const id = await supabase.rpc("fruver_registrar_envio", {
    p_envio: { ...envio, enviado_por: usuario.email, enviado_por_id: usuario.userId || null },
    p_lineas: lineas,
  });
  const filas = await supabase.select("fruver_envios", { select: SELECT, id: `eq.${id}` });
  return respuestaEnvio(filas[0]);
}

/** El pedido que ya envió una sede para esa entrega, o null. */
export async function envioDeSede({ supabase, bodega, entrega }) {
  const filas = await supabase.select("fruver_envios", { select: SELECT, bodega: `eq.${bodega}`, fecha_entrega: `eq.${entrega}` });
  return filas?.[0] ? respuestaEnvio(filas[0]) : null;
}

/** Pedidos enviados con entrega entre `desde` y `hasta` (incluidas). */
export async function enviosEntre({ supabase, desde, hasta }) {
  const filas = await supabase.select("fruver_envios", {
    select: SELECT,
    and: `(fecha_entrega.gte.${desde},fecha_entrega.lte.${hasta})`,
    order: "fecha_entrega.desc,enviado_en.desc",
  });
  return (filas || []).map(respuestaEnvio);
}
