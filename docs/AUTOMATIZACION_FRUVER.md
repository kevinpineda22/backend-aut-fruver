# Automatización Fruver — qué se pidió, qué se construyó y qué falta

Sistema para que cada sede pida su fruver con una **cantidad sugerida** por el sistema, el líder la ajuste si no está de acuerdo, y compras vea la **compra consolidada**. Todo queda registrado para medir después si el sugerido mejora el resultado.

**Estado al 2026-11-05:** backend en producción y verificado; front subido a la rama `Johan` (falta el build y deploy a merkahorro.com).

---

## 1. Lo pedido contra lo entregado

| # | Lo que se pidió | Estado | Cómo quedó |
|---|---|---|---|
| 1 | Un sugerido de compra para fruver | ✅ Hecho | Sugerido por sede y producto, con venta esperada, merma real e inventario en vivo de SIESA (§3). |
| 2 | Un módulo nuevo llamado "Automatización Fruver", con "Pedidos" como primera sección | ✅ Hecho | Sistema con tres secciones: Pedido de sede, Compra, Sedes y QR (§2). |
| 3 | Que **no** sea un módulo de Power BI: sistema aparte, ruta nueva | ✅ Hecho | Ruta propia `/automatizacion-fruver`, con su menú. No aparece en la Analítica. |
| 4 | Usar el mismo frontend del panel de Power BI | ✅ Hecho | Mismo armazón (riel morado, hoja blanca) y mismas piezas visuales (métricas, paneles, tablas). |
| 5 | Backend aparte | ✅ Hecho | Repo `kevinpineda22/backend-aut-fruver`, desplegado en `https://backend-aut-fruver.vercel.app`. |
| 6 | Sugeridos de compra **de cada sede**, con cantidades, teniendo en cuenta lo que cada tienda ya tiene acumulado (inventario) | ✅ Hecho | Cada sede tiene su sugerido, que descuenta su inventario y lo que va a vender antes de recibir. |
| 7 | QR por sede: el líder lo escanea y se le abre su sede con sus productos | ✅ Hecho | Adhesivo por sede; con la cámara del celular abre el pedido de esa sede (§2.1). |
| 8 | El sistema sugiere; si el líder no está de acuerdo, digita a mano | ✅ Hecho | La cantidad viene precargada con el sugerido; el líder la cambia y puede dar un motivo. |
| 9 | Trazabilidad | ✅ Hecho | Cada renglón guarda sugerido, lo pedido, quién, cuándo, motivo y los datos del cálculo; cada cambio queda como evento (§4). |
| 10 | Analítica: si los sugeridos mejoran la venta con el tiempo, si el líder pide a mano o usa el sugerido | ⏳ Pendiente | **Los datos ya se guardan** para poder medirlo. Falta la pantalla, que necesita unas semanas de pedidos reales (§6). |

---

## 2. Funcionalidades

Ruta: `https://merkahorro.com/automatizacion-fruver`. Cada sección tiene su propio permiso (§5).

### 2.1 Pedido de sede — el líder

1. **Entra con el QR.** El líder escanea el adhesivo de su sede con la cámara del celular, o desde la página. El sistema verifica el código y muestra la sede.
2. **Abre el pedido.** Elige la fecha de entrega (por defecto, mañana) y cuántos días cubre (1 a 4). La primera vez se calcula el sugerido; desde ese momento queda **fijo** para ese pedido.
3. **Revisa y ajusta.** Cada producto muestra:
   - el sugerido;
   - la venta esperada y lo que hay hoy;
   - el campo "Pedir", que arranca con el sugerido y acepta decimales con coma ("12,5").

   Si cambia la cantidad, el renglón se marca **"Cambiado a mano"**: puede elegir un motivo (opcional) o volver al sugerido con un botón. Cada cambio se guarda en el momento.
4. **Envía.** Una confirmación resume cuántos productos pide y cuántos cambió a mano. Enviado, el pedido queda cerrado.

