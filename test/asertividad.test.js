import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { desplegarConPlata } from "../src/asertividad/consultas.js";
import { medirAsertividad, periodo } from "../src/asertividad/reglas.js";
import { leerSemanas, manejadorAsertividad } from "../src/asertividad/rutas.js";
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

describe("leerSemanas y manejador", () => {
  it("valida las semanas", () => {
    assert.deepEqual(leerSemanas({}), { semanas: 8 });
    assert.deepEqual(leerSemanas({ semanas: "12" }), { semanas: 12 });
    assert.ok(leerSemanas({ semanas: "1" }).error);
    assert.ok(leerSemanas({ semanas: "17" }).error);
    assert.ok(leerSemanas({ semanas: "abc" }).error);
  });

  const respuesta = () => {
    const r = { estado: 200, cuerpo: null };
    r.status = (s) => { r.estado = s; return r; };
    r.json = (c) => { r.cuerpo = c; return r; };
    return r;
  };

  it("400 con semanas inválidas, sin tocar la base", async () => {
    let llamado = false;
    const r = respuesta();
    await manejadorAsertividad({ pool: {}, calcular: async () => { llamado = true; } })({ query: { semanas: "0" } }, r);
    assert.equal(r.estado, 400);
    assert.equal(llamado, false);
  });

  it("responde lo calculado", async () => {
    const r = respuesta();
    await manejadorAsertividad({ pool: {}, calcular: async ({ semanas }) => ({ semanas }) })({ query: { semanas: "4" } }, r);
    assert.deepEqual(r.cuerpo, { ok: true, data: { semanas: 4 } });
  });
});
