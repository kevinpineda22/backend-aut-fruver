import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cubre, modoAuth, pathsDe, puedeVer, tokenDelHeader, vencimientoDelToken,
} from "../src/auth/permisos.js";

describe("cubre (gemelo de src/config/autorizacionRutas.js del front)", () => {
  it("cubre la ruta exacta y sus hijas", () => {
    assert.equal(cubre("/automatizacion-fruver", "/automatizacion-fruver"), true);
    assert.equal(cubre("/automatizacion-fruver", "/automatizacion-fruver/detalle"), true);
  });
  it("no cubre vecinos de nombre parecido ni distinto uso de mayúsculas", () => {
    assert.equal(cubre("/automatizacion-fruver", "/automatizacion-fruverx"), false);
    assert.equal(cubre("/Automatizacion-fruver", "/automatizacion-fruver"), false);
  });
});

describe("modoAuth", () => {
  it("sin valor es report", () => {
    assert.equal(modoAuth(undefined), "report");
    assert.equal(modoAuth(""), "report");
  });
  it("acepta los tres modos sin importar mayúsculas", () => {
    assert.equal(modoAuth("OFF"), "off");
    assert.equal(modoAuth(" enforce "), "enforce");
  });
  it("un valor desconocido cierra", () => {
    assert.equal(modoAuth("enforced"), "enforce");
  });
});

describe("tokenDelHeader", () => {
  it("lee Bearer", () => assert.equal(tokenDelHeader("Bearer abc.def"), "abc.def"));
  it("rechaza otras formas", () => {
    assert.equal(tokenDelHeader("abc"), null);
    assert.equal(tokenDelHeader("Bearer a b"), null);
    assert.equal(tokenDelHeader(undefined), null);
  });
});

describe("pathsDe", () => {
  it("acepta objetos {path} y strings, descarta basura", () => {
    assert.deepEqual(pathsDe([{ path: "/a" }, "/b", null, { nombre: "x" }]), ["/a", "/b"]);
    assert.deepEqual(pathsDe(null), []);
  });
});

describe("puedeVer", () => {
  it("el admin NO pasa sin la ruta asignada (igual que RutaProtegida fuera de la Analítica)", () => {
    assert.equal(puedeVer({ role: "admin" }, "/automatizacion-fruver"), false);
    assert.equal(puedeVer({ role: "super_admin", rutasPersonales: [{ path: "/automatizacion-fruver" }] }, "/automatizacion-fruver"), true);
  });
  it("una ruta personal que cubre el módulo habilita", () => {
    assert.equal(puedeVer({ role: "compras", rutasPersonales: [{ path: "/automatizacion-fruver" }] }, "/automatizacion-fruver"), true);
  });
  it("las rutas personales PISAN las del rol", () => {
    const acceso = {
      role: "compras",
      rutasPersonales: [{ path: "/traslados" }],
      rutasRol: [{ path: "/automatizacion-fruver" }],
    };
    assert.equal(puedeVer(acceso, "/automatizacion-fruver"), false);
  });
  it("sin rutas personales mandan las del rol", () => {
    assert.equal(puedeVer({ role: "compras", rutasPersonales: [], rutasRol: [{ path: "/automatizacion-fruver" }] }, "/automatizacion-fruver"), true);
  });
  it("el redirect del rol habilita su pantalla de inicio", () => {
    assert.equal(puedeVer({ role: "gerencia", redirect: "/automatizacion-fruver" }, "/automatizacion-fruver"), true);
  });
  it("sin nada de lo anterior, no", () => {
    assert.equal(puedeVer({ role: "compras", rutasPersonales: [{ path: "/ventas-comerciales" }] }, "/automatizacion-fruver"), false);
    assert.equal(puedeVer(null, "/automatizacion-fruver"), false);
  });
});

describe("vencimientoDelToken", () => {
  it("lee exp en milisegundos", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1000 })).toString("base64url");
    assert.equal(vencimientoDelToken(`h.${payload}.s`), 1_000_000);
  });
  it("un token ilegible da null", () => assert.equal(vencimientoDelToken("nada"), null));
});
