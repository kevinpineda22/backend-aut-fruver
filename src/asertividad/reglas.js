/* =============================================================================
   Asertividad del sugerido: ¿cuánto se equivoca la venta esperada?

   Para cada día ya vendido del período y cada sede×producto, se recalcula lo
   que el sistema HABRÍA esperado vender ese día con la historia que existía
   antes (las mismas funciones de pedidos/reglas.js), y se compara con lo que se
   vendió. Sin fuga: el índice de quincena de un día T se aprende con la venta
   hasta T − RETRASO_DATOS, que es lo que tiene la réplica cuando se calcula el
   sugerido de ese día.

   Tres pronósticos lado a lado:
     sistema      — la fórmula vigente (con quincena si AJUSTE_QUINCENA)
     sinQuincena  — la fórmula sin el ajuste: dice si el ajuste sigue ayudando
     ingenuo      — lo que se vendió el mismo día de la semana pasada: si el
                    sistema no le gana a esto, no aporta

   Métricas, ponderadas en plata (unidades × precio de venta promedio del
   producto, para poder sumar kilos con unidades):
     error (WAPE) = Σ |vendido − esperado| ÷ Σ vendido
     sesgo        = Σ (esperado − vendido) ÷ Σ vendido   (+ = esperaba de más)

   Límites que la pantalla dice:
     - Mide la VENTA ESPERADA, no el pedido: el inventario histórico por bodega
       no está en la réplica.
     - Un día de agotado la venta es menor que la demanda: el error real de los
       productos que se agotan es algo mayor.
     - Es la fórmula de HOY aplicada al pasado, no lo que se mostró ese día.
   ============================================================================= */

import {
  AJUSTE_QUINCENA, DIAS_ENTRENO_QUINCENA, faseQuincena, fechasComparables, indiceQuincena, sumarDias, ventaEsperada,
} from "../pedidos/reglas.js";

export const SEMANAS_DEFECTO = 8;
export const SEMANAS_MIN = 2;
export const SEMANAS_MAX = 16;
/** Días entre el último dato de la réplica y el día pronosticado (se calcula hoy para mañana; la réplica trae hasta ayer). */
export const RETRASO_DATOS = 2;

