/* Asertividad del sugerido desde la terminal: el reporte técnico completo
   (por sede, semana y modelo; la pantalla muestra solo el día a día). Solo lee la réplica.

   node --env-file=.env scripts/medir-asertividad.mjs [semanas=8] */
import process from "node:process";
import { pool } from "../src/config/db.js";
import { calcularAsertividadCompleta } from "../src/asertividad/servicio.js";
import { MODELOS } from "../src/asertividad/reglas.js";

const semanas = Number(process.argv[2] || 8);
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`).padStart(8);

try {
  const t0 = Date.now();
  const d = await calcularAsertividadCompleta({ pool, semanas });
  const p = d.parametros;
  console.log(`Asertividad ${p.desde} → ${p.hasta} (${semanas} semanas, ${d.observaciones} observaciones, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(`Ajuste de quincena: ${p.ajusteQuincena ? "encendido" : "apagado"}\n`);
  console.log("Error (sesgo)".padEnd(26), MODELOS.map((m) => m.padStart(22)).join(""));
  for (const [nivel, m] of Object.entries(d.resumen)) {
    console.log(nivel.padEnd(26), MODELOS.map((x) => `${pct(m[x].error)} (${pct(m[x].sesgo)})`.padStart(22)).join(""));
  }
  console.log("\nCompra por semana (todas las sedes, por producto y semana):");
  for (const s of d.semanas) console.log(`  ${s.desde} → ${s.hasta}`, MODELOS.map((x) => `${x} ${pct(s.consolidado[x].error)}`).join("  "));
} finally {
  await pool.end();
}
