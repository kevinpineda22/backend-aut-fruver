import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAXIMO_PAGINAS, crearClientePrecios } from "../src/precios/connekta.js";
import { comprimir, crearAlmacenPrecios, expandir } from "../src/precios/copia.js";
import {
  agruparPrecios, codigoItem, estadoPrecio, fechaDe, leerUbicaciones, normalizarFila, productosDeLista, unidadEtiqueta,
} from "../src/precios/reglas.js";
import { LISTAS_PRECIO } from "../src/sedes.js";

/** Una fila como la manda Connekta (textos con relleno, fechas con hora). */
const cruda = (o = {}) => ({
  Cia: 1, Item: 5098, Referencia: "A-0005098   ", Descripcion: "TOMATE CHONTO KILO     ", UMInventario: "KL  ",
  Subgrupo: "4004-VERDURA   ", Separata: null, Lista: "P01", UM: "KL  ", Precio: 4500,
  FechaActivacion: "2026-11-10T00:00:00", FechaInactivacion: null, FechaActualizacion: "2026-11-10T06:40:00", Orden: 1,
  ...o,
});
const fila = (o) => normalizarFila(cruda(o));
const HOY = "2026-11-11";

describe("normalizarFila", () => {
  it("limpia el relleno de SIESA y deja las fechas como AAAA-MM-DD", () => {
    const f = fila();
    assert.equal(f.item, "5098");
    assert.equal(f.descripcion, "TOMATE CHONTO KILO");
    assert.equal(f.umInventario, "KL");
    assert.equal(f.um, "KL");
    assert.equal(f.subgrupo, "4004-VERDURA");
    assert.equal(f.separata, null);
    assert.equal(f.activacion, "2026-11-10");
    assert.equal(f.inactivacion, null);
  });

  it("la fecha nunca pasa por Date (en UTC correría el día)", () => {
    assert.equal(fechaDe("2026-11-11T23:59:59"), "2026-11-11");
    assert.equal(fechaDe(""), null);
    assert.equal(fechaDe(null), null);
  });

  it("el código sin ceros a la izquierda, como en la réplica", () => {
    assert.equal(codigoItem("0005098"), "5098");
    assert.equal(codigoItem(" 5098 "), "5098");
    assert.equal(codigoItem("0"), "0");
  });
});

describe("estadoPrecio", () => {
  it("vigente = la activación más reciente que ya rige; anterior = la previa", () => {
    const e = estadoPrecio([
      fila({ Precio: 4000, FechaActivacion: "2026-11-09" }),
      fila({ Precio: 4500, FechaActivacion: "2026-11-11" }),
      fila({ Precio: 3800, FechaActivacion: "2026-11-05" }),
    ], HOY);
    assert.equal(e.vigente.precio, 4500);
    assert.equal(e.anterior.precio, 4000);
    assert.equal(e.cambio, "sube");
    assert.equal(e.programado, null);
  });

  it("un precio programado para mañana NO es el vigente (el reloj de SIESA puede ir en UTC)", () => {
    const e = estadoPrecio([
      fila({ Precio: 5200, FechaActivacion: "2026-11-12" }),
      fila({ Precio: 4500, FechaActivacion: "2026-11-10" }),
      fila({ Precio: 4800, FechaActivacion: "2026-11-08" }),
    ], HOY);
    assert.equal(e.vigente.precio, 4500);
    assert.deepEqual([e.programado.precio, e.programado.activacion], [5200, "2026-11-12"]);
    assert.equal(e.cambio, "baja");
  });

  it("con dos programados, el próximo es el más cercano", () => {
    const e = estadoPrecio([
      fila({ Precio: 6000, FechaActivacion: "2026-11-14" }),
      fila({ Precio: 5200, FechaActivacion: "2026-11-12" }),
      fila({ Precio: 4500, FechaActivacion: "2026-11-10" }),
    ], HOY);
    assert.equal(e.programado.precio, 5200);
    assert.equal(e.vigente.precio, 4500);
    assert.equal(e.anterior, null, "la consulta trae 3 filas: el anterior no vino y no se inventa");
    assert.equal(e.cambio, "nuevo");
  });

  it("volver a cargar el mismo precio con otra fecha no es un cambio", () => {
    const e = estadoPrecio([
      fila({ Precio: 4500, FechaActivacion: "2026-11-11" }),
      fila({ Precio: 4500, FechaActivacion: "2026-11-10" }),
    ], HOY);
    assert.equal(e.cambio, "igual");
  });

  it("dos filas con la misma activación: gana la última modificación, y el anterior es de otra fecha", () => {
    const e = estadoPrecio([
      fila({ Precio: 4300, FechaActivacion: "2026-11-11", FechaActualizacion: "2026-11-11T06:00:00" }),
      fila({ Precio: 4600, FechaActivacion: "2026-11-11", FechaActualizacion: "2026-11-11T09:30:00" }),
      fila({ Precio: 4000, FechaActivacion: "2026-11-09" }),
    ], HOY);
    assert.equal(e.vigente.precio, 4600);
    assert.equal(e.anterior.precio, 4000);
  });

  it("si el precio que regía está inactivado, no hay precio (no se revive uno viejo)", () => {
    const e = estadoPrecio([
      fila({ Precio: 4500, FechaActivacion: "2026-11-10", FechaInactivacion: "2026-11-11" }),
      fila({ Precio: 4000, FechaActivacion: "2026-11-01" }),
    ], HOY);
    assert.equal(e.vigente, null);
    assert.equal(e.motivoSinPrecio, "inactivo");
  });

  it("una inactivación futura no lo saca hoy", () => {
    const e = estadoPrecio([fila({ Precio: 4500, FechaActivacion: "2026-11-10", FechaInactivacion: "2026-11-20" })], HOY);
    assert.equal(e.vigente.precio, 4500);
  });

  it("precio en 0 = sin precio", () => {
    const e = estadoPrecio([fila({ Precio: 0, FechaActivacion: "2026-11-10" })], HOY);
    assert.equal(e.vigente, null);
    assert.equal(e.motivoSinPrecio, "en_cero");
  });

  it("solo programados: todavía no tiene precio", () => {
    const e = estadoPrecio([fila({ Precio: 4500, FechaActivacion: "2026-11-12" })], HOY);
    assert.equal(e.vigente, null);
    assert.equal(e.motivoSinPrecio, "programado");
  });
});

