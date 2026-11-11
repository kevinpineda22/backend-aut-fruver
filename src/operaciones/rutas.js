import express from "express";
import { ErrorPublico, respuestaError } from "../http.js";
import { enviosEntre } from "../envios/servicio.js";
import { aplicarEnvios } from "../envios/reglas.js";
import { calcularSugerido } from "../pedidos/servicio.js";
import { leerNit } from "../proveedores/reglas.js";
import { alertasEstado, aplicarAccion, baseDeCompra, leerAccion, leerEntrega, productoProveedor } from "./reglas.js";

const permisos = { abrir: "compra", pedidos: "compra", compra: "compra", costo: "compra", recibo: "recibo", despacho: "despacho" };
const permisoAccion = (a) => a.tipo === "ajuste"
  ? ({ compras: "compra", recibos: "recibo", despachos: "despacho" })[a.coleccion] : permisos[a.tipo];
const tabla = "fruver_operaciones";

export function rutasOperaciones({ supabase, pool, inventario, calcular = calcularSugerido, leerEnvios = enviosEntre }) {
  const router = express.Router();
  const manejar = (accion) => async (req, res) => {
    try { await accion(req, res); }
    catch (error) {
      const conflictos = ["OPERACION_CAMBIO", "SOLICITUD_REUTILIZADA"];
      const publico = conflictos.some((c) => error.message?.includes(c))
        ? new ErrorPublico("La operación cambió o el identificador fue reutilizado. Recargue antes de continuar.", 409) : error;
      respuestaError(res, publico, "No fue posible consultar o guardar la operación Fruver.");
    }
  };
  // El prefijo se monta por sección, con permiso enforce; el tipo también se valida.
  router.get("/", manejar(async (req, res) => {
    const entrega = leerEntrega(req.query.entrega);
    const filas = await supabase.select(tabla, { select: "*", fecha_entrega: `eq.${entrega}` });
    const operacion = filas[0] || null;
    res.json({ ok: true, data: operacion ? { ...operacion, alertas: alertasEstado(operacion.estado) } : null });
  }));
  router.get("/proveedores", manejar(async (req, res) => {
    if (req.fruverSeccion !== "compra") throw new ErrorPublico("No tiene permiso para consultar portafolios.", 403);
    const item = String(req.query.item || "").trim();
    if (!item || item.length > 100) throw new ErrorPublico("Seleccione un producto.", 400);
    // Se usa el contrato del directorio existente, sin depender de su tabla privada.
    const proveedores = [];
    for (let pagina = 1; ; pagina += 1) {
      const lista = await supabase.rpc("fruver_listar_proveedores", { p_buscar: "", p_pagina: pagina });
      if (!Array.isArray(lista?.proveedores) || !Number.isFinite(lista.total) || !lista.porPagina) {
        throw new ErrorPublico("El directorio de proveedores devolvió una respuesta inválida.", 502);
      }
      for (let i = 0; i < lista.proveedores.length; i += 8) {
        const fichas = await Promise.all(lista.proveedores.slice(i, i + 8)
          .map((p) => supabase.rpc("fruver_ficha_proveedor", { p_nit: p.nit })));
        for (const ficha of fichas) if (productoProveedor(ficha, item)) {
          proveedores.push({ nit: ficha.datos.nit, nombre: ficha.datos.nombre_comercial || ficha.datos.razon_social,
            productos: ficha.productos.map((p) => ({
              referencia: p.referencia_producto, descripcion: p.descripcion_producto, um: p.unidad_medida,
            })) });
        }
      }
      if (pagina * lista.porPagina >= lista.total) break;
      if (!lista.proveedores.length) throw new ErrorPublico("El directorio cambió durante la consulta. Intente de nuevo.", 409);
    }
    res.json({ ok: true, data: proveedores });
  }));
  router.post("/", manejar(async (req, res) => {
    const entrega = leerEntrega(req.body?.entrega);
    const accion = leerAccion(req.body);
    if (permisoAccion(accion) !== req.fruverSeccion) throw new ErrorPublico("No tiene permiso para esta acción.", 403);
    if (!req.usuario?.email) throw new ErrorPublico("Inicie sesión para registrar operaciones.", 401);
    const solicitud = { ...accion, entrega };
    // Reintentar una respuesta perdida no vuelve a sumar cantidades.
    const previos = await supabase.select("fruver_operacion_eventos", {
      select: "solicitud", id: `eq.${accion.solicitud}`,
    });
    if (previos.length) {
      const mismas = Object.keys(solicitud).length === Object.keys(previos[0].solicitud).length
        && Object.entries(solicitud).every(([k, v]) => previos[0].solicitud[k] === v);
      if (!mismas) throw new ErrorPublico("El identificador ya corresponde a otra solicitud.", 409);
      return res.json({ ok: true, data: { guardado: true, repetido: true } });
    }
    const filas = await supabase.select(tabla, { select: "*", fecha_entrega: `eq.${entrega}` });
    const actual = filas[0];
    if ((actual?.version || 0) !== accion.version) throw new ErrorPublico("Otra persona registró cambios. Recargue antes de continuar.", 409);
    let estado;
    let evento;
    if (["abrir", "pedidos"].includes(accion.tipo)) {
      if (accion.tipo === "abrir" && actual) throw new ErrorPublico("La operación ya está abierta.", 409);
      if (accion.tipo === "pedidos" && !actual) throw new ErrorPublico("Abra primero la operación.", 409);
      const envios = await leerEnvios({ supabase, desde: entrega, hasta: entrega });
      if (!envios.length) throw new ErrorPublico("Ninguna sede ha enviado pedido para esta fecha.", 400);
      const datos = await calcular({ pool, inventario, entrega, dias: 1 });
      const base = baseDeCompra(aplicarEnvios(datos, envios));
      if (!base.items.length) throw new ErrorPublico("No hay productos comprables en los pedidos enviados.", 400);
      if (actual) {
        for (const p of base.items) {
          const anterior = actual.estado.base.items.find((i) => i.item === p.item);
          if (anterior) {
            p.acopioDisponible = anterior.acopioDisponible;
            p.comprar = p.acopioDisponible == null ? null : Math.max(0, p.pedidoTiendas - p.acopioDisponible);
          }
        }
        for (const p of actual.estado.base.items) if (!base.items.some((i) => i.item === p.item)) base.items.push(p);
        base.inventarioEn = actual.estado.base.inventarioEn;
      }
      estado = actual ? { ...actual.estado, base } : { base, compras: [], recibos: [], despachos: [] };
      evento = { antes: actual?.estado.base || null, despues: base, alertas: alertasEstado(estado),
        motivo: actual ? "Actualización de pedidos; se conserva el inventario inicial" : "Apertura con pedidos e inventario del acopio" };
    } else {
      if (!actual) throw new ErrorPublico("Compras debe abrir la operación para esta entrega.", 409);
      const proveedor = accion.tipo === "compra"
        ? await supabase.rpc("fruver_ficha_proveedor", { p_nit: leerNit(accion.nit) }) : null;
      ({ estado, evento } = aplicarAccion(actual.estado, accion, proveedor));
    }
    const data = await supabase.rpc("fruver_guardar_operacion", {
      p_entrega: entrega, p_version: accion.version, p_estado: estado,
      p_solicitud: solicitud, p_evento: { ...evento, tipo: accion.tipo, usuario: req.usuario.email, usuario_id: req.usuario.userId || null },
    });
    res.status(201).json({ ok: true, data });
  }));
  router.get("/historial", manejar(async (req, res) => {
    const entrega = leerEntrega(req.query.entrega);
    const pagina = Number(req.query.pagina || 1);
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) throw new ErrorPublico("La página no es válida.", 400);
    const eventos = await supabase.select("fruver_operacion_eventos", {
      select: "id,fecha_entrega,version,creado_en,evento", fecha_entrega: `eq.${entrega}`,
      order: "version.desc", limit: 50, offset: (pagina - 1) * 50,
    });
    res.json({ ok: true, data: eventos });
  }));
  return router;
}
