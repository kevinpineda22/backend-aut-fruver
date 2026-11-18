import { test } from "node:test";
import assert from "node:assert/strict";
import { atribuir, estadoLinea, medirCumplimiento } from "../src/cumplimiento/reglas.js";
import { leerRangoCumplimiento, manejadorCumplimiento } from "../src/cumplimiento/rutas.js";

const base = { items: [
  { item: "10", descripcion: "TOMATE", um: "KL" },
  { item: "20", descripcion: "PAPA", um: "KL" },
  { item: "30", descripcion: "CILANTRO", um: "UND" },
] };
const compra = (id, item, nit, cantidad, costo = 1000, proveedor = `Prov ${nit}`) => ({ id, item, nit, proveedor, cantidad, costo });
const op = (fecha_entrega, compras, recibos) => ({ fecha_entrega, estado: { base, compras, recibos, despachos: [] } });
const HOY = "2026-11-18";

test("atribuye recibos por compra, por nit y a ciegas con un solo proveedor", () => {
  const { lineas, sinAtribuir } = atribuir({
    compras: [compra("c1", "10", "900", 100), compra("c2", "20", "800", 50), compra("c3", "30", "700", 10)],
    recibos: [{ id: "r1", compraId: "c1", cantidad: 90 }, { id: "r2", item: "20", nit: "800", cantidad: 50 },
      { id: "r3", item: "30", cantidad: 12 }],
  });
  assert.deepEqual(lineas.map((l) => [l.item, l.nit, l.pedido, l.recibido, l.atribuible]),
    [["10", "900", 100, 90, true], ["20", "800", 50, 50, true], ["30", "700", 10, 12, true]]);
  assert.equal(sinAtribuir.size, 0);
});

test("recibo a ciegas sin proveedor y dos proveedores: no se atribuye a ninguno", () => {
  const { lineas, sinAtribuir } = atribuir({
    compras: [compra("c1", "10", "900", 60), compra("c2", "10", "800", 40)],
    recibos: [{ id: "r1", item: "10", cantidad: 95 }],
  });
  assert.ok(lineas.every((l) => !l.atribuible && l.recibido === 0));
  assert.equal(sinAtribuir.get("10"), 95);
});

test("compras anuladas (cantidad 0) no cuentan como pedido", () => {
  const { lineas } = atribuir({ compras: [compra("c1", "10", "900", 0)], recibos: [] });
  assert.equal(lineas.length, 0);
});

test("estado del renglón con tolerancia de 2 %", () => {
  assert.equal(estadoLinea({ pedido: 100, recibido: 98, recibos: 1 }), "completa");
  assert.equal(estadoLinea({ pedido: 100, recibido: 97.9, recibos: 1 }), "incompleta");
  assert.equal(estadoLinea({ pedido: 100, recibido: 103, recibos: 1 }), "sobre");
  assert.equal(estadoLinea({ pedido: 100, recibido: 0, recibos: 0 }), "sinRecibo");
});

test("cumplimiento en plata: lo sobreentregado no compensa lo que faltó", () => {
  const r = medirCumplimiento([op("2026-11-10",
    [compra("c1", "10", "900", 100, 2000), compra("c2", "20", "900", 50, 1000)],
    [{ id: "r1", compraId: "c1", cantidad: 50 }, { id: "r2", compraId: "c2", cantidad: 80 }])], { hoy: HOY });
  // pedido = 100·2000 + 50·1000 = 250.000; cumplido = 50·2000 + 50·1000 = 150.000
  assert.equal(r.global.pedidoValor, 250000);
  assert.equal(r.global.cumplimiento, 0.6);
  assert.equal(r.global.sobreentrega, 30000 / 250000);
  assert.equal(r.global.lineas, 2);
  assert.equal(r.global.completas, 1);
  assert.equal(r.proveedores[0].nit, "900");
  assert.deepEqual(r.proveedores[0].productos.map((p) => [p.item, p.pedido, p.recibido]), [["10", 100, 50], ["20", 50, 80]]);
});

test("por proveedor y por fecha; producto sin recibo en una operación con recibos cuenta como no entregado", () => {
  const r = medirCumplimiento([
    op("2026-11-10", [compra("c1", "10", "900", 10), compra("c2", "20", "800", 10)], [{ id: "r1", compraId: "c1", cantidad: 10 }]),
    op("2026-11-11", [compra("c3", "10", "800", 10)], [{ id: "r2", item: "10", cantidad: 5 }]),
  ], { hoy: HOY });
  const p800 = r.proveedores.find((p) => p.nit === "800");
  assert.equal(p800.cumplimiento, 0.25);
  assert.equal(p800.sinRecibo, 1);
  assert.equal(r.proveedores.find((p) => p.nit === "900").cumplimiento, 1);
  assert.deepEqual(r.fechas.map((f) => [f.fecha, f.cumplimiento]), [["2026-11-10", 0.5], ["2026-11-11", 0.5]]);
  assert.equal(r.lineas.find((l) => l.nit === "800" && l.fecha === "2026-11-10").estado, "sinRecibo");
});

