import { respuestaError } from "../http.js";
import { SEMANAS_DEFECTO, SEMANAS_MAX, SEMANAS_MIN } from "./reglas.js";
import { calcularAsertividad } from "./servicio.js";

/** Lee `semanas`. Si no sirve, devuelve el mensaje de error. */
export function leerSemanas(query) {
  const semanas = query.semanas == null || query.semanas === "" ? SEMANAS_DEFECTO : Number(query.semanas);
  if (!Number.isInteger(semanas) || semanas < SEMANAS_MIN || semanas > SEMANAS_MAX) {
    return { error: `Las semanas a medir van de ${SEMANAS_MIN} a ${SEMANAS_MAX}.` };
  }
  return { semanas };
}

/** `GET ?semanas` → cuánto se equivocó la venta esperada contra lo vendido. */
export function manejadorAsertividad({ pool, calcular = calcularAsertividad }) {
  return async (request, response) => {
    const parametros = leerSemanas(request.query);
    if (parametros.error) return response.status(400).json({ ok: false, error: parametros.error });
    try {
      const data = await calcular({ pool, ...parametros });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible medir la asertividad del sugerido.");
    }
  };
}
