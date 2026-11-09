import { ErrorPublico } from "../http.js";

export const CAMPOS_PROVEEDOR = [
  "nit", "razon_social", "nombre_comercial", "nombre_contacto", "telefono",
  "telefono_whatsapp", "tipo_proveedor", "fecha_registro_proveedor",
];
const REQUERIDOS = new Set(["nit", "razon_social", "nombre_comercial", "nombre_contacto", "telefono",
  "referencia_producto", "descripcion_producto"]);
const CAMPOS_PRODUCTO = ["referencia_producto", "descripcion_producto", "descripcion_maestra_pedido",
  "descripcion_catalogo", "unidad_medida", "fecha_asignacion"];

function texto(valor, campo) {
  if (valor != null && typeof valor !== "string") throw new ErrorPublico(`El campo ${campo} debe ser texto.`, 400);
  const limpio = (valor || "").trim();
  if (REQUERIDOS.has(campo) && !limpio) throw new ErrorPublico(`Complete el campo ${campo}.`, 400);
  if (limpio.length > 2000) throw new ErrorPublico(`El campo ${campo} es demasiado largo.`, 400);
  if (campo.startsWith("fecha_") && limpio && (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(limpio) || Number.isNaN(Date.parse(limpio)))) {
    throw new ErrorPublico(`La fecha ${campo} no es válida; use formato ISO con zona horaria.`, 400);
  }
  return limpio || null;
}

export function leerNit(valor) {
  const nit = texto(valor, "nit");
  if (nit.length > 100 || /[/\\]/.test(nit) || [...nit].some((c) => c.charCodeAt(0) < 32)) {
    throw new ErrorPublico("El NIT no es válido.", 400);
  }
  return nit;
}

export function leerVersion(valor) {
  if (typeof valor !== "string" || !/^[a-f0-9]{32}$/.test(valor)) {
    throw new ErrorPublico("Recargue la ficha antes de modificar el proveedor.", 400);
  }
  return valor;
}

function leerContactos(contactos) {
  if (!Array.isArray(contactos)) throw new ErrorPublico("Los contactos adicionales deben ser una lista.", 400);
  return contactos.map((contacto, indice) => {
    if (contacto == null || typeof contacto !== "object" || Array.isArray(contacto)) return contacto;
    const limpio = { ...contacto };
    for (const campo of ["nombre_contacto", "nombre", "telefono", "nombre_comercial"]) {
      if (!Object.hasOwn(contacto, campo)) continue;
      const valor = contacto[campo];
      if (valor != null && typeof valor !== "string" && typeof valor !== "number") {
        throw new ErrorPublico(`El campo contactos[${indice + 1}].${campo} debe ser texto.`, 400);
      }
      limpio[campo] = texto(valor == null ? null : String(valor), `contactos[${indice + 1}].${campo}`);
    }
    return limpio;
  });
}

export function leerFicha(body, nitOriginal = null) {
  if (!body || !body.datos || !Array.isArray(body.productos) || !body.productos.length) {
    throw new ErrorPublico("El proveedor debe tener sus datos y al menos un producto.", 400);
  }
  const datos = Object.fromEntries(CAMPOS_PROVEEDOR.map((c) => [c, texto(body.datos[c], c)]));
  datos.nit = leerNit(datos.nit);
  if (nitOriginal && datos.nit !== nitOriginal) throw new ErrorPublico("No se puede cambiar el NIT de una ficha existente.", 400);
  const ids = new Set();
  const productos = body.productos.map((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new ErrorPublico("El producto no es válido.", 400);
    const producto = Object.fromEntries(CAMPOS_PRODUCTO.map((c) => [c, texto(p[c], c)]));
    if (p.id != null) {
      const id = String(p.id);
      if (!/^[1-9]\d*$/.test(id) || ids.has(id) || !nitOriginal) throw new ErrorPublico("Hay un ID de producto inválido o repetido.", 400);
      ids.add(id);
      producto.id = id;
    }
    for (const campo of ["id_producto_maestra", "id_producto_catalogo"]) {
      const valor = p[campo];
      if (valor == null || valor === "") producto[campo] = null;
      else {
        const numero = Number(valor);
        if (!Number.isInteger(numero) || numero < 1 || numero > 2147483647) throw new ErrorPublico(`El campo ${campo} debe ser un entero positivo.`, 400);
        producto[campo] = numero;
      }
    }
    if (!Array.isArray(p.observaciones) || p.observaciones.some((o) => typeof o !== "string" || o.length > 2000)) {
      throw new ErrorPublico("Las observaciones deben ser una lista de textos.", 400);
    }
    producto.observaciones = p.observaciones.map((o) => o.trim()).filter(Boolean);
    return producto;
  });
  return { datos, productos, version: nitOriginal ? leerVersion(body.version) : null,
    ...(Object.hasOwn(body, "contactos") ? { contactos: leerContactos(body.contactos) } : {}) };
}

export function leerListado(query) {
  const pagina = Number(query.pagina || 1);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) throw new ErrorPublico("La página no es válida.", 400);
  const buscar = texto(query.buscar, "buscar") || "";
  return { p_buscar: buscar, p_pagina: pagina };
}
