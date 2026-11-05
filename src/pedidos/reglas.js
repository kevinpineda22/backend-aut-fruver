/* =============================================================================
   Reglas del sugerido de pedido de fruver (funciones puras: sin base ni red)

   Para cada sede y cada producto:

     venta esperada de un día = media recortada de lo vendido el MISMO día de la
                                semana en las últimas 6 semanas abiertas
                                (el jueves de fruver vende el doble: comparar un
                                jueves con un martes daría pedidos absurdos)

     inventario al recibir    = disponible hoy en SIESA
                                − lo que falta vender hoy (según la hora)
                                − lo que se vende los días antes de la entrega

     necesidad                = venta esperada de los días a cubrir ÷ (1 − merma)
     sugerido                 = necesidad − inventario al recibir (nunca negativo)

   La merma es la parte de lo comprado que no se vendió (se dañó, se botó) y sale
   de comparar compras contra ventas del mismo producto. Para vender 100 kg con
   10 % de merma hay que comprar 111 kg, no 110.
   ============================================================================= */

export const SEMANAS_HISTORIA = 6;
/** Semanas de más que se miran para saltar días cerrados o sin datos todavía. */
export const SEMANAS_MARGEN = 2;
export const DIAS_MERMA = 42;
export const MERMA_MAXIMA = 0.25;
/** Si vende 1,5 veces lo que compra, el producto se arma o transforma en la tienda. */
export const FACTOR_ARMADO = 1.5;
export const DIAS_COBERTURA_MAX = 4;
export const DIAS_ENTREGA_MAX = 7;

export function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Fecha (YYYY-MM-DD) y hora decimal (14.5 = 2:30 p. m.) en Colombia. */
export function ahoraColombia(momento = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(momento);
  const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return { fecha: `${v.year}-${v.month}-${v.day}`, hora: Number(v.hour) + Number(v.minute) / 60 };
}

/**
 * Fechas con el mismo día de la semana que `fecha`, hacia atrás, en las que la
 * sede abrió y que ya están en los datos. Un día cerrado (festivo, inventario)
 * no cuenta como "vendió 0": se salta y se busca una semana más atrás.
 */
export function fechasComparables(fecha, abiertas, ultimoDato, semanas = SEMANAS_HISTORIA) {
  const fechas = [];
  for (let k = 1; fechas.length < semanas && k <= semanas + SEMANAS_MARGEN; k++) {
    const candidata = sumarDias(fecha, -7 * k);
    if (candidata <= ultimoDato && abiertas.has(candidata)) fechas.push(candidata);
  }
  return fechas;
}

/** Promedio sin el día más alto ni el más bajo (con 5 o más días): una promoción o un día malo no mueven el pedido. */
export function mediaRecortada(valores) {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const usados = orden.length >= 5 ? orden.slice(1, -1) : orden;
  return usados.reduce((suma, v) => suma + v, 0) / usados.length;
}

/** Venta esperada en `fecha`. Un día abierto sin ventas del producto cuenta como 0. */
export function ventaEsperada(ventasPorFecha, fechas) {
  return mediaRecortada(fechas.map((f) => Number(ventasPorFecha.get(f) || 0)));
}

/**
 * Parte de la venta del día que todavía no ocurrió a esta hora, según cómo
 * vende la sede hora por hora. `perfil`: Map hora → ventas.
 */
export function fraccionRestante(perfil, hora) {
  let total = 0;
  let resta = 0;
  for (const [h, ventas] of perfil || []) {
    const v = Number(ventas) || 0;
    total += v;
    resta += v * Math.min(1, Math.max(0, Number(h) + 1 - hora));
  }
  return total > 0 ? resta / total : 0;
}

/** Parte de lo comprado que no se vendió, entre 0 y MERMA_MAXIMA. */
export function calcularMerma(comprado, vendido) {
  const c = Number(comprado) || 0;
  const v = Number(vendido) || 0;
  if (c <= 0 || v >= c) return 0;
  return Math.min((c - v) / c, MERMA_MAXIMA);
}

/** Vende bastante más de lo que se compra con ese código: se arma en la tienda (paquetes, bandejas). */
export const seArmaEnTienda = (comprado, vendido) =>
  Number(vendido) > 0 && Number(vendido) > Math.max(Number(comprado) || 0, 0) * FACTOR_ARMADO;

/**
 * Redondeo de negocio (el mismo de Traslados): sube al entero siguiente si el
 * decimal es 0,2 o más; si no, baja. 22,45 → 23 · 3,15 → 3 · 3,2 → 4.
 */
export function redondear(x) {
  const n = Number(x) || 0;
  if (n <= 0) return 0;
  const entero = Math.floor(n);
  return n - entero >= 0.2 - 1e-9 ? entero + 1 : entero;
}

/** Días antes de la entrega (después de hoy) y días que cubre el pedido. */
export function ventanas(hoy, entrega, dias) {
  const antes = [];
  for (let f = sumarDias(hoy, 1); f < entrega; f = sumarDias(f, 1)) antes.push(f);
  const cobertura = Array.from({ length: dias }, (_, i) => sumarDias(entrega, i));
  return { antes, cobertura };
}

/** Sugerido de una sede para un producto. Sin inventario no hay sugerido: null, nunca un 0 inventado. */
export function calcularLinea({ pendienteHoy, antesDeEntrega, cobertura, disponible, merma }) {
  const necesidad = cobertura / (1 - merma);
  if (disponible == null) return { inventarioAlRecibir: null, necesidad, sugerido: null };
  const inventarioAlRecibir = Math.max(0, disponible - pendienteHoy - antesDeEntrega);
  return { inventarioAlRecibir, necesidad, sugerido: redondear(necesidad - inventarioAlRecibir) };
}

/** Disponible = existencia − ventas de caja todavía sin descargar del inventario. Nunca negativo. */
export const disponibleDe = (existencia, pos) =>
  Math.max(0, (Number(existencia) || 0) - (Number(pos) || 0));
