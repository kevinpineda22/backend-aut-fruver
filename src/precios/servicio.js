/* =============================================================================
   Precios de una sede: precios en vivo (Connekta) + productos activos (réplica)
   + ubicación de cada producto en la tienda (Supabase de la intranet).

   Lo único que se escribe es la ubicación (fruver_ubicaciones,
   sql/003_precios_ubicaciones.sql), y solo con la función fruver_guardar_ubicaciones.
   ============================================================================= */

import { GRUPO_FRUVER } from "../pedidos/consultas.js";
import { LISTAS_PRECIO, nombreSede, ordenarSedes } from "../sedes.js";
import { UBICACION_POR_DEFECTO, agruparPrecios, codigoItem, productosDeLista } from "./reglas.js";

/** Las sedes que tienen lista de precios, en el orden de siempre. */
export const sedesConLista = () =>
  ordenarSedes(Object.keys(LISTAS_PRECIO)).map((codigo) => ({ codigo, nombre: nombreSede(codigo), lista: LISTAS_PRECIO[codigo] }));

const ACTIVOS_TTL = 30 * 60_000;
let activosGuardados = null;

/**
 * Códigos de los ítems de fruver ACTIVOS en SIESA (réplica, `indestado = '1'`).
 * La consulta de precios trae también los inactivos (unos 220 de 547), que no
 * van en la góndola. Si la réplica falla devuelve null: mejor una lista con
 * productos de más que una góndola sin etiquetas.
 */
export async function itemsActivos({ pool, ahora = Date.now }) {
  if (activosGuardados && activosGuardados.vence > ahora()) return activosGuardados.items;
  try {
    const { rows } = await pool.query(
      `SELECT item FROM merkahorro_siesa.dimitems WHERE "001-GRUPO" = $1 AND trim(indestado) = '1'`,
      [GRUPO_FRUVER],
    );
    const items = new Set(rows.map((r) => codigoItem(r.item)));
    activosGuardados = { items, vence: ahora() + ACTIVOS_TTL };
    return items;
  } catch (error) {
    console.error("[precios] no se pudieron leer los ítems activos:", error.message);
    return activosGuardados?.items || null;
  }
}

/** Map item → ubicación guardada para la sede. */
export async function ubicacionesDeSede({ supabase, bodega }) {
  const filas = await supabase.select("fruver_ubicaciones", { select: "item,ubicacion", bodega: `eq.${bodega}` });
  return new Map((filas || []).map((f) => [codigoItem(f.item), f.ubicacion]));
}

export async function guardarUbicaciones({ supabase, bodega, cambios, usuario }) {
  return supabase.rpc("fruver_guardar_ubicaciones", {
    p_bodega: bodega,
    p_cambios: cambios,
    p_usuario: usuario.email,
  });
}

/**
 * Los precios vigentes de la lista de una sede, con su ubicación en la tienda.
 * Si la base de ubicaciones no responde, todo sale como BANCARELLAS con aviso:
 * la tienda puede imprimir igual.
 */
export async function preciosDeSede({ precios, pool, supabase, bodega, hoy }) {
  const lista = LISTAS_PRECIO[bodega];
  const [datos, activos, ubicaciones] = await Promise.all([
    precios.consultar(),
    itemsActivos({ pool }),
    ubicacionesDeSede({ supabase, bodega }).catch((error) => {
      console.error("[precios] no se pudieron leer las ubicaciones:", error.message);
      return null;
    }),
  ]);

  const { productos, sinPrecio } = productosDeLista(agruparPrecios(datos.filas), lista, hoy, activos);
  const conUbicacion = productos.map((p) => ({ ...p, ubicacion: ubicaciones?.get(p.item) || UBICACION_POR_DEFECTO }));

  const avisos = [];
  if (datos.desactualizado) avisos.push(`SIESA no respondió: los precios son de la consulta de las ${datos.consultadoEn}.`);
  if (!activos) avisos.push("No se pudo saber qué productos están activos: pueden aparecer productos que ya no se venden.");
  if (!ubicaciones) avisos.push("No se pudieron leer las ubicaciones guardadas: todos los productos aparecen como Bancarellas.");

  return {
    sede: { codigo: bodega, nombre: nombreSede(bodega), lista },
    sedes: sedesConLista(),
    hoy,
    consultadoEn: datos.consultadoEn,
    desactualizado: datos.desactualizado,
    avisos,
    productos: conUbicacion,
    sinPrecio,
  };
}
