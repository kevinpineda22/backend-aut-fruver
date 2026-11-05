import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ahoraColombia, calcularLinea, calcularMerma, fechasComparables, fraccionRestante, mediaRecortada,
  redondear, seArmaEnTienda, ventanas,
} from "../src/pedidos/reglas.js";
import { leerParametros } from "../src/pedidos/rutas.js";
import { armarSugerido } from "../src/pedidos/sugerido.js";
import { crearClienteInventario, stockPorBodega } from "../src/siesa/inventario.js";

describe("fechasComparables", () => {
  const abiertas = new Set(["2026-10-29", "2026-10-22", "2026-10-08", "2026-10-01", "2026-09-24", "2026-09-17", "2026-09-10"]);
  it("toma el mismo día de la semana y salta el que la sede no abrió", () => {
    // 2026-11-05 es jueves; el 15-oct (jueves) la sede no abrió.
    assert.deepEqual(fechasComparables("2026-11-05", abiertas, "2026-11-04"), [
      "2026-10-29", "2026-10-22", "2026-10-08", "2026-10-01", "2026-09-24", "2026-09-17",
    ]);
  });
  it("no usa días que todavía no están en los datos", () => {
    assert.deepEqual(fechasComparables("2026-11-05", abiertas, "2026-10-25", 2), ["2026-10-22", "2026-10-08"]);
  });
});

describe("mediaRecortada", () => {
  it("con 5 o más días saca el más alto y el más bajo", () => {
    assert.equal(mediaRecortada([100, 100, 100, 100, 500, 10]), 100);
  });
  it("con pocos días promedia todo", () => {
    assert.equal(mediaRecortada([10, 20]), 15);
    assert.equal(mediaRecortada([]), 0);
  });
});

describe("fraccionRestante", () => {
  const perfil = new Map([[8, 25], [9, 25], [10, 25], [11, 25]]);
  it("antes de abrir falta todo el día; después de cerrar, nada", () => {
    assert.equal(fraccionRestante(perfil, 6), 1);
    assert.equal(fraccionRestante(perfil, 13), 0);
  });
  it("a mitad de una hora cuenta la mitad de esa hora", () => {
    assert.equal(fraccionRestante(perfil, 10.5), 0.375);
  });
  it("sin perfil no inventa venta pendiente", () => {
    assert.equal(fraccionRestante(undefined, 10), 0);
  });
});

describe("merma y productos armados", () => {
  it("es lo comprado que no se vendió, con tope", () => {
    assert.equal(calcularMerma(100, 90), 0.1);
    assert.equal(calcularMerma(100, 10), 0.25);
    assert.equal(calcularMerma(100, 120), 0);
    assert.equal(calcularMerma(0, 50), 0);
  });
  it("vender mucho más de lo comprado = se arma en la tienda (paquetes de verduras)", () => {
    assert.equal(seArmaEnTienda(73_560, 257_661), true);
    assert.equal(seArmaEnTienda(0, 5), true);
    assert.equal(seArmaEnTienda(100, 110), false);
  });
});

describe("redondear (regla de Traslados)", () => {
  it("sube desde 0,2", () => {
    assert.equal(redondear(22.45), 23);
    assert.equal(redondear(3.15), 3);
    assert.equal(redondear(3.2), 4);
    assert.equal(redondear(-5), 0);
  });
});

describe("ventanas", () => {
  it("entrega mañana: nada antes, cubre los días pedidos", () => {
    assert.deepEqual(ventanas("2026-11-05", "2026-11-06", 2), { antes: [], cobertura: ["2026-11-06", "2026-11-07"] });
  });
  it("entrega pasado mañana: mañana se vende de lo que hay", () => {
    assert.deepEqual(ventanas("2026-11-05", "2026-11-07", 1).antes, ["2026-11-06"]);
  });
});

describe("calcularLinea", () => {
  it("descuenta lo que se vende antes de recibir y suma la merma", () => {
    const l = calcularLinea({ pendienteHoy: 30, antesDeEntrega: 0, cobertura: 90, disponible: 50, merma: 0.1 });
    assert.equal(l.inventarioAlRecibir, 20);
    assert.equal(l.sugerido, 80); // 90 / 0,9 = 100 − 20
  });
  it("con inventario de sobra no pide", () => {
    assert.equal(calcularLinea({ pendienteHoy: 0, antesDeEntrega: 0, cobertura: 10, disponible: 500, merma: 0 }).sugerido, 0);
  });
  it("sin inventario no hay sugerido (null, no 0)", () => {
    assert.equal(calcularLinea({ pendienteHoy: 0, antesDeEntrega: 0, cobertura: 10, disponible: null, merma: 0 }).sugerido, null);
  });
});

