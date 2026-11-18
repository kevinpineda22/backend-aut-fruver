/* =============================================================================
   Cumplimiento de proveedores (nivel de servicio de entrega)

   ¿Cuánto de lo que se le compró a cada proveedor llegó? Se mide con lo que ya
   registra Operaciones (`fruver_operaciones.estado`): las compras dicen qué se
   pidió a quién; los recibos, qué llegó.

   Renglón = (fecha de entrega, producto, proveedor).
     pedido    = Σ compras vigentes de ese producto a ese proveedor
     recibido  = recibos atribuibles a ese renglón (ver `atribuir`)
     cumplido  = min(recibido, pedido)       → lo que se sobreentrega NO compensa
     sobrante  = max(0, recibido − pedido)   → se reporta aparte
   Cumplimiento = Σ cumplido·costo ÷ Σ pedido·costo (en plata, para sumar kilos
   con unidades). Renglón completo = recibió al menos el 98 % (la báscula no es
   exacta).
   ============================================================================= */

/** Tolerancia de peso: con 98 % de lo pedido el renglón cuenta como completo. */
export const TOLERANCIA_COMPLETO = 0.02;
/** Días hacia atrás por defecto. */
export const DIAS_DEFECTO = 30;

const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * A qué renglón (item|nit) va cada recibo:
 * - recibo por compra (`compraId`) → el proveedor de esa compra;
 * - recibo a ciegas con `nit` → ese proveedor;
 * - recibo a ciegas sin `nit` → si a ese producto se le compró a UN solo
 *   proveedor ese día, a él; si a varios, no se puede saber: queda sin atribuir.
 */
export function atribuir(estado) {
  const compras = (estado.compras || []).filter((c) => c.cantidad > 0);
  const lineas = new Map();
  for (const c of compras) {
    const clave = `${c.item}|${c.nit}`;
    const l = lineas.get(clave) || { item: c.item, nit: c.nit, proveedor: c.proveedor || c.nit, pedido: 0, recibido: 0,
      valorCosto: 0, cantidadCosto: 0, recibos: 0 };
    l.pedido = r3(l.pedido + c.cantidad);
    if (c.costo != null) { l.valorCosto += c.costo * c.cantidad; l.cantidadCosto += c.cantidad; }
    lineas.set(clave, l);
  }
  const porId = new Map((estado.compras || []).map((c) => [c.id, c]));
  const proveedoresDe = (item) => [...lineas.values()].filter((l) => l.item === item);
  const sinAtribuir = new Map();
  for (const r of estado.recibos || []) {
    if (!(r.cantidad > 0)) continue;
    let clave = null;
    let item = r.item;
    if (r.compraId) {
      const c = porId.get(r.compraId);
      if (c) { clave = `${c.item}|${c.nit}`; item = c.item; }
    } else if (r.nit) clave = `${r.item}|${r.nit}`;
    else {
      const candidatos = proveedoresDe(r.item);
      if (candidatos.length === 1) clave = `${r.item}|${candidatos[0].nit}`;
    }
    const linea = clave && lineas.get(clave);
    if (linea) { linea.recibido = r3(linea.recibido + r.cantidad); linea.recibos++; } else if (item) {
      sinAtribuir.set(item, r3((sinAtribuir.get(item) || 0) + r.cantidad));
    }
  }
  return {
    lineas: [...lineas.values()].map(({ valorCosto, cantidadCosto, ...l }) => ({
      ...l, costo: cantidadCosto > 0 ? valorCosto / cantidadCosto : null,
      // Un producto con recibo a ciegas sin proveedor y varios proveedores: no se sabe quién falló.
      atribuible: !sinAtribuir.has(l.item),
    })),
    sinAtribuir,
  };
}

/** Estado de un renglón para la tabla. */
export function estadoLinea(l) {
  if (l.recibos === 0) return "sinRecibo";
  if (l.recibido > l.pedido * (1 + TOLERANCIA_COMPLETO)) return "sobre";
  if (l.recibido >= l.pedido * (1 - TOLERANCIA_COMPLETO)) return "completa";
  return "incompleta";
}

function nuevo() {
  return { lineas: 0, completas: 0, sinRecibo: 0, pedidoValor: 0, cumplidoValor: 0, recibidoValor: 0, sobranteValor: 0 };
}

function sumar(m, l) {
  m.lineas++;
  if (l.estado === "completa" || l.estado === "sobre") m.completas++;
  if (l.estado === "sinRecibo") m.sinRecibo++;
  m.pedidoValor += l.pedido * l.costo;
  m.recibidoValor += l.recibido * l.costo;
  m.cumplidoValor += Math.min(l.recibido, l.pedido) * l.costo;
  m.sobranteValor += Math.max(0, l.recibido - l.pedido) * l.costo;
}

