/* =============================================================================
   Sedes de fruver

   Las tiendas no se escriben a mano en el cálculo: son las bodegas que vendieron
   fruver en la ventana de historia (así una sede nueva entra sola el día que
   empieza a vender). Esta tabla solo pone NOMBRES y orden; una bodega que no
   esté acá igual aparece, con su código.

   El ACOPIO (PV009, centro de acopio mayorista) no vende: es donde se compra
   el ~74 % del fruver y desde donde se reparte. Su inventario se descuenta del
   total a comprar.
   ============================================================================= */

export const ACOPIO = { codigo: "PV009", nombre: "Centro de acopio mayorista" };

export const NOMBRES_SEDES = {
  PV001: "Principal Copacabana",
  "00301": "Girardota Parque",
  "00201": "Villahermosa",
  "00701": "Barbosa",
  "00401": "Girardota Llano",
  "00601": "Las Vegas",
  "00801": "San Juan",
};

/** Lista de precios de SIESA de cada tienda (la que cobra la caja). Verificada
    contra Sin Filas (wc_sedes.lista_precio_siesa): P05 no existe, Barbosa es P07.
    ⚠️ database_sedes.sql del gestor ecommerce tiene un mapeo viejo y equivocado. */
export const LISTAS_PRECIO = {
  PV001: "P01",
  "00201": "P02",
  "00301": "P03",
  "00401": "P04",
  "00601": "P06",
  "00701": "P07",
  "00801": "P08",
};

const ORDEN = Object.keys(NOMBRES_SEDES);

export const nombreSede = (codigo) => NOMBRES_SEDES[codigo] || codigo;

/** Ordena códigos de bodega: primero los conocidos (en su orden), después el resto. */
export function ordenarSedes(codigos) {
  const posicion = (c) => (ORDEN.includes(c) ? ORDEN.indexOf(c) : ORDEN.length);
  return [...new Set(codigos)].sort((a, b) => posicion(a) - posicion(b) || a.localeCompare(b));
}
