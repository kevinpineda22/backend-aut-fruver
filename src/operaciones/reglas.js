import { ErrorPublico, fechaValida } from "../http.js";

export const redondear = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fallar = (mensaje, status = 400) => { throw new ErrorPublico(mensaje, status); };

export function leerEntrega(valor) {
  if (typeof valor !== "string" || !fechaValida(valor)
    || new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) !== valor) fallar("La fecha de entrega no es válida.");
  return valor;
}

export function leerAccion(body) {
  if (!body || !uuid(body.solicitud) || !Number.isSafeInteger(body.version) || body.version < 0) {
    fallar("Recargue la operación: faltan su identificador o versión.");
  }
  if (!["abrir", "pedidos", "compra", "recibo", "despacho", "ajuste", "costo"].includes(body.tipo)) fallar("La operación no es válida.");
  const a = { solicitud: body.solicitud, version: body.version, tipo: body.tipo };
  for (const campo of ["item", "nit", "compraId", "bodega", "objetivoId", "coleccion", "motivo"]) {
    if (body[campo] != null && (typeof body[campo] !== "string" || body[campo].length > 2000)) fallar(`El campo ${campo} no es válido.`);
    if (body[campo] != null) a[campo] = body[campo].trim();
  }
  if (["compra", "recibo", "despacho", "ajuste"].includes(a.tipo)) {
    if (typeof body.cantidad !== "number" || !Number.isFinite(body.cantidad)
      || body.cantidad < (a.tipo === "ajuste" ? 0 : 0.001) || body.cantidad > 1e9
      || Math.abs(redondear(body.cantidad) - body.cantidad) > 1e-8) fallar("Ingrese una cantidad válida, con máximo tres decimales.");
    a.cantidad = body.cantidad;
  }
  if (["compra", "costo"].includes(a.tipo)) {
    if (body.costo != null && (typeof body.costo !== "number" || !Number.isFinite(body.costo) || body.costo < 0 || body.costo > 1e9
      || Math.abs(redondear(body.costo) - body.costo) > 1e-8)) fallar("El costo unitario debe ser un número no negativo con máximo tres decimales, o quedar pendiente.");
    a.costo = body.costo ?? null;
  }
  if (["ajuste", "costo"].includes(a.tipo) && !a.motivo) fallar("Explique el motivo del ajuste.");
  return a;
}

// SIESA expone tanto el item numérico como su referencia A-000123.
export function referenciaItem(valor) {
  const texto = String(valor ?? "").trim();
  const match = /^(?:A-)?0*(\d+)$/i.exec(texto);
  return match ? match[1] : texto;
}

export function productoProveedor(ficha, item) {
  return ficha?.productos?.some((p) => referenciaItem(p.referencia_producto) === referenciaItem(item));
}

const suma = (filas, filtro) => redondear(filas.filter(filtro).reduce((s, f) => s + f.cantidad, 0));
const diferente = (a, b) => Math.abs(a - b) > 0.0005;
const aviso = (codigo, item, esperado, actual, extra = {}) => ({
  codigo, item, esperado, actual, diferencia: redondear(actual - esperado), ...extra,
});

export function alertasEstado(estado) {
  const alertas = [];
  for (const p of estado.base.items) {
    const comprado = suma(estado.compras, (c) => c.item === p.item);
    if (p.comprar == null) alertas.push({ codigo: "REFERENCIA_SIN_INVENTARIO", item: p.item });
    else if (diferente(comprado, p.comprar)) alertas.push(aviso("COMPRA_DIFERENTE", p.item, p.comprar, comprado));
    const recibido = suma(estado.recibos, (r) => estado.compras.some((c) => c.id === r.compraId && c.item === p.item));
    const despachado = suma(estado.despachos, (d) => d.item === p.item);
    if (p.acopioDisponible == null && despachado > 0) alertas.push({ codigo: "EXISTENCIA_DESCONOCIDA", item: p.item });
    else if (p.acopioDisponible != null && despachado > redondear(p.acopioDisponible + recibido)) {
      alertas.push(aviso("DESPACHO_SIN_EXISTENCIAS", p.item, redondear(p.acopioDisponible + recibido), despachado));
    }
    for (const [bodega, cantidad] of Object.entries(p.sedes)) {
      const enviado = suma(estado.despachos, (d) => d.item === p.item && d.bodega === bodega);
      if (diferente(enviado, cantidad)) alertas.push(aviso("DESPACHO_DIFERENTE", p.item, cantidad, enviado, { bodega }));
    }
  }
  for (const c of estado.compras) {
    const recibido = suma(estado.recibos, (r) => r.compraId === c.id);
    if (diferente(recibido, c.cantidad)) alertas.push(aviso("RECIBO_DIFERENTE", c.item, c.cantidad, recibido, { compraId: c.id }));
    if (c.costo == null && c.cantidad > 0) alertas.push({ codigo: "COSTO_PENDIENTE", item: c.item, compraId: c.id });
  }
  return alertas;
}

