/* =============================================================================
   Última lectura de precios de SIESA, guardada en Supabase
   (fruver_precios_copia, sql/004_precios_copia.sql).

   Sirve para que una instancia nueva de Vercel abra la pantalla al instante en
   vez de esperar los ~13 s de Connekta. Las filas van EN COLUMNAS
   ({ campos, datos }): con ~7.300 filas, repetir los nombres en cada una
   duplicaba el tamaño.
   ============================================================================= */

export const TABLA_COPIA = "fruver_precios_copia";

export const CAMPOS = [
  "item", "descripcion", "umInventario", "subgrupo", "separata",
  "lista", "um", "precio", "activacion", "inactivacion", "actualizacion",
];

export const comprimir = (filas) => ({ campos: CAMPOS, datos: filas.map((f) => CAMPOS.map((c) => f[c] ?? null)) });

/** Usa los `campos` GUARDADOS: una copia escrita por una versión anterior se lee igual. */
export function expandir(guardadas) {
  const campos = guardadas?.campos;
  if (!Array.isArray(campos) || !Array.isArray(guardadas.datos)) return [];
  return guardadas.datos.map((d) => Object.fromEntries(campos.map((c, i) => [c, d[i]])));
}

/** null si Supabase no está configurado: el cliente queda solo con memoria. */
export function crearAlmacenPrecios({ supabase }) {
  if (!supabase?.configurado) return null;
  return {
    async leer() {
      const [fila] = (await supabase.select(TABLA_COPIA, { select: "filas,consultado_en", id: "eq.1" })) || [];
      return fila ? { filas: expandir(fila.filas), consultadoEn: fila.consultado_en } : null;
    },
    guardar: ({ filas, consultadoEn }) =>
      supabase.rpc("fruver_guardar_copia_precios", { p_filas: comprimir(filas), p_consultado_en: consultadoEn }),
  };
}