describe("unidadEtiqueta", () => {
  const um = (...ums) => new Map(ums.map((u) => [u, []]));
  it("la de inventario si la lista la tiene", () => {
    assert.equal(unidadEtiqueta(um("UND", "KL"), "UND"), "UND");
  });
  it("si no, la única que haya; con varias, KL y después UND", () => {
    assert.equal(unidadEtiqueta(um("P15"), "UND"), "P15");
    assert.equal(unidadEtiqueta(um("UND", "KL"), "P6"), "KL");
    assert.equal(unidadEtiqueta(um("UND", "P6"), "KL"), "UND");
  });
  it("sin precios en la lista: null", () => {
    assert.equal(unidadEtiqueta(undefined, "KL"), null);
  });
});

describe("productosDeLista", () => {
  const filas = [
    fila({ Lista: "P01", Precio: 4500, FechaActivacion: HOY }),
    fila({ Lista: "P01", Precio: 4000, FechaActivacion: "2026-11-09" }),
    fila({ Lista: "P02", Precio: 4200, FechaActivacion: "2026-11-01" }),
    fila({ Item: 16702, Descripcion: "AGUACATE HASS", UMInventario: "UND", UM: "UND", Lista: "P01", Precio: 2500, FechaActivacion: "2026-10-01" }),
    fila({ Item: 5294, Descripcion: "BANANO", Lista: "P01", Precio: 0, FechaActivacion: "2026-10-01" }),
    fila({ Item: 9999, Descripcion: "ZANAHORIA", Lista: "P02", Precio: 1800, FechaActivacion: "2026-10-01" }),
  ];
  const grupos = agruparPrecios(filas);

  it("cada lista con SU precio: una tienda nunca imprime el de otra", () => {
    const p01 = productosDeLista(grupos, "P01", HOY).productos.find((p) => p.item === "5098");
    const p02 = productosDeLista(grupos, "P02", HOY).productos.find((p) => p.item === "5098");
    assert.equal(p01.precio, 4500);
    assert.equal(p02.precio, 4200);
  });

  it("marca lo que hay que reimprimir hoy", () => {
    const { productos } = productosDeLista(grupos, "P01", HOY);
    const tomate = productos.find((p) => p.item === "5098");
    assert.equal(tomate.cambioHoy, true);
    assert.deepEqual(tomate.anterior, { precio: 4000, fecha: "2026-11-09" });
    assert.equal(productos.find((p) => p.item === "16702").cambioHoy, false);
  });

  it("los sin precio salen aparte con su motivo, ordenados por nombre", () => {
    const { productos, sinPrecio } = productosDeLista(grupos, "P01", HOY);
    assert.deepEqual(productos.map((p) => p.descripcion), ["AGUACATE HASS", "TOMATE CHONTO KILO"]);
    assert.deepEqual(sinPrecio.map((p) => [p.item, p.motivo]), [["5294", "en_cero"], ["9999", "sin_lista"]]);
  });

  it("filtra los inactivos cuando se sabe cuáles son; con null no filtra", () => {
    assert.deepEqual(productosDeLista(grupos, "P01", HOY, new Set(["5098"])).productos.map((p) => p.item), ["5098"]);
    assert.equal(productosDeLista(grupos, "P01", HOY, null).productos.length, 2);
  });
});

