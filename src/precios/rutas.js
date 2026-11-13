import express from "express";
import { respuestaError } from "../http.js";
import { ahoraColombia } from "../pedidos/reglas.js";
import { LISTAS_PRECIO } from "../sedes.js";
import { leerUbicaciones } from "./reglas.js";
import { guardarUbicaciones, preciosDeSede, sedesConLista } from "./servicio.js";

/** Cambiar ubicaciones deja nombre: sin usuario identificado no se guarda, en NINGÚN modo de FRUVER_AUTH. */
function requiereUsuario(request, response, next) {
  if (request.usuario?.email) return next();
  return response.status(401).json({ ok: false, error: "Inicie sesión para guardar las ubicaciones." });
}

/**
 * Precios (etiquetas de góndola):
 *   GET  /?bodega=PV001   → precios vigentes de la lista de la sede (sin bodega: solo las sedes).
 *                           Al instante, con la última lectura de SIESA (`alDia` dice si es de
 *                           hace menos de 5 min). Con `&fresco=1` espera la lectura de SIESA.
 *   PUT  /ubicaciones     → { bodega, cambios: [{ item, ubicacion }] } (requiere usuario)
 */
export function rutasPrecios({ precios, pool, supabase, reloj = ahoraColombia }) {
  const router = express.Router();

  router.get("/", async (request, response) => {
    const bodega = String(request.query.bodega || "");
    if (!bodega) return response.json({ ok: true, data: { sedes: sedesConLista() } });
    if (!LISTAS_PRECIO[bodega]) return response.status(400).json({ ok: false, error: "La sede no tiene lista de precios." });
    try {
      const fresco = request.query.fresco === "1";
      const data = await preciosDeSede({ precios, pool, supabase, bodega, hoy: reloj().fecha, fresco });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar los precios en SIESA.");
    }
  });

  router.put("/ubicaciones", requiereUsuario, async (request, response) => {
    const leido = leerUbicaciones(request.body, Object.keys(LISTAS_PRECIO));
    if (leido.error) return response.status(400).json({ ok: false, error: leido.error });
    try {
      const guardados = await guardarUbicaciones({ supabase, ...leido, usuario: request.usuario });
      return response.json({ ok: true, data: { guardados: Number(guardados) || 0 } });
    } catch (error) {
      return respuestaError(response, error, "No fue posible guardar las ubicaciones.");
    }
  });

  return router;
}
