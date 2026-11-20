import { respuestaError } from "../http.js";
import { DIAS_DEFECTO, DIAS_OPCIONES } from "./reglas.js";
import { calcularAsertividad } from "./servicio.js";

/** Lee `dias` (7, 14 o 28). Si no sirve, devuelve el mensaje de error. */
export function leerDias(query) {
  const dias = query.dias == null || query.dias === "" ? DIAS_DEFECTO : Number(query.dias);
  if (!DIAS_OPCIONES.includes(dias)) return { error: `Los días a medir son ${DIAS_OPCIONES.join(", ")}.` };
  return { dias };
}

/** `GET ?dias` → día por día, lo que el sistema esperaba vender contra lo que se vendió. */
export function manejadorAsertividad({ pool, calcular = calcularAsertividad }) {
  return async (request, response) => {
    const parametros = leerDias(request.query);
    if (parametros.error) return response.status(400).json({ ok: false, error: parametros.error });
    try {
      const data = await calcular({ pool, ...parametros });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible medir la asertividad del sugerido.");
    }
  };
}
