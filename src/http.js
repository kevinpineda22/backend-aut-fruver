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

/** Lo que ve el usuario cuando una función fruver_* de la base rechaza el cambio. */
const MENSAJES_BASE = {
  PEDIDO_ENVIADO: { status: 409, error: "El pedido ya fue enviado: no se puede cambiar." },
  PEDIDO_NO_EXISTE: { status: 404, error: "El pedido no existe." },
  PRODUCTO_NO_EXISTE: { status: 404, error: "Ese producto no está en el pedido de la sede." },
  CANTIDAD_INVALIDA: { status: 400, error: "La cantidad no es válida." },
  SEDE_NO_EXISTE: { status: 404, error: "La sede no existe." },
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
