import express from "express";
import { fechaValida, respuestaError } from "../http.js";
import { DIAS_COBERTURA_MAX, DIAS_ENTREGA_MAX, ahoraColombia, sumarDias } from "./reglas.js";
import { calcularSugerido } from "./servicio.js";
import { aplicarPedidosSede } from "../pedidoSede/reglas.js";
import { pedidosDeEntrega } from "../pedidoSede/servicio.js";

/** Lee `entrega` y `dias`. Si no sirven, devuelve el mensaje de error. */
export function leerParametros(query, hoy) {
  const entrega = String(query.entrega || sumarDias(hoy, 1));
  const dias = query.dias == null || query.dias === "" ? 1 : Number(query.dias);
  if (!fechaValida(entrega)) return { error: "La fecha de entrega no es valida." };
  if (entrega <= hoy) return { error: "La entrega tiene que ser despues de hoy." };
  if (entrega > sumarDias(hoy, DIAS_ENTREGA_MAX)) return { error: `La entrega puede ser hasta ${DIAS_ENTREGA_MAX} dias adelante.` };
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_COBERTURA_MAX) {
    return { error: `Los dias a cubrir van de 1 a ${DIAS_COBERTURA_MAX}.` };
  }
  return { entrega, dias };
}

/**
 * Pedidos que las sedes ya hicieron para esa entrega. Si la base de pedidos no
 * está configurada o falla, la compra sale igual con el sugerido y se avisa.
 */
async function conPedidosSede(supabase, sugerido, entrega) {
  try {
    const pedidos = await pedidosDeEntrega(supabase, entrega);
    if (!pedidos) return { ...sugerido, pedidosSede: null };
    return aplicarPedidosSede(sugerido, pedidos);
  } catch (error) {
    console.error("[pedidos] no se pudieron leer los pedidos de sede:", error.message);
    return { ...sugerido, pedidosSede: null, avisoPedidosSede: "No se pudieron leer los pedidos de las sedes: la compra usa solo el sugerido." };
  }
}

export function rutasPedidos({ pool, inventario, supabase }) {
  const router = express.Router();

  router.get("/sugerido", async (request, response) => {
    const { fecha: hoy } = ahoraColombia();
    const parametros = leerParametros(request.query, hoy);
    if (parametros.error) return response.status(400).json({ ok: false, error: parametros.error });
    try {
      const sugerido = await calcularSugerido({ pool, inventario, ...parametros });
      const data = await conPedidosSede(supabase, sugerido, parametros.entrega);
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible calcular el pedido sugerido.");
    }
  });

  return router;
}
