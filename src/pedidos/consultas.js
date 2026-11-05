/* =============================================================================
   Consultas a la réplica de SIESA (solo lectura)

   Fruver = grupo `40-LEGUMBRE` (unidad de negocio 002).

   Gotchas de la réplica que se respetan acá:
   - `dimitems.referencia` viene como 'A-0005098   ': el código del ítem son los
     dígitos sin ceros a la izquierda. En ventas el ítem es texto ('5098'); en
     compras, entero.
   - En `compras` el tipo de documento está en el prefijo de `documento`
     (CEA-…, DSE-…). El ~29 % del fruver entra por DSE (documento soporte, compra a
     campesinos): por eso se filtra por `clase_docto`, que cubre los dos.
   - En `compras`, `cantidad` es la cantidad en la U.M. de inventario (KL, UND) y
     es la que se compara con lo vendido. (`cantidad_inv` es la de la U.M. del
     documento; en fruver son iguales.)
   ============================================================================= */

const S = "merkahorro_siesa";
export const GRUPO_FRUVER = "40-LEGUMBRE";

export async function consultarUltimoDato(pool) {
  const { rows } = await pool.query(`SELECT MAX(fecha)::text AS ultimo FROM ${S}.ventas_pdv_resumen_diario`);
  return rows[0]?.ultimo || null;
}

/**
 * Unidades vendidas de fruver por día, sede y producto. Usa el índice (fecha, grupo).
 *
 * VIAJA COMPACTO: una fila por (sede, producto) con dos arreglos, el día (como
 * distancia a `desde`) y lo vendido. Medido 2026-11-05: la base resuelve en
 * 0,13 s, pero las ~41 mil filas sueltas, con la descripción repetida en cada
 * una, tardaban 26 s en bajar por la red. Acá se devuelven otra vez sueltas.
 */
export async function consultarVentas(pool, { desde, hasta }) {
  const { rows } = await pool.query(
    `WITH dia AS (
       SELECT fecha, bodega, item, MAX(desc_item) AS descripcion, MAX(subgrupo) AS subgrupo, SUM(unidades) AS unidades
         FROM ${S}.ventas_pdv_resumen_item_diario
        WHERE grupo = $3 AND fecha >= $1::date AND fecha <= $2::date
        GROUP BY 1, 2, 3
     )
     SELECT bodega, item, MAX(descripcion) AS descripcion, MAX(subgrupo) AS subgrupo,
            array_agg(fecha - $1::date ORDER BY fecha) AS dias,
            array_agg(round(unidades, 3)::float8 ORDER BY fecha) AS unidades
       FROM dia GROUP BY 1, 2`,
    [desde, hasta, GRUPO_FRUVER],
  );
  return desplegarVentas(rows, desde);
}

/** Filas compactas (sede, producto, días[], unidades[]) → una fila por día. */
export function desplegarVentas(filas, desde) {
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
    subgrupo: f.subgrupo,
    unidades: f.unidades[i],
  })));
}

/** Días en que cada sede vendió algo (abrió). */
export async function consultarDiasAbiertos(pool, { desde, hasta }) {
  const { rows } = await pool.query(
    `SELECT fecha::text AS fecha, bodega FROM ${S}.ventas_pdv_resumen_diario
      WHERE fecha >= $1::date AND fecha <= $2::date AND ventas > 0`,
    [desde, hasta],
  );
  return rows;
}

/** Cómo vende cada sede hora por hora, en el mismo día de la semana (1 = lunes … 7 = domingo). */
export async function consultarPerfilHorario(pool, { desde, hasta, diaIso }) {
  const { rows } = await pool.query(
    `SELECT bodega, hora, SUM(ventas)::float8 AS ventas FROM ${S}.ventas_pdv_resumen_hora
      WHERE fecha >= $1::date AND fecha <= $2::date AND EXTRACT(ISODOW FROM fecha) = $3
      GROUP BY 1, 2`,
    [desde, hasta, diaIso],
  );
  return rows;
}

/** Comprado (entradas − devoluciones) y último precio de compra por unidad, de los productos dados. */
export async function consultarCompras(pool, { desde, hasta, items }) {
  const codigos = items.map(Number).filter(Number.isInteger);
  if (!codigos.length) return [];
  const { rows } = await pool.query(
    `WITH c AS (
       SELECT item, fecha, clase_docto, cantidad, valor_bruto_local - COALESCE(valor_dsctos_local, 0) AS subtotal
         FROM ${S}.compras
        WHERE item = ANY($3::int[]) AND estado <> 'Anulado'
          AND fecha >= $1::date AND fecha < $2::date + 1
     ), totales AS (
       SELECT item, SUM(CASE WHEN clase_docto ILIKE 'Entrada%' THEN cantidad
                             WHEN clase_docto ILIKE 'Devoluc%' THEN -cantidad ELSE 0 END)::float8 AS comprado
         FROM c GROUP BY item
     ), ultimo AS (
       SELECT DISTINCT ON (item) item, (subtotal / NULLIF(cantidad, 0))::float8 AS ultimo_precio
         FROM c WHERE clase_docto ILIKE 'Entrada%' AND cantidad > 0
        ORDER BY item, fecha DESC
     )
     SELECT t.item::text AS item, t.comprado, u.ultimo_precio
       FROM totales t LEFT JOIN ultimo u USING (item)`,
    [desde, hasta, codigos],
  );
  return rows;
}

/** Unidad de medida de inventario de cada producto de fruver. */
export async function consultarMaestro(pool) {
  const { rows } = await pool.query(
    `SELECT ltrim(regexp_replace(referencia, '[^0-9]', '', 'g'), '0') AS item, trim(idunimedidainv) AS um
       FROM ${S}.dimitems WHERE trim("001-GRUPO") = $1`,
    [GRUPO_FRUVER],
  );
  return rows;
}
