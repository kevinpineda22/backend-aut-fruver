import { test } from "node:test";
import assert from "node:assert/strict";
import { leerAccion, aplicarReciboCiego, vistaRecibo } from "../src/operaciones/reglas.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const estado = () => ({
  base: { items: [
    { item: "10", descripcion: "TOMATE", um: "KL", comprar: 100, sedes: {}, acopioDisponible: 0 },
    { item: "20", descripcion: "PAPA", um: "KL", comprar: 50, sedes: {}, acopioDisponible: 0 },
  ] },
  compras: [
    { id: id(1), item: "10", nit: "900", proveedor: "Agro A", cantidad: 60, costo: 2000 },
    { id: id(2), item: "10", nit: "800", proveedor: "Agro B", cantidad: 40, costo: 2100 },
    { id: id(3), item: "20", nit: "900", proveedor: "Agro A", cantidad: 50, costo: 1500 },
  ],
  recibos: [],
  despachos: [],
});

const accion = (lineas) => leerAccion({ solicitud: id(100), version: 1, tipo: "recibo_ciego", lineas });

test("recibo a ciegas sin proveedor sigue funcionando (compatibilidad)", () => {
  const a = accion([{ solicitud: id(101), item: "10", cantidad: 95 }]);
  assert.equal(a.lineas[0].nit, undefined);
  const { estado: nuevo, evento } = aplicarReciboCiego(estado(), a.lineas);
  assert.deepEqual(nuevo.recibos, [{ id: id(101), item: "10", cantidad: 95 }]);
  assert.match(evento.motivo, /sin asignación a proveedor/);
});

test("recibo a ciegas con proveedor guarda el nit", () => {
  const a = accion([
    { solicitud: id(101), item: "10", nit: " 900 ", cantidad: 58 },
    { solicitud: id(102), item: "10", nit: "800", cantidad: 40 },
  ]);
  const { estado: nuevo, evento } = aplicarReciboCiego(estado(), a.lineas);
  assert.deepEqual(nuevo.recibos.map((r) => [r.item, r.nit, r.cantidad]), [["10", "900", 58], ["10", "800", 40]]);
  assert.match(evento.motivo, /por producto y proveedor/);
});

test("el mismo producto con dos proveedores no es repetido; con el mismo proveedor sí", () => {
  assert.doesNotThrow(() => accion([
    { solicitud: id(101), item: "10", nit: "900", cantidad: 1 },
    { solicitud: id(102), item: "10", nit: "800", cantidad: 1 },
  ]));
  assert.throws(() => accion([
    { solicitud: id(101), item: "10", nit: "900", cantidad: 1 },
    { solicitud: id(102), item: "10", nit: "900", cantidad: 1 },
  ]), /repetidos/);
  assert.throws(() => accion([
    { solicitud: id(101), item: "10", cantidad: 1 },
    { solicitud: id(102), item: "10", cantidad: 1 },
  ]), /repetidos/);
});

test("rechaza un proveedor al que no se le compró ese producto", () => {
  const a = accion([{ solicitud: id(101), item: "20", nit: "800", cantidad: 10 }]);
  assert.throws(() => aplicarReciboCiego(estado(), a.lineas), /no se le compró/);
});

test("la vista del recibo lista proveedores por producto, sin cantidades", () => {
  const e = estado();
  e.recibos.push({ id: id(50), compraId: id(3), cantidad: 49 }, { id: id(51), item: "10", nit: "800", cantidad: 40 },
    { id: id(52), item: "10", cantidad: 5 });
  const v = vistaRecibo(e);
  const tomate = v.base.items.find((p) => p.item === "10");
  assert.deepEqual(tomate.proveedores, [{ nit: "900", nombre: "Agro A" }, { nit: "800", nombre: "Agro B" }]);
  assert.ok(!JSON.stringify(v.base).includes("cantidad"), "el recibo a ciegas no puede mostrar lo comprado");
  assert.deepEqual(v.recibos, [
    { id: id(50), item: "20", cantidad: 49, nit: "900" },
    { id: id(51), item: "10", cantidad: 40, nit: "800" },
    { id: id(52), item: "10", cantidad: 5 },
  ]);
});
