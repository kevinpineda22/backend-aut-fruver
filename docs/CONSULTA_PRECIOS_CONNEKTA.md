# Consulta de precios de fruver en Connekta

Alimenta la sección **Precios** (etiquetas de góndola, migración de
`gestionFruver/cambioPrecios`). Trae, para cada producto de fruver, los últimos
precios de cada lista y unidad de medida, para saber el vigente, el anterior y
los programados a futuro.

- **Nombre en Connekta:** `merkahorro_fruver_precios` (registrada; es el valor
  por defecto del backend)
- **Credenciales:** las mismas `CONNI_KEY` / `CONNI_TOKEN` del inventario
  (verificado 2026-11-11: autoriza esta consulta). Opcionales:
  `FRUVER_PRECIOS_CONSULTA` si cambia el nombre, `FRUVER_PRECIOS_CONNI_KEY` /
  `_TOKEN` si algún día tiene un par propio.

Connekta no recibe SQL por HTTP: solo acepta el *nombre* de una consulta
registrada. Esta copia sirve para leerla sin entrar a SIESA; **la fuente de
verdad es la registrada**. Si se cambia allá, actualizar esta copia en el mismo
cambio.

---

## Por qué una consulta propia

La consulta estándar `API_v2_ItemsPrecios` devuelve **todo el historial** de
`t126` desde 2021. Medido el 2026-11-11: el ítem 5098 ocupa **44 páginas de 100**
(el máximo que deja; con más responde "excede el permitido"), unos 18 s
recorriéndolas de a una. No dice cuántas páginas hay y ordena por lista, no por
fecha. Con cientos de productos no da para tiempo real. La réplica de Postgres no
tiene tablas de precios.

## Lo que el backend da por hecho

1. **Fruver = plan `001` (GRUPO), criterio mayor `40`** ("40-LEGUMBRE" en la
   réplica). Son 547 ítems (unos 326 activos). Un ítem que se mueva de grupo sale
   solo de las etiquetas.
2. **`Orden` 1 = la fecha de activación más reciente, NO el vigente.** Si hay un
   precio programado para mañana, ese es el 1. El backend decide el vigente con
   la fecha de **Colombia** (`hoyEnColombia()`), no la consulta: el reloj del
   servidor de SIESA puede estar en UTC, y después de las 7:00 p. m. "hoy" ya
   sería mañana y se imprimiría un precio que todavía no rige.
   - Vigente = la fila con mayor `FechaActivacion` ≤ hoy, sin `FechaInactivacion` ≤ hoy.
   - Anterior = la siguiente.
   - "Cambió hoy" = vigente con `FechaActivacion` = hoy.
3. **Se traen 3 filas por (lista, ítem, U.M.).** Alcanzan para vigente, anterior
   y un programado. Si hay **dos** precios programados, el anterior se pierde: el
   backend avisa que no hay anterior y no lo inventa.
4. **Un ítem tiene un precio POR unidad de medida** (KL, UND, P15…). La etiqueta
   usa la unidad de inventario (`UMInventario`). Un KL se imprime como
   "PRECIO POR 500G".
5. **`Separata`** (plan `SP`) dice si el producto está en una separata o promoción
   (ej. `CAFR-CARNES Y FRUVER`). Es solo para avisar en pantalla; el precio de la
   promoción, si existe, viene en su propia lista.
6. **Listas de las tiendas:** P01 Copacabana Plaza, P02 Villahermosa,
   P03 Girardota Parque, P04 Girardota Llano, P06 Las Vegas, P07 Barbosa,
   P08 San Juan. La consulta trae TODAS las listas (también las que no son de
   tiendas, como P90) para no esconder ninguna. El backend filtra la de la sede.

## Reglas de Connekta que no se pueden tocar

- **Sin `;` y sin comentarios** en el SQL que se pega (con `;` da 500).
- Hay que terminar con **`ORDER BY ... OFFSET 0 ROWS`**. El generador envuelve todo
  en `SELECT * FROM (...)`: sin `OFFSET`, SQL Server rechaza el `ORDER BY`, y sin
  orden estable la paginación repite y saltea filas.
- Un 401 de "verifique si tiene permisos asignados a la consulta dinámica"
  significa que el par de credenciales no tiene asignada ESA consulta (el par
  común no tiene, por ejemplo, `API_v2_ItemsPrecios`).
