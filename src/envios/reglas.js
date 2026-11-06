/* =============================================================================
   Pedidos que envían las sedes — reglas puras (sin base ni red)

   El líder ve el sugerido de su sede, cambia lo que no le parece, quita lo que
   no quiere y agrega lo que el sistema no sugirió. Al enviar, cada renglón se
   guarda con lo que el sistema sugirió, lo que pidió el líder y su ORIGEN:

     sugerido   — sugerido > 0 y pidió exactamente eso
     modificado — sugerido > 0 y pidió otra cantidad (> 0)
     quitado    — sugerido > 0 y no lo pidió (cantidad 0)
     agregado   — el sistema no sugería nada (0 o sin dato) y lo pidió

   Lo que ni se sugirió ni se pidió no se guarda.
   ============================================================================= */

import { fechaValida } from "../http.js";
import { redondear } from "../pedidos/reglas.js";

export const CANTIDAD_MAXIMA = 100_000;
export const RENGLONES_MAXIMOS = 2_000;
const TEXTO_MAXIMO = 200;

const numero = (v) => (v == null || v === "" ? null : Number(v));
const texto = (v, max = TEXTO_MAXIMO) => (v == null ? null : String(v).trim().slice(0, max) || null);
const redondeo3 = (v) => Math.round(v * 1000) / 1000;

/** Origen de un renglón; `null` si no va en el pedido (ni sugerido ni pedido). */
export function origenDe(sugerido, cantidad) {
  const s = Number(sugerido) || 0;
  const c = Number(cantidad) || 0;
  if (s > 0) {
    if (c === 0) return "quitado";
    return Math.abs(c - s) < 1e-9 ? "sugerido" : "modificado";
  }
  return c > 0 ? "agregado" : null;
}

/**
 * Lee el cuerpo de `POST /api/fruver/sugerido/envio`. Devuelve `{ error }` si
 * algo no sirve, o `{ envio, lineas }` listos para la base.
 */
export function leerEnvio(body) {
  const bodega = String(body?.bodega || "").trim();
  if (!/^[A-Z0-9]{3,10}$/i.test(bodega)) return { error: "La sede no es válida." };
  const sedeNombre = texto(body?.sedeNombre) || bodega;
  const entrega = String(body?.entrega || "");
  if (!fechaValida(entrega)) return { error: "La fecha de entrega no es válida." };
  const dias = Number(body?.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 4) return { error: "Los días a cubrir van de 1 a 4." };
  if (!Array.isArray(body?.lineas) || !body.lineas.length) return { error: "El pedido no tiene productos." };
  if (body.lineas.length > RENGLONES_MAXIMOS) return { error: "El pedido tiene demasiados productos." };

  const vistos = new Set();
  const lineas = [];
  for (const l of body.lineas) {
    const item = String(l?.item || "").trim();
    if (!/^\d{1,12}$/.test(item)) return { error: "Hay un producto con código no válido." };
    if (vistos.has(item)) return { error: `El producto ${item} está repetido.` };
    vistos.add(item);
    const cantidad = numero(l.cantidad);
    if (cantidad == null || !Number.isFinite(cantidad) || cantidad < 0 || cantidad > CANTIDAD_MAXIMA) {
      return { error: `La cantidad de ${texto(l.descripcion) || item} no es válida.` };
    }
    const sugerido = numero(l.sugerido);
    if (sugerido != null && (!Number.isFinite(sugerido) || sugerido < 0)) return { error: `El sugerido de ${item} no es válido.` };
    const origen = origenDe(sugerido, cantidad);
    if (!origen) continue;
    lineas.push({
      item,
      descripcion: texto(l.descripcion) || item,
      subgrupo: texto(l.subgrupo),
      um: texto(l.um, 10),
      sugerido,
      cantidad: redondeo3(cantidad),
      origen,
      disponible: numero(l.disponible),
      venta_esperada: numero(l.ventaEsperada),
      merma: numero(l.merma),
      ultimo_precio: numero(l.ultimoPrecio),
    });
  }
  if (!lineas.some((l) => l.cantidad > 0)) return { error: "El pedido no tiene ningún producto para pedir." };

  return {
    envio: {
      bodega,
      sede_nombre: sedeNombre,
      fecha_entrega: entrega,
      dias,
      inventario_en: texto(body.inventarioEn, 40),
      parametros: body.parametros && typeof body.parametros === "object" ? body.parametros : null,
    },
    lineas,
  };
}

/**
 * Cuánto se apartó el líder del sugerido. La diferencia en plata es
 * Σ (pidió − sugerido) × último precio: positiva = pidió más, negativa = menos.
 */
