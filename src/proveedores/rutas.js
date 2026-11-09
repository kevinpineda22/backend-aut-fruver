import express from "express";
import { ErrorPublico, respuestaError } from "../http.js";
import { leerFicha, leerListado, leerNit, leerVersion } from "./reglas.js";

const ERRORES = {
  PROVEEDOR_NO_EXISTE: [404, "El proveedor ya no existe."],
  PROVEEDOR_EXISTE: [409, "Ya existe un proveedor con ese NIT."],
  PROVEEDOR_CAMBIO: [409, "Otra persona cambió esta ficha. Cierre y vuelva a abrirla antes de guardar."],
  PRODUCTO_INVALIDO: [400, "Hay productos que no pertenecen a este proveedor."],
  PORTAFOLIO_VACIO: [400, "El proveedor debe conservar al menos un producto."],
  CONTACTOS_INVALIDOS: [400, "Los contactos adicionales deben ser una lista."],
};

export function rutasProveedores({ supabase }) {
  const router = express.Router();
  const manejar = (mensaje, accion) => async (request, response) => {
    try {
      await accion(request, response);
    } catch (error) {
      const codigo = Object.keys(ERRORES).find((c) => error.message?.includes(c));
      const publico = codigo ? new ErrorPublico(ERRORES[codigo][1], ERRORES[codigo][0]) : error;
      return respuestaError(response, publico, mensaje);
    }
  };
  router.get("/", manejar("No fue posible consultar los proveedores.", async (req, res) => {
    res.json({ ok: true, data: await supabase.rpc("fruver_listar_proveedores", leerListado(req.query)) });
  }));
  router.get("/:nit", manejar("No fue posible consultar el proveedor.", async (req, res) => {
    const data = await supabase.rpc("fruver_ficha_proveedor", { p_nit: leerNit(req.params.nit) });
    if (!data) throw new ErrorPublico("El proveedor ya no existe.", 404);
    res.json({ ok: true, data });
  }));
  const guardar = (crear) => manejar("No fue posible guardar el proveedor y su portafolio.", async (req, res) => {
    const nit = crear ? null : leerNit(req.params.nit);
    const ficha = leerFicha(req.body, nit);
    const conContactos = Object.hasOwn(ficha, "contactos");
    const data = await supabase.rpc(conContactos ? "fruver_guardar_proveedor_con_contactos" : "fruver_guardar_proveedor", {
      p_nit: nit || ficha.datos.nit, p_version: ficha.version, p_datos: ficha.datos, p_productos: ficha.productos,
      ...(conContactos ? { p_contactos: ficha.contactos } : {}),
    });
    res.status(crear ? 201 : 200).json({ ok: true, data });
  });
  router.post("/", guardar(true));
  router.put("/:nit", guardar(false));
  router.delete("/:nit", manejar("No fue posible eliminar el proveedor.", async (req, res) => {
    const data = await supabase.rpc("fruver_eliminar_proveedor", {
      p_nit: leerNit(req.params.nit), p_version: leerVersion(req.body?.version),
    });
    res.json({ ok: true, data });
  }));
  return router;
}