Extras: buscar producto, ver "solo cambiados", y un resumen (productos a pedir, cambiados a mano, valor estimado). Si el líder vuelve a abrir el mismo pedido, lo encuentra como lo dejó, sin esperar un recálculo.

### 2.2 Compra — compras

- **Consolidado:** por producto, la venta esperada, el pedido de las tiendas, el inventario del acopio (PV009), cuánto **comprar** y el valor estimado.
- **Pedido de tiendas** = lo que pidió cada líder que **ya envió** + el sugerido de las sedes que todavía no.
- **Comprar** = pedido de tiendas − inventario del acopio.
- **Estado por sede:** "Sin abrir", "En curso" o "Enviado" (con quién y a qué hora).
- **Detalle por producto:** al tocarlo se ve cada sede, con "pidió el líder · sugerido X" cuando corresponde.
- **Vista de una sede:** su tabla con venta esperada, inventario, lo que se vende antes de recibir, merma, sugerido y lo que pidió el líder.
- **Descargar Excel** de la vista actual.

### 2.3 Sedes y QR — administración

- Un adhesivo por sede, listo para **imprimir** (solo salen los adhesivos).
- **Cambiar código:** si un adhesivo se pierde o se copia, el viejo deja de funcionar en el acto. Hay que imprimir y pegar el nuevo.
- Los adhesivos se imprimen **desde merkahorro.com**: el QR lleva la dirección del sitio desde donde se imprime.

---

## 3. Cómo se calcula el sugerido

Fruver = grupo `40-LEGUMBRE` de SIESA. Para cada sede y cada producto:

| Paso | Cálculo |
|---|---|
| Venta esperada de un día | Promedio de lo vendido el **mismo día de la semana** en las últimas 6 semanas en que la sede abrió, sin el día más alto ni el más bajo. El jueves de fruver vende ~2×: no se compara con un martes. |
| Inventario al recibir | Disponible en SIESA ahora − lo que falta vender hoy (según cómo vende la sede hora por hora) − la venta de los días antes de la entrega. |
| Merma | (comprado − vendido) ÷ comprado en los últimos 42 días, con tope de 25 %. |
| Necesidad | Venta esperada de los días a cubrir ÷ (1 − merma). Para vender 100 kg con 10 % de merma hay que comprar 111 kg. |
| Sugerido | Necesidad − inventario al recibir, nunca negativo. Redondeo de Traslados: sube desde ,2. |

Casos especiales:

- **Se arma en tienda** (paquetes de verduras, bandejas): si se vende más de 1,5 veces lo que se compra con ese código, el producto tiene pedido por sede pero **no suma a la compra**.
- **Inventario no leído:** el producto queda sin sugerido, nunca en 0. Si falla más del 20 % de los productos, el sistema avisa en vez de calcular, para no pedir de más en todas las sedes.

---

## 4. Trazabilidad

Tablas en el Supabase de la intranet (`sql/001_pedidos_sede.sql`):

| Tabla | Qué guarda |
|---|---|
| `fruver_sedes` | Cada sede y el código de su QR (y quién lo cambió por última vez). |
| `fruver_pedidos` | El pedido de una sede para una fecha de entrega: estado, quién lo abrió, quién lo envió y cuándo, y con qué datos se calculó. |
| `fruver_pedido_lineas` | Un renglón por producto: **sugerido**, **cantidad pedida**, origen (`sugerido` o `manual`), motivo, y los datos del cálculo (venta esperada, inventario, merma, precio). |
| `fruver_pedido_eventos` | Cada acción: abrir, cada cambio de cantidad (antes → después, con motivo) y enviar, con usuario y hora. |

Garantías:

- Los cambios pasan por **funciones de la base**, que escriben el cambio y su evento en la misma transacción. No hay forma de cambiar una cantidad sin dejar rastro.
- El sugerido se guarda **con los datos con que se calculó**. Si mañana cambia la fórmula, los pedidos viejos se siguen evaluando con lo que el líder vio ese día.

