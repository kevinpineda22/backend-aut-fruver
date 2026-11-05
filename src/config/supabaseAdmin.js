/* =============================================================================
   Supabase de la intranet, con la SERVICE ROLE (solo en el backend)

   Las tablas fruver_* tienen RLS sin políticas: con la anon key no se ve nada.
   Este cliente las lee y escribe por la API REST (PostgREST) y llama a las
   funciones fruver_* (sql/001_pedidos_sede.sql), que hacen cada cambio junto con
   su evento de trazabilidad.

   La service role salta RLS: quién puede hacer qué lo decide ESTE backend
   (FRUVER_AUTH + ruta asignada + QR de la sede). Nunca exponer esta clave.
   ============================================================================= */

/** Error de una función fruver_* (`raise exception 'PEDIDO_ENVIADO'`) con su código. */
export class ErrorBase extends Error {
  constructor(codigo, mensaje, status) {
    super(mensaje || codigo);
    this.codigo = codigo;
    this.status = status;
  }
}

const CODIGOS = ["PEDIDO_NO_EXISTE", "PEDIDO_ENVIADO", "CANTIDAD_INVALIDA", "PRODUCTO_NO_EXISTE", "SEDE_NO_EXISTE"];

/**
 * Cabeceras para la clave del backend. Sirven las dos formas de Supabase:
 * - la `service_role` vieja (un JWT, "eyJ…"): va en `apikey` Y en `Authorization`;
 * - la secret key nueva ("sb_secret_…"): va SOLO en `apikey`. No es un JWT, y
 *   mandarla como `Bearer` hace que la API la trate como un token inválido.
 */
export function cabecerasClave(clave) {
  const esJwt = String(clave || "").split(".").length === 3;
  return esJwt ? { apikey: clave, Authorization: `Bearer ${clave}` } : { apikey: clave };
}

export function crearSupabaseAdmin({ url, serviceKey, fetchImpl = globalThis.fetch } = {}) {
  const base = String(url || "").replace(/\/$/, "");
  const configurado = Boolean(base && serviceKey);

  async function pedir(ruta, { method = "GET", body, prefer } = {}) {
    if (!configurado) throw new ErrorBase("NO_CONFIGURADO", "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.", 503);
    const respuesta = await fetchImpl(`${base}/rest/v1${ruta}`, {
      method,
      headers: {
        ...cabecerasClave(serviceKey),
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const texto = await respuesta.text();
    const datos = texto ? JSON.parse(texto) : null;
    if (!respuesta.ok) {
      const mensaje = datos?.message || `Supabase respondio ${respuesta.status}`;
      const codigo = CODIGOS.find((c) => mensaje.includes(c)) || "ERROR_BASE";
      throw new ErrorBase(codigo, mensaje, respuesta.status);
    }
    return datos;
  }

  return {
    configurado,
    /** GET /rest/v1/<tabla>?<consulta> */
    select: (tabla, consulta) => pedir(`/${tabla}?${new URLSearchParams(consulta)}`),
    /** Llama a una función: POST /rest/v1/rpc/<nombre> */
    rpc: (nombre, args) => pedir(`/rpc/${nombre}`, { method: "POST", body: args }),
  };
}
