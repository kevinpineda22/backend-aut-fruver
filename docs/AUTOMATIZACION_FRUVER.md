# Automatización Fruver — qué se pidió, qué se construyó y qué falta

Cada sede revisa **cuánto pedir de cada producto de fruver** (el sugerido, con su inventario y la cuenta que lleva a ese número), lo ajusta y **envía su pedido**. Compras recibe los pedidos en **Compra**, y **Seguimiento** muestra si las sedes siguieron el sugerido o lo cambiaron.

**Estado al 2026-11-06:** construido y probado en local. Falta correr el SQL en Supabase, subir backend y front, y asignar permisos (§6).

---

## 1. Lo pedido contra lo entregado

| # | Lo que se pidió | Estado | Cómo quedó |
|---|---|---|---|
| 1 | Un sugerido de compra para fruver | ✅ Hecho | Por sede y producto, con venta esperada, merma real e inventario en vivo de SIESA (§3). |
| 2 | Un sistema nuevo, "Automatización Fruver", fuera de Power BI, con ruta propia | ✅ Hecho | Ruta `/automatizacion-fruver`. Tres secciones: Sugerido, Compra y Seguimiento (§2). |
| 3 | Mismo frontend del panel de Power BI | ✅ Hecho | Mismo armazón (riel morado, hoja blanca) y mismas piezas visuales. |
| 4 | Backend aparte | ✅ Hecho | Repo `kevinpineda22/backend-aut-fruver`, desplegado en `https://backend-aut-fruver.vercel.app`. |
| 5 | Sencillo y fácil de leer: el inventario de cada sede y el sugerido | ✅ Hecho | Por producto: inventario hoy, venta esperada, sugerido y lo que se pide. El resto aparece al tocar el producto. |
| 6 | Mostrar cómo se calcula el sugerido, en pantalla y en el código | ✅ Hecho | Recuadro "¿Cómo se calcula?", la cuenta de cada producto, `src/pedidos/reglas.js` y el `README.md` (§3). |
| 7 | Quitar los QR por completo | ✅ Hecho | Sin adhesivos ni escáner. El líder elige su sede en una lista. |
| 8 | El sugerido se puede cambiar; se nota con color que no es el inicial, y hay botón para volver al sugerido | ✅ Hecho | El renglón cambiado se pinta en **ámbar** y muestra "Volver al sugerido (X)". |
| 9 | Botón de enviar al final de la lista; agrupa todo lo pedido | ✅ Hecho | Al final: resumen (productos, cambiados, quitados, agregados) y **Enviar pedido**, con confirmación. |
| 10 | Quitar un producto del pedido, de forma muy clara; agregar los que el sistema no sugirió | ✅ Hecho | "Quitar del pedido" (queda gris y tachado, con "Volver a pedir"). "Agregar" en los no sugeridos (azul), y "¿Falta un producto?" para los que la sede no vende. |
| 11 | Lo enviado se guarda en el módulo Compra | ✅ Hecho | Compra suma lo que pidió cada sede que envió y descuenta el acopio. Muestra qué sedes enviaron y cuáles no. |
| 12 | Seguimiento: si el líder pidió lo sugerido, si cambió, cuánto, si quitó o agregó | ✅ Hecho | Sección **Seguimiento**: por sede y por pedido, con el detalle de cada producto (§2.3). |
| 13 | Usar después los QR que ya tienen las tiendas | ⏳ Pendiente | Falta saber qué lleva ese QR (§6). |

---

## 2. Funcionalidades

Ruta: `https://merkahorro.com/automatizacion-fruver`. Cada sección tiene su permiso (§5).

**Horario:** Sugerido se publica cada día a las **4:00 p. m.** (hora de Colombia), porque durante el día la base sigue cambiando. Antes de esa hora muestra un aviso y no se puede enviar pedidos. Compra y Seguimiento están disponibles todo el día.

### 2.1 Sugerido — el líder de sede

