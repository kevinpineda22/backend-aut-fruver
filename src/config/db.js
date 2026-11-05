import process from "node:process";
import pg from "pg";

const { Pool } = pg;

export const postgresConfigurado = [
  "POSTGRES_HOST",
  "POSTGRES_DATABASE",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
].every((variable) => Boolean(process.env[variable]));

/* Misma réplica y mismas reglas que backend_analitica:
   - Corre en Vercel detrás de Supavisor (puerto 6543): `max: 1` por instancia.
   - NUNCA un `SET` de sesión: Supavisor recicla la conexión y el ajuste le queda
     pegado a la próxima consulta de otro servicio. Si hace falta, `SET LOCAL`
     dentro de una transacción.
   - Este backend solo LEE la réplica. */
export const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DATABASE || "postgres",
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: process.env.POSTGRES_SSLMODE === "require"
    ? { rejectUnauthorized: false }
    : false,
  max: 1,
  connectionTimeoutMillis: Number(process.env.POSTGRES_STATEMENT_TIMEOUT || 55000),
  idleTimeoutMillis: 30000,
  statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT || 55000),
  options: "-c max_parallel_workers_per_gather=0",
  application_name: "merkahorro_automatizacion_fruver",
});

pool.on("error", (error) => {
  console.error("Conexion inactiva de PostgreSQL terminada:", error.message);
});
