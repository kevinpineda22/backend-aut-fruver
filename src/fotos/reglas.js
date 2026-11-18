/* =============================================================================
   Foto diaria del sugerido de compra

   El sugerido se calcula en vivo y se pierde. Sin una foto por día no hay cómo
   comparar lo que el sistema recomendó comprar con lo que se compró (SIESA) y
   se vendió, ni cómo corregir la fórmula con datos. La foto guarda el resultado
   Y los ingredientes (venta esperada, merma, inventario de cada sede y del
   acopio), que la réplica de SIESA no conserva.

   Siempre el mismo pedido: entrega MAÑANA, 1 día de cobertura. Así la serie es
   comparable día con día. Tabla y función: sql/005_fotos_sugerido.sql.
   ============================================================================= */

import { sumarDias } from "../pedidos/reglas.js";

export const MOMENTO_PUBLICACION = "publicacion";
export const DIAS_FOTO = 1;

/** Qué pedido se fotografía el día `hoy`. */
export const pedidoDeLaFoto = (hoy) => ({ entrega: sumarDias(hoy, 1), dias: DIAS_FOTO });

/** Por sede, solo los pasos del cálculo (sin repetir lo que ya está en el renglón). */
function sedesDe(sedes) {
  const salida = {};
  for (const [bodega, s] of Object.entries(sedes || {})) {
    salida[bodega] = {
      disponible: s.disponible ?? null,
      pendienteHoy: s.pendienteHoy ?? null,
      antesDeEntrega: s.antesDeEntrega ?? null,
      inventarioAlRecibir: s.inventarioAlRecibir ?? null,
      ventaEsperada: s.ventaEsperada ?? null,
      necesidad: s.necesidad ?? null,
      sugerido: s.sugerido ?? null,
    };
  }
  return salida;
}

/**
 * Convierte la respuesta de `calcularSugerido` en lo que recibe
 * `fruver_guardar_foto_sugerido(p_foto, p_items)`.
 */
export function armarFoto(sugerido, { momento = MOMENTO_PUBLICACION } = {}) {
  const p = sugerido.parametros;
  const items = sugerido.items.map((i) => ({
    item: String(i.item),
    descripcion: i.descripcion,
    subgrupo: i.subgrupo ?? null,
    um: i.um ?? null,
    merma: i.merma ?? null,
    armado: Boolean(i.armado),
    sin_inventario: Boolean(i.sinInventario),
    ultimo_precio: i.ultimoPrecio ?? null,
    venta_esperada: i.ventaEsperada ?? null,
    pedido_tiendas: i.pedidoTiendas ?? null,
    acopio_disponible: i.acopioDisponible ?? null,
    comprar: i.comprar ?? null,
    valor_estimado: i.valorEstimado ?? null,
    sedes: sedesDe(i.sedes),
  }));
  return {
    foto: {
      fecha: p.hoy,
      momento,
      entrega: p.entrega,
      dias: p.dias,
      inventario_en: sugerido.inventario?.consultadoEn || null,
      parametros: {
        hora: p.hora, ultimoDato: p.ultimoDato, cobertura: p.cobertura, antesDeEntrega: p.antesDeEntrega,
        quincena: p.quincena || null, acopio: sugerido.acopio?.codigo || null,
        sedes: (sugerido.sedes || []).map((s) => s.codigo),
      },
      resumen: {
        ...sugerido.totales,
        sinCalcular: items.filter((i) => i.comprar == null && !i.armado).length,
        inventarioFallidos: sugerido.inventario?.fallidos ?? null,
      },
    },
    items,
  };
}