1. **Elige su sede** (el navegador la recuerda), cuándo llega el pedido y cuántos días cubre.
2. **Revisa la lista.** Por producto: inventario hoy, venta esperada, sugerido y el campo **Pedir**, que arranca con el sugerido. Primero salen los que hay que pedir.
3. **Ajusta.** Cada renglón cambia de aspecto según lo que hizo el líder:

   | Lo que hizo | Cómo se ve | Para deshacer |
   |---|---|---|
   | Nada | Normal, va lo sugerido | — |
   | Cambió la cantidad | **Ámbar** | "Volver al sugerido (X)" |
   | Quitó el producto | **Gris y tachado**, "No se pide" | "Volver a pedir X" |
   | Agregó uno no sugerido | **Azul**, "Agregado por usted" | "Quitar del pedido" |
   | Agregó y no escribió cantidad | **Rojo**, "Escriba la cantidad" | Escribirla o quitarlo |

   Para pedir un producto que la sede no vende: "¿Falta un producto?" al final de la lista.
4. **Envía.** Al final: el resumen y **Enviar pedido**. Pide confirmar ("Después de enviarlo no se puede cambiar"). No deja enviar si falta una cantidad o si no hay nada para pedir.

Extras: buscar, ver "Todos / En el pedido / Mis cambios", y la cuenta de cada producto al tocar su nombre. Lo que el líder cambia queda guardado en su navegador hasta que envía: si cierra la página, al volver lo encuentra igual.

Ya enviado, la sección muestra el pedido en solo lectura: quién lo envió, a qué hora, y cada producto con su cambio.

### 2.2 Compra — compras

- **Pedidos de las sedes:** cuáles enviaron (quién y a qué hora) y cuáles no.
- **Consolidado:** por producto, la venta esperada, el **pedido de tiendas** (suma de lo que pidieron las sedes que enviaron), el inventario del acopio (PV009), cuánto **comprar** y el valor estimado. Las sedes que no enviaron no suman.
- **Detalle por producto:** lo que pidió cada sede, si fue como se sugirió, cambiado o agregado, y el sugerido.
- **Vista de una sede:** todas las columnas del cálculo más "Pidió la sede". **Descargar Excel** con sugerido y pedido por sede.

### 2.3 Seguimiento

Filtros: rango de fechas de entrega y sede.

- **Resumen:** porcentaje **igual al sugerido**, pedidos enviados, cambios (cambiados, quitados, agregados) y **diferencia en plata**.
- **Por sede:** las mismas medidas, una fila por sede. Se ve qué líder sigue el sugerido y cuál lo cambia mucho.
- **Pedidos:** uno por fila. Al tocarlo, cada producto con sugerido, lo pedido, la diferencia (en unidades y %) y el tipo de cambio. Los cambios salen primero, el de más plata arriba.

Cómo se mide:
- **Igual al sugerido** = de los productos que sugirió el sistema, cuántos se pidieron con la misma cantidad. Lo agregado no entra (no había sugerido que seguir).
- **Diferencia en plata** = Σ (pedido − sugerido) × último precio de compra. Positiva: se pidió más que lo sugerido. Negativa: menos.

### 2.4 Asertividad

¿Qué tan fiable es el sugerido? Día por día, todas las sedes juntas: lo que el sistema esperaba vender contra lo que se vendió. Rediseñada el 20-nov-2026 (antes tenía gráficos y cuatro niveles que no se entendían).

Filtro: última semana, 2 semanas (por defecto) o 4 semanas.

- **Arriba, tres números:** el acierto del período («de cada $100 vendidos, el sistema previó bien $X»), si espera vender de más o de menos, y el producto que más falla (el de más plata errada entre los que aciertan menos de 80 %).
- **Día por día:** día · el sistema esperaba vender · se vendió · diferencia · acierto. Al tocar un día, producto por producto, del que más falló al que menos (10 primero; «Ver todos» para el resto).
- **Dónde se equivoca más plata:** los 10 productos del período con más plata errada.
- Acierto en verde desde 80 %, ámbar desde 70 %, rojo debajo.
- Si la venta de alguna sede todavía no llegó (suele pasar con el último día), el día dice «Faltan datos de N sedes» y se compara solo con las que llegaron.

Cada día se recalcula con la fórmula del sugerido y solo con lo que había antes de ese día: **da lo mismo que se mostró** (comprobado contra la foto guardada del 18-nov: 178 de 178 productos iguales). Límite: un día de agotado la venta es menor que la demanda.

