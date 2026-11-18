/* Toma la foto del sugerido de compra y la guarda en el Supabase de la intranet. */

import { ahoraColombia } from "../pedidos/reglas.js";
import { calcularSugerido } from "../pedidos/servicio.js";
import { MOMENTO_PUBLICACION, armarFoto, pedidoDeLaFoto } from "./reglas.js";

/**
 * Calcula el sugerido de la entrega de mañana y lo guarda. Si ya había foto de
 * hoy, no la pisa: `{ guardada: false, yaExistia: true }`.
 * Con `guardar: false` solo calcula (para probar sin escribir).
 */
export async function tomarFoto({ pool, inventario, supabase, momento = new Date(), guardar = true, calcular = calcularSugerido }) {
  const { fecha: hoy } = ahoraColombia(momento);
  const sugerido = await calcular({ pool, inventario, ...pedidoDeLaFoto(hoy), momento });
  const { foto, items } = armarFoto(sugerido, { momento: MOMENTO_PUBLICACION });
  const resumen = { fecha: foto.fecha, entrega: foto.entrega, productos: items.length, ...foto.resumen };
  if (!guardar) return { guardada: false, ...resumen, foto, items };
  const id = await supabase.rpc("fruver_guardar_foto_sugerido", { p_foto: foto, p_items: items });
  return { guardada: id != null, yaExistia: id == null, id, ...resumen };
}
