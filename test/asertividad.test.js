import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { desplegarConPlata } from "../src/asertividad/consultas.js";
import { medirAsertividad, medirPorDia, periodo, periodoDias, sedesSinDatos } from "../src/asertividad/reglas.js";
import { leerDias, manejadorAsertividad } from "../src/asertividad/rutas.js";
import { faseQuincena, sumarDias } from "../src/pedidos/reglas.js";

const rango = (desde, n) => Array.from({ length: n }, (_, i) => sumarDias(desde, i));
const SEDES = ["00301", "PV001"];
// 20 semanas de días abiertos: alcanza para la historia (8) y el índice (12).
const FECHAS = rango("2026-07-01", 140);
const abiertasTodas = () => new Map(SEDES.map((s) => [s, new Set(FECHAS)]));
const fila = (fecha, bodega, item, unidades, precio = 1000) =>
  ({ fecha, bodega, item, descripcion: `P${item}`, unidades, ventas: unidades * precio });
const plano = (unidades = () => 10, items = ["1"], precio = () => 1000) =>
  SEDES.flatMap((b) => items.flatMap((it) => FECHAS.map((f) => fila(f, b, it, unidades(f, b, it), precio(it)))));
const diaria = (ventas) => {
  const m = new Map();
  for (const v of ventas) m.set(`${v.fecha}|${v.bodega}`, (m.get(`${v.fecha}|${v.bodega}`) || 0) + v.ventas);
  return [...m].map(([k, ventas]) => { const [fecha, bodega] = k.split("|"); return { fecha, bodega, ventas }; });
};
const DESDE = "2026-10-21";
const HASTA = "2026-11-17";

describe("periodo", () => {
  it("son bloques de 7 días que terminan en el último dato, con lo que hay que leer antes", () => {
    const p = periodo("2026-11-17", 8);
    assert.equal(p.desde, "2026-09-23");
    assert.equal(p.hasta, "2026-11-17");
    assert.equal(p.historiaDesde, "2026-07-29"); // 8 semanas antes
    assert.equal(p.entrenoDesde, "2026-06-30"); // T−2 menos 84 días
  });
});

describe("medirAsertividad", () => {
  it("una venta constante se pronostica sin error", () => {
    const ventas = plano();
    const r = medirAsertividad({ ventas, abiertas: abiertasTodas(), ventaDiaria: diaria(ventas), desde: DESDE, hasta: HASTA });
    for (const m of ["sistema", "sinQuincena", "ingenuo"]) {
      assert.equal(r.resumen.sedeProductoDia[m].error, 0, m);
      assert.equal(r.resumen.sedeProductoDia[m].sesgo, 0, m);
    }
    assert.equal(r.semanas.length, 4);
    assert.equal(r.sedes.length, 2);
    assert.equal(r.observaciones, 2 * 28);
  });

  it("el error se pondera en plata: un producto caro pesa más que uno barato", () => {
    // Ítem 1 caro y exacto; ítem 2 barato y vende el doble el último día.
    const ventas = plano((f, b, it) => (it === "2" && f === HASTA ? 20 : 10), ["1", "2"], (it) => (it === "1" ? 9000 : 1000));
    const r = medirAsertividad({ ventas, abiertas: abiertasTodas(), ventaDiaria: [], desde: HASTA, hasta: HASTA });
    // vendido en plata: 2 sedes × (10×9000 + 20×1000) = 220.000; error: 2 × 10 × 1000 = 20.000
    assert.equal(r.resumen.sedeProductoDia.sinQuincena.error, Math.round((20_000 / 220_000) * 1e4) / 1e4);
    assert.equal(r.resumen.sedeProductoDia.sinQuincena.sesgo, -Math.round((20_000 / 220_000) * 1e4) / 1e4);
    const barato = r.productos.find((p) => p.item === "2");
    assert.equal(barato.sinQuincena.error, 0.5); // esperaba 10, vendió 20
    assert.equal(r.productos[0].item, "1"); // ordenados por venta en plata
  });

  it("con quincena el sistema le gana a la fórmula sin ajuste cuando la venta sigue el pago", () => {
    const ventas = plano((f) => (faseQuincena(f) <= 2 ? 13 : 10));
    const r = medirAsertividad({ ventas, abiertas: abiertasTodas(), ventaDiaria: diaria(ventas), desde: DESDE, hasta: HASTA });
    const { sistema, sinQuincena } = r.resumen.sedeProductoDia;
    assert.ok(sistema.error < sinQuincena.error / 2, `sistema ${sistema.error} vs sin ${sinQuincena.error}`);
  });

  it("sin fuga: lo vendido el día anterior no cambia el pronóstico del día medido", () => {
    const base = plano((f) => (faseQuincena(f) <= 2 ? 13 : 10));
    const conPico = base.map((v) => (v.fecha === sumarDias(HASTA, -1) ? { ...v, unidades: 500, ventas: 500_000 } : v));
    const medir = (ventas) => medirAsertividad({ ventas, abiertas: abiertasTodas(), ventaDiaria: diaria(ventas), desde: HASTA, hasta: HASTA });
    assert.deepEqual(medir(conPico).dias.at(-1).sistema, medir(base).dias.at(-1).sistema);
  });

  it("los días cerrados no se miden", () => {
    const ventas = plano();
    const abiertas = abiertasTodas();
    abiertas.get("00301").delete(HASTA);
    const r = medirAsertividad({ ventas, abiertas, ventaDiaria: [], desde: HASTA, hasta: HASTA });
    assert.equal(r.observaciones, 1);
    assert.deepEqual(r.sedes.map((s) => s.codigo), ["PV001"]);
  });

  it("cada producto trae su detalle por sede y su error semanal", () => {
    const ventas = plano();
    const r = medirAsertividad({ ventas, abiertas: abiertasTodas(), ventaDiaria: [], desde: DESDE, hasta: HASTA, um: new Map([["1", "KL"]]), nombreSede: (c) => `Sede ${c}` });
    const [p] = r.productos;
    assert.equal(p.um, "KL");
    assert.deepEqual(Object.keys(p.sedes).sort(), ["00301", "PV001"]);
    assert.equal(p.semanal.sistema.error, 0);
    assert.equal(p.participacionAcumulada, 1);
    assert.equal(r.sedes[0].nombre.startsWith("Sede "), true);
  });
});