Medido el 20-nov-2026 (réplica hasta el 19): acierto **77 %** en 2 semanas (esperó 5 % de más), **73 %** en 4 semanas (6 % de menos). Los jueves aciertan menos (65–77 %): venden 2–3× más y varían más.

### 2.5 Cumplimiento de proveedores (nivel de servicio de entrega)

De lo que se le compró a cada proveedor, ¿cuánto llegó? Compara las **compras** de Operaciones (qué se le pidió a quién) con los **recibos** (qué llegó). Filtro: rango de fechas de entrega (por defecto, los últimos 30 días hasta ayer).

- **Cumplimiento** = de cada $100 comprados, cuántos llegaron. Por renglón (entrega × producto × proveedor) cuenta lo menor entre recibido y comprado: **lo que llega de más no compensa lo que faltó** y se muestra aparte («Llegó de más»). Ponderado en plata. Meta en pantalla: 95 % (verde ≥ 95 %, ámbar ≥ 85 %, rojo debajo).
- **Renglón completo** = llegó al menos el 98 % de lo comprado (tolerancia de báscula).
- Por proveedor (al tocarlo, por producto), por entrega y renglón por renglón (filtro por proveedor y «solo los que no llegaron completos»).

Reglas:

- Solo entregas **ya pasadas** y con **al menos un recibo registrado**. Una entrega con compras y sin ningún recibo no se mide (se avisa): no se registró el recibo, no es que no llegó nada.
- En una entrega con recibos, un producto comprado sin recibo cuenta como **no entregado** («Sin recibo»).
- Recibo por compra → el proveedor de esa compra. Recibo a ciegas **con proveedor** → ese proveedor. Recibo a ciegas **sin proveedor** → si a ese producto se le compró a un solo proveedor ese día, a él; si a varios, **no se puede atribuir** y queda fuera (se avisa). Por eso el recibo a ciegas ahora acepta el proveedor (ver §4).
- Costo para ponderar: el de la compra → el promedio del producto en el período → el último costo de compra en SIESA (90 días). Hoy casi todas las compras quedan con costo pendiente, así que el respaldo es la regla; la pantalla avisa cuántos renglones usan costo estimado.

Primera medición (18 nov 2026): 2 entregas, 5 renglones, 58 % de cumplimiento — el 12 nov solo se registró el recibo de la papa. Con tan pocas operaciones el número todavía no dice nada de los proveedores.

---

## 3. Cómo se calcula el sugerido

Fruver = grupo `40-LEGUMBRE` de SIESA. Para cada sede y cada producto:

| Paso | Qué es | Cálculo |
|---|---|---|
| 1 | Inventario hoy | Disponible en SIESA en este momento. |
| 2 | Se vende antes de recibir | Lo que falta vender hoy (según cómo vende la sede hora por hora) + la venta esperada de los días antes de la entrega. |
| 3 | Quedan al recibir | Inventario hoy − se vende antes de recibir. Nunca menos de 0. |
| 4 | Venta esperada | Promedio de lo vendido el **mismo día de la semana** en las últimas 6 semanas en que la sede abrió, sin el día más alto ni el más bajo, **ajustado por la quincena** (ver abajo). Se suma por cada día que cubre el pedido. |
| 5 | Merma | (comprado − vendido) ÷ comprado en los últimos 42 días, con tope de 25 %. |
| 6 | Hay que tener | Venta esperada ÷ (1 − merma). |
| 7 | **Sugerido** | Hay que tener − quedan al recibir, nunca negativo. Se redondea hacia arriba desde 0,2. |

Casos especiales:

- **Se arma en tienda** (paquetes, bandejas): si se vende más de 1,5 veces lo que se compra con ese código, tiene sugerido por sede pero **no suma a la compra**.
- **Inventario no leído:** el producto sale "Sin dato", nunca en 0. Si falla más del 20 % de los productos, el sistema avisa en vez de calcular.

