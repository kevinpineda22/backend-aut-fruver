# Automatización Fruver — API

Backend de **Automatización Fruver**, un sistema propio de la intranet de Merkahorro (front: `Pagina-web_React/src/pages/AutomatizacionFruver/`, ruta `/automatizacion-fruver`). No es parte de la Analítica.

Express en Vercel, mismo patrón que `backend_analitica`.
- **Lee** la réplica de SIESA en Postgres y el inventario en vivo de SIESA (nunca escribe ahí).
- **Escribe** solo los pedidos que envían las sedes, en el Supabase de la intranet (tablas `fruver_envios` y `fruver_envio_lineas`, con la service role).

> Qué se pidió, qué se entregó y qué falta: [docs/AUTOMATIZACION_FRUVER.md](docs/AUTOMATIZACION_FRUVER.md).

## Secciones

Cada sección tiene su permiso (ruta del front). Quien tiene `/automatizacion-fruver` entra a todas; a un líder de sede se le asigna solo `/automatizacion-fruver/sugerido`.

| Sección | Para quién | Permiso | API |
|---|---|---|---|
| Sugerido | Líder de sede | `/automatizacion-fruver/sugerido` | `GET /api/fruver/sugerido?entrega&dias` · `GET /api/fruver/sugerido/envio?bodega&entrega` · `POST /api/fruver/sugerido/envio` |
| Compra | Compras | `/automatizacion-fruver/pedidos` | `GET /api/fruver/pedidos/sugerido?entrega&dias` |
| Seguimiento | Dirección / compras | `/automatizacion-fruver/seguimiento` | `GET /api/fruver/seguimiento?desde&hasta` |
| Asertividad | Dirección / compras | `/automatizacion-fruver/asertividad` | `GET /api/fruver/asertividad?dias` (7, 14 o 28; por defecto 14) |
| Cumplimiento | Dirección / compras | `/automatizacion-fruver/cumplimiento` (siempre `enforce`) | `GET /api/fruver/cumplimiento?desde&hasta` (por defecto, 30 días hasta ayer; máx. 92) |

## Pedido de la sede: cómo funciona

> **Se publica a las 4:00 p. m. (Colombia).** Antes de esa hora, Sugerido responde `{ espera: true, publicaA }` sin calcular y `POST /sugerido/envio` responde 409. La regla vive en el backend (`HORA_PUBLICACION`, `src/pedidos/reglas.js`). Compra y Seguimiento están abiertas todo el día.

1. El líder elige su sede y ve el sugerido de cada producto.
2. Cambia la cantidad que no le parece, quita lo que no quiere pedir y agrega lo que el sistema no sugirió. Mientras tanto, lo que cambia se guarda en su navegador.
3. Al final de la lista, **Enviar pedido**. Se guarda una vez por sede y fecha de entrega; enviado, ya no se cambia (un segundo envío responde 409).
4. **Compra** suma lo que enviaron las sedes y descuenta el acopio. **Seguimiento** lo compara con el sugerido.

Cada renglón enviado guarda el sugerido que vio el líder, lo que pidió y su **origen** (lo calcula el backend, `src/envios/reglas.js`):

| Origen | Cuándo |
|---|---|
| `sugerido` | Pidió exactamente lo sugerido |
| `modificado` | Cambió la cantidad sugerida |
| `quitado` | El sistema sugería y no lo pidió (cantidad 0) |
| `agregado` | El sistema no sugería (0 o sin dato) y lo pidió |

Lo que ni se sugirió ni se pidió no se guarda. Sin usuario identificado no se envía nada, en ningún modo de `FRUVER_AUTH`.

**Instalar**: correr `sql/002_pedidos_enviados.sql` una vez en el SQL Editor del Supabase de la intranet (es idempotente). Guarda encabezado y renglones en una sola transacción (`fruver_registrar_envio`).

**Límite conocido**: el sugerido de cada renglón lo manda el front (el que vio el líder). Un usuario con permiso podría alterarlo desde las herramientas del navegador; para una herramienta interna se aceptó a cambio de que el seguimiento compare contra lo que el líder realmente vio.