export function baseDeCompra(datos) {
  if (!Array.isArray(datos.envios) || datos.avisoEnvios) fallar("No se pudieron leer los pedidos enviados. No se puede abrir la compra.", 503);
  if (!datos.envios.some((e) => e.enviado)) fallar("Ninguna sede ha enviado pedido para esta fecha.");
  return {
    inventarioEn: datos.inventario.consultadoEn,
    sedes: datos.sedes,
    items: datos.items.filter((p) => !p.armado && p.pedidoTiendas > 0).map((p) => ({
      item: p.item, descripcion: p.descripcion, um: p.um, pedidoTiendas: p.pedidoTiendas,
      comprar: p.acopioDisponible == null ? null : redondear(Math.max(0, p.pedidoTiendas - p.acopioDisponible)),
      acopioDisponible: p.acopioDisponible,
      sedes: Object.fromEntries(Object.entries(p.sedes)
        .filter(([bodega, l]) => datos.envios.some((e) => e.bodega === bodega && e.enviado) && l.pedido != null)
        .map(([bodega, l]) => [bodega, l.pedido])),
    })),
  };
}

/** Historial inmutable: el estado cambia, pero cada evento conserva antes/después. */
export function aplicarAccion(estado, accion, proveedor = null) {
  const nuevo = structuredClone(estado);
  const producto = nuevo.base.items.find((p) => p.item === accion.item);
  let antes = null;
  let despues;
  let item;
  if (accion.tipo === "compra") {
    if (!producto || !proveedor || !productoProveedor(proveedor, producto.item)) fallar("El proveedor no vende este producto o no pertenece al pedido.");
    item = producto.item;
    despues = { id: accion.solicitud, item, nit: proveedor.datos.nit,
      proveedor: proveedor.datos.nombre_comercial || proveedor.datos.razon_social,
      cantidad: accion.cantidad, costo: accion.costo };
    nuevo.compras.push(despues);
  } else if (accion.tipo === "recibo") {
    const compra = nuevo.compras.find((c) => c.id === accion.compraId);
    if (!compra || compra.cantidad === 0) fallar("Seleccione una compra vigente.");
    item = compra.item;
    despues = { id: accion.solicitud, compraId: compra.id, cantidad: accion.cantidad };
    nuevo.recibos.push(despues);
  } else if (accion.tipo === "despacho") {
    if (!producto || !Object.hasOwn(producto.sedes, accion.bodega)) fallar("La sede no pidió este producto.");
    item = producto.item;
    despues = { id: accion.solicitud, item, bodega: accion.bodega, cantidad: accion.cantidad };
    nuevo.despachos.push(despues);
  } else if (["ajuste", "costo"].includes(accion.tipo)) {
    const coleccion = accion.tipo === "costo" ? "compras" : accion.coleccion;
    if (!["compras", "recibos", "despachos"].includes(coleccion)) fallar("El ajuste no es válido.");
    const fila = nuevo[coleccion].find((f) => f.id === accion.objetivoId);
    if (!fila) fallar("El registro a ajustar ya no existe.", 409);
    antes = { ...fila };
    if (accion.tipo === "costo") fila.costo = accion.costo;
    else fila.cantidad = accion.cantidad;
    despues = { ...fila };
    item = fila.item || nuevo.compras.find((c) => c.id === fila.compraId).item;
  } else fallar("La acción requiere una operación abierta.");
  const alertas = alertasEstado(nuevo);
  const relevantes = alertas.filter((a) => {
    if (a.item !== item) return false;
    if (accion.tipo === "compra") return ["COMPRA_DIFERENTE", "REFERENCIA_SIN_INVENTARIO"].includes(a.codigo);
    if (accion.tipo === "recibo") return a.codigo === "RECIBO_DIFERENTE" && a.compraId === accion.compraId;
    if (accion.tipo === "despacho") return ["DESPACHO_SIN_EXISTENCIAS", "EXISTENCIA_DESCONOCIDA"].includes(a.codigo)
      || (a.codigo === "DESPACHO_DIFERENTE" && a.bodega === accion.bodega);
    return false;
  });
  if (relevantes.length && !accion.motivo) fallar("Hay diferencias de cantidades o inventario. Ingrese un motivo para continuar.");
  return { estado: nuevo, evento: { antes, despues, alertas, motivo: accion.motivo || null } };
}