**Ajuste por quincena (2026-11-18).** Los días siguientes al pago (15 y 30) fruver vende 20–28 % más, y a mitad de quincena ~25 % menos. El promedio de 6 semanas mezclaba las dos fases y se equivocaba para los dos lados. Ahora el sistema aprende ese patrón con las últimas 12 semanas de venta y lo aplica al día que se pronostica.

¿Qué tan fiable es? **La fuente es la sección Asertividad del panel** (se recalcula con cada venta nueva). Foto del 18 nov 2026, 16 semanas (29 jul → 17 nov), error ponderado en plata:

| Nivel | Antes | Con quincena | Repetir la semana pasada |
|---|---|---|---|
| Sede × producto × día | 41,0 % | 36,8 % | ~60 % |
| Consolidado × semana (la compra) | 20,6 % | 14,4 % | ~38 % |

Límites: no corrige festivos; empeora la víspera del pago; la venta real subestima la demanda los días de agotado; mide el pronóstico, no el pedido (el inventario histórico por bodega no está en la réplica).

Dónde vive: `src/pedidos/reglas.js` y `src/pedidos/sugerido.js` en el backend; `sugerido/sugeridoVista.js` en el front arma la cuenta que se muestra.

---

## 4. Lo que se guarda

Tablas en el Supabase de la intranet (`sql/002_pedidos_enviados.sql`):

| Tabla | Qué guarda |
|---|---|
| `fruver_envios` | Un pedido por sede y fecha de entrega: días que cubre, quién lo envió y cuándo, y con qué datos se calculó el sugerido. |
| `fruver_envio_lineas` | Un renglón por producto: sugerido que vio el líder, cantidad pedida, **origen** (`sugerido`, `modificado`, `quitado`, `agregado`) y los datos del cálculo (inventario, venta esperada, merma, precio). |

- Encabezado y renglones se guardan en **una transacción** (`fruver_registrar_envio`): nunca queda un pedido a medias.
- Una sede envía **una vez** por fecha de entrega.
- RLS sin políticas: solo el backend, con la clave secreta, lee y escribe.

**Foto diaria del sugerido de compra (2026-11-18, `sql/005_fotos_sugerido.sql`).** Todos los días, poco después de la publicación de las 4:00 p. m., el sistema guarda el sugerido de compra de la entrega de mañana (1 día): por producto, cuánto recomendó comprar y con qué datos (venta esperada, merma, inventario del acopio y de cada sede). Tablas `fruver_sugerido_fotos` y `fruver_sugerido_foto_items`. Es la base para medir **sugerido contra comprado contra vendido** y para pulir la fórmula. Una foto por día; la primera vale.

**Recibo a ciegas con proveedor (2026-11-18, compatible hacia atrás).** `POST /api/fruver/operaciones/recibo` con `tipo: "recibo_ciego"` acepta en cada línea un `nit` **opcional**:

```json
{ "tipo": "recibo_ciego", "solicitud": "<uuid>", "version": 5,
  "lineas": [ { "solicitud": "<uuid>", "item": "5167", "nit": "43168338", "cantidad": 9.5 },
              { "solicitud": "<uuid>", "item": "5167", "nit": "98567962", "cantidad": 10 } ] }
```

- Sin `nit` funciona igual que antes (un front que no lo manda no se rompe).
- Con `nit`: tiene que existir una compra vigente de ese producto a ese proveedor en la entrega (si no, 400). El recibo se guarda con su `nit`.
- Repetido = mismo producto **y** mismo proveedor (el mismo producto de dos proveedores en un recibo es válido).
- La vista del recibo (`vistaRecibo`) trae, por producto, `proveedores: [{ nit, nombre }]` — **sin cantidades**, para que siga siendo a ciegas — y cada recibo trae su `nit` cuando se conoce.
- Para el front de Recibo (equipo de Kevin): mostrar el selector de proveedor cuando el producto tiene más de uno en `proveedores`; con uno solo, mandarlo sin preguntar.

---

## 5. Permisos

