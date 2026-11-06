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

## Pedido de la sede: cómo funciona

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
                               ni el más bajo), sumada para los días que cubre el pedido
5. hay que tener (necesidad) = venta esperada ÷ (1 − merma)
6. sugerido                  = hay que tener − quedan al recibir                  (redondeo: sube desde ,2)
```

Ejemplo (el de `test/pedidos.test.js`): hay 80 kg, faltan vender 50 hoy → quedan 30 al recibir. Se esperan vender 90 kg con 21,7 % de merma → hay que tener 90 ÷ 0,783 = 114,9. Sugerido = 114,9 − 30 = 84,9 → **85 kg**.

- **Merma** = (comprado − vendido) ÷ comprado en los últimos 42 días, con tope de 25 %.
- **Se arma en tienda**: si vende más de 1,5 veces lo que se compra con ese código (paquetes de verduras, bandejas), tiene sugerido por sede pero no suma a la compra.
- **Compra consolidada** = suma de los sugeridos de las sedes − inventario del acopio (`PV009`, centro de acopio mayorista).
- Un producto cuyo inventario no se pudo leer queda **sin sugerido** (`null`), nunca en 0. Si falla más del 20 %, la API responde 502.

Cada sede devuelve los pasos del cálculo (`disponible`, `pendienteHoy`, `antesDeEntrega`, `inventarioAlRecibir`, `ventaEsperada`, `necesidad`, `sugerido`), así la pantalla muestra la cuenta de cada producto sin rehacerla.

Reglas puras en `src/pedidos/reglas.js` y `sugerido.js` (probadas en `test/pedidos.test.js`).

## Fuentes y gotchas

- **Ventas**: `merkahorro_siesa.ventas_pdv_resumen_item_diario` (refrescada por el workflow `postgrest_post.yml` del repo del front, 10:00 y 15:00). Hoy no está: se estima por la hora.
- **Compras**: `merkahorro_siesa.compras`. El ~29 % del fruver entra por `DSE` (documento soporte), no `CEA`: se filtra por `clase_docto`, que cubre los dos.
- **Maestro**: `dimitems.referencia` viene como `'A-0005098   '`; el ítem son los dígitos sin ceros a la izquierda.
- **Inventario**: la réplica NO tiene inventario por bodega. Se consulta en vivo `API_v2_Inventarios_InvFecha` (una llamada por producto trae todas las bodegas). ~6–8 s para ~220 productos con 12 a la vez; se guarda 2 minutos.
- Nunca `SET` de sesión contra Supavisor (puerto 6543): usar `SET LOCAL` dentro de una transacción.

## Variables

Ver `.env.example`. Postgres y Supabase (solo para validar la sesión): los mismos de `backend_analitica`. SIESA: los mismos de `backend-traslado`.

`SUPABASE_SERVICE_ROLE_KEY`: la service role (o secret key) del mismo proyecto. Sin ella, el sugerido funciona, pero enviar responde 503 y Compra sale sin pedidos de sedes (con aviso).

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