describe("desplegarConPlata", () => {
  it("abre los arreglos en una fila por día con unidades y plata", () => {
    const filas = [{ bodega: "00301", item: "5", descripcion: "X", dias: [0, 2], unidades: [1.5, 2], ventas: [3000, 4000] }];
    assert.deepEqual(desplegarConPlata(filas, "2026-11-01"), [
      { fecha: "2026-11-01", bodega: "00301", item: "5", descripcion: "X", unidades: 1.5, ventas: 3000 },
      { fecha: "2026-11-03", bodega: "00301", item: "5", descripcion: "X", unidades: 2, ventas: 4000 },
    ]);
  });
});

describe("periodoDias", () => {
  it("son los últimos N días que terminan en el último dato", () => {
    const p = periodoDias("2026-11-17", 14);
    assert.equal(p.desde, "2026-11-04");
    assert.equal(p.hasta, "2026-11-17");
    assert.equal(p.historiaDesde, "2026-09-09");
  });
});

describe("medirPorDia", () => {
  it("una venta constante: el sistema acierta 100 % todos los días", () => {
    const ventas = plano();
    const r = medirPorDia({ ventas, abiertas: abiertasTodas(), ventaDiaria: diaria(ventas), desde: "2026-11-11", hasta: HASTA });
    assert.equal(r.dias.length, 7);
    assert.equal(r.dias[0].fecha, HASTA); // el más reciente primero
    assert.equal(r.dias[0].dia, "mar");
    for (const d of r.dias) {
      assert.equal(d.acierto, 1);
      assert.equal(d.esperadoValor, 2 * 10 * 1000); // dos sedes juntas
      assert.equal(d.vendidoValor, 2 * 10 * 1000);
    }
    assert.equal(r.resumen.acierto, 1);
    assert.equal(r.resumen.dias, 7);
    assert.ok(r.dias.every((d) => d.sedesSinDatos === 0));
  });

  it("avisa el día que llegó a medias: una sede sin venta ese día no se mide", () => {
    const ventas = plano();
    const abiertas = abiertasTodas();
    abiertas.get("00301").delete(HASTA); // el último día llegó a medias
    const r = medirPorDia({ ventas, abiertas, ventaDiaria: [], desde: sumarDias(HASTA, -2), hasta: HASTA });
    assert.deepEqual(r.dias.map((d) => d.sedesSinDatos), [1, 0, 0]);
    assert.equal(r.dias[0].vendidoValor, 10 * 1000);
  });

  it("una sede que abrió en el período o cerró un día en medio no es un día a medias", () => {
    const abiertas = new Map([
      ["A", new Set(["2026-11-03", "2026-11-04", "2026-11-05"])], // abrió el 3
      ["B", new Set(["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05"])], // cerró el 2
      ["C", new Set(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"])], // el 5 no ha llegado
      ["D", new Set(["2026-10-01", "2026-10-02"])], // cerró antes del período
    ]);
    const r = sedesSinDatos(abiertas, rango("2026-11-01", 5));
    assert.deepEqual([...r.values()], [0, 0, 0, 0, 1]);
  });

  it("una sede sin historia para pronosticar no se cuenta como día a medias", () => {
    // PV001 abrió hace poco: tiene venta, pero no días comparables para esperar nada.
    const recientes = new Set(rango(sumarDias(HASTA, -2), 3));
    const ventas = plano().filter((v) => v.bodega !== "PV001" || recientes.has(v.fecha));
    const abiertas = new Map([["00301", new Set(FECHAS)], ["PV001", recientes]]);
    const r = medirPorDia({ ventas, abiertas, ventaDiaria: [], desde: sumarDias(HASTA, -2), hasta: HASTA });
    assert.deepEqual(r.dias.map((d) => d.sedesSinDatos), [0, 0, 0]);
  });

  it("junta las sedes por producto, y un producto que sobra no tapa otro que falta", () => {
    // Ítem 1 vende el doble el último día; ítem 2 la mitad.
    const ventas = plano((f, b, it) => (f !== HASTA ? 10 : it === "1" ? 20 : 5), ["1", "2"], (it) => (it === "1" ? 1000 : 4000));
    const r = medirPorDia({ ventas, abiertas: abiertasTodas(), ventaDiaria: [], desde: HASTA, hasta: HASTA });
    const [d] = r.dias;
    // El precio es el promedio del período: ítem 1 y 2 a su precio fijo.
    // esperado: 2 sedes × (10×1000 + 10×4000) = 100.000; vendido: 2 × (20×1000 + 5×4000) = 80.000
    assert.equal(d.esperadoValor, 100_000);
    assert.equal(d.vendidoValor, 80_000);
    // error: ítem 1 → 2×10×1000 = 20.000; ítem 2 → 2×5×4000 = 40.000 → 1 − 60.000/80.000
    assert.equal(d.acierto, 0.25);
    assert.equal(d.sesgo, 0.25); // esperaba de más
    assert.deepEqual(d.productos.map((p) => p.item), ["2", "1"]); // el que más plata erró primero
    const p2 = d.productos[0];
    assert.equal(p2.esperado, 20); // las dos sedes juntas
    assert.equal(p2.vendido, 10);
    assert.equal(p2.acierto, 0); // esperaba el doble: nunca negativo
    assert.equal(p2.descripcion, undefined); // el nombre va una sola vez, en `productos`
    assert.equal(r.productos[0].item, "2");
    assert.equal(r.productos[0].descripcion, "P2");
  });

  it("sin fuga: lo vendido el día anterior no cambia lo esperado del día medido", () => {
    const base = plano((f) => (faseQuincena(f) <= 2 ? 13 : 10));
    const conPico = base.map((v) => (v.fecha === sumarDias(HASTA, -1) ? { ...v, unidades: 500, ventas: 500_000 } : v));
    const medir = (ventas) => medirPorDia({ ventas, abiertas: abiertasTodas(), ventaDiaria: diaria(ventas), desde: HASTA, hasta: HASTA });
    assert.equal(medir(conPico).dias[0].esperadoValor, medir(base).dias[0].esperadoValor);
  });
});

describe("leerDias y manejador", () => {
  it("valida los días", () => {
    assert.deepEqual(leerDias({}), { dias: 14 });
    assert.deepEqual(leerDias({ dias: "7" }), { dias: 7 });
    assert.deepEqual(leerDias({ dias: "28" }), { dias: 28 });
    assert.ok(leerDias({ dias: "10" }).error);
    assert.ok(leerDias({ dias: "abc" }).error);
  });

  const respuesta = () => {
    const r = { estado: 200, cuerpo: null };
    r.status = (s) => { r.estado = s; return r; };
    r.json = (c) => { r.cuerpo = c; return r; };
    return r;
  };

  it("400 con días inválidos, sin tocar la base", async () => {
    let llamado = false;
    const r = respuesta();
    await manejadorAsertividad({ pool: {}, calcular: async () => { llamado = true; } })({ query: { dias: "0" } }, r);
    assert.equal(r.estado, 400);
    assert.equal(llamado, false);
  });

  it("responde lo calculado", async () => {
    const r = respuesta();
    await manejadorAsertividad({ pool: {}, calcular: async ({ dias }) => ({ dias }) })({ query: { dias: "7" } }, r);
    assert.deepEqual(r.cuerpo, { ok: true, data: { dias: 7 } });
  });
});
