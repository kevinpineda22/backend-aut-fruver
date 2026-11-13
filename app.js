/* =============================================================================
   API de Automatización Fruver — punto de entrada

   Vercel detecta este archivo como la app Express (exporta `default`). No crear
   `index.js`, `server.js` ni `app.js` dentro de `src/`.

   Un módulo por carpeta en `src/` (hoy: `pedidos`, el cálculo del sugerido).
   Cada sección del front tiene su permiso (RUTAS) y su ruta acá abajo, detrás
   de `requiereModulo`.

   Lee la réplica de SIESA en Postgres (`merkahorro_siesa`, solo lectura) y el
   inventario en vivo de SIESA (consulta estándar). No escribe en ninguno: lo
   que escribe son pedidos, compras, recibos y despachos en el Supabase de la
   intranet (sql/002_pedidos_enviados.sql y sql/003_operaciones.sql).
   ============================================================================= */

import "dotenv/config";
import process from "node:process";
import cors from "cors";
import express from "express";
import { requiereModulo } from "./src/auth/middleware.js";
import { modoAuth } from "./src/auth/permisos.js";
import { crearResolverAcceso } from "./src/auth/supabaseAuth.js";
import { origenesPermitidos, originPermitido } from "./src/config/cors.js";
import { pool, postgresConfigurado } from "./src/config/db.js";
import { respuestaError } from "./src/http.js";
import { crearSupabaseAdmin } from "./src/config/supabaseAdmin.js";
import { rutasEnvio, rutasSeguimiento } from "./src/envios/rutas.js";
import { manejadorCompra, manejadorSugerido } from "./src/pedidos/rutas.js";
import { crearClienteInventario } from "./src/siesa/inventario.js";
import { rutasProveedores } from "./src/proveedores/rutas.js";
import { crearClientePrecios } from "./src/precios/connekta.js";
import { crearAlmacenPrecios } from "./src/precios/copia.js";
import { LISTAS_PRECIO } from "./src/sedes.js";
import { rutasPrecios } from "./src/precios/rutas.js";
import { rutasOperaciones } from "./src/operaciones/rutas.js";

/** Ruta del sistema en el front. Cada sección es una ruta hija con su permiso:
    quien tiene asignada `/automatizacion-fruver` entra a todas; a un líder se le
    asigna solo `/automatizacion-fruver/sugerido`. */
export const RUTA_MODULO = "/automatizacion-fruver";
export const RUTAS = {
  sugerido: `${RUTA_MODULO}/sugerido`,
  compra: `${RUTA_MODULO}/pedidos`,
  seguimiento: `${RUTA_MODULO}/seguimiento`,
  proveedores: `${RUTA_MODULO}/proveedores`,
  precios: `${RUTA_MODULO}/precios`,
  recibo: `${RUTA_MODULO}/recibo`,
  despacho: `${RUTA_MODULO}/despacho`,
};

const allowedOrigins = origenesPermitidos(process.env.FRUVER_ALLOWED_ORIGINS);
const modo = modoAuth(process.env.FRUVER_AUTH);
const resolverAcceso = crearResolverAcceso({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
});
const inventario = crearClienteInventario();
const supabase = crearSupabaseAdmin({
  url: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
// La última lectura de SIESA queda en Supabase: abrir Precios no espera los ~13 s de Connekta.
const precios = crearClientePrecios({
  almacen: crearAlmacenPrecios({ supabase }),
  listas: Object.values(LISTAS_PRECIO),
});

console.log(`[auth] FRUVER_AUTH=${modo}`);

export const app = express();

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    try {
      callback(null, originPermitido(origin, allowedOrigins));
    } catch {
      callback(null, false);
    }
  },
}));
app.use("/api/fruver/proveedores", express.json({ limit: "2mb" }));
app.use("/api/fruver/proveedores", (error, _request, response, next) => {
  if (error.type === "entity.too.large" || error.type === "entity.parse.failed") {
    return response.status(error.status).json({
      ok: false,
      error: error.type === "entity.too.large" ? "El portafolio supera el tamaño máximo de 2 MB por solicitud." : "El JSON de la solicitud no es válido.",
    });
  }
  return next(error);
});
app.use("/api/fruver/operaciones", express.json({ limit: "256kb" }));
app.use(express.json({ limit: "32kb" }));

app.get("/", (_request, response) => {
  response.json({
    ok: true,
    servicio: "API de Automatizacion Fruver",
    configuracion: {
      postgres: postgresConfigurado,
      siesa: inventario.configurado,
      precios: precios.configurado,
      sesion: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      pedidos: supabase.configurado,
      cors: allowedOrigins.length > 0,
    },
  });
});

app.get(["/api", "/api/salud"], async (_request, response) => {
  try {
    const result = await pool.query("SELECT NOW() AS ahora");
    response.json({ ok: true, data: { servicio: "API de Automatizacion Fruver", ahora: result.rows[0].ahora } });
  } catch (error) {
    respuestaError(response, error, "PostgreSQL no esta disponible.");
  }
});

/* `no-store`: el sugerido depende del inventario de este momento y va detrás
   de un token. Nunca `public` (el CDN se lo serviría a cualquiera). */
app.use("/api/fruver", (_request, response, next) => {
  response.set("Cache-Control", "private, no-store");
  next();
});

const acceso = (ruta) => requiereModulo(ruta, { modo, resolverAcceso });

// Sugerido por sede (los líderes): el cálculo, y ver/enviar el pedido de la sede.
app.get("/api/fruver/sugerido", acceso(RUTAS.sugerido), manejadorSugerido({ pool, inventario }));
app.use("/api/fruver/sugerido/envio", acceso(RUTAS.sugerido), rutasEnvio({ supabase }));

// Compra (compras): el cálculo con lo que enviaron las sedes encima.
app.get("/api/fruver/pedidos/sugerido", acceso(RUTAS.compra), manejadorCompra({ pool, inventario, supabase }));

// Seguimiento: ¿las sedes pidieron lo sugerido?
app.use("/api/fruver/seguimiento", acceso(RUTAS.seguimiento), rutasSeguimiento({ supabase }));

// Precios: etiquetas de góndola con el precio vigente de SIESA y la ubicación en la tienda.
app.use("/api/fruver/precios", acceso(RUTAS.precios), rutasPrecios({ precios, pool, supabase }));

// Los contactos personales y su CRUD siempre requieren sesión y permiso.
app.use("/api/fruver/proveedores",
  requiereModulo(RUTAS.proveedores, { modo: "enforce", resolverAcceso }),
  rutasProveedores({ supabase }));

for (const seccion of ["compra", "recibo", "despacho"]) {
  app.use(`/api/fruver/operaciones/${seccion}`,
    requiereModulo(RUTAS[seccion], { modo: "enforce", resolverAcceso }),
    (req, _res, next) => { req.fruverSeccion = seccion; next(); },
    rutasOperaciones({ supabase, pool, inventario }));
}

app.use((error, _request, response, next) => {
  if (error.type === "entity.too.large" || error.type === "entity.parse.failed") {
    return response.status(error.status).json({ ok: false, error: "El JSON no es válido o supera el tamaño permitido." });
  }
  return next(error);
});

app.use((_request, response) => {
  response.status(404).json({ ok: false, error: "Ruta no encontrada." });
});

export default app;
