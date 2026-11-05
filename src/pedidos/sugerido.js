/* =============================================================================
   Arma el sugerido completo a partir de lo que trajeron la base y SIESA.
   Puro: recibe filas, devuelve la respuesta. Así se prueba sin base ni red.
   ============================================================================= */

import { ACOPIO, nombreSede, ordenarSedes } from "../sedes.js";
import {
  calcularLinea, calcularMerma, fechasComparables, fraccionRestante, redondear,
  seArmaEnTienda, ventaEsperada, ventanas,
} from "./reglas.js";

const un = (valor) => Math.round((Number(valor) || 0) * 10) / 10;

function agrupar(filas, clave, valor) {
  const mapa = new Map();
  for (const fila of filas) {
    const k = clave(fila);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(valor(fila));
  }
  return mapa;
}

/**
 * @param {object} p
 * @param {string} p.hoy           fecha de Colombia
 * @param {number} p.hora          hora decimal de Colombia
 * @param {string} p.entrega       día en que llega el pedido (después de hoy)
 * @param {number} p.dias          días que cubre el pedido
 * @param {string} p.ultimoDato    último día con ventas en la réplica
 * @param {string} p.mermaDesde    desde cuándo se mide la merma
 * @param {Array}  p.ventas        { fecha, bodega, item, descripcion, subgrupo, unidades }
 * @param {Array}  p.abiertas      { fecha, bodega }
 * @param {Array}  p.perfiles      { bodega, hora, ventas } (mismo día de la semana que hoy)
 * @param {Array}  p.compras       { item, comprado, ultimo_precio }
 * @param {Array}  p.maestro       { item, um }
 * @param {{ porItem: Map, fallidos: Set, consultadoEn: string }} p.inventario
 */
export function armarSugerido({
  hoy, hora, entrega, dias, ultimoDato, mermaDesde,
  ventas, abiertas, perfiles, compras, maestro, inventario,
}) {
  const sedes = ordenarSedes(ventas.map((v) => v.bodega).filter((b) => b !== ACOPIO.codigo));
  const abiertasPorSede = new Map(
    [...agrupar(abiertas, (a) => a.bodega, (a) => a.fecha)].map(([b, fechas]) => [b, new Set(fechas)]),
  );
  const perfilPorSede = new Map(
    [...agrupar(perfiles, (p) => p.bodega, (p) => [Number(p.hora), Number(p.ventas)])].map(([b, horas]) => [b, new Map(horas)]),
  );

  const historia = new Map();
  const info = new Map();
  const vendidoMerma = new Map();
  for (const v of ventas) {
    const clave = `${v.bodega}|${v.item}`;
    if (!historia.has(clave)) historia.set(clave, new Map());
    historia.get(clave).set(v.fecha, Number(v.unidades) || 0);
    if (!info.has(v.item)) info.set(v.item, { descripcion: v.descripcion, subgrupo: v.subgrupo });
    if (v.fecha >= mermaDesde) vendidoMerma.set(v.item, (vendidoMerma.get(v.item) || 0) + (Number(v.unidades) || 0));
  }
  const comprasPorItem = new Map(compras.map((c) => [String(c.item), c]));
  const umPorItem = new Map(maestro.map((m) => [String(m.item), m.um]));
  const fraccionHoy = new Map(sedes.map((s) => [s, fraccionRestante(perfilPorSede.get(s), hora)]));
  const { antes, cobertura } = ventanas(hoy, entrega, dias);

  const items = [];
  for (const [item, datos] of info) {
    const compra = comprasPorItem.get(item);
    const comprado = Number(compra?.comprado) || 0;
    const vendido = vendidoMerma.get(item) || 0;
    const armado = seArmaEnTienda(comprado, vendido);
    const merma = armado ? 0 : calcularMerma(comprado, vendido);
    const sinInventario = inventario.fallidos.has(item);
    const stock = inventario.porItem.get(item);

    const porSede = {};
    let ventaTotal = 0;
    let pedidoTiendas = 0;
    let faltaInventario = false;
    for (const sede of sedes) {
      const hist = historia.get(`${sede}|${item}`);
      if (!hist) continue;
      const abiertasSede = abiertasPorSede.get(sede) || new Set();
      const esperada = (fecha) => ventaEsperada(hist, fechasComparables(fecha, abiertasSede, ultimoDato));
      const pendienteHoy = esperada(hoy) * (fraccionHoy.get(sede) || 0);
      const antesDeEntrega = antes.reduce((s, f) => s + esperada(f), 0);
      const ventaCobertura = cobertura.reduce((s, f) => s + esperada(f), 0);
      const disponible = sinInventario ? null : (stock?.get(sede)?.disponible ?? 0);
      const linea = calcularLinea({ pendienteHoy, antesDeEntrega, cobertura: ventaCobertura, disponible, merma });

      if (ventaCobertura <= 0 && !disponible) continue;
      ventaTotal += ventaCobertura;
      if (linea.sugerido == null) faltaInventario = true;
      else pedidoTiendas += linea.sugerido;
      porSede[sede] = {
        ventaEsperada: un(ventaCobertura),
        pendienteHoy: un(pendienteHoy),
        antesDeEntrega: un(antesDeEntrega),
        disponible: disponible == null ? null : un(disponible),
        inventarioAlRecibir: linea.inventarioAlRecibir == null ? null : un(linea.inventarioAlRecibir),
        sugerido: linea.sugerido,
      };
    }
    if (ventaTotal <= 0 && pedidoTiendas <= 0) continue;

    const acopioDisponible = sinInventario ? null : un(stock?.get(ACOPIO.codigo)?.disponible ?? 0);
    const comprar = armado || faltaInventario || acopioDisponible == null
      ? null
      : redondear(Math.max(0, pedidoTiendas - acopioDisponible));
    const precio = compra?.ultimo_precio == null ? null : Math.round(Number(compra.ultimo_precio));

    items.push({
      item,
      descripcion: datos.descripcion,
      subgrupo: datos.subgrupo,
      um: umPorItem.get(item) || null,
      merma: Math.round(merma * 1000) / 1000,
      armado,
      sinInventario,
      ultimoPrecio: precio,
      ventaEsperada: un(ventaTotal),
      pedidoTiendas: faltaInventario ? null : pedidoTiendas,
      acopioDisponible,
      comprar,
      valorEstimado: comprar != null && precio != null ? comprar * precio : null,
      sedes: porSede,
    });
  }

  items.sort((a, b) =>
    (b.ventaEsperada * (b.ultimoPrecio || 1)) - (a.ventaEsperada * (a.ultimoPrecio || 1))
    || a.descripcion.localeCompare(b.descripcion));

  return {
    parametros: { hoy, hora: Math.round(hora * 100) / 100, entrega, dias, ultimoDato, cobertura, antesDeEntrega: antes },
    acopio: ACOPIO,
    sedes: sedes.map((codigo) => ({ codigo, nombre: nombreSede(codigo) })),
    items,
    totales: {
      productos: items.length,
      conCompra: items.filter((i) => i.comprar > 0).length,
      valorEstimado: items.reduce((s, i) => s + (i.valorEstimado || 0), 0),
      sinInventario: items.filter((i) => i.sinInventario).length,
      armados: items.filter((i) => i.armado).length,
    },
    inventario: { consultadoEn: inventario.consultadoEn, fallidos: inventario.fallidos.size },
  };
}
