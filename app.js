/* =============================================================================
   API de Automatización Fruver — punto de entrada

   Vercel detecta este archivo como la app Express (exporta `default`). No crear
   `index.js`, `server.js` ni `app.js` dentro de `src/`.

   Un módulo por carpeta en `src/` (hoy: `pedidos`). Para sumar uno nuevo:
   su carpeta con `rutas.js`, y una línea `app.use("/api/fruver/<modulo>", ...)`
   abajo, detrás del mismo `requiereModulo`.

   Lee la réplica de SIESA en Postgres (`merkahorro_siesa`, solo lectura) y el
   inventario en vivo de SIESA (consulta estándar). No escribe en ninguno.
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
import { rutasPedidos } from "./src/pedidos/rutas.js";
import { crearClienteInventario } from "./src/siesa/inventario.js";

/** Ruta de la pantalla en el front: quien la puede abrir, puede usar esta API. */
export const RUTA_MODULO = "/automatizacion-fruver";

const allowedOrigins = origenesPermitidos(process.env.FRUVER_ALLOWED_ORIGINS);
const modo = modoAuth(process.env.FRUVER_AUTH);
const resolverAcceso = crearResolverAcceso({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
});
const inventario = crearClienteInventario();

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
app.use(express.json({ limit: "32kb" }));

app.get("/", (_request, response) => {
  response.json({
    ok: true,
    servicio: "API de Automatizacion Fruver",
    configuracion: {
      postgres: postgresConfigurado,
      siesa: inventario.configurado,
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

app.use(
  "/api/fruver/pedidos",
  requiereModulo(RUTA_MODULO, { modo, resolverAcceso }),
  rutasPedidos({ pool, inventario }),
);

app.use((_request, response) => {
  response.status(404).json({ ok: false, error: "Ruta no encontrada." });
});

export default app;
