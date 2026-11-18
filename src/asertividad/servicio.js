/* Asertividad: lee la réplica y mide. Las consultas van en serie (pool de una conexión). */

import { ErrorPublico } from "../http.js";
import {
  consultarDiasAbiertos, consultarMaestro, consultarUltimoDato, consultarVentaDiariaFruver,
} from "../pedidos/consultas.js";
import { AJUSTE_QUINCENA, DIAS_ENTRENO_QUINCENA, SEMANAS_HISTORIA } from "../pedidos/reglas.js";
import { ACOPIO, nombreSede } from "../sedes.js";
import { consultarVentasConPlata } from "./consultas.js";
import { RETRASO_DATOS, medirAsertividad, periodo } from "./reglas.js";

/* El resultado solo cambia cuando llegan ventas nuevas a la réplica (2 veces al
   día): se guarda por (último dato, semanas) mientras viva la instancia. */
const CACHE_MS = 30 * 60_000;
const cache = new Map();

export async function calcularAsertividad({ pool, semanas, ahora = Date.now }) {
  const ultimoDato = await consultarUltimoDato(pool);
  if (!ultimoDato) throw new ErrorPublico("La réplica no tiene ventas para medir.", 404);

  const clave = `${ultimoDato}|${semanas}`;
  const guardado = cache.get(clave);
  if (guardado && ahora() - guardado.en < CACHE_MS) return guardado.datos;

  const p = periodo(ultimoDato, semanas);
  const leerDesde = p.entrenoDesde < p.historiaDesde ? p.entrenoDesde : p.historiaDesde;
  const ventas = (await consultarVentasConPlata(pool, { desde: p.historiaDesde, hasta: p.hasta }))
    .filter((v) => v.bodega !== ACOPIO.codigo);
  if (!ventas.length) throw new ErrorPublico("No hay ventas de fruver en el período para medir.", 404);
  const filasAbiertas = await consultarDiasAbiertos(pool, { desde: leerDesde, hasta: p.hasta });
  const ventaDiaria = AJUSTE_QUINCENA
    ? (await consultarVentaDiariaFruver(pool, { desde: p.entrenoDesde, hasta: p.hasta })).filter((t) => t.bodega !== ACOPIO.codigo)
    : [];
  const maestro = await consultarMaestro(pool);

  const abiertas = new Map();
  for (const a of filasAbiertas) {
    if (!abiertas.has(a.bodega)) abiertas.set(a.bodega, new Set());
    abiertas.get(a.bodega).add(a.fecha);
  }

  const medida = medirAsertividad({
    ventas, abiertas, ventaDiaria, desde: p.desde, hasta: p.hasta,
    um: new Map(maestro.map((m) => [String(m.item), m.um])), nombreSede,
  });

  const datos = {
    parametros: {
      desde: p.desde,
      hasta: p.hasta,
      ultimoDato,
      semanas,
      ajusteQuincena: AJUSTE_QUINCENA,
      semanasHistoria: SEMANAS_HISTORIA,
      diasEntrenoQuincena: DIAS_ENTRENO_QUINCENA,
      retrasoDatos: RETRASO_DATOS,
      calculadoEn: new Date(ahora()).toISOString(),
    },
    ...medida,
  };
  cache.set(clave, { en: ahora(), datos });
  for (const [k, v] of cache) if (ahora() - v.en >= CACHE_MS) cache.delete(k);
  return datos;
}
