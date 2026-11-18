/* Lee las operaciones (Supabase de la intranet) y mide el cumplimiento de proveedores. */

import { consultarCompras } from "../pedidos/consultas.js";
import { sumarDias } from "../pedidos/reglas.js";
import { medirCumplimiento } from "./reglas.js";

/** Días hacia atrás para buscar el último costo de compra en SIESA. */
const DIAS_COSTO = 90;

/** Productos comprados sin costo en la operación: su último costo de compra en SIESA. */
async function costosDeRespaldo(pool, operaciones, hasta) {
  const items = new Set();
  for (const op of operaciones) for (const c of op.estado?.compras || []) if (c.cantidad > 0 && c.costo == null) items.add(c.item);
  if (!pool || !items.size) return { costos: new Map(), aviso: null };
  try {
    const filas = await consultarCompras(pool, { desde: sumarDias(hasta, -DIAS_COSTO), hasta, items: [...items] });
    return { costos: new Map(filas.filter((f) => f.ultimo_precio > 0).map((f) => [f.item, f.ultimo_precio])), aviso: null };
  } catch (error) {
    console.error("[cumplimiento] costos de SIESA:", error.message);
    return { costos: new Map(), aviso: "No se pudo leer el último costo de SIESA: los productos sin costo en la compra quedan fuera." };
  }
}

export async function calcularCumplimiento({ supabase, pool, desde, hasta, hoy }) {
  const operaciones = (await supabase.select("fruver_operaciones", {
    select: "fecha_entrega,estado",
    and: `(fecha_entrega.gte.${desde},fecha_entrega.lte.${hasta})`,
    order: "fecha_entrega.asc",
  })) || [];
  const { costos, aviso } = await costosDeRespaldo(pool, operaciones, hasta);
  const medido = medirCumplimiento(operaciones, { hoy, costosSiesa: costos });
  return { desde, hasta, ...medido, observaciones: { ...medido.observaciones, avisoCostos: aviso } };
}