| Permiso (asignado en Usuarios) | Qué abre |
|---|---|
| Automatización Fruver (todo) — `/automatizacion-fruver` | Todas las secciones. |
| Sugerido por sede (líder) — `/automatizacion-fruver/sugerido` | Ver el sugerido y enviar el pedido. Para los líderes de sede. |
| Compra consolidada — `/automatizacion-fruver/pedidos` | Compra. |
| Seguimiento del sugerido — `/automatizacion-fruver/seguimiento` | Seguimiento. |
| Asertividad del sugerido — `/automatizacion-fruver/asertividad` | Asertividad. |
| Cumplimiento de proveedores Fruver — `/automatizacion-fruver/cumplimiento` | Cumplimiento. **Siempre exige sesión** (como Operaciones), aunque `FRUVER_AUTH` esté en `report`. |

- El **admin no tiene pase directo**: también hay que asignarle la ruta.
- Sin usuario identificado no se envía nada, en ningún modo.
- Hoy un líder puede elegir cualquier sede. Cuando se adapten los QR de las tiendas, el QR puede fijar la sede.

---

## 6. Lo que falta

| Pendiente | Por qué importa |
|---|---|
| Correr `sql/002_pedidos_enviados.sql` en el Supabase de la intranet | Sin las tablas, enviar falla y Compra sale sin pedidos (con aviso). |
| `SUPABASE_SERVICE_ROLE_KEY` en Vercel | La necesita el backend para guardar y leer los pedidos. |
| Subir backend y front, y asignar permisos | Las pantallas están en la rama `Johan`. |
| Pasar `FRUVER_AUTH` de `report` a `enforce` | Hoy el sugerido responde sin sesión (modo de transición). Enviar ya exige usuario. |
| Adaptar a los QR que ya tienen las tiendas | Saber qué lleva ese QR para que abra la sede correcta (y la fije). |
| Reabrir un pedido enviado | Hoy enviado = cerrado. Si un líder se equivoca, no hay forma de corregir. |
| Hora de corte | Acordar con compras hasta qué hora pueden enviar las sedes. |
| Villahermosa (`00201`) | Compra fruver por su cuenta: confirmar con compras si envía pedido. |
| Festivos | Un festivo no se distingue de un día normal en el cálculo. |
| Líder contra sistema, contra la venta real | Asertividad mide el pronóstico del sistema. Falta comparar lo que PIDIÓ el líder con lo que se vendió: ¿quién acertó más? |
| Correr `sql/005_fotos_sugerido.sql` y poner `CRON_SECRET` en Vercel | Sin las dos, la foto diaria del sugerido no se guarda. Cada día sin foto es un dato perdido para siempre. |
| Sección "Sugerido contra comprado" | Con unas semanas de fotos: lo que recomendó el sistema contra la compra real de SIESA y la venta real, por producto. |
| Proveedor en el front del recibo a ciegas | El backend ya lo acepta (§4). Sin él, un producto comprado a dos proveedores y recibido a ciegas no se puede medir en Cumplimiento. |
| Costo en la compra | Casi todas las compras quedan con costo pendiente; Cumplimiento pondera con el último costo de SIESA. |

**Limpieza opcional:** las tablas del pedido con QR de la primera versión (`fruver_sedes`, `fruver_pedidos`, …) ya no se usan. `sql/quitar_pedidos_sede.sql` las borra (revisar antes: borra datos). No toca las tablas nuevas.

**Hallazgo aparte:** el módulo de Compras de la Analítica cuenta solo documentos `CEA`, y el ~29 % de la compra de fruver entra por `DSE`. Ese módulo sub-cuenta el fruver.

---

## 7. Dónde está cada cosa

| Pieza | Ubicación |
|---|---|
| Backend | `BACKEND/automatizacion-fruver` → GitHub `kevinpineda22/backend-aut-fruver` → Vercel `backend-aut-fruver` |
| Front | `Pagina-web_React/src/pages/AutomatizacionFruver/` (rama `Johan`): `sugerido/`, `pedidos/`, `seguimiento/`, `asertividad/`, `cumplimiento/` |
| Pedidos enviados | Supabase de la intranet, `fruver_envios` y `fruver_envio_lineas` |
| Ventas y compras | Réplica de SIESA en Postgres (`merkahorro_siesa`), solo lectura |
| Inventario | SIESA en vivo, consulta estándar `API_v2_Inventarios_InvFecha` |
| Detalle técnico | `README.md` de este repo |
