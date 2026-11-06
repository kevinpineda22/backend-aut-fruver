export function fechaValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function esTimeout(error) {
  return error?.code === "ETIMEDOUT"
    || error?.code === "57014"
    || /timeout|statement timeout/i.test(error?.message || "");
}

/** Error que ya trae el mensaje para el usuario y su código HTTP. */
export class ErrorPublico extends Error {
  constructor(mensaje, status = 502) {
    super(mensaje);
    this.status = status;
  }
}

/** Lo que ve el usuario cuando la base rechaza la escritura (ErrorBase.codigo). */
const MENSAJES_BASE = {
  PEDIDO_YA_ENVIADO: { status: 409, error: "Esta sede ya envió su pedido para esa fecha de entrega." },
  NO_CONFIGURADO: { status: 503, error: "El servidor no tiene configurada la base de pedidos." },
};

export function respuestaError(response, error, mensaje) {
  console.error(mensaje, error.message);
  if (error instanceof ErrorPublico) {
    return response.status(error.status).json({ ok: false, error: error.message });
  }
  if (MENSAJES_BASE[error?.codigo]) {
    const { status, error: texto } = MENSAJES_BASE[error.codigo];
    return response.status(status).json({ ok: false, error: texto, codigo: error.codigo });
  }
  return response.status(esTimeout(error) ? 503 : 500).json({
    ok: false,
    error: esTimeout(error)
      ? "La base de datos tardo demasiado en responder. Intente de nuevo."
      : mensaje,
  });
}