Para sumar una sección: su permiso en `RUTAS` y su ruta en `app.js`. En el front: su carpeta en `src/pages/AutomatizacionFruver/`, una entrada en `secciones.js`, su ruta hija en `RouterApp.jsx` y su entrada en `data/masterRoutes.js`.

> **QR:** el sistema no usa QR: el líder elige su sede en una lista. Más adelante se va a adaptar a los QR que ya tienen las tiendas (para no pegar otro adhesivo).

## Cómo se calcula el sugerido

Fruver = grupo `40-LEGUMBRE`. Para cada sede y cada producto:

```
1. inventario hoy            = disponible en SIESA ahora (existencia − ventas de caja sin descargar)
2. se vende antes de recibir = lo que falta vender hoy (según cómo vende la sede por hora)
                             + la venta esperada de los días antes de la entrega
3. quedan al recibir         = inventario hoy − se vende antes de recibir        (nunca menos de 0)
4. venta esperada            = media recortada de lo vendido el MISMO día de la semana
                               en las últimas 6 semanas en que la sede abrió (sin el día más alto
                               ni el más bajo), AJUSTADA POR QUINCENA, sumada para los días que
                               cubre el pedido
5. hay que tener (necesidad) = venta esperada ÷ (1 − merma)
6. sugerido                  = hay que tener − quedan al recibir                  (redondeo: sube desde ,2)
```

**Ajuste por quincena** (`AJUSTE_QUINCENA` en `reglas.js`; `false` = fórmula anterior). Fruver vende +20–28 % los días siguientes al pago (15 y 30) y ~25 % menos a mitad de quincena; la media de 6 semanas mezclaba las dos fases. Fase = días desde el último pago (0–15). El índice de cada fase se aprende con 84 días de venta de fruver en plata de todas las sedes (`consultarVentaDiariaFruver`): venta del día ÷ venta promedio de ese día de la semana en la sede, promediado por fase; una fase con menos de 7 observaciones vale 1. Cada día de la historia se divide por el índice de su fase y la media recortada se multiplica por el de la fecha pronosticada. La respuesta trae `parametros.quincena` (índice y factor de cada día del pedido); el envío lo guarda en `fruver_envios.parametros`.

Medido sin fuga (16 semanas, 29-jul → 17-nov-2026, índice con datos ≤ T−2): error ponderado en plata del consolidado semanal 20,6 % → 14,4 %; sede×ítem×día 41,0 % → 36,8 %; sesgo −5,2 % → −3,1 %. Empeora en la víspera del pago (fases 13–14) y no resuelve festivos.

Ejemplo (el de `test/pedidos.test.js`): hay 80 kg, faltan vender 50 hoy → quedan 30 al recibir. Se esperan vender 90 kg con 21,7 % de merma → hay que tener 90 ÷ 0,783 = 114,9. Sugerido = 114,9 − 30 = 84,9 → **85 kg**.

- **Merma** = (comprado − vendido) ÷ comprado en los últimos 42 días, con tope de 25 %.
- **Se arma en tienda**: si vende más de 1,5 veces lo que se compra con ese código (paquetes de verduras, bandejas), tiene sugerido por sede pero no suma a la compra.
- **Compra consolidada** = suma de los sugeridos de las sedes − inventario del acopio (`PV009`, centro de acopio mayorista).
- Un producto cuyo inventario no se pudo leer queda **sin sugerido** (`null`), nunca en 0. Si falla más del 20 %, la API responde 502.

Cada sede devuelve los pasos del cálculo (`disponible`, `pendienteHoy`, `antesDeEntrega`, `inventarioAlRecibir`, `ventaEsperada`, `necesidad`, `sugerido`), así la pantalla muestra la cuenta de cada producto sin rehacerla.

Reglas puras en `src/pedidos/reglas.js` y `sugerido.js` (probadas en `test/pedidos.test.js` y `test/quincena.test.js`).

## Asertividad: ¿qué tan fiable es el sugerido?

