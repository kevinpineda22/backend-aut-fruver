import { test } from "node:test";
import assert from "node:assert/strict";
import { armarFoto, pedidoDeLaFoto } from "../src/fotos/reglas.js";
import { tomarFoto } from "../src/fotos/servicio.js";
import { cronAutorizado, manejadorFotoSugerido } from "../src/fotos/rutas.js";

const sugerido = () => ({
  parametros: { hoy: "2026-11-18", hora: 16.17, entrega: "2026-11-19", dias: 1, ultimoDato: "2026-11-17",
    cobertura: ["2026-11-19"], antesDeEntrega: [], quincena: { indice: { 0: 1.2 }, dias: { "2026-11-19": 1.1 } } },
  acopio: { codigo: "PV009", nombre: "Acopio" },
  sedes: [{ codigo: "001", nombre: "Copacabana" }, { codigo: "002", nombre: "Girardota" }],
  items: [
    { item: 4736, descripcion: "PAPA", subgrupo: "TUBERCULOS", um: "KL", merma: 0.12, armado: false, sinInventario: false,
      ultimoPrecio: 3800, ventaEsperada: 90, pedidoTiendas: 85, acopioDisponible: 10, comprar: 75, valorEstimado: 285000,
      sedes: { "001": { ventaEsperada: 60, pendienteHoy: 5, antesDeEntrega: 0, disponible: 20, inventarioAlRecibir: 15, necesidad: 68.2, sugerido: 54 },
        "002": { ventaEsperada: 30, pendienteHoy: 2, antesDeEntrega: 0, disponible: 6, inventarioAlRecibir: 4, necesidad: 34.1, sugerido: 31 } } },
    { item: "9", descripcion: "BANDEJA", armado: true, sinInventario: false, ventaEsperada: 5, pedidoTiendas: 5, acopioDisponible: 0, comprar: null, sedes: {} },
    { item: "7", descripcion: "AJÍ", armado: false, sinInventario: true, ventaEsperada: 2, pedidoTiendas: null, acopioDisponible: null, comprar: null, sedes: {} },
  ],
  totales: { productos: 3, conCompra: 1, valorEstimado: 285000, sinInventario: 1, armados: 1 },
  inventario: { consultadoEn: "2026-11-18T21:10:03.000Z", fallidos: 1 },
});

test("la foto es siempre la entrega de mañana, 1 día", () => {
  assert.deepEqual(pedidoDeLaFoto("2026-11-30"), { entrega: "2026-12-01", dias: 1 });
});

test("armarFoto guarda el resultado y los ingredientes del cálculo", () => {
  const { foto, items } = armarFoto(sugerido());
  assert.equal(foto.fecha, "2026-11-18");
  assert.equal(foto.momento, "publicacion");
  assert.equal(foto.entrega, "2026-11-19");
  assert.equal(foto.inventario_en, "2026-11-18T21:10:03.000Z");
  assert.deepEqual(foto.parametros.sedes, ["001", "002"]);
  assert.equal(foto.parametros.acopio, "PV009");
  assert.deepEqual(foto.parametros.quincena.dias, { "2026-11-19": 1.1 });
  assert.equal(foto.resumen.sinCalcular, 1, "el ají sin inventario no se pudo calcular; la bandeja armada no cuenta");
  const papa = items[0];
  assert.equal(papa.item, "4736");
  assert.equal(papa.comprar, 75);
  assert.equal(papa.acopio_disponible, 10);
  assert.equal(papa.sin_inventario, false);
  assert.deepEqual(papa.sedes["001"], { disponible: 20, pendienteHoy: 5, antesDeEntrega: 0, inventarioAlRecibir: 15,
    ventaEsperada: 60, necesidad: 68.2, sugerido: 54 });
  assert.equal(items[1].comprar, null);
  assert.equal(items[1].armado, true);
  assert.equal(items[2].sin_inventario, true);
  assert.equal(items[2].subgrupo, null);
});

test("tomarFoto calcula la entrega de mañana y guarda por la función de la base", async () => {
  let pedido;
  let llamada;
  const r = await tomarFoto({
    momento: new Date("2026-11-18T21:10:00Z"),
    calcular: async (a) => { pedido = a; return sugerido(); },
    supabase: { rpc: async (nombre, args) => { llamada = { nombre, args }; return 42; } },
  });
  assert.equal(pedido.entrega, "2026-11-19");
  assert.equal(pedido.dias, 1);
  assert.equal(llamada.nombre, "fruver_guardar_foto_sugerido");
  assert.equal(llamada.args.p_items.length, 3);
  assert.deepEqual([r.guardada, r.yaExistia, r.id, r.productos], [true, false, 42, 3]);
});

test("si ya había foto de hoy, no la pisa y lo dice", async () => {
  const r = await tomarFoto({ calcular: async () => sugerido(), supabase: { rpc: async () => null } });
  assert.deepEqual([r.guardada, r.yaExistia], [false, true]);
});

test("en seco no escribe", async () => {
  const r = await tomarFoto({ calcular: async () => sugerido(), guardar: false,
    supabase: { rpc: async () => { throw new Error("no debía escribir"); } } });
  assert.equal(r.guardada, false);
  assert.equal(r.items.length, 3);
});

function respuesta() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("el cron exige CRON_SECRET: sin configurar 503, mal 401, bien pasa", () => {
  const correr = (secreto, authorization) => {
    const r = respuesta();
    let paso = false;
    cronAutorizado(secreto)({ headers: { authorization } }, r, () => { paso = true; });
    return paso ? "pasa" : r.code;
  };
  assert.equal(correr(undefined, "Bearer x"), 503);
  assert.equal(correr("secreto", undefined), 401);
  assert.equal(correr("secreto", "Bearer otro"), 401);
  assert.equal(correr("secreto", "Bearer secreto"), "pasa");
});

test("el manejador responde 503 sin Supabase y el error del cálculo si falla", async () => {
  const r1 = respuesta();
  await manejadorFotoSugerido({ supabase: { configurado: false } })({}, r1);
  assert.equal(r1.code, 503);
  const r2 = respuesta();
  const fallo = Object.assign(new Error("No fue posible consultar el inventario en SIESA."), { status: 502, publico: true });
  await manejadorFotoSugerido({ supabase: { configurado: true }, tomar: async () => { throw fallo; } })({}, r2);
  assert.ok(r2.code >= 500);
  assert.equal(r2.body.ok, false);
});
