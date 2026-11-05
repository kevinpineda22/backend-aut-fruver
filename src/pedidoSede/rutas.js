import express from "express";
import { respuestaError } from "../http.js";
import { leerParametros } from "../pedidos/rutas.js";
import { ahoraColombia } from "../pedidos/reglas.js";
import { abrirPedido, cambiarCantidad, enviarPedido, sedeDelQr } from "./servicio.js";

export const CANTIDAD_MAXIMA = 100_000;
export const MOTIVO_MAXIMO = 200;

/**
 * Para que haya trazabilidad tiene que haber alguien: sin usuario identificado
 * no se abre ni se cambia nada, en NINGÚN modo de FRUVER_AUTH (en `report` y
 * `off` el middleware deja pasar sin usuario; acá no).
 */
export function requiereUsuario(request, response, next) {
  if (request.usuario?.email) return next();
  return response.status(401).json({ ok: false, error: "Inicie sesion para hacer el pedido de su sede." });
}

/** Lee `cantidad` y `motivo` del cuerpo. Devuelve `{ error }` si no sirven. */
export function leerCambio(body) {
  const cantidad = Number(body?.cantidad);
  if (body?.cantidad == null || body.cantidad === "" || !Number.isFinite(cantidad) || cantidad < 0 || cantidad > CANTIDAD_MAXIMA) {
    return { error: "La cantidad tiene que ser un número entre 0 y 100.000." };
  }
  const motivo = body?.motivo == null ? null : String(body.motivo).trim().slice(0, MOTIVO_MAXIMO) || null;
  return { cantidad: Math.round(cantidad * 1000) / 1000, motivo };
}

export function rutasPedidoSede({ pool, inventario, supabase }) {
  const router = express.Router();
  router.use(requiereUsuario);

  router.post("/verificar", async (request, response) => {
    try {
      return response.json({ ok: true, data: await sedeDelQr(supabase, request.body?.qr) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible verificar el código de la sede.");
    }
  });

  router.post("/pedido", async (request, response) => {
    const parametros = leerParametros(request.body || {}, ahoraColombia().fecha);
    if (parametros.error) return response.status(400).json({ ok: false, error: parametros.error });
    try {
      const data = await abrirPedido({ supabase, pool, inventario, qr: request.body?.qr, ...parametros, usuario: request.usuario });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible abrir el pedido de la sede.");
    }
  });

  router.put("/pedido/:id/lineas/:item", async (request, response) => {
    const cambio = leerCambio(request.body);
    if (cambio.error) return response.status(400).json({ ok: false, error: cambio.error });
    try {
      const data = await cambiarCantidad({
        supabase, qr: request.body?.qr, pedidoId: Number(request.params.id), item: request.params.item,
        ...cambio, usuario: request.usuario,
      });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible guardar la cantidad.");
    }
  });

  router.post("/pedido/:id/enviar", async (request, response) => {
    try {
      const data = await enviarPedido({ supabase, qr: request.body?.qr, pedidoId: Number(request.params.id), usuario: request.usuario });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible enviar el pedido.");
    }
  });

  return router;
}