`src/asertividad/`. Para cada día ya vendido y cada sede×producto, recalcula la venta esperada con la historia que existía ANTES (las mismas funciones de `pedidos/reglas.js`; el índice de quincena con datos ≤ T−2) y la compara con lo vendido.

**La pantalla** (`medirPorDia`, `GET ?dias=7|14|28`): una fila por día, todas las sedes juntas — *el sistema esperaba vender* · *se vendió* · *diferencia* · *acierto* — y al tocar un día, producto por producto (del que más plata erró al que menos).

- **Acierto** = 1 − Σ |esperado − vendido| ÷ Σ vendido, producto por producto (que sobre papa no compensa que falte tomate), en plata (unidades × precio promedio de venta) para sumar kilos con unidades. Nunca menos de 0.
- **El recálculo es lo que se mostró.** Comprobado el 20-nov-2026 contra la foto del 18-nov (entrega jue 19): 178 de 178 productos iguales, sede por sede.
- **Día a medias** (`sedesSinDatos`): una sede que venía vendiendo y no aparece al final del período es retraso de la réplica, no cierre. Ese día se compara solo con las sedes que llegaron y la pantalla lo avisa. No cuentan una sede que abrió en el período ni un día cerrado en medio.
- Los productos de cada día viajan solo con números; nombre y unidad van una vez en `productos` (28 días ≈ 0,6 MB en vez de 1 MB).
- Límites: un día de agotado la venta es menor que la demanda; mide la venta esperada, no el pedido (el inventario histórico por bodega no está en la réplica).
- Caché en memoria por (último dato, días), 30 min. 14 días: ~20 s la primera vez.

**El reporte técnico** (`medirAsertividad`, solo terminal): cuatro niveles (sede×producto×día … consolidado×semana) y tres pronósticos — **sistema**, **sinQuincena** (¿el ajuste sigue ayudando?) e **ingenuo** (repetir la semana pasada: si el sistema no le gana, no aporta). `node --env-file=.env scripts/medir-asertividad.mjs [semanas]`.

Tests: `test/asertividad.test.js` (incluye sin fuga: lo vendido el día anterior no cambia lo esperado).

Variantes probadas y descartadas (2026-11-18, backtest de 16 semanas): índice de quincena **por sede** (solo 0,3 pts mejor que el global, con siete índices que estimar) y **corrección del error por fase** sobre la fórmula (0,6 pts peor que el índice).

## Foto diaria del sugerido de compra

`src/fotos/`. El sugerido se calcula en vivo y se pierde; sin guardarlo no se puede comparar lo que el sistema recomendó comprar con lo que se compró (SIESA) y se vendió, ni corregir la fórmula con datos. Tampoco queda el inventario por sede de ese momento (la réplica no lo tiene).

- **Cuándo**: Vercel Cron (`vercel.json`) a las 16:10 y 16:40 Colombia (21:10 y 21:40 UTC), justo después de la publicación. La segunda es respaldo: si la primera guardó, no hace nada (la primera foto del día es la que vale).
- **Qué**: siempre la entrega de **mañana, 1 día** (serie comparable). Por producto: `comprar` (el sugerido de compra), pedido de las tiendas, acopio, venta esperada, merma, precio, y por sede (`sedes` jsonb) disponible, lo que se vende antes de recibir, inventario al recibir, venta esperada, necesidad y sugerido. Encabezado con parámetros (último dato, cobertura, índice de quincena) y resumen.
- **Dónde**: `fruver_sugerido_fotos` + `fruver_sugerido_foto_items` (`sql/005_fotos_sugerido.sql`), escrito por `fruver_guardar_foto_sugerido` en una transacción.
- **Tamaño**: ~178 productos, ~200 KB de JSON por día, 6–7 s.
- **Ruta**: `GET /api/fruver/cron/foto-sugerido`, solo con `Authorization: Bearer $CRON_SECRET`.
- **A mano**: `node --env-file=.env scripts/tomar-foto-sugerido.mjs [--seco]` (`--seco` calcula sin escribir; sin él, escribe en el Supabase REAL).
- Límites: es el sugerido del sistema a las 4 p. m., no lo que compras vio después (los pedidos de las sedes y el inventario cambian en la tarde). Si SIESA falla en las dos corridas, ese día queda sin foto (se ve en los logs de Vercel).
- Tests: `test/fotos.test.js`.

