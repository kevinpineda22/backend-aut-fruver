import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ErrorBase, cabecerasClave, crearSupabaseAdmin } from "../src/config/supabaseAdmin.js";
import { aplicarEnvios, leerEnvio, origenDe, respuestaEnvio, resumenEnvio } from "../src/envios/reglas.js";
import { leerRango, requiereUsuario } from "../src/envios/rutas.js";

describe("origenDe", () => {
  it("clasifica cada renglón contra el sugerido", () => {
    assert.equal(origenDe(10, 10), "sugerido");
    assert.equal(origenDe(10, 12.5), "modificado");
    assert.equal(origenDe(10, 0), "quitado");
    assert.equal(origenDe(0, 4), "agregado");
    assert.equal(origenDe(null, 4), "agregado"); // sin dato de inventario: el sistema no sugirió nada
    assert.equal(origenDe(0, 0), null);
    assert.equal(origenDe(null, 0), null);
  });
});

describe("leerEnvio", () => {
  const base = {
    bodega: "00301", sedeNombre: "Girardota Parque", entrega: "2026-11-07", dias: 1,
    lineas: [
      { item: "5098", descripcion: "TOMATE", sugerido: 85, cantidad: 85, ultimoPrecio: 3000 },
      { item: "5076", descripcion: "PAPA", sugerido: 3, cantidad: 0 },
      { item: "5138", descripcion: "TOMATE DE ARBOL", sugerido: 0, cantidad: 6 },
      { item: "5028", descripcion: "COCO", sugerido: 0, cantidad: 0 },
      { item: "5015", descripcion: "BROCOLI", sugerido: 4, cantidad: 7 },
    ],
  };

  it("deja los renglones con origen y descarta los que ni se sugieren ni se piden", () => {
    const { envio, lineas, error } = leerEnvio(base);
    assert.equal(error, undefined);
    assert.equal(envio.bodega, "00301");
    assert.deepEqual(lineas.map((l) => [l.item, l.origen]), [
      ["5098", "sugerido"], ["5076", "quitado"], ["5138", "agregado"], ["5015", "modificado"],
    ]);
    assert.equal(lineas[0].ultimo_precio, 3000);
  });

  it("rechaza cantidades negativas, códigos raros y renglones repetidos", () => {
    assert.match(leerEnvio({ ...base, lineas: [{ item: "5098", sugerido: 1, cantidad: -1 }] }).error, /cantidad/);
    assert.match(leerEnvio({ ...base, lineas: [{ item: "abc", sugerido: 1, cantidad: 1 }] }).error, /código/);
    assert.match(leerEnvio({ ...base, lineas: [base.lineas[0], base.lineas[0]] }).error, /repetido/);
    assert.match(leerEnvio({ ...base, lineas: [{ item: "5098", sugerido: 1, cantidad: "" }] }).error, /cantidad/);
  });

  it("no deja enviar un pedido sin nada que pedir", () => {
    assert.match(leerEnvio({ ...base, lineas: [{ item: "5076", sugerido: 3, cantidad: 0 }] }).error, /ningún producto/);
    assert.match(leerEnvio({ ...base, lineas: [] }).error, /no tiene productos/);
  });

  it("valida sede, fecha y días", () => {
    assert.match(leerEnvio({ ...base, bodega: "x" }).error, /sede/);
    assert.match(leerEnvio({ ...base, entrega: "mañana" }).error, /fecha/);
    assert.match(leerEnvio({ ...base, dias: 9 }).error, /días/);
  });
});

describe("resumenEnvio", () => {
  it("cuenta cada origen y la diferencia en plata contra el sugerido", () => {
    const r = resumenEnvio([
      { origen: "sugerido", sugerido: 10, cantidad: 10, ultimo_precio: 1000 },
      { origen: "modificado", sugerido: 10, cantidad: 15, ultimo_precio: 1000 },
      { origen: "quitado", sugerido: 4, cantidad: 0, ultimo_precio: 500 },
      { origen: "agregado", sugerido: 0, cantidad: 2, ultimo_precio: 2000 },
    ]);
    assert.equal(r.renglones, 4);
    assert.deepEqual([r.sugerido, r.modificado, r.quitado, r.agregado], [1, 1, 1, 1]);
    assert.equal(r.igualAlSugerido, 1 / 3); // de los 3 que el sistema sugirió, 1 tal cual
    assert.equal(r.valorSugerido, 22000);
    assert.equal(r.valorPedido, 29000);
    assert.equal(r.diferenciaValor, 7000);
  });
});

