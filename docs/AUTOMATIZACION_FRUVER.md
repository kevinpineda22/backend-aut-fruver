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

---

## 3. Cómo se calcula el sugerido

Fruver = grupo `40-LEGUMBRE` de SIESA. Para cada sede y cada producto:

| Paso | Qué es | Cálculo |
|---|---|---|
| 1 | Inventario hoy | Disponible en SIESA en este momento. |
| 2 | Se vende antes de recibir | Lo que falta vender hoy (según cómo vende la sede hora por hora) + la venta esperada de los días antes de la entrega. |
| 3 | Quedan al recibir | Inventario hoy − se vende antes de recibir. Nunca menos de 0. |
| 4 | Venta esperada | Promedio de lo vendido el **mismo día de la semana** en las últimas 6 semanas en que la sede abrió, sin el día más alto ni el más bajo. Se suma por cada día que cubre el pedido. |
| 5 | Merma | (comprado − vendido) ÷ comprado en los últimos 42 días, con tope de 25 %. |
| 6 | Hay que tener | Venta esperada ÷ (1 − merma). |
| 7 | **Sugerido** | Hay que tener − quedan al recibir, nunca negativo. Se redondea hacia arriba desde 0,2. |

Casos especiales:

- **Se arma en tienda** (paquetes, bandejas): si se vende más de 1,5 veces lo que se compra con ese código, tiene sugerido por sede pero **no suma a la compra**.
- **Inventario no leído:** el producto sale "Sin dato", nunca en 0. Si falla más del 20 % de los productos, el sistema avisa en vez de calcular.

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

---

## 5. Permisos

| Permiso (asignado en Usuarios) | Qué abre |
|---|---|
| Automatización Fruver (todo) — `/automatizacion-fruver` | Las tres secciones. |
| Sugerido por sede (líder) — `/automatizacion-fruver/sugerido` | Ver el sugerido y enviar el pedido. Para los líderes de sede. |
| Compra consolidada — `/automatizacion-fruver/pedidos` | Compra. |
| Seguimiento del sugerido — `/automatizacion-fruver/seguimiento` | Seguimiento. |

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
| Seguimiento contra la venta real | Hoy compara lo pedido con lo sugerido. Falta comparar los dos con lo que se vendió el día de la entrega: ¿quién acertó más? |

**Limpieza opcional:** las tablas del pedido con QR de la primera versión (`fruver_sedes`, `fruver_pedidos`, …) ya no se usan. `sql/quitar_pedidos_sede.sql` las borra (revisar antes: borra datos). No toca las tablas nuevas.

**Hallazgo aparte:** el módulo de Compras de la Analítica cuenta solo documentos `CEA`, y el ~29 % de la compra de fruver entra por `DSE`. Ese módulo sub-cuenta el fruver.

---

## 7. Dónde está cada cosa

| Pieza | Ubicación |
|---|---|
| Backend | `BACKEND/automatizacion-fruver` → GitHub `kevinpineda22/backend-aut-fruver` → Vercel `backend-aut-fruver` |
| Front | `Pagina-web_React/src/pages/AutomatizacionFruver/` (rama `Johan`): `sugerido/`, `pedidos/`, `seguimiento/` |
| Pedidos enviados | Supabase de la intranet, `fruver_envios` y `fruver_envio_lineas` |
| Ventas y compras | Réplica de SIESA en Postgres (`merkahorro_siesa`), solo lectura |
| Inventario | SIESA en vivo, consulta estándar `API_v2_Inventarios_InvFecha` |
| Detalle técnico | `README.md` de este repo |
