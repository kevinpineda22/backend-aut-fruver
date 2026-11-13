/* =============================================================================
   Precios de fruver en vivo (consulta dinámica de Connekta)

   Una sola consulta trae todo el fruver, todas las listas y las últimas 3 fechas
   de cada precio (docs/CONSULTA_PRECIOS_CONNEKTA.md). Viene paginada: la primera
   página dice cuántas hay y el resto se pide de a varias a la vez.

   Leerla tarda ~13 s (medido 2026-11-13): Connekta corre la consulta entera por
   cada página y no deja pedir más de 1000 filas; pedir las 10 a la vez no ayuda
   (6–10 s, el servidor de SIESA se pone lento). Por eso NADIE espera a SIESA para
   abrir la pantalla:

   - La última lectura se guarda en memoria y en Supabase (`almacen`,
     sql/004_precios_copia.sql), así una instancia nueva de Vercel también la tiene.
   - `consultar()` devuelve esa copia al instante, con `alDia` = si tiene menos de
     `ttlMs` (5 min).
   - `consultar({ fresco: true })` espera la lectura de SIESA si la copia no está
     al día. La pantalla la pide sola y no deja imprimir hasta tenerla.
   - Si SIESA falla, se usa la copia Y SE DICE (`desactualizado`). Nunca se
     inventa un precio: sin copia, el error sube.

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

/**
 * @param {object}   [almacen]  { leer() → {filas, consultadoEn} | null, guardar({filas, consultadoEn}) }
 * @param {string[]} [listas]   solo se guardan estas listas de precios (las de las tiendas)
 */
export function crearClientePrecios({
  env = process.env, fetchImpl = globalThis.fetch, ttlMs = 5 * 60_000, ahora = Date.now, concurrencia = 4,
  almacen = null, listas = null,
} = {}) {
  const base = String(env.CONNEKTA_BASE_URL || "").replace(/\/$/, "");
  const consulta = env.FRUVER_PRECIOS_CONSULTA || CONSULTA_POR_DEFECTO;
  const key = env.FRUVER_PRECIOS_CONNI_KEY || env.CONNI_KEY;
  const token = env.FRUVER_PRECIOS_CONNI_TOKEN || env.CONNI_TOKEN;
  const idCompania = env.CONNEKTA_ID_COMPANIA || "7375";
  const configurado = Boolean(base && consulta && key && token);

  let guardado = null; // { filas, consultadoEn, en (ms) }
  let enCurso = null;
  const listasSet = listas ? new Set(listas) : null;

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
    const normalizadas = filas.map(normalizarFila);
    return listasSet ? normalizadas.filter((f) => listasSet.has(f.lista)) : normalizadas;
  }

  const alDia = (copia) => Boolean(copia) && ahora() - copia.en < ttlMs;
  const respuesta = (copia, extra) => ({ filas: copia.filas, consultadoEn: copia.consultadoEn, ...extra });

  /** La copia más nueva entre la de memoria y la de Supabase (otra instancia pudo leer SIESA después). */
  async function copiaGuardada() {
    if (!almacen || alDia(guardado)) return guardado;
    try {
      const leida = await almacen.leer();
      const en = Date.parse(leida?.consultadoEn);
      if (leida?.filas?.length && Number.isFinite(en) && (!guardado || en > guardado.en)) {
        guardado = { filas: leida.filas, consultadoEn: leida.consultadoEn, en };
      }
    } catch (error) {
      console.error("[precios] no se pudo leer la copia guardada:", error.message);
    }
    return guardado;
  }

  /** Una sola lectura de SIESA a la vez por instancia. */
  function leerSiesa() {
    enCurso ||= traerTodo()
      .then(async (filas) => {
        const consultadoEn = new Date(ahora()).toISOString();
        guardado = { filas, consultadoEn, en: ahora() };
        if (almacen) {
          await Promise.resolve(almacen.guardar({ filas, consultadoEn }))
            .catch((error) => console.error("[precios] no se pudo guardar la copia:", error.message));
        }
        return guardado;
      })
      .finally(() => { enCurso = null; });
    return enCurso;
  }

  /**
   * @param {{ fresco?: boolean }} [opciones] fresco: esperar a SIESA si la copia no está al día
   * @returns {Promise<{ filas: Array, consultadoEn: string, alDia: boolean, desactualizado: boolean }>}
   */
  async function consultar({ fresco = false } = {}) {
    if (!configurado) {
      throw new ErrorPublico("El servidor no tiene configurada la consulta de precios de SIESA.", 503);
    }
    const copia = await copiaGuardada();
    if (alDia(copia)) return respuesta(copia, { alDia: true, desactualizado: false });
    if (copia && !fresco) return respuesta(copia, { alDia: false, desactualizado: false });
    try {
      return respuesta(await leerSiesa(), { alDia: true, desactualizado: false });
    } catch (error) {
      if (!copia) throw error;
      console.error("[precios] SIESA falló; se usa la copia de", copia.consultadoEn, error.message);
      return respuesta(copia, { alDia: false, desactualizado: true });
    }
  }

  return { configurado, consultar };
}
