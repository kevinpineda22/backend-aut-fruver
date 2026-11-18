/* Toma la foto del sugerido de compra a mano (la misma que hace el cron).

   node --env-file=.env scripts/tomar-foto-sugerido.mjs          → calcula y GUARDA
   node --env-file=.env scripts/tomar-foto-sugerido.mjs --seco   → solo calcula y muestra el resumen

   Ojo: el .env local apunta al Supabase REAL de la intranet. */

import process from "node:process";
import { pool } from "../src/config/db.js";
import { crearSupabaseAdmin } from "../src/config/supabaseAdmin.js";
import { tomarFoto } from "../src/fotos/servicio.js";
import { crearClienteInventario } from "../src/siesa/inventario.js";

const seco = process.argv.includes("--seco");
const supabase = crearSupabaseAdmin({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
const inicio = Date.now();
try {
  const r = await tomarFoto({ pool, inventario: crearClienteInventario(), supabase, guardar: !seco });
  const { foto, items, ...resumen } = r;
  console.log(JSON.stringify(resumen, null, 2));
  if (seco) {
    const bytes = Buffer.byteLength(JSON.stringify({ p_foto: foto, p_items: items }));
    console.log(`En seco: ${items.length} renglones, ${(bytes / 1024).toFixed(0)} KB para guardar, ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
    const ejemplo = items.find((i) => i.comprar > 0);
    if (ejemplo) console.log("Ejemplo:", JSON.stringify(ejemplo, null, 2));
  }
} finally {
  await pool.end();
}
