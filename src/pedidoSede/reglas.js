/* =============================================================================
   Pedido de sede (el que sube el líder) — reglas puras

   El sistema le PROPONE al líder la cantidad (el sugerido de su sede) y él
   decide. Cada renglón guarda las dos cosas, el sugerido y lo pedido, más los
   datos con que se calculó el sugerido: así después se puede medir quién
   acertó más, el sistema o el líder, aunque la fórmula cambie.
   ============================================================================= */

import { redondear } from "../pedidos/reglas.js";

/**
 * Renglones del pedido de una sede, sacados del sugerido completo.
 * Un producto sin inventario leído (sugerido null) entra con sugerido 0: el
 * líder igual lo puede pedir.
 */
export function lineasDeSede(sugerido, bodega) {
  return sugerido.items
    .filter((i) => i.sedes[bodega])
    .map((i) => {
      const l = i.sedes[bodega];
      return {
        item: i.item,
        descripcion: i.descripcion,
        subgrupo: i.subgrupo,
        um: i.um,
        sugerido: l.sugerido ?? 0,
        venta_esperada: l.ventaEsperada,
        disponible: l.disponible,
        inventario_al_recibir: l.inventarioAlRecibir,
        merma: i.merma,
        ultimo_precio: i.ultimoPrecio,
        armado: i.armado,
      };
    });
}

/**
 * Lo que necesita la pantalla del líder: el pedido, sus renglones (en el orden
 * en que se venden más) y un resumen.
 */
export function respuestaPedido(pedido, lineas, sede) {
  const orden = [...(lineas || [])].sort((a, b) =>
    Number(b.venta_esperada || 0) * Number(b.ultimo_precio || 1) - Number(a.venta_esperada || 0) * Number(a.ultimo_precio || 1)
    || String(a.descripcion).localeCompare(String(b.descripcion)));
  const manuales = orden.filter((l) => l.origen === "manual").length;
  return {
    sede,
    pedido: {
      id: pedido.id,
      fechaEntrega: pedido.fecha_entrega,
      diasCobertura: pedido.dias_cobertura,
      estado: pedido.estado,
      creadoPor: pedido.creado_por,
      creadoEn: pedido.creado_en,
      enviadoPor: pedido.enviado_por,
      enviadoEn: pedido.enviado_en,
      inventarioConsultadoEn: pedido.inventario_consultado_en,
    },
    lineas: orden,
    resumen: {
      productos: orden.length,
      conPedido: orden.filter((l) => Number(l.cantidad) > 0).length,
      manuales,
      valorEstimado: orden.reduce((s, l) => s + (l.armado ? 0 : Number(l.cantidad || 0) * Number(l.ultimo_precio || 0)), 0),
    },
  };
}

/**
 * Lleva los pedidos de las sedes a la compra consolidada. Una sede que ENVIÓ su
 * pedido cuenta con lo que pidió el líder; una que no, con el sugerido. Así
 * compras ve lo que de verdad se pidió en cuanto llega, y lo demás estimado.
 *
 * @param {object} resultado respuesta de armarSugerido (no se modifica)
 * @param {Array}  pedidos   [{ bodega, estado, enviado_por, enviado_en, fruver_pedido_lineas: [{ item, cantidad }] }]
 */
export function aplicarPedidosSede(resultado, pedidos) {
  const enviados = new Map(
    (pedidos || []).filter((p) => p.estado === "enviado")
      .map((p) => [p.bodega, new Map((p.fruver_pedido_lineas || []).map((l) => [String(l.item), Number(l.cantidad)]))]),
  );

  const items = resultado.items.map((item) => {
    const sedes = {};
    let pedidoTiendas = 0;
    let incompleto = false;
    for (const [bodega, linea] of Object.entries(item.sedes)) {
      const delLider = enviados.get(bodega);
      const pedido = delLider ? (delLider.get(item.item) ?? 0) : null;
      sedes[bodega] = { ...linea, pedido };
      const cuenta = pedido ?? linea.sugerido;
      if (cuenta == null) incompleto = true;
      else pedidoTiendas += cuenta;
    }
    const comprar = item.armado || incompleto || item.acopioDisponible == null
      ? null
      : redondear(Math.max(0, pedidoTiendas - item.acopioDisponible));
    return {
      ...item,
      sedes,
      pedidoTiendas: incompleto ? null : pedidoTiendas,
      comprar,
      valorEstimado: comprar != null && item.ultimoPrecio != null ? comprar * item.ultimoPrecio : null,
    };
  });

  return {
    ...resultado,
    items,
    totales: {
      ...resultado.totales,
      conCompra: items.filter((i) => i.comprar > 0).length,
      valorEstimado: items.reduce((s, i) => s + (i.valorEstimado || 0), 0),
    },
    pedidosSede: resultado.sedes.map((s) => {
      const p = (pedidos || []).find((x) => x.bodega === s.codigo);
      return {
        bodega: s.codigo,
        estado: p?.estado || "sin_abrir",
        enviadoPor: p?.enviado_por || null,
        enviadoEn: p?.enviado_en || null,
      };
    }),
  };
}
