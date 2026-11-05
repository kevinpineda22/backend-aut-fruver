import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorBase, crearSupabaseAdmin } from "../src/config/supabaseAdmin.js";
import { respuestaError } from "../src/http.js";
import { aplicarPedidosSede, lineasDeSede, respuestaPedido } from "../src/pedidoSede/reglas.js";
import { leerCambio, requiereUsuario } from "../src/pedidoSede/rutas.js";
import { cambiarCantidad, enviarPedido, sedeDelQr } from "../src/pedidoSede/servicio.js";
import { extraerToken } from "../src/sedes/sedes.js";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** Supabase falso: tablas en memoria y las rpc que se llamaron. */
function supabaseFalso({ sedes = [], pedidos = [], lineas = [] } = {}) {
  const llamadas = [];
  const filtrar = (filas, consulta) => filas.filter((f) =>
    Object.entries(consulta).every(([k, v]) => !String(v).startsWith("eq.") || String(f[k]) === String(v).slice(3)));
  return {
    configurado: true,
    llamadas,
    select: async (tabla, consulta) => {
      if (tabla === "fruver_sedes") return filtrar(sedes, consulta);
      if (tabla === "fruver_pedidos") return filtrar(pedidos, consulta);
      if (tabla === "fruver_pedido_lineas") return filtrar(lineas, consulta);
      return [];
    },
    rpc: async (nombre, args) => { llamadas.push([nombre, args]); return {}; },
  };
}
const sedes = [{ bodega: "00301", nombre: "Girardota Parque", qr_token: TOKEN, activa: "true" }];
const usuario = { email: "lider@merkahorro.com", userId: "u1" };

describe("QR de sede", () => {
  it("saca el código aunque venga dentro de una URL", () => {
    assert.equal(extraerToken(`https://merkahorro.com/s/${TOKEN.toUpperCase()}`), TOKEN);
    assert.equal(extraerToken("hola"), "");
  });
  it("un QR que no es de ninguna sede da 403", async () => {
    await assert.rejects(sedeDelQr(supabaseFalso({ sedes }), "ffffffffffffffffffffffffffffffff"), (e) => e.status === 403);
    const sede = await sedeDelQr(supabaseFalso({ sedes }), TOKEN);
    assert.equal(sede.bodega, "00301");
  });
});

describe("pedido de otra sede", () => {
  const datos = { sedes, pedidos: [{ id: 7, bodega: "PV001", estado: "borrador" }] };
  it("no se puede cambiar con el QR de otra sede", async () => {
    await assert.rejects(
      cambiarCantidad({ supabase: supabaseFalso(datos), qr: TOKEN, pedidoId: 7, item: "5098", cantidad: 1, usuario }),
      (e) => e.status === 403 && /otra sede/.test(e.message));
  });
  it("con el QR correcto llama a la función que deja el evento, con el usuario", async () => {
    const supabase = supabaseFalso({ sedes, pedidos: [{ id: 7, bodega: "00301", estado: "borrador" }] });
    await cambiarCantidad({ supabase, qr: TOKEN, pedidoId: 7, item: "5098", cantidad: 12, motivo: "Promoción", usuario });
    assert.deepEqual(supabase.llamadas[0], ["fruver_cambiar_cantidad",
      { p_pedido: 7, p_item: "5098", p_cantidad: 12, p_motivo: "Promoción", p_usuario: "lider@merkahorro.com" }]);
  });
  it("enviar devuelve el pedido actualizado", async () => {
    const supabase = supabaseFalso({ sedes, pedidos: [{ id: 7, bodega: "00301", estado: "borrador" }], lineas: [] });
    const r = await enviarPedido({ supabase, qr: TOKEN, pedidoId: 7, usuario });
    assert.equal(supabase.llamadas[0][0], "fruver_enviar_pedido");
    assert.equal(r.sede.bodega, "00301");
  });
});

describe("validaciones", () => {
  it("sin usuario identificado no hay pedido (trazabilidad)", () => {
    let codigo = 0;
    const response = { status: (c) => { codigo = c; return { json: () => null }; } };
    requiereUsuario({ usuario: undefined }, response, () => { codigo = 200; });
    assert.equal(codigo, 401);
    requiereUsuario({ usuario: usuario }, response, () => { codigo = 200; });
    assert.equal(codigo, 200);
  });
  it("cantidad: número entre 0 y 100.000; motivo recortado", () => {
    assert.ok(leerCambio({ cantidad: -1 }).error);
    assert.ok(leerCambio({ cantidad: "abc" }).error);
    assert.ok(leerCambio({}).error);
    assert.deepEqual(leerCambio({ cantidad: "12.5", motivo: "  " }), { cantidad: 12.5, motivo: null });
    assert.equal(leerCambio({ cantidad: 0, motivo: "x".repeat(300) }).motivo.length, 200);
  });
  it("un rechazo de la base se dice con palabras y su código HTTP", () => {
    let enviado;
    const response = { status: (c) => ({ json: (b) => { enviado = [c, b]; } }) };
    const original = console.error; console.error = () => {};
    respuestaError(response, new ErrorBase("PEDIDO_ENVIADO", "x"), "falló");
    console.error = original;
    assert.equal(enviado[0], 409);
    assert.match(enviado[1].error, /ya fue enviado/);
  });
});