export const MODELOS = ["sistema", "sinQuincena", "ingenuo"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay();
const redondear = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Ventana a medir: `semanas` bloques de 7 días que terminan en el último dato. */
export function periodo(ultimoDato, semanas) {
  const hasta = ultimoDato;
  const desde = sumarDias(hasta, -7 * semanas + 1);
  return {
    desde,
    hasta,
    // Lo que hay que leer de la base para medir ese período.
    historiaDesde: sumarDias(desde, -56),
    entrenoDesde: sumarDias(desde, -RETRASO_DATOS - DIAS_ENTRENO_QUINCENA + 1),
  };
}

/** Acumulador de una métrica: se suman observaciones y al final se cierra. */
function acumulador() {
  const a = { venta: 0, error: Object.fromEntries(MODELOS.map((m) => [m, 0])), sesgo: Object.fromEntries(MODELOS.map((m) => [m, 0])), unidades: 0, esperado: 0 };
  return {
    sumar(o) {
      a.venta += o.A * o.p;
      a.unidades += o.A;
      a.esperado += o.F.sistema;
      for (const m of MODELOS) {
        a.error[m] += Math.abs(o.A - o.F[m]) * o.p;
        a.sesgo[m] += (o.F[m] - o.A) * o.p;
      }
    },
    cerrar() {
      const r = { venta: Math.round(a.venta), unidades: redondear(a.unidades, 1), esperado: redondear(a.esperado, 1) };
      for (const m of MODELOS) {
        r[m] = a.venta > 0 ? { error: redondear(a.error[m] / a.venta), sesgo: redondear(a.sesgo[m] / a.venta) } : { error: null, sesgo: null };
      }
      return r;
    },
  };
}

/** Agrupa observaciones por `clave` y devuelve Map clave → métrica cerrada. */
function porClave(obs, clave) {
  const grupos = new Map();
  for (const o of obs) {
    const k = clave(o);
    if (!grupos.has(k)) grupos.set(k, acumulador());
    grupos.get(k).sumar(o);
  }
  return new Map([...grupos].map(([k, a]) => [k, a.cerrar()]));
}

/** Suma las observaciones de cada grupo en una sola (el error de la suma, no la suma de errores). */
function sumarGrupos(obs, clave) {
  const grupos = new Map();
  for (const o of obs) {
    const k = clave(o);
    const g = grupos.get(k);
    if (!g) grupos.set(k, { ...o, F: { ...o.F } });
    else {
      g.A += o.A;
      for (const m of MODELOS) g.F[m] += o.F[m];
    }
  }
  return [...grupos.values()];
}

const total = (obs) => { const a = acumulador(); for (const o of obs) a.sumar(o); return a.cerrar(); };

/**
 * @param {object} p
 * @param {Array}  p.ventas      { fecha, bodega, item, descripcion, unidades, ventas } — sin el acopio
 * @param {Map}    p.abiertas    bodega → Set de fechas abiertas
 * @param {Array}  p.ventaDiaria { fecha, bodega, ventas } — para el índice de quincena
 * @param {string} p.desde       primer día medido
 * @param {string} p.hasta       último día medido
 * @param {Map}    [p.um]        item → unidad de medida
 * @param {(codigo:string)=>string} [p.nombreSede]
 */
export function medirAsertividad({ ventas, abiertas, ventaDiaria, desde, hasta, um = new Map(), nombreSede = (c) => c }) {
  const hist = new Map();
  const info = new Map();
  for (const v of ventas) {
    const k = `${v.bodega}|${v.item}`;
    if (!hist.has(k)) hist.set(k, new Map());
    hist.get(k).set(v.fecha, Number(v.unidades) || 0);
    const i = info.get(v.item) || { descripcion: v.descripcion, unidades: 0, ventas: 0 };
    i.unidades += Math.max(0, Number(v.unidades) || 0);
    i.ventas += Math.max(0, Number(v.ventas) || 0);
    info.set(v.item, i);
  }
  const precio = (item) => {
    const i = info.get(item);
    return i && i.unidades > 0 && i.ventas > 0 ? i.ventas / i.unidades : null;
  };

  const indices = new Map();
  const indicePara = (T) => {
    if (!AJUSTE_QUINCENA) return null;
    if (!indices.has(T)) {
      const hastaEntreno = sumarDias(T, -RETRASO_DATOS);
      const desdeEntreno = sumarDias(hastaEntreno, -DIAS_ENTRENO_QUINCENA + 1);
      indices.set(T, indiceQuincena(ventaDiaria.filter((t) => t.fecha >= desdeEntreno && t.fecha <= hastaEntreno), abiertas));
    }
    return indices.get(T);
  };

  const fechas = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) fechas.push(f);

  const obs = [];
  for (const [k, h] of hist) {
    const [sede, item] = k.split("|");
    const p = precio(item);
    const ab = abiertas.get(sede);
    if (!p || !ab) continue;
    for (const T of fechas) {
      if (!ab.has(T)) continue;
      const comps = fechasComparables(T, ab, sumarDias(T, -1));
      if (!comps.length) continue;
      const sinQuincena = ventaEsperada(h, comps);
      const indice = indicePara(T);
      const sistema = indice ? ventaEsperada(h, comps, indice, T) : sinQuincena;
      const ingenuo = Number(h.get(comps[0]) || 0);
      const A = Number(h.get(T) || 0);
      if (A <= 0 && sistema <= 0 && sinQuincena <= 0 && ingenuo <= 0) continue;
      obs.push({ sede, item, T, A, p, F: { sistema, sinQuincena, ingenuo } });
    }
  }

  const semana = (T) => Math.floor((Date.parse(`${T}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / (7 * 86_400_000));
  const sedes = [...new Set(obs.map((o) => o.sede))];

  const resumen = {
    sedeProductoDia: total(obs),
    consolidadoDia: total(sumarGrupos(obs, (o) => `${o.item}|${o.T}`)),
    sedeProductoSemana: total(sumarGrupos(obs, (o) => `${o.sede}|${o.item}|${semana(o.T)}`)),
    consolidadoSemana: total(sumarGrupos(obs, (o) => `${o.item}|${semana(o.T)}`)),
  };

  const porSemana = porClave(obs, (o) => semana(o.T));
  const porSemanaConsolidado = porClave(sumarGrupos(obs, (o) => `${o.item}|${semana(o.T)}`), (o) => semana(o.T));
  const semanas = [...porSemana.keys()].sort((a, b) => a - b).map((w) => ({
    desde: sumarDias(desde, 7 * w),
    hasta: sumarDias(desde, 7 * w + 6),
    ...porSemana.get(w),
    consolidado: porSemanaConsolidado.get(w),
  }));

  const porSede = porClave(obs, (o) => o.sede);
  const porSedeSemana = porClave(sumarGrupos(obs, (o) => `${o.sede}|${o.item}|${semana(o.T)}`), (o) => o.sede);
  const sedesSalida = sedes
    .map((codigo) => ({ codigo, nombre: nombreSede(codigo), ...porSede.get(codigo), semanal: porSedeSemana.get(codigo) }))
    .sort((a, b) => b.venta - a.venta);

  const porDia = porClave(obs, (o) => diaSemana(o.T));
  const diasSemana = [1, 2, 3, 4, 5, 6, 0].filter((d) => porDia.has(d)).map((d) => ({ dia: DIAS[d], ...porDia.get(d) }));

  const porFase = porClave(obs, (o) => faseQuincena(o.T));
  const fases = [...porFase.keys()].sort((a, b) => a - b).map((fase) => ({ fase, ...porFase.get(fase) }));

  const porFecha = porClave(obs, (o) => o.T);
  const dias = fechas.filter((f) => porFecha.has(f)).map((fecha) => ({ fecha, dia: DIAS[diaSemana(fecha)], fase: faseQuincena(fecha), ...porFecha.get(fecha) }));

  const porProducto = porClave(obs, (o) => o.item);
  const porProductoSemana = porClave(sumarGrupos(obs, (o) => `${o.item}|${semana(o.T)}`), (o) => o.item);
  const porProductoSede = porClave(obs, (o) => `${o.item}|${o.sede}`);
  const ventaTotal = resumen.sedeProductoDia.venta || 1;
  let acumulado = 0;
  const productos = [...porProducto.entries()]
    .sort((a, b) => b[1].venta - a[1].venta)
    .map(([item, m]) => {
      acumulado += m.venta;
      return {
        item,
        descripcion: info.get(item)?.descripcion || item,
        um: um.get(item) || null,
        participacion: redondear(m.venta / ventaTotal),
        participacionAcumulada: redondear(acumulado / ventaTotal),
        ...m,
        semanal: porProductoSemana.get(item),
        sedes: Object.fromEntries(sedes
          .filter((s) => porProductoSede.has(`${item}|${s}`))
          .map((s) => [s, porProductoSede.get(`${item}|${s}`)])),
      };
    });

  return {
    resumen,
    semanas,
    sedes: sedesSalida,
    diasSemana,
    fases,
    dias,
    productos,
    observaciones: obs.length,
  };
}
