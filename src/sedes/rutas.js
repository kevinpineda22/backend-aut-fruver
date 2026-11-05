import express from "express";
import { respuestaError } from "../http.js";
import { requiereUsuario } from "../pedidoSede/rutas.js";
import { listarSedes, regenerarToken } from "./sedes.js";

/** Administración de sedes y sus QR (para imprimir los adhesivos). */
export function rutasSedes({ supabase }) {
  const router = express.Router();
  router.use(requiereUsuario);

  router.get("/", async (_request, response) => {
    try {
      return response.json({ ok: true, data: await listarSedes(supabase) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible leer las sedes.");
    }
  });

  router.post("/:bodega/token", async (request, response) => {
    try {
      const data = await regenerarToken(supabase, request.params.bodega, request.usuario.email);
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible cambiar el código de la sede.");
    }
  });

  return router;
}
