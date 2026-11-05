import { ErrorPublico } from "../http.js";
import {
  consultarCompras, consultarDiasAbiertos, consultarMaestro, consultarPerfilHorario,
  consultarUltimoDato, consultarVentas,
} from "./consultas.js";
import { DIAS_MERMA, SEMANAS_HISTORIA, SEMANAS_MARGEN, ahoraColombia, sumarDias } from "./reglas.js";
import { armarSugerido } from "./sugerido.js";

/** 1 = lunes … 7 = domingo (como ISODOW de Postgres). */
const diaIso = (fecha) => ((new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Sugerido de pedido de fruver por sede para la entrega dada.
 * Las consultas van en serie: el pool tiene una sola conexión.
 */
export async function calcularSugerido({ pool, inventario, entrega, dias, momento = new Date() }) {
  const { fecha: hoy, hora } = ahoraColombia(momento);
  const ayer = sumarDias(hoy, -1);
  const desde = sumarDias(hoy, -7 * (SEMANAS_HISTORIA + SEMANAS_MARGEN));
  const mermaDesde = sumarDias(hoy, -DIAS_MERMA);

  const ultimoDato = await consultarUltimoDato(pool);
  const ventas = await consultarVentas(pool, { desde, hasta: ayer });
  if (!ventas.length) throw new ErrorPublico("No hay ventas de fruver en las últimas semanas para calcular el pedido.", 404);
  const items = [...new Set(ventas.map((v) => v.item))];

  // SIESA (red, ~6 s) corre mientras se hacen las consultas chicas de la base.
  const pedidoInventario = inventario.consultar(items).catch((error) => error);
  const abiertas = await consultarDiasAbiertos(pool, { desde, hasta: ayer });
  const perfiles = await consultarPerfilHorario(pool, { desde: sumarDias(hoy, -28), hasta: ayer, diaIso: diaIso(hoy) });
  const compras = await consultarCompras(pool, { desde: mermaDesde, hasta: ayer, items });
  const maestro = await consultarMaestro(pool);

  const stock = await pedidoInventario;
  if (stock instanceof Error) {
    console.error("[pedidos] inventario:", stock.message);
    throw new ErrorPublico("No fue posible consultar el inventario en SIESA. Intente de nuevo en unos minutos.", 502);
  }

  return armarSugerido({
    hoy, hora, entrega, dias, ultimoDato, mermaDesde,
    ventas, abiertas, perfiles, compras, maestro, inventario: stock,
  });
}