describe("aplicarEnvios", () => {
  const sugerido = {
    parametros: {},
    acopio: { codigo: "PV009" },
    sedes: [{ codigo: "PV001", nombre: "Principal" }, { codigo: "00301", nombre: "Girardota Parque" }],
    items: [
      { item: "5098", descripcion: "TOMATE", armado: false, acopioDisponible: 40, ultimoPrecio: 3000,
        sedes: { PV001: { sugerido: 48 }, "00301": { sugerido: 85 } } },
      { item: "181101", descripcion: "PAQUETES", armado: true, acopioDisponible: 0, ultimoPrecio: 900,
        sedes: { "00301": { sugerido: 20 } } },
    ],
    totales: { productos: 2 },
  };
  const envio = respuestaEnvio({
    id: 1, bodega: "00301", sede_nombre: "Girardota Parque", fecha_entrega: "2026-11-07", dias: 1,
    enviado_por: "lider@x.com", enviado_en: "2026-11-06T13:00:00Z",
    fruver_envio_lineas: [
      { item: "5098", descripcion: "TOMATE", sugerido: 85, cantidad: 100, origen: "modificado", ultimo_precio: 3000 },
      { item: "777", descripcion: "NUEVO", sugerido: null, cantidad: 5, origen: "agregado", ultimo_precio: 100 },
    ],
  });

  it("solo cuenta lo que enviaron las sedes y descuenta el acopio", () => {
    const r = aplicarEnvios(sugerido, [envio]);
    const tomate = r.items.find((i) => i.item === "5098");
    assert.equal(tomate.pedidoTiendas, 100); // PV001 no envió: no cuenta
    assert.equal(tomate.comprar, 60);
    assert.equal(tomate.sedes["00301"].pedido, 100);
    assert.equal(tomate.sedes["00301"].origen, "modificado");
    assert.equal(tomate.sedes.PV001.pedido, undefined);
    assert.equal(r.items.find((i) => i.item === "181101").comprar, null); // se arma en tienda
  });

  it("suma un producto agregado que no estaba en el cálculo, sin inventarlo comprar", () => {
    const nuevo = aplicarEnvios(sugerido, [envio]).items.find((i) => i.item === "777");
    assert.equal(nuevo.pedidoTiendas, 5);
    assert.equal(nuevo.comprar, null); // sin inventario del acopio no se inventa
  });

  it("dice qué sedes enviaron", () => {
    const r = aplicarEnvios(sugerido, [envio]);
    assert.deepEqual(r.envios.map((e) => [e.bodega, e.enviado]), [["PV001", false], ["00301", true]]);
    assert.equal(r.envios[1].enviadoPor, "lider@x.com");
  });
});

describe("leerRango", () => {
  it("por defecto mira dos semanas atrás y una adelante", () => {
    assert.deepEqual(leerRango({}, "2026-11-06"), { desde: "2026-10-23", hasta: "2026-11-13" });
  });
  it("rechaza rangos al revés o demasiado largos", () => {
    assert.match(leerRango({ desde: "2026-11-06", hasta: "2026-11-01" }, "2026-11-06").error, /posterior/);
    assert.match(leerRango({ desde: "2026-01-01", hasta: "2026-11-01" }, "2026-11-06").error, /hasta 92/);
  });
});

describe("requiereUsuario", () => {
  const respuesta = () => {
    const r = { status(c) { r.codigo = c; return r; }, json(b) { r.cuerpo = b; return r; } };
    return r;
  };
  it("sin usuario identificado no se envía nada", () => {
    const r = respuesta();
    let paso = false;
    requiereUsuario({}, r, () => { paso = true; });
    assert.equal(paso, false);
    assert.equal(r.codigo, 401);
  });
  it("con usuario pasa", () => {
    let paso = false;
    requiereUsuario({ usuario: { email: "a@b.com" } }, respuesta(), () => { paso = true; });
    assert.equal(paso, true);
  });
});

describe("supabaseAdmin", () => {
  it("manda la clave secreta nueva solo como apikey y la vieja también como Bearer", () => {
    assert.deepEqual(cabecerasClave("sb_secret_x"), { apikey: "sb_secret_x" });
    assert.deepEqual(cabecerasClave("a.b.c"), { apikey: "a.b.c", Authorization: "Bearer a.b.c" });
  });
  it("traduce el rechazo de la base a su código", async () => {
    const supabase = crearSupabaseAdmin({
      url: "https://x.supabase.co", serviceKey: "srv",
      fetchImpl: async () => new Response(JSON.stringify({ message: "PEDIDO_YA_ENVIADO" }), { status: 400 }),
    });
    await assert.rejects(supabase.rpc("fruver_registrar_envio", {}), (e) => e instanceof ErrorBase && e.codigo === "PEDIDO_YA_ENVIADO");
  });
  it("sin configurar responde NO_CONFIGURADO", async () => {
    const supabase = crearSupabaseAdmin({ url: "https://x.supabase.co" });
    assert.equal(supabase.configurado, false);
    await assert.rejects(supabase.select("fruver_envios", {}), (e) => e.codigo === "NO_CONFIGURADO");
  });
});
