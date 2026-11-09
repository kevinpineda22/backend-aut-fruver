import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sugeridoAbierto } from "../src/envios/rutas.js";
import { sugeridoPublicado } from "../src/pedidos/reglas.js";
import { manejadorCompra, manejadorSugerido } from "../src/pedidos/rutas.js";

const respuestaFalsa = () => {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
};
/** Si el manejador consulta la base antes de tiempo, la prueba revienta. */
const poolProhibido = { query: () => { throw new Error("no debía consultar la base"); } };
const reloj = (hora) => () => ({ fecha: "2026-11-09", hora });

describe("publicación del sugerido a las 4:00 p. m.", () => {
  it("la frontera es exactamente las 16:00", () => {
    assert.equal(sugeridoPublicado(15 + 59 / 60), false);
    assert.equal(sugeridoPublicado(16), true);
    assert.equal(sugeridoPublicado(23.5), true);
    assert.equal(sugeridoPublicado(0), false);
  });

  it("Sugerido responde en espera y no toca la base antes de la hora", async () => {
    const r = respuestaFalsa();
    await manejadorSugerido({ pool: poolProhibido, inventario: {}, reloj: reloj(15.5) })({ query: {} }, r);
    assert.equal(r.codigo, 200);
    assert.deepEqual(r.cuerpo, { ok: true, data: { espera: true, publicaA: "4:00 p. m." } });
  });

  it("Sugerido pasa a calcular desde la hora", async () => {
    const r = respuestaFalsa();
    // Una entrega inválida corta en los parámetros: prueba que ya pasó el portón sin ir a la base.
    await manejadorSugerido({ pool: poolProhibido, inventario: {}, reloj: reloj(16) })({ query: { entrega: "2026-11-09" } }, r);
    assert.equal(r.codigo, 400);
  });

  it("Compra no espera: a cualquier hora llega a validar los parámetros", async () => {
    const r = respuestaFalsa();
    await manejadorCompra({ pool: poolProhibido, inventario: {}, supabase: {} })({ query: { entrega: "2000-01-01" } }, r);
    assert.equal(r.codigo, 400);
  });

  it("no deja enviar antes de la hora", () => {
    const r = respuestaFalsa();
    let siguio = false;
    sugeridoAbierto(reloj(9))({}, r, () => { siguio = true; });
    assert.equal(siguio, false);
    assert.equal(r.codigo, 409);
  });

  it("deja enviar desde la hora", () => {
    let siguio = false;
    sugeridoAbierto(reloj(16))({}, respuestaFalsa(), () => { siguio = true; });
    assert.equal(siguio, true);
  });
});