- `t126` **no tiene `f126_ind_tipo_precio`** (Connekta: "Invalid column name"):
  la primera versión la pedía y daba 500.
- El total de páginas viene como `total_páginas`, **con tilde**.

## Verificado con la consulta registrada (2026-11-11)

- La llave **`f126_rowid_item`** existe y une bien con `t120`.
- `f125_id_criterio_mayor = '40'` funciona sin `LTRIM/RTRIM`: 484 ítems con
  precio, 9.462 filas, unos 13 s las 10 páginas.
- **Sin criterios duplicados**: ninguna (lista, ítem, U.M.) trae dos filas iguales.
- Hay precios de $1.000.000 (ej. 178492, 4685): son ítems **inactivos**, y el
  backend los saca con la réplica (`indestado = '1'`).

---

## La consulta

Para pegar en el generador (sin los ``` del bloque):

```sql
SELECT
    p.Cia,
    p.Item,
    p.Referencia,
    p.Descripcion,
    p.UMInventario,
    p.Subgrupo,
    p.Separata,
    p.Lista,
    p.UM,
    p.Precio,
    p.FechaActivacion,
    p.FechaInactivacion,
    p.FechaActualizacion,
    p.Orden
FROM (
    SELECT
        i.f120_id_cia AS Cia,
        i.f120_id AS Item,
        i.f120_referencia AS Referencia,
        i.f120_descripcion AS Descripcion,
        i.f120_id_unidad_inventario AS UMInventario,
        sub.f106_descripcion AS Subgrupo,
        sep.f106_descripcion AS Separata,
        pr.f126_id_lista_precio AS Lista,
        pr.f126_id_unidad_medida AS UM,
        pr.f126_precio AS Precio,
        pr.f126_fecha_activacion AS FechaActivacion,
        pr.f126_fecha_inactivacion AS FechaInactivacion,
        pr.f126_fecha_ts_actualizacion AS FechaActualizacion,
        ROW_NUMBER() OVER (
            PARTITION BY pr.f126_id_cia, pr.f126_id_lista_precio, pr.f126_rowid_item, pr.f126_id_unidad_medida
            ORDER BY pr.f126_fecha_activacion DESC, pr.f126_fecha_ts_actualizacion DESC
        ) AS Orden
    FROM dbo.t126_mc_items_precios AS pr
    INNER JOIN dbo.t120_mc_items AS i
        ON i.f120_id_cia = pr.f126_id_cia
        AND i.f120_rowid = pr.f126_rowid_item
    INNER JOIN dbo.t125_mc_items_criterios AS grp
        ON grp.f125_id_cia = i.f120_id_cia
        AND grp.f125_rowid_item = i.f120_rowid
        AND grp.f125_id_plan = '001'
        AND grp.f125_id_criterio_mayor = '40'
    LEFT JOIN dbo.t125_mc_items_criterios AS critSub
        ON critSub.f125_id_cia = i.f120_id_cia
        AND critSub.f125_rowid_item = i.f120_rowid
        AND critSub.f125_id_plan = '002'
    LEFT JOIN dbo.t106_mc_criterios_item_mayores AS sub
        ON sub.f106_id_cia = critSub.f125_id_cia
        AND sub.f106_id_plan = critSub.f125_id_plan
        AND sub.f106_id = critSub.f125_id_criterio_mayor
    LEFT JOIN dbo.t125_mc_items_criterios AS critSep
        ON critSep.f125_id_cia = i.f120_id_cia
        AND critSep.f125_rowid_item = i.f120_rowid
        AND critSep.f125_id_plan = 'SP'
    LEFT JOIN dbo.t106_mc_criterios_item_mayores AS sep
        ON sep.f106_id_cia = critSep.f125_id_cia
        AND sep.f106_id_plan = critSep.f125_id_plan
        AND sep.f106_id = critSep.f125_id_criterio_mayor
    WHERE pr.f126_id_cia = 1
) AS p
WHERE p.Orden <= 3
ORDER BY p.Item, p.Lista, p.UM, p.Orden
OFFSET 0 ROWS
```

## Volumen esperado

547 ítems × unas 9 listas × 1–2 unidades × 3 filas ≈ **15.000 filas**: unas 15
páginas de 1000. El backend las pide en paralelo y las guarda en caché unos
minutos. Si al registrarla trae muchas más, revisar el punto de criterios
duplicados.