---

## 5. Permisos y seguridad

| Permiso (asignado en Usuarios) | Qué abre |
|---|---|
| Automatización Fruver (todo) — `/automatizacion-fruver` | Las tres secciones. Para compras y administración. |
| Pedido de sede (líder) — `/automatizacion-fruver/pedido-sede` | Solo el pedido. Para los líderes de sede. |
| Compra consolidada — `/automatizacion-fruver/pedidos` | Solo la compra. |
| Sedes y QR — `/automatizacion-fruver/sedes` | Solo los adhesivos. |

- El **admin no tiene pase directo**: también hay que asignarle la ruta, igual que en el resto de la intranet fuera de la Analítica.
- Cada escritura del líder **vuelve a pedir el QR** y verifica que el pedido sea de esa sede: no se puede tocar el pedido de otra.
- **Sin usuario identificado no se escribe nada**, en ningún modo.
- Las tablas tienen RLS sin políticas: solo el backend, con la clave secreta, puede leerlas y escribirlas.

---

## 6. Lo que falta

| Pendiente | Por qué importa |
|---|---|
| Build y deploy del front a merkahorro.com | Las pantallas están en la rama `Johan`, todavía no publicadas. |
| Asignar permisos e imprimir los adhesivos | Sin eso nadie entra ni hay QR en las sedes. |
| Pasar `FRUVER_AUTH` de `report` a `enforce` en Vercel | Hoy la compra responde sin sesión (modo de transición). Hacerlo cuando el front esté publicado y los usuarios entren bien. |
| **Analítica del sugerido** (pedido #10) | Uso del sugerido por sede y líder, acierto del sugerido contra lo pedido a mano frente a la venta real del día de entrega, merma en el tiempo. Necesita unas semanas de pedidos. |
| Hora de corte del pedido | A la 1 p. m. el acopio ya tenía la compra del día y casi todo salía "Comprar 0". Hay que acordar con compras a qué hora se arma el pedido. |
| Villahermosa (`00201`) | Compra fruver por su cuenta y guarda mucho inventario. Hoy se trata como una sede más que se abastece del acopio: confirmar con compras. |
| Reabrir un pedido enviado | Hoy enviado = cerrado. Si un líder se equivoca, no hay forma de corregir. |
| Recalcular el sugerido de un pedido en curso | Queda fijo desde que se abre; si se abre temprano, el inventario puede cambiar en el día. |
| Festivos | Un festivo no se distingue de un día normal en el cálculo. |
| Mensaje de "Sedes y QR" sin sesión | Dice "…para hacer el pedido de su sede"; corregir el texto. |

**Hallazgo aparte:** el módulo de Compras de la Analítica cuenta solo documentos `CEA`, y el ~29 % de la compra de fruver entra por `DSE` (documento soporte). Ese módulo sub-cuenta el fruver.

---

## 7. Dónde está cada cosa

| Pieza | Ubicación |
|---|---|
| Backend | `BACKEND/automatizacion-fruver` → GitHub `kevinpineda22/backend-aut-fruver` → Vercel `backend-aut-fruver` |
| Front | `Pagina-web_React/src/pages/AutomatizacionFruver/` (rama `Johan`) |
| Base de pedidos | Supabase de la intranet, tablas `fruver_*` |
| Ventas y compras | Réplica de SIESA en Postgres (`merkahorro_siesa`), solo lectura |
| Inventario | SIESA en vivo, consulta estándar `API_v2_Inventarios_InvFecha` |
| Detalle técnico | `README.md` de este repo |

**Tiempos medidos en producción:** la compra tarda 5,4 s la primera vez y ~1,5 s después (el inventario se guarda 2 minutos).

**Pruebas:** 75 tests en el backend y 81 en el front. El SQL se probó dentro de una transacción con ROLLBACK, y el flujo completo del líder en el navegador contra una base de prueba.
