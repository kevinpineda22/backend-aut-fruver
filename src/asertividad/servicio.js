/* Asertividad: lee la réplica y mide. Las consultas van en serie (pool de una conexión). */

import { ErrorPublico } from "../http.js";
import {
  consultarDiasAbiertos, consultarMaestro, consultarUltimoDato, consultarVentaDiariaFruver,
} from "../pedidos/consultas.js";
import { AJUSTE_QUINCENA } from "../pedidos/reglas.js";
import { ACOPIO, nombreSede } from "../sedes.js";
import { consultarVentasConPlata } from "./consultas.js";
import { medirAsertividad, medirPorDia, periodo, periodoDias } from "./reglas.js";

/* El resultado solo cambia cuando llegan ventas nuevas a la réplica (2 veces al
   día): se guarda por (último dato, período) mientras viva la instancia. */
const CACHE_MS = 30 * 60_000;
const cache = new Map();

async function conCache(clave, ahora, calcular) {
  const guardado = cache.get(clave);
  if (guardado && ahora() - guardado.en < CACHE_MS) return guardado.datos;
  const datos = await calcular();
  cache.set(clave, { en: ahora(), datos });
  for (const [k, v] of cache) if (ahora() - v.en >= CACHE_MS) cache.delete(k);
  return datos;
}

/** Lo que hace falta para medir el período `p`: ventas, días abiertos, venta diaria y unidad de medida. */
async function leerDatos(pool, p) {
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
  return { ventas, abiertas, ventaDiaria, um: new Map(maestro.map((m) => [String(m.item), m.um])) };
}

async function ultimoDatoDe(pool) {
  const ultimoDato = await consultarUltimoDato(pool);
  if (!ultimoDato) throw new ErrorPublico("La réplica no tiene ventas para medir.", 404);
  return ultimoDato;
}

/** La pantalla: los últimos `dias` días, día por día, todas las sedes juntas. */
export async function calcularAsertividad({ pool, dias, ahora = Date.now }) {
  const ultimoDato = await ultimoDatoDe(pool);
  return conCache(`dias|${ultimoDato}|${dias}`, ahora, async () => {
    const p = periodoDias(ultimoDato, dias);
    const datos = await leerDatos(pool, p);
    return {
      parametros: { desde: p.desde, hasta: p.hasta, ultimoDato, dias, calculadoEn: new Date(ahora()).toISOString() },
      ...medirPorDia({ ...datos, desde: p.desde, hasta: p.hasta }),
    };
  });
}

/** El reporte técnico completo (por sede, semana, modelo): para el script de terminal. */
export async function calcularAsertividadCompleta({ pool, semanas, ahora = Date.now }) {
  const ultimoDato = await ultimoDatoDe(pool);
  return conCache(`semanas|${ultimoDato}|${semanas}`, ahora, async () => {
    const p = periodo(ultimoDato, semanas);
    const datos = await leerDatos(pool, p);
    return {
      parametros: { desde: p.desde, hasta: p.hasta, ultimoDato, semanas, ajusteQuincena: AJUSTE_QUINCENA },
      ...medirAsertividad({ ...datos, desde: p.desde, hasta: p.hasta, nombreSede }),
    };
  });
}
