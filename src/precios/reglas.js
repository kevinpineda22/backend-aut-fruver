/* =============================================================================
   Precios de fruver: reglas puras (sin red ni base, se prueban solas)

   Las filas vienen de la consulta de Connekta `merkahorro_fruver_precios`
   (docs/CONSULTA_PRECIOS_CONNEKTA.md): hasta 3 filas por (lista, ítem, U.M.),
   las de fecha de activación más reciente.

   EL VIGENTE SE DECIDE ACÁ, con la fecha de COLOMBIA, y no en la consulta: el
   reloj del servidor de SIESA puede estar en UTC, y desde las 7:00 p. m. su "hoy"
   ya es mañana. Si decidiera la consulta, a esa hora se imprimiría un precio que
   todavía no rige en la caja.

   Las fechas se comparan como texto AAAA-MM-DD (el orden alfabético es el
   cronológico). Nunca pasan por `Date`: en un servidor UTC eso corre el día.
   ============================================================================= */

const texto = (valor) => String(valor ?? "").trim();

/** "2026-11-11T00:00:00" → "2026-11-11". Cualquier otra cosa → null. */
export function fechaDe(valor) {
  const t = texto(valor);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

/** El código del ítem sin ceros a la izquierda ni relleno: "0005098 " → "5098". */
export const codigoItem = (valor) => texto(valor).replace(/^0+(?=\d)/, "");

/** Una fila de Connekta con los textos limpios (SIESA rellena con espacios). */
export function normalizarFila(f) {
  const precio = Number(f.Precio);
  return {
    item: codigoItem(f.Item),
    descripcion: texto(f.Descripcion),
    umInventario: texto(f.UMInventario).toUpperCase(),
    subgrupo: texto(f.Subgrupo) || null,
    separata: texto(f.Separata) || null,
    lista: texto(f.Lista).toUpperCase(),
    um: texto(f.UM).toUpperCase(),
    precio: Number.isFinite(precio) ? precio : null,
    activacion: fechaDe(f.FechaActivacion),
    inactivacion: fechaDe(f.FechaInactivacion),
    actualizacion: texto(f.FechaActualizacion) || "",
  };
}

/** Más reciente primero: por activación y, en empate, por la última modificación. */
const masReciente = (a, b) => b.activacion.localeCompare(a.activacion) || b.actualizacion.localeCompare(a.actualizacion);

/**
 * El precio de una (lista, ítem, U.M.) a la fecha `hoy`.
 *
 * - vigente: la fila más reciente con activación ≤ hoy. Si ESA fila está
 *   inactivada (inactivación ≤ hoy), no hay precio: no se revive uno más viejo,
 *   porque la caja tampoco lo cobra.
 * - anterior: la fila previa con OTRA fecha de activación (o null si la consulta
 *   no la trajo: no se inventa).
 * - programado: el próximo precio con activación > hoy.
 * - cambio: "sube" | "baja" | "igual" | "nuevo" (sin anterior). Volver a cargar
 *   el mismo precio con fecha nueva NO es un cambio: no hay que reimprimir.
 */
export function estadoPrecio(filas, hoy) {
  const orden = (filas || []).filter((f) => f.activacion).sort(masReciente);
  const futuros = orden.filter((f) => f.activacion > hoy);
  const programado = futuros.length ? futuros[futuros.length - 1] : null;

  const i = orden.findIndex((f) => f.activacion <= hoy);
  const candidato = i < 0 ? null : orden[i];
  const inactivo = Boolean(candidato?.inactivacion && candidato.inactivacion <= hoy);
  const vigente = candidato && !inactivo && candidato.precio > 0 ? candidato : null;
  const anterior = vigente ? orden.slice(i + 1).find((f) => f.activacion < vigente.activacion) || null : null;

  let cambio = null;
  if (vigente) {
    if (!anterior || !(anterior.precio > 0)) cambio = "nuevo";
    else if (vigente.precio > anterior.precio) cambio = "sube";
    else if (vigente.precio < anterior.precio) cambio = "baja";
    else cambio = "igual";
  }

  return {
    vigente,
    anterior,
    programado,
    cambio,
    motivoSinPrecio: vigente ? null
      : !candidato ? (programado ? "programado" : "sin_precio")
        : inactivo ? "inactivo" : "en_cero",
  };
}

/**
 * Filas normalizadas → Map item → { datos del ítem, listas: Map lista → Map um → filas }.
 * Los datos del ítem (nombre, subgrupo, separata) son iguales en todas sus filas.
 */
export function agruparPrecios(filas) {
  const porItem = new Map();
  for (const f of filas) {
    if (!f.item || !f.lista || !f.um) continue;
    let grupo = porItem.get(f.item);
    if (!grupo) {
      grupo = {
        item: f.item,
        descripcion: f.descripcion,
        umInventario: f.umInventario,
        subgrupo: f.subgrupo,
        separata: f.separata,
        listas: new Map(),
      };
      porItem.set(f.item, grupo);
    }
    if (!grupo.listas.has(f.lista)) grupo.listas.set(f.lista, new Map());
    const porUm = grupo.listas.get(f.lista);
    if (!porUm.has(f.um)) porUm.set(f.um, []);
    porUm.get(f.um).push(f);
  }
  return porItem;
}

/**
 * La U.M. que va en la etiqueta: la de inventario, que es como lo vende la caja
 * (KL o UND). Si la lista no tiene precio en esa unidad, la única que tenga; con
 * varias, KL y después UND. `null` si la lista no tiene ninguna.
 */
export function unidadEtiqueta(porUm, umInventario) {
  if (!porUm?.size) return null;
  if (porUm.has(umInventario)) return umInventario;
  if (porUm.size === 1) return [...porUm.keys()][0];
  for (const preferida of ["KL", "UND"]) if (porUm.has(preferida)) return preferida;
  return [...porUm.keys()].sort()[0];
}

const resumenFila = (f) => (f ? { precio: f.precio, fecha: f.activacion } : null);

/**
 * Los productos de UNA lista de precios a la fecha `hoy`.
 *
 * @param {Map}       grupos   agruparPrecios(...)
 * @param {string}    lista    "P01"
 * @param {string}    hoy      AAAA-MM-DD en Colombia
 * @param {Set|null}  activos  códigos de los ítems activos (null = no se pudo saber: no se filtra)
 * @returns {{ productos: Array, sinPrecio: Array }}
 */
export function productosDeLista(grupos, lista, hoy, activos = null) {
  const productos = [];
  const sinPrecio = [];
  for (const g of grupos.values()) {
    if (activos && !activos.has(g.item)) continue;
    const porUm = g.listas.get(lista);
    const um = unidadEtiqueta(porUm, g.umInventario);
    const base = { item: g.item, descripcion: g.descripcion, subgrupo: g.subgrupo, separata: g.separata };
    if (!um) {
      sinPrecio.push({ ...base, motivo: "sin_lista" });
      continue;
    }
    const estado = estadoPrecio(porUm.get(um), hoy);
    if (!estado.vigente) {
      sinPrecio.push({ ...base, um, motivo: estado.motivoSinPrecio, programado: resumenFila(estado.programado) });
      continue;
    }
    productos.push({
      ...base,
      um,
      umInventario: g.umInventario,
      precio: estado.vigente.precio,
      desde: estado.vigente.activacion,
      anterior: resumenFila(estado.anterior),
      programado: resumenFila(estado.programado),
      cambio: estado.cambio,
      // Lo que hay que reimprimir hoy: entró un precio hoy y es distinto (o nuevo).
      cambioHoy: estado.vigente.activacion === hoy && estado.cambio !== "igual",
    });
  }
  const porNombre = (a, b) => a.descripcion.localeCompare(b.descripcion, "es");
  return { productos: productos.sort(porNombre), sinPrecio: sinPrecio.sort(porNombre) };
}

/* -----------------------------------------------------------------------------
   Ubicación de cada producto en la tienda: BANCARELLAS (lleva etiqueta de
   góndola) o NEVERA (no se imprime). Sin registro = BANCARELLAS, igual que el
   sistema viejo.
   ---------------------------------------------------------------------------- */

export const UBICACIONES = ["BANCARELLAS", "NEVERA"];
export const UBICACION_POR_DEFECTO = "BANCARELLAS";
/** Fruver tiene ~550 ítems. 600 cambios caben en el límite de 32 KB del cuerpo (app.js). */
export const MAXIMO_CAMBIOS_UBICACION = 600;

/** Valida el cuerpo de "guardar ubicaciones". Devuelve { bodega, cambios } o { error }. */
export function leerUbicaciones(cuerpo, bodegasValidas) {
  const bodega = texto(cuerpo?.bodega);
  if (!bodegasValidas.includes(bodega)) return { error: "La sede no es válida." };
  const cambios = Array.isArray(cuerpo?.cambios) ? cuerpo.cambios : null;
  if (!cambios?.length) return { error: "No hay cambios para guardar." };
  if (cambios.length > MAXIMO_CAMBIOS_UBICACION) return { error: `Se pueden guardar hasta ${MAXIMO_CAMBIOS_UBICACION} productos a la vez.` };
  const porItem = new Map();
  for (const c of cambios) {
    const item = codigoItem(c?.item);
    const ubicacion = texto(c?.ubicacion).toUpperCase();
    if (!/^\d{1,10}$/.test(item)) return { error: "Hay un producto con código inválido." };
    if (!UBICACIONES.includes(ubicacion)) return { error: `La ubicación del producto ${item} no es válida.` };
    porItem.set(item, ubicacion); // el último gana si llega repetido
  }
  return { bodega, cambios: [...porItem].map(([item, ubicacion]) => ({ item, ubicacion })) };
}
