/* =============================================================================
   Precios de fruver en vivo (consulta dinámica de Connekta)

   Una sola consulta trae todo el fruver, todas las listas y las últimas 3 fechas
   de cada precio (docs/CONSULTA_PRECIOS_CONNEKTA.md). Viene paginada: la primera
   página dice cuántas hay y el resto se pide de a varias a la vez.

   Se guarda en memoria `ttlMs` (2 min): todas las sedes leen de la misma copia y
   SIESA no recibe una consulta por cada pantalla abierta. Si SIESA falla y hay
   una copia vieja, se usa esa Y SE DICE (`desactualizado`). Nunca se inventa un
   precio: sin copia, el error sube.

   Variables: CONNEKTA_BASE_URL (…/api/connekta/v3), CONNEKTA_ID_COMPANIA,
   CONNI_KEY, CONNI_TOKEN — el MISMO par del inventario (src/siesa/inventario.js).
   Opcionales: FRUVER_PRECIOS_CONNI_KEY / _TOKEN si algún día la consulta tiene
   un par propio, y FRUVER_PRECIOS_CONSULTA si se registra con otro nombre.
   ============================================================================= */

export const CONSULTA_POR_DEFECTO = "merkahorro_fruver_precios";

import { ErrorPublico } from "../http.js";
import { normalizarFila } from "./reglas.js";

export const TAM_PAGINA = 1000;
/** Fusible: si `total_páginas` viniera mal, no se piden páginas para siempre. */
export const MAXIMO_PAGINAS = 60;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function crearClientePrecios({
  env = process.env, fetchImpl = globalThis.fetch, ttlMs = 120_000, ahora = Date.now, concurrencia = 4,
} = {}) {
  const base = String(env.CONNEKTA_BASE_URL || "").replace(/\/$/, "");
  const consulta = env.FRUVER_PRECIOS_CONSULTA || CONSULTA_POR_DEFECTO;
  const key = env.FRUVER_PRECIOS_CONNI_KEY || env.CONNI_KEY;
  const token = env.FRUVER_PRECIOS_CONNI_TOKEN || env.CONNI_TOKEN;
  const idCompania = env.CONNEKTA_ID_COMPANIA || "7375";
  const configurado = Boolean(base && consulta && key && token);

  let guardado = null; // { filas, consultadoEn, vence }
  let enCurso = null;

  async function pagina(numero) {
    const params = new URLSearchParams({
      idCompania, descripcion: consulta, paginacion: `numPag=${numero}|tamPag=${TAM_PAGINA}`,
    });
    for (let intento = 1; ; intento++) {
      let respuesta;
      try {
        respuesta = await fetchImpl(`${base}/ejecutarconsulta?${params}`, {
          headers: { conniKey: key, conniToken: token },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (intento < 3) { await dormir(1000 * intento); continue; }
        throw error;
      }
      const cuerpo = await respuesta.json().catch(() => null);
      if ((respuesta.status === 429 || respuesta.status >= 500) && intento < 3) {
        await dormir(1500 * intento);
        continue;
      }
      if (respuesta.status === 400 && /No se encontraron registros/i.test(JSON.stringify(cuerpo?.detalle || ""))) {
        return { filas: [], total: 0 };
      }
      if (respuesta.status === 401) {
        throw new ErrorPublico("SIESA rechazó las credenciales de la consulta de precios (CONNI_KEY/CONNI_TOKEN).", 502);
      }
      if (!respuesta.ok || cuerpo?.codigo !== 0) {
        throw new Error(`Connekta respondió ${respuesta.status} (${cuerpo?.mensaje || "sin mensaje"}) en la página ${numero}`);
      }
      const d = cuerpo.detalle || {};
      const filas = d.Table ?? d.Datos ?? [];
      if (!Array.isArray(filas)) throw new Error("Connekta devolvió un detalle sin filas.");
      // La clave viene CON tilde: sin tilde da undefined y se cortaría en la página 1.
      return { filas, total: Number(d["total_páginas"] ?? d.total_paginas ?? 1) || 1 };
    }
  }

  async function traerTodo() {
    const primera = await pagina(1);
    const total = Math.min(primera.total, MAXIMO_PAGINAS);
    if (primera.total > MAXIMO_PAGINAS) {
      console.warn(`[precios] la consulta dice ${primera.total} páginas; se leen ${MAXIMO_PAGINAS}. Revisar la consulta.`);
    }
    const resto = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 2);
    const paginas = new Map([[1, primera.filas]]);
    let cursor = 0;
    async function trabajador() {
      while (cursor < resto.length) {
        const numero = resto[cursor++];
        paginas.set(numero, (await pagina(numero)).filas);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrencia, resto.length) }, trabajador));
    const filas = [];
    for (let n = 1; n <= total; n++) filas.push(...(paginas.get(n) || []));
    return filas.map(normalizarFila);
  }

  /**
   * @returns {Promise<{ filas: Array, consultadoEn: string, desactualizado: boolean }>}
   */
  async function consultar() {
    if (!configurado) {
      throw new ErrorPublico("El servidor no tiene configurada la consulta de precios de SIESA.", 503);
    }
    if (guardado && guardado.vence > ahora()) return { ...guardado, desactualizado: false };
    enCurso ||= traerTodo()
      .then((filas) => {
        guardado = { filas, consultadoEn: new Date(ahora()).toISOString(), vence: ahora() + ttlMs };
        return { ...guardado, desactualizado: false };
      })
      .catch((error) => {
        if (!guardado) throw error;
        console.error("[precios] SIESA falló; se usa la copia de", guardado.consultadoEn, error.message);
        return { ...guardado, desactualizado: true };
      })
      .finally(() => { enCurso = null; });
    return enCurso;
  }

  return { configurado, consultar };
}
