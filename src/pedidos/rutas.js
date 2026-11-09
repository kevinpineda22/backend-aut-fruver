import { fechaValida, respuestaError } from "../http.js";
import { DIAS_COBERTURA_MAX, DIAS_ENTREGA_MAX, HORA_PUBLICACION_TEXTO, ahoraColombia, sugeridoPublicado, sumarDias } from "./reglas.js";
import { calcularSugerido } from "./servicio.js";
import { aplicarEnvios } from "../envios/reglas.js";
import { enviosEntre } from "../envios/servicio.js";

/** Lee `entrega` y `dias`. Si no sirven, devuelve el mensaje de error. */
export function leerParametros(query, hoy) {
  const entrega = String(query.entrega || sumarDias(hoy, 1));
  const dias = query.dias == null || query.dias === "" ? 1 : Number(query.dias);
  if (!fechaValida(entrega)) return { error: "La fecha de entrega no es valida." };
  if (entrega <= hoy) return { error: "La entrega tiene que ser despues de hoy." };
  if (entrega > sumarDias(hoy, DIAS_ENTREGA_MAX)) return { error: `La entrega puede ser hasta ${DIAS_ENTREGA_MAX} dias adelante.` };
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_COBERTURA_MAX) {
    return { error: `Los dias a cubrir van de 1 a ${DIAS_COBERTURA_MAX}.` };
  }
  return { entrega, dias };
}

/** Antes de la hora de publicación no se calcula: es un estado normal, no un error. */
const enEspera = (response) => response.json({ ok: true, data: { espera: true, publicaA: HORA_PUBLICACION_TEXTO } });

/**
 * `GET ?entrega&dias` → el sugerido de todas las sedes y la compra consolidada.
 * Lo usan las dos secciones (Sugerido por sede y Compra), cada una montada en
 * app.js detrás de su propio permiso.
 */
export function manejadorSugerido({ pool, inventario, reloj = ahoraColombia }) {
  return async (request, response) => {
    const { fecha: hoy, hora } = reloj();
    if (!sugeridoPublicado(hora)) return enEspera(response);
    const parametros = leerParametros(request.query, hoy);
    if (parametros.error) return response.status(400).json({ ok: false, error: parametros.error });
    try {
      const data = await calcularSugerido({ pool, inventario, ...parametros });
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible calcular el pedido sugerido.");
    }
  };
}

/**
 * Compra: el mismo cálculo (por el inventario del acopio y los nombres) con lo
 * que ENVIARON las sedes para esa entrega encima. Si la base de pedidos no
 * responde, sale el sugerido solo y un aviso: compras no se queda sin nada.
 */
export function manejadorCompra({ pool, inventario, supabase }) {
  return async (request, response) => {
    const { fecha: hoy } = ahoraColombia();
    const parametros = leerParametros(request.query, hoy);
    if (parametros.error) return response.status(400).json({ ok: false, error: parametros.error });
    let sugerido;
    try {
      sugerido = await calcularSugerido({ pool, inventario, ...parametros });
    } catch (error) {
      return respuestaError(response, error, "No fue posible calcular el pedido sugerido.");
    }
    try {
      const envios = await enviosEntre({ supabase, desde: parametros.entrega, hasta: parametros.entrega });
      return response.json({ ok: true, data: aplicarEnvios(sugerido, envios) });
    } catch (error) {
      console.error("[compra] no se pudieron leer los pedidos enviados:", error.message);
      return response.json({
        ok: true,
        data: { ...sugerido, envios: null, avisoEnvios: "No se pudieron leer los pedidos que enviaron las sedes. Intente de nuevo en unos minutos." },
      });
    }
  };
}