function cerrar(m) {
  return {
    ...m,
    cumplimiento: m.pedidoValor > 0 ? m.cumplidoValor / m.pedidoValor : null,
    sobreentrega: m.pedidoValor > 0 ? m.sobranteValor / m.pedidoValor : null,
    completas: m.completas,
    pctCompletas: m.lineas ? m.completas / m.lineas : null,
  };
}

/**
 * Mide el cumplimiento de las operaciones con entrega ANTES de `hoy` (la de hoy
 * todavía se está recibiendo). Una operación con compras y SIN ningún recibo no
 * se mide: no se registró el recibo, no es que no llegó nada.
 *
 * Costo para ponderar, en orden: el de la compra → el promedio del producto en
 * el período → el último costo de compra en SIESA (`costosSiesa`). El costo
 * casi siempre queda pendiente al comprar, así que el respaldo es la regla.
 *
 * @param {{fecha_entrega:string, estado:object}[]} operaciones
 * @param {{hoy:string, costosSiesa?:Map<string, number>}} opciones
 */
export function medirCumplimiento(operaciones, { hoy, costosSiesa = new Map() }) {
  const observaciones = { operaciones: 0, sinReciboRegistrado: [], enCurso: [], lineasSinAtribuir: 0, productosSinAtribuir: [],
    lineasSinCosto: 0 };
  const lineas = [];
  const costosItem = new Map();
  for (const op of operaciones) {
    for (const c of op.estado?.compras || []) {
      if (c.cantidad > 0 && c.costo != null) {
        const s = costosItem.get(c.item) || { v: 0, q: 0 };
        s.v += c.costo * c.cantidad; s.q += c.cantidad;
        costosItem.set(c.item, s);
      }
    }
  }
  for (const op of [...operaciones].sort((a, b) => a.fecha_entrega.localeCompare(b.fecha_entrega))) {
    const estado = op.estado || {};
    if (!(estado.compras || []).some((c) => c.cantidad > 0)) continue;
    if (op.fecha_entrega >= hoy) { observaciones.enCurso.push(op.fecha_entrega); continue; }
    if (!(estado.recibos || []).some((r) => r.cantidad > 0)) { observaciones.sinReciboRegistrado.push(op.fecha_entrega); continue; }
    observaciones.operaciones++;
    const base = new Map((estado.base?.items || []).map((p) => [p.item, p]));
    const { lineas: propias, sinAtribuir } = atribuir(estado);
    for (const [item, cantidad] of sinAtribuir) {
      observaciones.productosSinAtribuir.push({ fecha: op.fecha_entrega, item, descripcion: base.get(item)?.descripcion || item, cantidad });
    }
    for (const l of propias) {
      if (!l.atribuible) { observaciones.lineasSinAtribuir++; continue; }
      const promedio = costosItem.get(l.item);
      const costo = l.costo ?? (promedio ? promedio.v / promedio.q : null) ?? (costosSiesa.get(l.item) > 0 ? costosSiesa.get(l.item) : null);
      if (costo == null) { observaciones.lineasSinCosto++; continue; }
      const linea = { fecha: op.fecha_entrega, item: l.item, descripcion: base.get(l.item)?.descripcion || l.item,
        um: base.get(l.item)?.um || "", nit: l.nit, proveedor: l.proveedor, pedido: l.pedido, recibido: l.recibido,
        costo, costoEstimado: l.costo == null, recibos: l.recibos };
      lineas.push({ ...linea, estado: estadoLinea(linea) });
    }
  }

  const global = nuevo();
  const proveedores = new Map();
  const fechas = new Map();
  for (const l of lineas) {
    sumar(global, l);
    const p = proveedores.get(l.nit) || { nit: l.nit, nombre: l.proveedor, m: nuevo(), productos: new Map() };
    sumar(p.m, l);
    const prod = p.productos.get(l.item) || { item: l.item, descripcion: l.descripcion, um: l.um, pedido: 0, recibido: 0, m: nuevo() };
    prod.pedido = r3(prod.pedido + l.pedido);
    prod.recibido = r3(prod.recibido + l.recibido);
    sumar(prod.m, l);
    p.productos.set(l.item, prod);
    proveedores.set(l.nit, p);
    const f = fechas.get(l.fecha) || nuevo();
    sumar(f, l);
    fechas.set(l.fecha, f);
  }

  return {
    global: cerrar(global),
    proveedores: [...proveedores.values()].map((p) => ({
      nit: p.nit, nombre: p.nombre, ...cerrar(p.m),
      productos: [...p.productos.values()].map(({ m, ...prod }) => ({ ...prod, ...cerrar(m) }))
        .sort((a, b) => b.pedidoValor - a.pedidoValor),
    })).sort((a, b) => b.pedidoValor - a.pedidoValor),
    fechas: [...fechas].map(([fecha, m]) => ({ fecha, ...cerrar(m) })),
    lineas,
    observaciones,
  };
}
