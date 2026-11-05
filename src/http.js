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

export function respuestaError(response, error, mensaje) {
  console.error(mensaje, error.message);
  if (error instanceof ErrorPublico) {
    return response.status(error.status).json({ ok: false, error: error.message });
  }
  return response.status(esTimeout(error) ? 503 : 500).json({
    ok: false,
    error: esTimeout(error)
      ? "La base de datos tardo demasiado en responder. Intente de nuevo."
      : mensaje,
  });
}