describe("ahoraColombia", () => {
  it("usa la hora de Bogotá (UTC−5)", () => {
    assert.deepEqual(ahoraColombia(new Date("2026-11-06T02:30:00Z")), { fecha: "2026-11-05", hora: 21.5 });
  });
});

describe("leerParametros", () => {
  it("por defecto: entrega mañana, un día", () => {
    assert.deepEqual(leerParametros({}, "2026-11-05"), { entrega: "2026-11-06", dias: 1 });
  });
  it("rechaza entregas hoy, muy lejos o días fuera de rango", () => {
    assert.ok(leerParametros({ entrega: "2026-11-05" }, "2026-11-05").error);
    assert.ok(leerParametros({ entrega: "2026-11-20" }, "2026-11-05").error);
    assert.ok(leerParametros({ dias: "9" }, "2026-11-05").error);
    assert.ok(leerParametros({ entrega: "mañana" }, "2026-11-05").error);
  });
});

describe("stockPorBodega", () => {
  it("disponible = existencia − pos, nunca negativo, solo compañía 1", () => {
    const m = stockPorBodega([
      { f120_id_cia: 1, f150_id: "00301 ", f400_cant_existencia_1: 350, f400_cant_pos_1: 150 },
      { f120_id_cia: 1, f150_id: "00801", f400_cant_existencia_1: 0, f400_cant_pos_1: 10 },
      { f120_id_cia: 2, f150_id: "00301", f400_cant_existencia_1: 999, f400_cant_pos_1: 0 },
    ]);
    assert.equal(m.get("00301").disponible, 200);
    assert.equal(m.get("00801").disponible, 0);
  });
});

describe("cliente de inventario", () => {
  const env = { CONNEKTA_BASE_URL: "https://siesa.test/api/connekta/v3", CONNI_KEY: "k", CONNI_TOKEN: "t" };
  const respuesta = (status, cuerpo) => ({ status, ok: status < 400, json: async () => cuerpo });

  it("si fallan muchos productos corta con error en vez de dar inventarios en 0", async () => {
    const cliente = crearClienteInventario({ env, fetchImpl: async () => respuesta(401, { detalle: "no autorizado" }) });
    await assert.rejects(cliente.consultar(["1", "2", "3"]), /Fallo el inventario/);
  });

  it("'No se encontraron registros' es inventario vacío, no un fallo", async () => {
    const cliente = crearClienteInventario({ env, fetchImpl: async () => respuesta(400, { detalle: "No se encontraron registros" }) });
    const r = await cliente.consultar(["1"]);
    assert.equal(r.fallidos.size, 0);
    assert.equal(r.porItem.get("1").size, 0);
  });

  it("pregunta en el host raíz, no bajo el path de Connekta", async () => {
    let url = "";
    const cliente = crearClienteInventario({ env, fetchImpl: async (u) => { url = u; return respuesta(200, []); } });
    await cliente.consultar(["5098"]);
    assert.ok(url.startsWith("https://siesa.test/api/siesa/v3/ejecutarconsultaestandar?"));
    assert.ok(url.includes("f120_id%3D5098"));
  });
});