## Cumplimiento de proveedores

`src/cumplimiento/`. Nivel de servicio de entrega: compras contra recibos de `fruver_operaciones.estado`. Renglón = (entrega, producto, proveedor); cumplido = min(recibido, comprado); cumplimiento = Σ cumplido·costo ÷ Σ comprado·costo. Lo sobreentregado va aparte (no compensa). Completo = ≥ 98 %.

- Atribución del recibo: `compraId` → proveedor de la compra; recibo a ciegas con `nit` → ese; sin `nit` → el único proveedor del producto ese día, o **sin atribuir** si hubo varios (sale en `observaciones`).
- Solo entregas `< hoy` con al menos un recibo. Producto comprado sin recibo en una entrega con recibos = no entregado.
- Costo: compra → promedio del producto en el período → último costo SIESA (`consultarCompras`, 90 días).
- Responde `global`, `proveedores[]` (con `productos[]`), `fechas[]`, `lineas[]` y `observaciones`.
- Tests: `test/cumplimiento.test.js`.

**Recibo a ciegas con proveedor**: cada línea de `recibo_ciego` acepta `nit` opcional (se valida contra las compras de ese producto; repetido = item+nit). `vistaRecibo` expone `proveedores: [{nit, nombre}]` por producto, sin cantidades. Tests: `test/recibo-ciego.test.js`. Contrato en `docs/AUTOMATIZACION_FRUVER.md` §4.

## Fuentes y gotchas

- **Ventas**: `merkahorro_siesa.ventas_pdv_resumen_item_diario` (refrescada por el workflow `postgrest_post.yml` del repo del front, 10:00 y 15:00). Hoy no está: se estima por la hora.
- **Compras**: `merkahorro_siesa.compras`. El ~29 % del fruver entra por `DSE` (documento soporte), no `CEA`: se filtra por `clase_docto`, que cubre los dos.
- **Maestro**: `dimitems.referencia` viene como `'A-0005098   '`; el ítem son los dígitos sin ceros a la izquierda.
- **Inventario**: la réplica NO tiene inventario por bodega. Se consulta en vivo `API_v2_Inventarios_InvFecha` (una llamada por producto trae todas las bodegas). ~6–8 s para ~220 productos con 12 a la vez; se guarda 2 minutos.
- Nunca `SET` de sesión contra Supavisor (puerto 6543): usar `SET LOCAL` dentro de una transacción.

## Variables

Ver `.env.example`. Postgres y Supabase (solo para validar la sesión): los mismos de `backend_analitica`. SIESA: los mismos de `backend-traslado`.

`SUPABASE_SERVICE_ROLE_KEY`: la service role (o secret key) del mismo proyecto. Sin ella, el sugerido funciona, pero enviar responde 503 y Compra sale sin pedidos de sedes (con aviso).

`CRON_SECRET`: secreto de Vercel Cron para la foto diaria del sugerido. Sin él, `/api/fruver/cron/foto-sugerido` responde 503 (cerrada) y no se guarda nada.

`FRUVER_AUTH`: `off` | `report` | `enforce` (vacío = `report`). Pasa quien tiene asignada la ruta de la sección (o `/automatizacion-fruver` entera), personal o por rol, igual que en el front. El admin NO tiene pase directo: también hay que asignársela.

## Correr

```bash
npm install
npm test
npm run dev     # http://127.0.0.1:3020/api
```

El front en desarrollo llega por el proxy `/api-fruver` de Vite, que por defecto apunta a este backend en **producción**. Para probar el local: `FRUVER_API_PROXY=http://127.0.0.1:3020 npm run dev` en el front.

## Tiempos medidos en producción (2026-11-05)

5,4 s la primera vez y ~1,5 s después (el inventario se guarda 2 minutos).
