/* Sedes y su QR. El adhesivo de cada sede lleva un código de 32 caracteres;
   quien lo escanea demuestra que está EN la sede. Mismo mecanismo que Carnes. */

const TOKEN = /[0-9a-f]{32}/i;

/**
 * Saca el código de lo que leyó la cámara. Acepta el código pelado o una URL que
 * lo lleve adentro (si alguien imprime los adhesivos con otro generador).
 * Gemelo de Pagina-web_React/src/pages/Carnes/utils/qrSede.js.
 */
export function extraerToken(contenido) {
  const texto = String(contenido ?? "").trim();
  const encontrado = texto.match(TOKEN);
  return encontrado ? encontrado[0].toLowerCase() : "";
}

/** La sede activa de un código, o null. */
export async function sedePorToken(supabase, contenido) {
  const token = extraerToken(contenido);
  if (!token) return null;
  const filas = await supabase.select("fruver_sedes", {
    select: "bodega,nombre", qr_token: `eq.${token}`, activa: "eq.true",
  });
  return filas?.[0] || null;
}

export async function listarSedes(supabase) {
  return supabase.select("fruver_sedes", {
    select: "bodega,nombre,qr_token,activa,token_actualizado_en,token_actualizado_por", order: "nombre",
  });
}

export async function regenerarToken(supabase, bodega, usuario) {
  return supabase.rpc("fruver_regenerar_token", { p_bodega: bodega, p_usuario: usuario });
}
