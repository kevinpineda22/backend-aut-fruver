/* Consultas de Asertividad a la réplica de SIESA (solo lectura). */

import { GRUPO_FRUVER } from "../pedidos/consultas.js";

const S = "merkahorro_siesa";

/**
 * Unidades Y plata vendidas de fruver por día, sede y producto. Viaja compacto,
 * como `consultarVentas` (una fila por sede×producto con arreglos; la red de la
 * base es lenta y la descripción repetida en cada fila pesaba más que el dato).
 * La plata da el precio promedio de cada producto, para sumar kilos con unidades.
 */
export async function consultarVentasConPlata(pool, { desde, hasta }) {
  const { rows } = await pool.query(
    `WITH dia AS (
       SELECT fecha, bodega, item, MAX(desc_item) AS descripcion, SUM(unidades) AS unidades, SUM(ventas) AS ventas
         FROM ${S}.ventas_pdv_resumen_item_diario
        WHERE grupo = $3 AND fecha >= $1::date AND fecha <= $2::date
        GROUP BY 1, 2, 3
     )
     SELECT bodega, item, MAX(descripcion) AS descripcion,
            array_agg(fecha - $1::date ORDER BY fecha) AS dias,
            array_agg(round(unidades, 3)::float8 ORDER BY fecha) AS unidades,
            array_agg(round(ventas)::float8 ORDER BY fecha) AS ventas
       FROM dia GROUP BY 1, 2`,
    [desde, hasta, GRUPO_FRUVER],
  );
  return desplegarConPlata(rows, desde);
}

/** Filas compactas → una fila por día con unidades y plata. */
export function desplegarConPlata(filas, desde) {
  const base = Date.parse(`${desde}T00:00:00Z`);
  const fechas = new Map();
  const fechaDe = (dias) => {
    if (!fechas.has(dias)) fechas.set(dias, new Date(base + dias * 86_400_000).toISOString().slice(0, 10));
    return fechas.get(dias);
  };
  return filas.flatMap((f) => f.dias.map((dias, i) => ({
    fecha: fechaDe(dias),
    bodega: f.bodega,
    item: f.item,
    descripcion: f.descripcion,
    unidades: f.unidades[i],
    ventas: f.ventas[i],
  })));
}
