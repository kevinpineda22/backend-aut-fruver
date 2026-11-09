import express from "express";
import { fechaValida, respuestaError } from "../http.js";
import { HORA_PUBLICACION_TEXTO, ahoraColombia, sugeridoPublicado, sumarDias } from "../pedidos/reglas.js";
import { leerEnvio } from "./reglas.js";
import { envioDeSede, enviosEntre, registrarEnvio } from "./servicio.js";

/** Días máximos que abarca una consulta de Seguimiento. */
export const RANGO_MAXIMO = 92;

/**
 * Para que el seguimiento sirva tiene que haber alguien: sin usuario
 * identificado no se envía nada, en NINGÚN modo de FRUVER_AUTH (en `report` y
 * `off` el middleware deja pasar sin usuario; acá no).
 */
export function requiereUsuario(request, response, next) {
  if (request.usuario?.email) return next();
  return response.status(401).json({ ok: false, error: "Inicie sesión para enviar el pedido de su sede." });
}

/**
 * No se envía antes de la publicación: una pestaña abierta desde ayer todavía
 * tiene en pantalla un sugerido viejo y podría mandarlo.
 */
export function sugeridoAbierto(reloj = ahoraColombia) {
  return (_request, response, next) => {
    if (sugeridoPublicado(reloj().hora)) return next();
    return response.status(409).json({ ok: false, error: `El sugerido de hoy se publica a las ${HORA_PUBLICACION_TEXTO}. Envíe el pedido después de esa hora.` });
  };
}

/** Lee `desde` y `hasta` de Seguimiento. Por defecto, las últimas dos semanas y lo que viene. */
export function leerRango(query, hoy) {
  const desde = String(query.desde || sumarDias(hoy, -14));
  const hasta = String(query.hasta || sumarDias(hoy, 7));
  if (!fechaValida(desde) || !fechaValida(hasta)) return { error: "Las fechas no son válidas." };
  if (desde > hasta) return { error: "La fecha inicial es posterior a la final." };
  if (sumarDias(desde, RANGO_MAXIMO) < hasta) return { error: `El rango puede ser de hasta ${RANGO_MAXIMO} días.` };
  return { desde, hasta };
}

/** Sugerido por sede: ver el pedido ya enviado y enviar uno. */
export function rutasEnvio({ supabase }) {
  const router = express.Router();

  router.get("/", async (request, response) => {
    const bodega = String(request.query.bodega || "");
    const entrega = String(request.query.entrega || "");
    if (!bodega || !fechaValida(entrega)) return response.status(400).json({ ok: false, error: "Falta la sede o la fecha de entrega." });
    try {
      return response.json({ ok: true, data: await envioDeSede({ supabase, bodega, entrega }) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar el pedido de la sede.");
    }
  });

  router.post("/", requiereUsuario, sugeridoAbierto(), async (request, response) => {
    const leido = leerEnvio(request.body);
    if (leido.error) return response.status(400).json({ ok: false, error: leido.error });
    const { fecha: hoy } = ahoraColombia();
    if (leido.envio.fecha_entrega <= hoy) {
      return response.status(400).json({ ok: false, error: "La entrega tiene que ser después de hoy." });
    }
    try {
      const data = await registrarEnvio({ supabase, ...leido, usuario: request.usuario });
      return response.status(201).json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible enviar el pedido.");
    }
  });

  return router;
}

/** Seguimiento: los pedidos enviados en un rango de fechas de entrega. */
export function rutasSeguimiento({ supabase }) {
  const router = express.Router();
  router.get("/", async (request, response) => {
    const rango = leerRango(request.query, ahoraColombia().fecha);
    if (rango.error) return response.status(400).json({ ok: false, error: rango.error });
    try {
      return response.json({ ok: true, data: { ...rango, envios: await enviosEntre({ supabase, ...rango }) } });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar el seguimiento.");
    }
  });
  return router;
}
