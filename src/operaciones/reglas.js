import { ErrorPublico, fechaValida } from "../http.js";

export const redondear = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fallar = (mensaje, status = 400) => { throw new ErrorPublico(mensaje, status); };
const motivosCompra = new Set([
  "Stock de seguridad",
  "Producto agotado",
  "Inventario fantasma en el acopio PV009: las existencias registradas no están disponibles físicamente.",
]);

export function leerEntrega(valor) {
  if (typeof valor !== "string" || !fechaValida(valor)
    || new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) !== valor) fallar("La fecha de entrega no es válida.");
  return valor;
}

export function leerAccion(body) {
  if (!body || !uuid(body.solicitud) || !Number.isSafeInteger(body.version) || body.version < 0) {
    fallar("Recargue la operación: faltan su identificador o versión.");
  }
  if (!["abrir", "pedidos", "compra", "compras", "recibo", "recibo_ciego", "despacho", "despachos", "ajuste", "costo"].includes(body.tipo)) fallar("La operación no es válida.");
  const a = { solicitud: body.solicitud, version: body.version, tipo: body.tipo };
  if (a.tipo === "despachos") {
    if (typeof body.bodega !== "string" || !body.bodega.trim() || body.bodega.length > 100) fallar("Seleccione una sede válida.");
    if (body.motivo != null && (typeof body.motivo !== "string" || body.motivo.length > 2000)) fallar("El motivo no es válido.");
    if (!Array.isArray(body.lineas) || !body.lineas.length || body.lineas.length > 500) fallar("Ingrese entre 1 y 500 productos para despachar.");
    a.bodega = body.bodega.trim();
    a.motivo = body.motivo?.trim() || "";
    a.lineas = body.lineas.map((linea) => {
      const l = leerAccion({ ...linea, tipo: "despacho", version: a.version });
      if (!l.item) fallar("Seleccione el producto a despachar.");
      return { solicitud: l.solicitud, item: l.item, cantidad: l.cantidad };
    });
    if (new Set(a.lineas.map((l) => l.item)).size !== a.lineas.length
      || new Set([a.solicitud, ...a.lineas.map((l) => l.solicitud)]).size !== a.lineas.length + 1) {
      fallar("Hay productos o identificadores repetidos en el despacho.");
    }
    return a;
  }
  if (a.tipo === "compras") {
    if (!Array.isArray(body.lineas) || !body.lineas.length || body.lineas.length > 500) fallar("Seleccione entre 1 y 500 asignaciones a proveedores para comprar.");
    a.lineas = body.lineas.map((linea) => {
      const l = leerAccion({ ...linea, tipo: "compra", version: a.version });
      if (!l.item || !l.nit) fallar("Cada producto debe tener referencia y proveedor.");
      return { solicitud: l.solicitud, item: l.item, nit: l.nit, cantidad: l.cantidad, costo: l.costo, motivo: l.motivo || "" };
    });
    if (new Set(a.lineas.map((l) => JSON.stringify([l.item, l.nit]))).size !== a.lineas.length
      || new Set([a.solicitud, ...a.lineas.map((l) => l.solicitud)]).size !== a.lineas.length + 1) {
      fallar("Hay productos con el mismo proveedor o identificadores repetidos en la compra.");
    }
    return a;
  }
  if (a.tipo === "recibo_ciego") {
    if (typeof body.nit !== "string" || !body.nit.trim() || body.nit.length > 100) fallar("Seleccione el proveedor del recibo.");
    a.nit = body.nit.trim();
    if (!Array.isArray(body.lineas) || !body.lineas.length || body.lineas.length > 500) fallar("Agregue entre 1 y 500 productos al recibo.");
    a.lineas = body.lineas.map((linea) => {
      const l = leerAccion({ ...linea, tipo: "recibo", version: a.version });
      if (!l.item) fallar("Seleccione el producto que está recibiendo.");
      return { solicitud: l.solicitud, item: l.item, cantidad: l.cantidad };
    });
    if (new Set(a.lineas.map((l) => l.item)).size !== a.lineas.length
      || new Set([a.solicitud, ...a.lineas.map((l) => l.solicitud)]).size !== a.lineas.length + 1) {
      fallar("Hay productos o identificadores repetidos en el recibo.");
    }
    return a;
  }
  for (const campo of ["item", "nit", "compraId", "bodega", "objetivoId", "coleccion", "motivo"]) {
    if (body[campo] != null && (typeof body[campo] !== "string" || body[campo].length > 2000)) fallar(`El campo ${campo} no es válido.`);
    if (body[campo] != null) a[campo] = body[campo].trim();
  }
  if (["compra", "recibo", "despacho", "ajuste"].includes(a.tipo)) {
    if (typeof body.cantidad !== "number" || !Number.isFinite(body.cantidad)
      || body.cantidad < (a.tipo === "ajuste" || (a.tipo === "compra" && a.motivo === "Producto agotado") ? 0 : 0.001) || body.cantidad > 1e9
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

function itemRecibo(estado, recibo) {
  const item = recibo.item || estado.compras.find((c) => c.id === recibo.compraId)?.item;
  if (!item) fallar("Hay un recibo sin producto asociado. Revise la operación en Seguimiento.", 409);
  return item;
}

export function vistaRecibo(estado) {
  const proveedores = new Map();
  for (const c of estado.compras.filter((c) => c.cantidad > 0)) {
    if (!proveedores.has(c.nit)) proveedores.set(c.nit, { nit: c.nit, nombre: c.proveedor, items: [] });
    const proveedor = proveedores.get(c.nit);
    if (!proveedor.items.includes(c.item)) proveedor.items.push(c.item);
  }
  return {
    proveedores: [...proveedores.values()],
    base: { items: estado.base.items.filter((p) => estado.compras.some((c) => c.item === p.item && c.cantidad > 0))
      .map(({ item, descripcion, um }) => ({ item, descripcion, um })) },
    recibos: estado.recibos.map((r) => ({ id: r.id, item: itemRecibo(estado, r), cantidad: r.cantidad })),
  };
}

export function resumenRecibo(estado, lineas = [], nit = null) {
  const proveedor = nit === null ? null : estado.compras.find((c) => c.nit === nit)?.proveedor;
  const reciboDelProveedor = (r) => r.nit === nit
    || (r.compraId && estado.compras.some((c) => c.id === r.compraId && c.nit === nit));
  return estado.base.items.map((p) => {
    const comprado = suma(estado.compras, (c) => c.item === p.item && (nit === null || c.nit === nit));
    const recibido = suma(estado.recibos, (r) => itemRecibo(estado, r) === p.item && (nit === null || reciboDelProveedor(r)));
    return { item: p.item, descripcion: p.descripcion, um: p.um, comprado, recibido,
      ...(nit !== null && { nit, proveedor }),
      enEsteRecibo: suma(lineas, (l) => l.item === p.item), diferencia: redondear(recibido - comprado) };
  }).filter((p) => p.comprado > 0 || p.recibido > 0);
}

export function aplicarReciboCiego(estado, lineas, nit) {
  const nuevo = structuredClone(estado);
  const proveedor = nuevo.compras.find((c) => c.nit === nit && c.cantidad > 0);
  if (!proveedor) fallar("Seleccione un proveedor con compras vigentes para esta entrega.");
  const recibos = [];
  for (const l of lineas) {
    if (!nuevo.base.items.some((p) => p.item === l.item)
      || !nuevo.compras.some((c) => c.item === l.item && c.nit === nit && c.cantidad > 0)) fallar("Seleccione un producto disponible para recibir de este proveedor.");
    if (nuevo.recibos.some((r) => r.id === l.solicitud)) fallar("El recibo ya fue registrado. Recargue la operación.", 409);
    const recibo = { id: l.solicitud, item: l.item, cantidad: l.cantidad, nit, proveedor: proveedor.proveedor };
    nuevo.recibos.push(recibo);
    recibos.push(recibo);
  }
  return { estado: nuevo, evento: { antes: null, despues: recibos, alertas: alertasEstado(nuevo),
    nit, proveedor: proveedor.proveedor, resumen: resumenRecibo(nuevo, recibos, nit),
    motivo: `Recibo a ciegas del proveedor ${proveedor.proveedor} (NIT ${nit}).` } };
}

export function reporteDespacho(estado, bodega = null, lineas = []) {
  const totales = new Map(estado.base.items.map((p) => [p.item, {
    comprado: suma(estado.compras, (c) => c.item === p.item),
    recibido: suma(estado.recibos, (r) => itemRecibo(estado, r) === p.item),
    despachadoTotal: suma(estado.despachos, (d) => d.item === p.item),
  }]));
  return estado.base.sedes.filter((s) => bodega === null || s.codigo === bodega).flatMap((s) =>
    estado.base.items.filter((p) => Object.hasOwn(p.sedes, s.codigo)).map((p) => {
      const { comprado, recibido, despachadoTotal } = totales.get(p.item);
      const despachadoSede = suma(estado.despachos, (d) => d.item === p.item && d.bodega === s.codigo);
      return { item: p.item, descripcion: p.descripcion, um: p.um, bodega: s.codigo, sede: s.nombre,
        pedido: p.sedes[s.codigo], comprado, recibido, despachadoTotal, despachadoSede,
        enEsteDespacho: suma(lineas, (l) => l.item === p.item && l.bodega === s.codigo),
        disponible: redondear(recibido - despachadoTotal),
        diferenciaSede: redondear(despachadoSede - p.sedes[s.codigo]),
        diferenciaReciboCompra: redondear(recibido - comprado) };
    }));
}

export function aplicarDespachos(estado, accion) {
  const nuevo = structuredClone(estado);
  if (!nuevo.base.sedes.some((s) => s.codigo === accion.bodega)) fallar("Seleccione una sede válida.");
  const filas = [];
  for (const l of accion.lineas) {
    const producto = nuevo.base.items.find((p) => p.item === l.item);
    if (!producto || !Object.hasOwn(producto.sedes, accion.bodega)) fallar("La sede no pidió este producto.");
    if (nuevo.despachos.some((d) => d.id === l.solicitud)) fallar("El despacho ya fue registrado. Recargue la operación.", 409);
    const fila = { id: l.solicitud, item: l.item, bodega: accion.bodega, cantidad: l.cantidad, siesaEstado: "pendiente_conector" };
    nuevo.despachos.push(fila);
    filas.push(fila);
  }
  const alertas = alertasEstado(nuevo);
  const relevantes = alertas.filter((a) => filas.some((f) => f.item === a.item)
    && (["DESPACHO_SIN_EXISTENCIAS", "DESPACHO_COMPRA_RECIBO_DIFERENTE"].includes(a.codigo)
      || (a.codigo === "DESPACHO_DIFERENTE" && a.bodega === accion.bodega)));
  if (relevantes.length && !accion.motivo) fallar("Hay diferencias entre pedido, compra, recibo o despacho. Ingrese un motivo para continuar.");
  return { estado: nuevo, evento: { antes: null, despues: filas, alertas, motivo: accion.motivo || null,
    reporteDespacho: reporteDespacho(nuevo, accion.bodega, filas), siesaEstado: "pendiente_conector" } };
}

export function alertasEstado(estado) {
  const alertas = [];
  for (const p of estado.base.items) {
    const comprado = suma(estado.compras, (c) => c.item === p.item);
    if (p.comprar == null) alertas.push({ codigo: "REFERENCIA_SIN_INVENTARIO", item: p.item });
    else if (diferente(comprado, p.comprar)) alertas.push(aviso("COMPRA_DIFERENTE", p.item, p.comprar, comprado));
    const recibido = suma(estado.recibos, (r) => itemRecibo(estado, r) === p.item);
    if (estado.recibos.some((r) => r.item === p.item) && diferente(recibido, comprado)) {
      alertas.push(aviso("RECIBO_PRODUCTO_DIFERENTE", p.item, comprado, recibido));
    }
    const despachado = suma(estado.despachos, (d) => d.item === p.item);
    if (despachado > recibido + 0.0005) {
      alertas.push(aviso("DESPACHO_SIN_EXISTENCIAS", p.item, recibido, despachado));
    }
    if (despachado > 0 && diferente(recibido, comprado)) {
      alertas.push(aviso("DESPACHO_COMPRA_RECIBO_DIFERENTE", p.item, comprado, recibido));
    }
    for (const [bodega, cantidad] of Object.entries(p.sedes)) {
      const enviado = suma(estado.despachos, (d) => d.item === p.item && d.bodega === bodega);
      if (diferente(enviado, cantidad)) alertas.push(aviso("DESPACHO_DIFERENTE", p.item, cantidad, enviado, { bodega }));
    }
  }
  for (const c of estado.compras) {
    const recibido = suma(estado.recibos, (r) => r.compraId === c.id);
    if (!estado.recibos.some((r) => r.item === c.item) && diferente(recibido, c.cantidad)) {
      alertas.push(aviso("RECIBO_DIFERENTE", c.item, c.cantidad, recibido, { compraId: c.id }));
    }
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
    envios: datos.envios.filter((e) => e.enviado).map((e) => ({
      bodega: e.bodega, sedeNombre: datos.sedes.find((s) => s.codigo === e.bodega)?.nombre || e.bodega,
    })),
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
export function aplicarAccion(estado, accion, proveedor = null, compraEnLote = false) {
  const nuevo = structuredClone(estado);
  const producto = nuevo.base.items.find((p) => p.item === accion.item);
  let antes = null;
  let despues;
  let item;
  if (accion.tipo === "compra") {
    if (!producto || !proveedor || !productoProveedor(proveedor, producto.item)) fallar("El proveedor no vende este producto o no pertenece al pedido.");
    if (nuevo.compras.some((c) => c.id === accion.solicitud)) fallar("El identificador del producto ya fue registrado. Recargue la operación.", 409);
    item = producto.item;
    despues = { id: accion.solicitud, item, nit: proveedor.datos.nit,
      proveedor: proveedor.datos.nombre_comercial || proveedor.datos.razon_social,
      cantidad: accion.cantidad, costo: accion.costo, motivo: accion.motivo || null };
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
    despues = { id: accion.solicitud, item, bodega: accion.bodega, cantidad: accion.cantidad, siesaEstado: "pendiente_conector" };
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
    if (accion.tipo === "compra") return !compraEnLote && ["COMPRA_DIFERENTE", "REFERENCIA_SIN_INVENTARIO"].includes(a.codigo);
    if (accion.tipo === "recibo") return a.codigo === "RECIBO_DIFERENTE" && a.compraId === accion.compraId;
    if (accion.tipo === "despacho") return ["DESPACHO_SIN_EXISTENCIAS", "DESPACHO_COMPRA_RECIBO_DIFERENTE"].includes(a.codigo)
      || (a.codigo === "DESPACHO_DIFERENTE" && a.bodega === accion.bodega);
    return false;
  });
  if (relevantes.length && !accion.motivo) fallar("Hay diferencias de cantidades o inventario. Ingrese un motivo para continuar.");
  if (accion.tipo === "compra" && relevantes.length && !motivosCompra.has(accion.motivo)) {
    fallar("Seleccione un motivo de compra: Stock de seguridad, Producto agotado o inventario fantasma.");
  }
  return { estado: nuevo, evento: { antes, despues, alertas, motivo: accion.motivo || null } };
}

export function aplicarCompras(estado, lineas, proveedores) {
  let nuevo = estado;
  const detalles = [];
  for (const linea of lineas) {
    const resultado = aplicarAccion(nuevo, { ...linea, tipo: "compra" }, proveedores.get(linea.nit), true);
    nuevo = resultado.estado;
    detalles.push(resultado.evento);
  }
  const alertas = alertasEstado(nuevo);
  for (const linea of lineas) {
    if (!linea.motivo && alertas.some((a) => a.item === linea.item
      && ["COMPRA_DIFERENTE", "REFERENCIA_SIN_INVENTARIO"].includes(a.codigo))) {
      fallar("Hay diferencias de cantidades o inventario. Ingrese un motivo para continuar.");
    }
    if (alertas.some((a) => a.item === linea.item && ["COMPRA_DIFERENTE", "REFERENCIA_SIN_INVENTARIO"].includes(a.codigo))
      && !motivosCompra.has(linea.motivo)) {
      fallar("Seleccione un motivo de compra: Stock de seguridad, Producto agotado o inventario fantasma.");
    }
  }
  return { estado: nuevo, evento: {
    antes: null, despues: detalles.map((e) => e.despues), detalles, alertas,
    motivo: lineas.filter((l) => l.motivo).map((l) => `${l.item}: ${l.motivo}`).join("\n") || null,
  } };
}
