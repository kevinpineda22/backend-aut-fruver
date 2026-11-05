import express from "express";
import { fechaValida, respuestaError } from "../http.js";
import { DIAS_COBERTURA_MAX, DIAS_ENTREGA_MAX, ahoraColombia, sumarDias } from "./reglas.js";
import { calcularSugerido } from "./servicio.js";

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

export function rutasPedidos({ pool, inventario }) {
  const router = express.Router();

  router.get("/sugerido", async (request, response) => {
    const { fecha: hoy } = ahoraColombia();
    const parametros = leerParametros(request.query, hoy);
    if (parametros.error) return response.status(400).json({ ok: false, error: parametros.error });
    try {
      const data = await calcularSugerido({ pool, inventario, ...parametros });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible calcular el pedido sugerido.");
    }
  });

  return router;
}