export function resumenEnvio(lineas) {
  const r = { renglones: 0, sugerido: 0, modificado: 0, quitado: 0, agregado: 0, valorSugerido: 0, valorPedido: 0 };
  for (const l of lineas || []) {
    r.renglones += 1;
    r[l.origen] += 1;
    const precio = Number(l.ultimo_precio) || 0;
    r.valorSugerido += (Number(l.sugerido) || 0) * precio;
    r.valorPedido += (Number(l.cantidad) || 0) * precio;
  }
  // Lo que el sistema sugería (todo menos lo agregado): ¿cuánto se pidió tal cual?
  const conSugerido = r.renglones - r.agregado;
  r.igualAlSugerido = conSugerido > 0 ? r.sugerido / conSugerido : null;
  r.diferenciaValor = r.valorPedido - r.valorSugerido;
  return r;
}

/** El pedido como lo ven el front y Seguimiento. */
export function respuestaEnvio(fila) {
  const lineas = (fila.fruver_envio_lineas || []).map((l) => ({
    item: l.item,
    descripcion: l.descripcion,
    subgrupo: l.subgrupo,
    um: l.um,
    sugerido: numero(l.sugerido),
    cantidad: Number(l.cantidad),
    origen: l.origen,
    disponible: numero(l.disponible),
    ventaEsperada: numero(l.venta_esperada),
    merma: numero(l.merma),
    ultimoPrecio: numero(l.ultimo_precio),
  }));
  return {
    id: fila.id,
    bodega: fila.bodega,
    sedeNombre: fila.sede_nombre,
    entrega: fila.fecha_entrega,
    dias: fila.dias,
    enviadoPor: fila.enviado_por,
    enviadoEn: fila.enviado_en,
    resumen: resumenEnvio(fila.fruver_envio_lineas || []),
    lineas,
  };
}

/**
 * Compra con lo que ENVIARON las sedes: el pedido de tiendas de cada producto
 * es la suma de lo que pidieron las sedes que ya enviaron (las que no, no
 * cuentan todavía). Comprar = ese pedido − inventario del acopio.
 */
export function aplicarEnvios(sugerido, envios) {
  const porItem = new Map(sugerido.items.map((i) => [i.item, { ...i, sedes: { ...i.sedes } }]));
  for (const envio of envios) {
    for (const l of envio.lineas) {
      if (!porItem.has(l.item)) {
        // Lo agregó una sede y no está en el cálculo (nadie lo vendió en semanas).
        porItem.set(l.item, {
          item: l.item, descripcion: l.descripcion, subgrupo: l.subgrupo, um: l.um, merma: 0, armado: false,
          sinInventario: true, ultimoPrecio: l.ultimoPrecio, ventaEsperada: 0, acopioDisponible: null, sedes: {},
        });
      }
      const item = porItem.get(l.item);
      item.sedes[envio.bodega] = { ...(item.sedes[envio.bodega] || { sugerido: null }), pedido: l.cantidad, origen: l.origen };
    }
  }

  const enviadas = new Set(envios.map((e) => e.bodega));
  const items = [...porItem.values()].map((i) => {
    const pedidoTiendas = Object.entries(i.sedes)
      .filter(([bodega]) => enviadas.has(bodega))
      .reduce((s, [, linea]) => s + (Number(linea.pedido) || 0), 0);
    const comprar = i.armado || i.acopioDisponible == null
      ? null
      : redondear(Math.max(0, pedidoTiendas - i.acopioDisponible));
    return {
      ...i,
      pedidoTiendas: redondeo3(pedidoTiendas),
      comprar,
      valorEstimado: comprar != null && i.ultimoPrecio != null ? comprar * i.ultimoPrecio : null,
    };
  });

  const sedes = [...sugerido.sedes];
  for (const e of envios) if (!sedes.some((s) => s.codigo === e.bodega)) sedes.push({ codigo: e.bodega, nombre: e.sedeNombre });

  return {
    ...sugerido,
    sedes,
    items,
    envios: sedes.map((s) => {
      const e = envios.find((x) => x.bodega === s.codigo);
      return e
        ? { bodega: s.codigo, enviado: true, enviadoPor: e.enviadoPor, enviadoEn: e.enviadoEn, resumen: e.resumen }
        : { bodega: s.codigo, enviado: false };
    }),
    totales: {
      ...sugerido.totales,
      productos: items.length,
      conCompra: items.filter((i) => i.comprar > 0).length,
      valorEstimado: items.reduce((s, i) => s + (i.valorEstimado || 0), 0),
    },
  };
}