describe("leerUbicaciones", () => {
  const sedes = Object.keys(LISTAS_PRECIO);
  it("acepta cambios válidos y normaliza código y ubicación", () => {
    assert.deepEqual(
      leerUbicaciones({ bodega: "PV001", cambios: [{ item: "0005098", ubicacion: "nevera" }] }, sedes),
      { bodega: "PV001", cambios: [{ item: "5098", ubicacion: "NEVERA" }] },
    );
  });
  it("rechaza sede, ubicación o código inválidos", () => {
    assert.ok(leerUbicaciones({ bodega: "PV009", cambios: [{ item: "1", ubicacion: "NEVERA" }] }, sedes).error);
    assert.ok(leerUbicaciones({ bodega: "PV001", cambios: [{ item: "1", ubicacion: "PISO" }] }, sedes).error);
    assert.ok(leerUbicaciones({ bodega: "PV001", cambios: [{ item: "1;drop", ubicacion: "NEVERA" }] }, sedes).error);
    assert.ok(leerUbicaciones({ bodega: "PV001", cambios: [] }, sedes).error);
  });
  it("si un producto llega repetido, gana el último", () => {
    const r = leerUbicaciones({ bodega: "PV001", cambios: [{ item: "1", ubicacion: "NEVERA" }, { item: "1", ubicacion: "BANCARELLAS" }] }, sedes);
    assert.deepEqual(r.cambios, [{ item: "1", ubicacion: "BANCARELLAS" }]);
  });
});

