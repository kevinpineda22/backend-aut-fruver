import { respuestaError } from "../http.js";
import { leerRango } from "../envios/rutas.js";
import { ahoraColombia, sumarDias } from "../pedidos/reglas.js";
import { DIAS_DEFECTO } from "./reglas.js";
import { calcularCumplimiento } from "./servicio.js";

/** Por defecto, los últimos 30 días ya cerrados (hasta ayer). */
export function leerRangoCumplimiento(query, hoy) {
  return leerRango({ desde: query.desde || sumarDias(hoy, -DIAS_DEFECTO), hasta: query.hasta || sumarDias(hoy, -1) }, hoy);
}

export function manejadorCumplimiento({ supabase, pool, calcular = calcularCumplimiento, reloj = ahoraColombia }) {
  return async (request, response) => {
    const hoy = reloj().fecha;
    const rango = leerRangoCumplimiento(request.query, hoy);
    if (rango.error) return response.status(400).json({ ok: false, error: rango.error });
    if (!supabase?.configurado) return response.status(503).json({ ok: false, error: "Falta la conexión con la intranet para leer las operaciones." });
    try {
      return response.json({ ok: true, data: await calcular({ supabase, pool, ...rango, hoy }) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible medir el cumplimiento de los proveedores.");
    }
  };
}