describe("armarSugerido", () => {
  // Jueves 5-nov a las 14:00. Entrega viernes 6, un día. Historia: los 6 viernes anteriores.
  const viernes = ["2026-10-30", "2026-10-23", "2026-10-16", "2026-10-09", "2026-10-02", "2026-09-25"];
  const ventas = [
    ...viernes.map((fecha) => ({ fecha, bodega: "00301", item: "5098", descripcion: "TOMATE", subgrupo: "4004-VERDURA", unidades: 90 })),
    ...viernes.map((fecha) => ({ fecha, bodega: "PV001", item: "5098", descripcion: "TOMATE", subgrupo: "4004-VERDURA", unidades: 45 })),
    // jueves (hoy): 100 kg en 00301
    ...["2026-10-29", "2026-10-22", "2026-10-15", "2026-10-08", "2026-10-01", "2026-09-24"]
      .map((fecha) => ({ fecha, bodega: "00301", item: "5098", descripcion: "TOMATE", subgrupo: "4004-VERDURA", unidades: 100 })),
    ...viernes.map((fecha) => ({ fecha, bodega: "00301", item: "181101", descripcion: "PAQUETES", subgrupo: "4004-VERDURA", unidades: 20 })),
  ];
  const abiertas = ["00301", "PV001"].flatMap((bodega) =>
    Array.from({ length: 60 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 10, 4 - i));
      return { fecha: d.toISOString().slice(0, 10), bodega };
    }));
  const base = {
    hoy: "2026-11-05", hora: 14, entrega: "2026-11-06", dias: 1, ultimoDato: "2026-11-04", mermaDesde: "2026-09-24",
    ventas, abiertas,
    // la mitad de la venta es después de las 14:00
    perfiles: [{ bodega: "00301", hora: 10, ventas: 50 }, { bodega: "00301", hora: 15, ventas: 50 }],
    compras: [{ item: "5098", comprado: 1800, ultimo_precio: 3000 }, { item: "181101", comprado: 10, ultimo_precio: 900 }],
    maestro: [{ item: "5098", um: "KL" }, { item: "181101", um: "UND" }],
  };
  const inventarioCon = (fallidos = []) => ({
    porItem: new Map([
      ["5098", new Map([["00301", { disponible: 80 }], ["PV001", { disponible: 10 }], ["PV009", { disponible: 40 }]])],
      ["181101", new Map()],
    ]),
    fallidos: new Set(fallidos),
    consultadoEn: "2026-11-05T19:00:00.000Z",
  });

  it("calcula por sede y consolida descontando el acopio", () => {
    const r = armarSugerido({ ...base, inventario: inventarioCon() });
    const tomate = r.items.find((i) => i.item === "5098");
    // vendido en la ventana de merma: 6×90 + 6×45 + 6×100 = 1.410 de 1.800 → merma 21,7 %
    assert.equal(tomate.merma, 0.217);
    // 00301: queda por vender hoy 50 de 100 → al recibir 30; necesita 90 / 0,783 = 114,9 → pide 85
    assert.equal(tomate.sedes["00301"].inventarioAlRecibir, 30);
    assert.equal(tomate.sedes["00301"].sugerido, 85);
    // PV001 no tiene perfil horario → no descuenta venta de hoy: 45/0,783 = 57,5 − 10 → 48
    assert.equal(tomate.sedes.PV001.sugerido, 48);
    assert.equal(tomate.pedidoTiendas, 133);
    assert.equal(tomate.comprar, 93); // 133 − 40 del acopio
    assert.equal(tomate.valorEstimado, 93 * 3000);
    assert.deepEqual(r.sedes.map((s) => s.codigo), ["PV001", "00301"]);
  });

  it("los paquetes armados en tienda tienen pedido por sede pero no van a la compra", () => {
    const paquetes = armarSugerido({ ...base, inventario: inventarioCon() }).items.find((i) => i.item === "181101");
    assert.equal(paquetes.armado, true);
    assert.equal(paquetes.sedes["00301"].sugerido, 20);
    assert.equal(paquetes.comprar, null);
  });

  it("un producto sin inventario queda sin sugerido y sin compra, y se cuenta", () => {
    const r = armarSugerido({ ...base, inventario: inventarioCon(["5098"]) });
    const tomate = r.items.find((i) => i.item === "5098");
    assert.equal(tomate.sedes["00301"].sugerido, null);
    assert.equal(tomate.comprar, null);
    assert.equal(r.totales.sinInventario, 1);
  });
});

describe("desplegarVentas", () => {
  it("vuelve a una fila por día desde el formato compacto", async () => {
    const { desplegarVentas } = await import("../src/pedidos/consultas.js");
    const filas = desplegarVentas([{ bodega: "00301", item: "5098", descripcion: "TOMATE", subgrupo: "4004-VERDURA", dias: [0, 2], unidades: [10.5, 3] }], "2026-10-30");
    assert.deepEqual(filas.map((f) => [f.fecha, f.unidades]), [["2026-10-30", 10.5], ["2026-11-01", 3]]);
    assert.equal(filas[1].bodega, "00301");
  });
});