describe("cliente de Connekta", () => {
  const env = {
    CONNEKTA_BASE_URL: "https://siesa.test/api/connekta/v3/", FRUVER_PRECIOS_CONSULTA: "merkahorro_fruver_precios",
    FRUVER_PRECIOS_CONNI_KEY: "k", FRUVER_PRECIOS_CONNI_TOKEN: "t",
  };
  const respuesta = (status, cuerpo) => ({ status, ok: status < 300, json: async () => cuerpo });
  const paginaDe = (n, total) => respuesta(200, { codigo: 0, detalle: { Table: [cruda({ Item: n })], "total_páginas": total } });

  it("recorre TODAS las páginas con `total_páginas` (con tilde) y respeta el orden", async () => {
    const pedidas = [];
    const cliente = crearClientePrecios({
      env,
      fetchImpl: async (url) => {
        const n = Number(new URL(url).searchParams.get("paginacion").match(/numPag=(\d+)/)[1]);
        pedidas.push(n);
        assert.ok(url.startsWith("https://siesa.test/api/connekta/v3/ejecutarconsulta?"));
        return paginaDe(n, 3);
      },
    });
    const { filas } = await cliente.consultar();
    assert.deepEqual(filas.map((f) => f.item), ["1", "2", "3"]);
    assert.deepEqual(pedidas.sort(), [1, 2, 3]);
  });

  it("guarda en caché: dos pantallas seguidas = una consulta a SIESA", async () => {
    let llamadas = 0;
    const cliente = crearClientePrecios({ env, fetchImpl: async () => { llamadas++; return paginaDe(1, 1); } });
    await Promise.all([cliente.consultar(), cliente.consultar()]);
    await cliente.consultar();
    assert.equal(llamadas, 1);
  });

  it("si SIESA falla después, usa la copia y lo dice", async () => {
    let falla = false;
    let reloj = 0;
    const cliente = crearClientePrecios({
      env, ttlMs: 10, ahora: () => reloj,
      fetchImpl: async () => (falla ? respuesta(400, { codigo: 1, mensaje: "error" }) : paginaDe(1, 1)),
    });
    await cliente.consultar();
    falla = true;
    reloj = 100;
    const r = await cliente.consultar({ fresco: true });
    assert.equal(r.desactualizado, true);
    assert.equal(r.alDia, false);
    assert.equal(r.filas.length, 1);
  });

  it("con una copia vieja responde al instante sin SIESA; `fresco` sí espera a SIESA", async () => {
    let llamadas = 0;
    let reloj = 0;
    const cliente = crearClientePrecios({
      env, ttlMs: 10, ahora: () => reloj,
      fetchImpl: async () => { llamadas++; return paginaDe(1, 1); },
    });
    assert.equal((await cliente.consultar()).alDia, true);
    reloj = 100;
    const vieja = await cliente.consultar();
    assert.equal(vieja.alDia, false);
    assert.equal(llamadas, 1, "la copia vieja no va a SIESA");
    const fresca = await cliente.consultar({ fresco: true });
    assert.equal(fresca.alDia, true);
    assert.equal(llamadas, 2);
  });

  it("una instancia nueva abre con la copia de Supabase, sin esperar a SIESA", async () => {
    let llamadas = 0;
    const almacen = {
      leer: async () => ({ filas: [{ item: "7", lista: "P01" }], consultadoEn: new Date(1_000).toISOString() }),
      guardar: async () => {},
    };
    const cliente = crearClientePrecios({
      env, ttlMs: 5_000, ahora: () => 3_000, almacen,
      fetchImpl: async () => { llamadas++; return paginaDe(1, 1); },
    });
    const r = await cliente.consultar();
    assert.equal(llamadas, 0);
    assert.equal(r.alDia, true);
    assert.deepEqual(r.filas.map((f) => f.item), ["7"]);
  });

  it("guarda en Supabase solo las listas de las tiendas, y si guardar falla igual responde", async () => {
    const guardadas = [];
    const cliente = crearClientePrecios({
      env, listas: ["P01"],
      almacen: { leer: async () => null, guardar: async ({ filas }) => { guardadas.push(filas); throw new Error("supabase caído"); } },
      fetchImpl: async () => respuesta(200, { codigo: 0, detalle: { Table: [cruda({ Lista: "P01" }), cruda({ Lista: "P90" })], "total_páginas": 1 } }),
    });
    const r = await cliente.consultar();
    assert.deepEqual(r.filas.map((f) => f.lista), ["P01"]);
    assert.deepEqual(guardadas[0].map((f) => f.lista), ["P01"]);
  });

  it("si Supabase no responde, va a SIESA", async () => {
    let llamadas = 0;
    const cliente = crearClientePrecios({
      env, almacen: { leer: async () => { throw new Error("timeout"); }, guardar: async () => {} },
      fetchImpl: async () => { llamadas++; return paginaDe(1, 1); },
    });
    assert.equal((await cliente.consultar()).alDia, true);
    assert.equal(llamadas, 1);
  });

  it("sin copia, el error sube (nunca un precio inventado)", async () => {
    const cliente = crearClientePrecios({ env, fetchImpl: async () => respuesta(400, { codigo: 1, mensaje: "error" }) });
    await assert.rejects(cliente.consultar());
  });

  it("401 = credenciales de la consulta, con un mensaje que lo dice", async () => {
    const cliente = crearClientePrecios({ env, fetchImpl: async () => respuesta(401, {}) });
    await assert.rejects(cliente.consultar(), /CONNI_KEY/);
  });

  it("usa el par CONNI_KEY/CONNI_TOKEN del inventario y el nombre de consulta por defecto", async () => {
    let pedido;
    const cliente = crearClientePrecios({
      env: { CONNEKTA_BASE_URL: "https://siesa.test/api/connekta/v3", CONNI_KEY: "k-comun", CONNI_TOKEN: "t-comun" },
      fetchImpl: async (url, opciones) => { pedido = { url, headers: opciones.headers }; return paginaDe(1, 1); },
    });
    assert.equal(cliente.configurado, true);
    await cliente.consultar();
    assert.equal(new URL(pedido.url).searchParams.get("descripcion"), "merkahorro_fruver_precios");
    assert.deepEqual(pedido.headers, { conniKey: "k-comun", conniToken: "t-comun" });
  });

  it("no pide más páginas que el fusible", async () => {
    let llamadas = 0;
    const cliente = crearClientePrecios({ env, fetchImpl: async () => { llamadas++; return paginaDe(1, 9999); } });
    await cliente.consultar();
    assert.equal(llamadas, MAXIMO_PAGINAS);
  });

  it("sin variables no está configurado y responde 503", async () => {
    const cliente = crearClientePrecios({ env: {} });
    assert.equal(cliente.configurado, false);
    await assert.rejects(cliente.consultar(), (e) => e.status === 503);
  });
});

