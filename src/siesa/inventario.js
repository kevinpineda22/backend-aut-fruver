/* =============================================================================
   Inventario en vivo de SIESA

   La réplica de Postgres NO tiene inventario por bodega, así que se pregunta en
   vivo con la consulta estándar `API_v2_Inventarios_InvFecha` (la misma que usa
   el stock en vivo de backend-traslado). Una llamada por producto trae TODAS las
   bodegas (tiendas y el acopio PV009), ~250 ms cada una.

   Disponible = existencia − ventas de caja todavía sin descargar (`pos`).

   UN FALLO SE DICE, NO SE PINTA COMO 0: un producto cuyo inventario no se pudo
   leer vuelve en `fallidos` y su sugerido queda vacío. Si fallan muchos, se
   corta con error: un pedido armado sobre inventarios en cero pediría de más
   en todas las sedes.

   Variables: CONNEKTA_BASE_URL, CONNEKTA_ID_COMPANIA, CONNI_KEY, CONNI_TOKEN
   (o SIESA_STOCK_CONNI_KEY / SIESA_STOCK_CONNI_TOKEN para un par propio).
   ============================================================================= */

import { disponibleDe } from "../pedidos/reglas.js";

const DESCRIPCION = "API_v2_Inventarios_InvFecha";
const RUTA = "/api/siesa/v3/ejecutarconsultaestandar";
export const MAXIMO_FALLIDOS = 0.2;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** La consulta estándar vive en el host raíz, no bajo el path de Connekta. */
export function resolverHost(env) {
  if (env.SIESA_V3_BASE_URL) return env.SIESA_V3_BASE_URL.replace(/\/$/, "");
  try {
    return new URL(env.CONNEKTA_BASE_URL || "").origin;
  } catch {
    return "";
  }
}

/** Filas de SIESA → Map bodega → { existencia, pos, disponible }. Solo compañía 1. */
export function stockPorBodega(filas) {
  const mapa = new Map();
  for (const f of filas || []) {
    if (Number(f.f120_id_cia ?? 1) !== 1) continue;
    const bodega = String(f.f150_id || "").trim();
    const previo = mapa.get(bodega) || { existencia: 0, pos: 0 };
    const existencia = previo.existencia + (Number(f.f400_cant_existencia_1) || 0);
    const pos = previo.pos + (Number(f.f400_cant_pos_1) || 0);
    mapa.set(bodega, { existencia, pos, disponible: disponibleDe(existencia, pos) });
  }
  return mapa;
}

export function crearClienteInventario({
  // Medido 2026-11-05 con 224 productos: 8 a la vez 13,5 s, 16 a la vez 6,4 s, sin 429.
  env = process.env, fetchImpl = globalThis.fetch, concurrencia = Number(env.SIESA_CONCURRENCIA) || 12,
  ttlMs = 120_000, ahora = Date.now,
} = {}) {
  const host = resolverHost(env);
  const key = env.SIESA_STOCK_CONNI_KEY || env.CONNI_KEY;
  const token = env.SIESA_STOCK_CONNI_TOKEN || env.CONNI_TOKEN;
  const idCompania = env.CONNEKTA_ID_COMPANIA || "7375";
  const configurado = Boolean(host && key && token);
  const cache = new Map();

  async function leerItem(item) {
    const guardado = cache.get(item);
    if (guardado && guardado.vence > ahora()) return guardado.stock;

    const params = new URLSearchParams({
      idCompania, descripcion: DESCRIPCION, parametros: `f120_id=${item}`, paginacion: "numPag=1|tamPag=100",
    });
    for (let intento = 1; ; intento++) {
      let respuesta;
      try {
        respuesta = await fetchImpl(`${host}${RUTA}?${params}`, {
          headers: { conniKey: key, conniToken: token },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (intento < 3) { await dormir(800 * intento); continue; }
        throw error;
      }
      const cuerpo = await respuesta.json().catch(() => null);
      if (respuesta.status === 429 || respuesta.status >= 500) {
        if (intento < 3) { await dormir(1500 * intento); continue; }
      }
      if (respuesta.status === 400 && /No se encontraron registros/i.test(JSON.stringify(cuerpo?.detalle || ""))) {
        const vacio = new Map();
        cache.set(item, { stock: vacio, vence: ahora() + ttlMs });
        return vacio;
      }
      if (!respuesta.ok) throw new Error(`SIESA respondio ${respuesta.status} para el item ${item}`);
      const filas = Array.isArray(cuerpo) ? cuerpo : (cuerpo?.detalle?.Datos || cuerpo?.detalle?.Table || []);
      const stock = stockPorBodega(filas);
      cache.set(item, { stock, vence: ahora() + ttlMs });
      return stock;
    }
  }

  /**
   * @param {string[]} items
   * @returns {Promise<{ porItem: Map<string, Map>, fallidos: Set<string>, consultadoEn: string }>}
   */
  async function consultar(items) {
    if (!configurado) throw new Error("Faltan las variables de SIESA (CONNEKTA_BASE_URL, CONNI_KEY, CONNI_TOKEN).");
    const pendientes = [...new Set(items)];
    const porItem = new Map();
    const fallidos = new Set();
    let primerError = null;
    let cursor = 0;

    async function trabajador() {
      while (cursor < pendientes.length) {
        const item = pendientes[cursor++];
        try {
          porItem.set(item, await leerItem(item));
        } catch (error) {
          primerError ||= error;
          fallidos.add(item);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrencia, pendientes.length || 1) }, trabajador));

    if (primerError) {
      console.error(`[inventario] ${fallidos.size}/${pendientes.length} productos sin inventario: ${primerError.message}`);
    }
    if (pendientes.length && fallidos.size / pendientes.length > MAXIMO_FALLIDOS) {
      const error = new Error(`Fallo el inventario de ${fallidos.size} de ${pendientes.length} productos.`);
      error.inventario = true;
      throw error;
    }
    return { porItem, fallidos, consultadoEn: new Date(ahora()).toISOString() };
  }

  return { configurado, consultar };
}