test("no mide la entrega de hoy ni operaciones sin ningún recibo registrado", () => {
  const r = medirCumplimiento([
    op("2026-11-10", [compra("c1", "10", "900", 10)], []),
    op(HOY, [compra("c2", "10", "900", 10)], [{ id: "r1", compraId: "c2", cantidad: 1 }]),
  ], { hoy: HOY });
  assert.equal(r.global.lineas, 0);
  assert.equal(r.global.cumplimiento, null);
  assert.deepEqual(r.observaciones.sinReciboRegistrado, ["2026-11-10"]);
  assert.deepEqual(r.observaciones.enCurso, [HOY]);
});

test("costo pendiente: usa el costo promedio del producto; sin ninguno, queda fuera y se avisa", () => {
  const r = medirCumplimiento([
    op("2026-11-10", [compra("c1", "10", "900", 10, null), compra("c2", "10", "800", 10, 3000), compra("c3", "20", "700", 5, null)],
      [{ id: "r1", compraId: "c1", cantidad: 10 }, { id: "r2", compraId: "c2", cantidad: 10 }, { id: "r3", compraId: "c3", cantidad: 5 }]),
  ], { hoy: HOY });
  const l = r.lineas.find((x) => x.nit === "900");
  assert.equal(l.costo, 3000);
  assert.equal(l.costoEstimado, true);
  assert.equal(r.observaciones.lineasSinCosto, 1);
  assert.equal(r.global.lineas, 2);
});

test("sin costo en ninguna compra: usa el último costo de SIESA", () => {
  const r = medirCumplimiento([op("2026-11-10", [compra("c1", "20", "700", 10, null)], [{ id: "r1", compraId: "c1", cantidad: 5 }])],
    { hoy: HOY, costosSiesa: new Map([["20", 1500]]) });
  assert.equal(r.lineas[0].costo, 1500);
  assert.equal(r.global.pedidoValor, 15000);
  assert.equal(r.observaciones.lineasSinCosto, 0);
});

test("productos sin atribuir quedan en observaciones, fuera del cumplimiento", () => {
  const r = medirCumplimiento([op("2026-11-10",
    [compra("c1", "10", "900", 60), compra("c2", "10", "800", 40), compra("c3", "20", "900", 10)],
    [{ id: "r1", item: "10", cantidad: 95 }, { id: "r2", compraId: "c3", cantidad: 10 }])], { hoy: HOY });
  assert.equal(r.observaciones.lineasSinAtribuir, 2);
  assert.deepEqual(r.observaciones.productosSinAtribuir, [{ fecha: "2026-11-10", item: "10", descripcion: "TOMATE", cantidad: 95 }]);
  assert.equal(r.global.lineas, 1);
  assert.equal(r.global.cumplimiento, 1);
});

test("rango por defecto: últimos 30 días hasta ayer; valida fechas", () => {
  assert.deepEqual(leerRangoCumplimiento({}, HOY), { desde: "2026-10-19", hasta: "2026-11-17" });
  assert.ok(leerRangoCumplimiento({ desde: "x" }, HOY).error);
  assert.ok(leerRangoCumplimiento({ desde: "2026-11-10", hasta: "2026-11-01" }, HOY).error);
});

function respuesta() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("el manejador responde 400 con fechas inválidas y 503 sin Supabase", async () => {
  const reloj = () => ({ fecha: HOY });
  const r1 = respuesta();
  await manejadorCumplimiento({ supabase: { configurado: true }, reloj, calcular: async () => ({}) })({ query: { desde: "mal" } }, r1);
  assert.equal(r1.code, 400);
  const r2 = respuesta();
  await manejadorCumplimiento({ supabase: { configurado: false }, reloj })({ query: {} }, r2);
  assert.equal(r2.code, 503);
  const r3 = respuesta();
  await manejadorCumplimiento({ supabase: { configurado: true }, reloj, calcular: async (a) => ({ desde: a.desde, hoy: a.hoy }) })({ query: {} }, r3);
  assert.deepEqual(r3.body, { ok: true, data: { desde: "2026-10-19", hoy: HOY } });
});
