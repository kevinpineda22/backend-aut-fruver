/* =============================================================================
   Asertividad del sugerido: ¿cuánto se equivoca la venta esperada?

   Para cada día ya vendido del período y cada sede×producto, se recalcula lo
   que el sistema HABRÍA esperado vender ese día con la historia que existía
   antes (las mismas funciones de pedidos/reglas.js), y se compara con lo que se
   vendió. Sin fuga: el índice de quincena de un día T se aprende con la venta
   hasta T − RETRASO_DATOS, que es lo que tiene la réplica cuando se calcula el
   sugerido de ese día.

   Dos salidas:
     medirPorDia      — la pantalla: por día, todas las sedes juntas, esperado
                        contra vendido y el acierto (1 − error), por producto.
     medirAsertividad — el reporte técnico de la terminal: cuatro niveles y
                        tres pronósticos.

   Tres pronósticos lado a lado (solo el reporte técnico; la pantalla usa `sistema`):
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
     - Es la fórmula de HOY aplicada al pasado. Mientras la fórmula no cambie,
       da lo mismo que se mostró: comprobado el 20-nov-2026 contra la foto del
       18-nov (fruver_sugerido_fotos), 178 de 178 productos iguales.
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
  const { obs, info, fechas } = observar({ ventas, abiertas, ventaDiaria, desde, hasta });
  return resumirCompleto({ obs, info, fechas, desde, um, nombreSede });
}

/** Días que se pueden pedir en la pantalla. */
export const DIAS_OPCIONES = [7, 14, 28];
export const DIAS_DEFECTO = 14;

/** Los últimos `dias` días que terminan en el último dato, con lo que hay que leer antes. */
export function periodoDias(ultimoDato, dias) {
  const desde = sumarDias(ultimoDato, -dias + 1);
  return {
    desde,
    hasta: ultimoDato,
    historiaDesde: sumarDias(desde, -56),
    entrenoDesde: sumarDias(desde, -RETRASO_DATOS - DIAS_ENTRENO_QUINCENA + 1),
  };
}

/** 0–1. Cuánto acertó: 1 − |esperado − vendido| ÷ vendido, nunca menos de 0. */
const acierto = (errorValor, vendidoValor) => (vendidoValor > 0 ? Math.max(0, 1 - errorValor / vendidoValor) : null);

/**
 * La tabla de la pantalla: por DÍA, todas las sedes juntas (lo que se compra),
 * lo que el sistema esperaba vender contra lo que se vendió, y por producto.
 *
 * El error de un día se suma producto por producto (en plata): que la papa
 * sobre no compensa que el tomate falte.
 */
export function medirPorDia({ ventas, abiertas, ventaDiaria, desde, hasta, um = new Map() }) {
  const { obs, info } = observar({ ventas, abiertas, ventaDiaria, desde, hasta });
  // Todas las sedes juntas: producto × día.
  const celdas = new Map();
  for (const o of obs) {
    const k = `${o.T}|${o.item}`;
    const c = celdas.get(k) || { fecha: o.T, item: o.item, p: o.p, esperado: 0, vendido: 0 };
    c.esperado += o.F.sistema;
    c.vendido += o.A;
    celdas.set(k, c);
  }
  const vacio = () => ({ esperadoValor: 0, vendidoValor: 0, errorValor: 0, sesgoValor: 0 });
  const sumar = (m, c) => {
    m.esperadoValor += c.esperado * c.p;
    m.vendidoValor += c.vendido * c.p;
    m.errorValor += Math.abs(c.esperado - c.vendido) * c.p;
    m.sesgoValor += (c.esperado - c.vendido) * c.p;
  };
  const cerrar = (m) => ({
    esperadoValor: Math.round(m.esperadoValor),
    vendidoValor: Math.round(m.vendidoValor),
    acierto: redondear(acierto(m.errorValor, m.vendidoValor)),
    // + = esperaba vender de más; − = de menos.
    sesgo: m.vendidoValor > 0 ? redondear(m.sesgoValor / m.vendidoValor) : null,
  });

  const total = vacio();
  const dias = new Map();
  const productos = new Map();
  for (const c of celdas.values()) {
    sumar(total, c);
    const d = dias.get(c.fecha) || { m: vacio(), filas: [] };
    sumar(d.m, c);
    d.filas.push(c);
    dias.set(c.fecha, d);
    const pr = productos.get(c.item) || { m: vacio(), esperado: 0, vendido: 0 };
    sumar(pr.m, c);
    pr.esperado += c.esperado;
    pr.vendido += c.vendido;
    productos.set(c.item, pr);
  }

  const fila = (item, esperado, vendido, m) => ({
    item,
    descripcion: info.get(item)?.descripcion || item,
    um: um.get(item) || null,
    esperado: redondear(esperado, 1),
    vendido: redondear(vendido, 1),
    ...cerrar(m),
    errorValor: Math.round(m.errorValor),
  });

  const sinDatos = sedesSinDatos(abiertas, [...dias.keys()]);
  return {
    resumen: { ...cerrar(total), errorValor: Math.round(total.errorValor), dias: dias.size },
    dias: [...dias.keys()].sort().reverse().map((fecha) => {
      const d = dias.get(fecha);
      return {
        fecha,
        dia: DIAS[diaSemana(fecha)],
        sedesSinDatos: sinDatos.get(fecha) || 0,
        ...cerrar(d.m),
        // Solo números: el nombre y la unidad están en `productos` (no repetirlos 28 veces).
        productos: d.filas
          .map((c) => {
            const errorValor = Math.abs(c.esperado - c.vendido) * c.p;
            return {
              item: c.item,
              esperado: redondear(c.esperado, 1),
              vendido: redondear(c.vendido, 1),
              acierto: redondear(acierto(errorValor, c.vendido * c.p)),
              errorValor: Math.round(errorValor),
            };
          })
          .sort((a, b) => b.errorValor - a.errorValor),
      };
    }),
    // Dónde más se equivoca en el período: más plata errada primero.
    productos: [...productos]
      .map(([item, pr]) => fila(item, pr.esperado, pr.vendido, pr.m))
      .sort((a, b) => b.errorValor - a.errorValor),
  };
}

/**
 * Sedes cuya venta todavía no llegó a la réplica, por día. El último día suele
 * llegar a medias: una sede que venía vendiendo y desaparece al FINAL del
 * período no cerró, es que su venta no ha llegado. Ese día compara menos sedes
 * y la pantalla lo avisa.
 *
 * No cuentan: una sede que abrió después (no venía vendiendo) ni un día cerrado
 * en medio del período (después volvió a vender).
 */
export function sedesSinDatos(abiertas, fechas) {
  // Una sede que dejó de vender una semana antes del período cerró: no es un retraso.
  const desde = sumarDias([...fechas].sort()[0], -7);
  const tramos = [...abiertas.values()].map((s) => {
    const dias = [...s].sort();
    return { primero: dias[0], ultimo: dias.at(-1) };
  }).filter((t) => t.primero && t.ultimo >= desde);
  return new Map(fechas.map((f) => [f, tramos.filter((t) => t.primero < f && t.ultimo < f).length]));
}

/** Observaciones sede × producto × día: lo vendido (A) y lo esperado por cada modelo (F). */
function observar({ ventas, abiertas, ventaDiaria, desde, hasta }) {
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
  return { obs, info, fechas };
}

/** El reporte completo (cuatro niveles, tres modelos): lo usa el script de terminal. */
function resumirCompleto({ obs, info, fechas, desde, um, nombreSede }) {
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