describe("cliente Supabase", () => {
  it("usa la service role y traduce el error de la función", async () => {
    let pedido;
    const supabase = crearSupabaseAdmin({
      url: "https://x.supabase.co", serviceKey: "srv",
      fetchImpl: async (url, opciones) => {
        pedido = { url, opciones };
        return { ok: false, status: 400, text: async () => JSON.stringify({ message: "PEDIDO_ENVIADO" }) };
      },
    });
    await assert.rejects(supabase.rpc("fruver_enviar_pedido", { p_pedido: 1 }), (e) => e.codigo === "PEDIDO_ENVIADO");
    assert.equal(pedido.url, "https://x.supabase.co/rest/v1/rpc/fruver_enviar_pedido");
    assert.equal(pedido.opciones.headers.apikey, "srv");
  });
  it("la service_role vieja (JWT) va también como Bearer; la secret key nueva, solo en apikey", async () => {
    const { cabecerasClave } = await import("../src/config/supabaseAdmin.js");
    assert.deepEqual(cabecerasClave("eyJa.eyJb.firma"), { apikey: "eyJa.eyJb.firma", Authorization: "Bearer eyJa.eyJb.firma" });
    assert.deepEqual(cabecerasClave("sb_secret_abc123"), { apikey: "sb_secret_abc123" });
  });
  it("sin la clave no está configurado y no llama a nadie", async () => {
    const supabase = crearSupabaseAdmin({ url: "https://x.supabase.co" });
    assert.equal(supabase.configurado, false);
    await assert.rejects(supabase.select("fruver_sedes", {}), (e) => e.codigo === "NO_CONFIGURADO");
  });
});

const sugerido = {
  sedes: [{ codigo: "PV001", nombre: "Principal" }, { codigo: "00301", nombre: "Girardota Parque" }],
  totales: { productos: 2 },
  items: [
    {
      item: "5098", descripcion: "TOMATE", subgrupo: "4004-VERDURA", um: "KL", merma: 0.07, armado: false, ultimoPrecio: 3000,
      acopioDisponible: 40, pedidoTiendas: 133, comprar: 93, valorEstimado: 279000,
      sedes: {
        PV001: { ventaEsperada: 45, disponible: 10, inventarioAlRecibir: 10, sugerido: 48 },
        "00301": { ventaEsperada: 90, disponible: 80, inventarioAlRecibir: 30, sugerido: 85 },
      },
    },
    {
      item: "181101", descripcion: "PAQUETES", um: "UND", merma: 0, armado: true, ultimoPrecio: 900,
      acopioDisponible: 0, pedidoTiendas: 20, comprar: null, valorEstimado: null,
      sedes: { "00301": { ventaEsperada: 20, disponible: 0, inventarioAlRecibir: 0, sugerido: 20 } },
    },
  ],
};

describe("lineasDeSede", () => {
  it("solo los productos de la sede, con los datos del sugerido para evaluarlo después", () => {
    const lineas = lineasDeSede(sugerido, "PV001");
    assert.deepEqual(lineas.map((l) => [l.item, l.sugerido, l.venta_esperada, l.disponible]), [["5098", 48, 45, 10]]);
  });
  it("un producto sin inventario entra con sugerido 0", () => {
    const sinInv = { ...sugerido, items: [{ ...sugerido.items[0], sedes: { PV001: { ventaEsperada: 4, sugerido: null } } }] };
    assert.equal(lineasDeSede(sinInv, "PV001")[0].sugerido, 0);
  });
});

describe("aplicarPedidosSede", () => {
  it("la sede que envió cuenta con lo que pidió el líder; la que no, con el sugerido", () => {
    const r = aplicarPedidosSede(sugerido, [
      { bodega: "00301", estado: "enviado", enviado_por: "l@x.co", fruver_pedido_lineas: [{ item: "5098", cantidad: 100 }] },
      { bodega: "PV001", estado: "borrador", fruver_pedido_lineas: [{ item: "5098", cantidad: 1 }] },
    ]);
    const tomate = r.items.find((i) => i.item === "5098");
    assert.equal(tomate.sedes["00301"].pedido, 100);
    assert.equal(tomate.sedes.PV001.pedido, null); // borrador: todavía no cuenta
    assert.equal(tomate.pedidoTiendas, 148); // 100 + 48
    assert.equal(tomate.comprar, 108); // 148 − 40 del acopio
    assert.deepEqual(r.pedidosSede.map((p) => [p.bodega, p.estado]), [["PV001", "borrador"], ["00301", "enviado"]]);
  });
  it("un producto que el líder no tiene en su pedido cuenta 0 para esa sede", () => {
    const r = aplicarPedidosSede(sugerido, [{ bodega: "00301", estado: "enviado", fruver_pedido_lineas: [] }]);
    assert.equal(r.items.find((i) => i.item === "5098").pedidoTiendas, 48);
  });
  it("sin pedidos todo sigue igual y las sedes figuran sin abrir", () => {
    const r = aplicarPedidosSede(sugerido, []);
    assert.equal(r.items[0].comprar, 93);
    assert.ok(r.pedidosSede.every((p) => p.estado === "sin_abrir"));
  });
});

describe("respuestaPedido", () => {
  it("ordena por lo que más se vende y cuenta los renglones cambiados a mano", () => {
    const r = respuestaPedido({ id: 1, estado: "borrador" }, [
      { item: "a", descripcion: "A", venta_esperada: 1, ultimo_precio: 1, cantidad: 2, origen: "manual" },
      { item: "b", descripcion: "B", venta_esperada: 10, ultimo_precio: 1000, cantidad: 5, origen: "sugerido" },
      { item: "c", descripcion: "C", venta_esperada: 3, ultimo_precio: 10, cantidad: 4, origen: "sugerido", armado: true },
    ], { bodega: "00301" });
    assert.deepEqual(r.lineas.map((l) => l.item), ["b", "c", "a"]);
    assert.equal(r.resumen.manuales, 1);
    assert.equal(r.resumen.valorEstimado, 5 * 1000 + 2 * 1);
  });
});