describe("copia de precios en Supabase", () => {
  const fila = {
    item: "5098", descripcion: "BANANO", umInventario: "KL", subgrupo: "FRUTA", separata: null,
    lista: "P01", um: "KL", precio: 3200, activacion: "2026-11-10", inactivacion: null, actualizacion: "2026-11-10T06:00:00",
  };

  it("comprimir y expandir devuelven las mismas filas", () => {
    const c = comprimir([fila]);
    assert.equal(c.datos[0].length, c.campos.length);
    assert.deepEqual(expandir(JSON.parse(JSON.stringify(c))), [fila]);
  });

  it("una copia rota o vacía se lee como sin filas", () => {
    assert.deepEqual(expandir(null), []);
    assert.deepEqual(expandir({ campos: "x" }), []);
  });

  it("lee la fila 1 y guarda por la función, nunca por la tabla", async () => {
    const llamadas = [];
    const supabase = {
      configurado: true,
      select: async (tabla, consulta) => { llamadas.push(["select", tabla, consulta.id]); return [{ filas: comprimir([fila]), consultado_en: "2026-11-13T15:00:00+00:00" }]; },
      rpc: async (nombre, args) => { llamadas.push(["rpc", nombre, args.p_consultado_en]); return true; },
    };
    const almacen = crearAlmacenPrecios({ supabase });
    const leida = await almacen.leer();
    assert.deepEqual(leida.filas, [fila]);
    assert.equal(leida.consultadoEn, "2026-11-13T15:00:00+00:00");
    await almacen.guardar({ filas: [fila], consultadoEn: "2026-11-13T15:05:00.000Z" });
    assert.deepEqual(llamadas, [
      ["select", "fruver_precios_copia", "eq.1"],
      ["rpc", "fruver_guardar_copia_precios", "2026-11-13T15:05:00.000Z"],
    ]);
  });

  it("sin Supabase configurado no hay almacén (queda solo la memoria)", () => {
    assert.equal(crearAlmacenPrecios({ supabase: { configurado: false } }), null);
  });
});

describe("«Actualizar» (forzar)", () => {
  const env = { CONNEKTA_BASE_URL: "https://siesa.test/api/connekta/v3", CONNI_KEY: "k", CONNI_TOKEN: "t" };
  const pagina = { status: 200, ok: true, json: async () => ({ codigo: 0, detalle: { Table: [cruda()], "total_páginas": 1 } }) };

  it("va a SIESA aunque la copia esté al día, salvo que tenga menos de 1 minuto", async () => {
    let llamadas = 0;
    let reloj = 0;
    const cliente = crearClientePrecios({ env, ahora: () => reloj, fetchImpl: async () => { llamadas++; return pagina; } });
    await cliente.consultar();
    assert.equal(llamadas, 1);

    reloj = 30_000; // copia de 30 s: «Actualizar» no vuelve a leer
    assert.equal((await cliente.consultar({ forzar: true })).alDia, true);
    assert.equal(llamadas, 1);

    reloj = 5 * 60_000; // al día (< 30 min) pero de más de 1 min: sí lee
    await cliente.consultar();
    assert.equal(llamadas, 1, "entrar normal no lee SIESA");
    await cliente.consultar({ forzar: true });
    assert.equal(llamadas, 2);
  });

  it("la copia vale 30 minutos", async () => {
    let reloj = 0;
    const cliente = crearClientePrecios({ env, ahora: () => reloj, fetchImpl: async () => pagina });
    await cliente.consultar();
    reloj = 29 * 60_000;
    assert.equal((await cliente.consultar()).alDia, true);
    reloj = 31 * 60_000;
    assert.equal((await cliente.consultar()).alDia, false);
  });
});
