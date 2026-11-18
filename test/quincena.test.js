import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { faseQuincena, indiceQuincena, sumarDias, ventaEsperada } from "../src/pedidos/reglas.js";
import { armarSugerido } from "../src/pedidos/sugerido.js";

const dias = (desde, n) => Array.from({ length: n }, (_, i) => sumarDias(desde, i));

describe("faseQuincena", () => {
  it("cuenta días desde el 15 y desde el 30", () => {
    assert.equal(faseQuincena("2026-11-15"), 0);
    assert.equal(faseQuincena("2026-11-16"), 1);
    assert.equal(faseQuincena("2026-11-29"), 14);
    assert.equal(faseQuincena("2026-11-30"), 0);
    assert.equal(faseQuincena("2026-12-01"), 1);
  });

  it("en un mes de 31 días el pago es el 30: el 31 y el 1 siguen contando", () => {
    assert.equal(faseQuincena("2026-10-31"), 1);
    assert.equal(faseQuincena("2026-11-01"), 2);
  });

  it("en febrero el pago es el último día", () => {
    assert.equal(faseQuincena("2026-02-28"), 0);
    assert.equal(faseQuincena("2026-03-01"), 1);
  });

  it("nunca pasa de 15", () => {
    assert.equal(faseQuincena("2026-01-14"), 15);
  });
});

describe("ventaEsperada con índice de quincena", () => {
  const hist = new Map([["2026-11-15", 20], ["2026-11-22", 5]]);
  const fechas = ["2026-11-15", "2026-11-22"]; // fase 0 y fase 7
  const indice = new Map([[0, 2], [7, 0.5]]);

  it("sin índice es la media de siempre", () => {
    assert.equal(ventaEsperada(hist, fechas), 12.5);
  });

  it("lleva cada día a normal y aplica la fase del día pronosticado", () => {
    // 20 / 2 = 10 y 5 / 0,5 = 10 → normal 10
    assert.equal(ventaEsperada(hist, fechas, indice, "2026-11-16"), 10); // fase 1 sin índice → ×1
    assert.equal(ventaEsperada(hist, fechas, indice, "2026-11-30"), 20); // fase 0 → ×2
    assert.equal(ventaEsperada(hist, fechas, indice, "2026-11-06"), 5); // fase 7 → ×0,5
  });
});

describe("indiceQuincena", () => {
  const fechas = dias("2026-08-01", 84);
  const abiertas = new Map([["00301", new Set(fechas)], ["PV001", new Set(fechas)]]);
  const conPago = (bodega, base) => fechas.map((fecha) => ({ fecha, bodega, ventas: faseQuincena(fecha) <= 2 ? base * 1.3 : base }));

  it("los días después del pago quedan por encima de 1 y el resto por debajo", () => {
    const indice = indiceQuincena([...conPago("00301", 100), ...conPago("PV001", 40)], abiertas);
    assert.ok(indice.get(0) > 1.15, `fase 0 = ${indice.get(0)}`);
    assert.ok(indice.get(7) < 1, `fase 7 = ${indice.get(7)}`);
    // el tamaño de la sede no importa: se compara cada sede contra sí misma
    assert.ok(Math.abs(indice.get(0) / indice.get(7) - 1.3) < 0.05);
  });

  it("sin efecto de quincena, el índice es 1", () => {
    const plano = ["00301", "PV001"].flatMap((bodega) => fechas.map((fecha) => ({ fecha, bodega, ventas: 100 })));
    const indice = indiceQuincena(plano, abiertas);
    assert.ok(indice.size >= 15); // la fase 15 solo existe el 14 después de un mes de 31
    for (const f of indice.values()) assert.equal(f, 1);
  });

  it("ignora días cerrados y días sin venta", () => {
    const cerrado = "2026-08-16"; // fase 1
    const sinCerrado = new Set(fechas.filter((f) => f !== cerrado));
    const soloAbiertas = new Map([["00301", sinCerrado], ["PV001", sinCerrado]]);
    const totales = ["00301", "PV001"].flatMap((bodega) => fechas.map((fecha) => ({ fecha, bodega, ventas: fecha === cerrado ? 10_000 : 100 })));
    totales.push({ fecha: "2026-08-17", bodega: "00301", ventas: 0 });
    const indice = indiceQuincena(totales, soloAbiertas);
    assert.ok(indice.size >= 15); // la fase 15 solo existe el 14 después de un mes de 31
    for (const f of indice.values()) assert.equal(f, 1);
  });

  it("una fase con pocas observaciones no se ajusta (una sola sede no alcanza el mínimo)", () => {
    const pocas = dias("2026-11-01", 10).map((fecha) => ({ fecha, bodega: "00301", ventas: 100 }));
    const indice = indiceQuincena(pocas, new Map([["00301", new Set(pocas.map((p) => p.fecha))]]));
    assert.equal(indice.size, 0);
  });
});

describe("armarSugerido con quincena", () => {
  // Jueves 5-nov a las 14:00. Entrega viernes 6-nov (fase 7). Historia: 6 viernes.
  const viernes = ["2026-10-30", "2026-10-23", "2026-10-16", "2026-10-09", "2026-10-02", "2026-09-25"];
  const fechas = dias("2026-08-12", 85); // hasta el 4-nov
  const base = {
    hoy: "2026-11-05", hora: 14, entrega: "2026-11-06", dias: 1, ultimoDato: "2026-11-04", mermaDesde: "2026-09-24",
    ventas: viernes.map((fecha) => ({ fecha, bodega: "00301", item: "5098", descripcion: "TOMATE", subgrupo: "4004-VERDURA", unidades: 90 })),
    abiertas: ["00301", "PV001"].flatMap((bodega) => fechas.map((fecha) => ({ fecha, bodega }))),
    perfiles: [],
    compras: [{ item: "5098", comprado: 540, ultimo_precio: 3000 }],
    maestro: [{ item: "5098", um: "KL" }],
    inventario: { porItem: new Map([["5098", new Map([["00301", { disponible: 0 }]])]]), fallidos: new Set(), consultadoEn: "x" },
  };

  it("sin venta diaria, el sugerido es el de antes", () => {
    const r = armarSugerido(base);
    assert.equal(r.items[0].sedes["00301"].ventaEsperada, 90);
    assert.equal(r.parametros.quincena, null);
  });

  it("si la fase de la entrega vende la mitad, el sugerido baja; el acopio no cuenta", () => {
    const ventaDiaria = [
      ...["00301", "PV001"].flatMap((bodega) => fechas.map((fecha) => ({ fecha, bodega, ventas: faseQuincena(fecha) === 7 ? 50 : 100 }))),
      // el acopio con venta rara no debe mover el índice
      ...fechas.map((fecha) => ({ fecha, bodega: "PV009", ventas: faseQuincena(fecha) === 7 ? 1e9 : 1 })),
    ];
    const r = armarSugerido({ ...base, abiertas: [...base.abiertas, ...fechas.map((fecha) => ({ fecha, bodega: "PV009" }))], ventaDiaria });
    const esperada = r.items[0].sedes["00301"].ventaEsperada;
    assert.ok(esperada > 40 && esperada < 55, `venta esperada = ${esperada}`);
    assert.ok(r.parametros.quincena.dias["2026-11-06"] < 0.6);
    assert.ok(r.parametros.quincena.indice[0] > 1);
  });
});
