import { timingSafeEqual } from "node:crypto";
import process from "node:process";
import { respuestaError } from "../http.js";
import { tomarFoto } from "./servicio.js";

/**
 * Vercel Cron manda `Authorization: Bearer $CRON_SECRET`. Sin secreto
 * configurado la ruta queda CERRADA (503): una ruta que escribe en la base no
 * puede quedar abierta por olvidar una variable.
 */
export function cronAutorizado(secreto = process.env.CRON_SECRET) {
  return (request, response, next) => {
    // Un cron que falla en silencio pierde la foto del día sin que nadie se entere: se registra todo rechazo.
    if (!secreto) {
      console.error("[cron] rechazado: CRON_SECRET no está configurado en este deploy.");
      return response.status(503).json({ ok: false, error: "CRON_SECRET no está configurado." });
    }
    const enviado = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(enviado);
    const b = Buffer.from(secreto);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      console.warn(`[cron] rechazado: ${enviado ? "clave distinta a CRON_SECRET" : "sin clave"} (${request.headers["user-agent"] || "sin user-agent"}).`);
      return response.status(401).json({ ok: false, error: "No autorizado." });
    }
    return next();
  };
}

export function manejadorFotoSugerido({ pool, inventario, supabase, tomar = tomarFoto }) {
  return async (_request, response) => {
    if (!supabase?.configurado) return response.status(503).json({ ok: false, error: "Falta la conexión con la intranet para guardar la foto." });
    try {
      const resultado = await tomar({ pool, inventario, supabase });
      console.log(`[foto-sugerido] ${resultado.fecha} → entrega ${resultado.entrega}: ${resultado.guardada ? `guardada (id ${resultado.id})` : "ya existía"}, ${resultado.productos} productos`);
      return response.json({ ok: true, data: resultado });
    } catch (error) {
      console.error("[foto-sugerido] falló:", error.message);
      return respuestaError(response, error, "No fue posible tomar la foto del sugerido.");
    }
  };
}
