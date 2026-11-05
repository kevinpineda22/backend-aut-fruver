# Automatización Fruver — API

Backend de **Automatización Fruver**, un sistema propio de la intranet de Merkahorro (front: `Pagina-web_React/src/pages/AutomatizacionFruver/`, ruta `/automatizacion-fruver`). No es parte de la Analítica.

Express en Vercel, mismo patrón que `backend_analitica`.
- **Lee** la réplica de SIESA en Postgres y el inventario en vivo de SIESA (nunca escribe ahí).
- **Lee y escribe** los pedidos de sede en el Supabase de la intranet (tablas `fruver_*`, con la service role).

## Secciones

Cada sección tiene su permiso (ruta del front). Quien tiene `/automatizacion-fruver` entra a todas; a un líder de sede se le asigna solo `/automatizacion-fruver/pedido-sede`.

| Sección | Permiso | Carpeta | API |
|---|---|---|---|
| Compra (consolidada) | `/automatizacion-fruver/pedidos` | `src/pedidos/` | `GET /api/fruver/pedidos/sugerido?entrega&dias` |
| Pedido de sede (líder) | `/automatizacion-fruver/pedido-sede` | `src/pedidoSede/` | `POST /api/fruver/sede/verificar` · `POST /api/fruver/sede/pedido` · `PUT /api/fruver/sede/pedido/:id/lineas/:item` · `POST /api/fruver/sede/pedido/:id/enviar` |
| Sedes y QR | `/automatizacion-fruver/sedes` | `src/sedes/` | `GET /api/fruver/sedes` · `POST /api/fruver/sedes/:bodega/token` |

Para sumar una sección: su carpeta en `src/` con su `rutas.js`, su permiso en `RUTAS` y su `app.use(...)` en `app.js`. En el front: su carpeta en `src/pages/AutomatizacionFruver/`, una entrada en `secciones.js`, su ruta hija en `RouterApp.jsx` y su entrada en `data/masterRoutes.js`.

## Pedido de sede: cómo funciona

1. Cada sede tiene un adhesivo con un QR (sección "Sedes y QR"). El QR lleva la dirección `…/automatizacion-fruver/pedido-sede?qr=<código>`: escaneado con la cámara del celular abre la página; también se puede escanear desde ella.
2. El líder (logueado) abre el pedido de su sede para una fecha de entrega. La primera vez se calcula el sugerido y queda **fijo**: cada renglón arranca con `cantidad = sugerido`.
3. El líder cambia lo que no le parezca (con un motivo opcional). Cada cambio se guarda en el momento.
4. Al enviar, el pedido queda cerrado. La sección Compra usa lo que pidió cada líder que ya envió y el sugerido para el resto.

**Seguridad**: cada escritura vuelve a pedir el QR y verifica que el pedido sea de ESA sede. Sin usuario identificado no se escribe nada, en ningún modo de `FRUVER_AUTH`.

**Trazabilidad** (`sql/001_pedidos_sede.sql`): cada renglón guarda el sugerido, lo pedido, si es `sugerido` o `manual`, el motivo, quién y cuándo, y los datos con que se calculó el sugerido (venta esperada, inventario, merma, precio). `fruver_pedido_eventos` registra abrir, cada cambio de cantidad (antes → después) y enviar. Los cambios pasan por funciones de la base, que escriben el cambio y su evento en la misma transacción.

**Instalar**: correr `sql/001_pedidos_sede.sql` una vez en el SQL Editor del Supabase de la intranet (es idempotente). Probado en una transacción con ROLLBACK: abrir, no duplicar, cambiar, volver al sugerido, rechazar cantidad negativa, rechazar cambios después de enviar, eventos y RLS.

## Pedidos: cómo se calcula el sugerido

Fruver = grupo `40-LEGUMBRE`. Para cada sede y cada producto:

```
venta esperada (un día)  = media recortada de lo vendido el MISMO día de la semana
                           en las últimas 6 semanas en que la sede abrió
inventario al recibir    = disponible en SIESA ahora
                           − lo que falta vender hoy (según cómo vende la sede por hora)
                           − la venta de los días antes de la entrega
necesidad                = venta esperada de los días a cubrir ÷ (1 − merma)
sugerido                 = necesidad − inventario al recibir   (redondeo de Traslados: sube desde ,2)
```

- **Merma** = (comprado − vendido) ÷ comprado en los últimos 42 días, con tope de 25 %.
- **Se arma en tienda**: si vende más de 1,5 veces lo que se compra con ese código (paquetes de verduras, bandejas), tiene pedido por sede pero no suma a la compra.
- **Compra consolidada** = suma de los sugeridos de las sedes − inventario del acopio (`PV009`, centro de acopio mayorista).
- Un producto cuyo inventario no se pudo leer queda **sin sugerido** (`null`), nunca en 0. Si falla más del 20 %, la API responde 502.

Reglas puras en `src/pedidos/reglas.js` y `sugerido.js` (probadas en `test/pedidos.test.js`).

## Fuentes y gotchas

- **Ventas**: `merkahorro_siesa.ventas_pdv_resumen_item_diario` (refrescada por el workflow `postgrest_post.yml` del repo del front, 10:00 y 15:00). Hoy no está: se estima por la hora.
- **Compras**: `merkahorro_siesa.compras`. El ~29 % del fruver entra por `DSE` (documento soporte), no `CEA`: se filtra por `clase_docto`, que cubre los dos.
- **Maestro**: `dimitems.referencia` viene como `'A-0005098   '`; el ítem son los dígitos sin ceros a la izquierda.
- **Inventario**: la réplica NO tiene inventario por bodega. Se consulta en vivo `API_v2_Inventarios_InvFecha` (una llamada por producto trae todas las bodegas). ~6–8 s para ~220 productos con 12 a la vez.
- Nunca `SET` de sesión contra Supavisor (puerto 6543): usar `SET LOCAL` dentro de una transacción.

## Variables

Ver `.env.example`. Postgres y Supabase: los mismos de `backend_analitica`. SIESA: los mismos de `backend-traslado`.

`SUPABASE_SERVICE_ROLE_KEY`: la service role del mismo proyecto de Supabase. Sin ella, Compra funciona con el sugerido solo y Pedido de sede / Sedes y QR responden 503.

`FRUVER_AUTH`: `off` | `report` | `enforce` (vacío = `report`). Pasa quien tiene asignada la ruta de la sección (o `/automatizacion-fruver` entera), personal o por rol, igual que en el front. El admin NO tiene pase directo: también hay que asignársela.

## Correr

```bash
npm install
npm test
npm run dev     # http://127.0.0.1:3020/api
```

El front en desarrollo llega por el proxy `/api-fruver` de Vite (por defecto a `127.0.0.1:3020`). En producción usa `VITE_FRUVER_API_URL` (o `https://backend-aut-fruver.vercel.app/api` si no está).

## Tiempos medidos (2026-11-05)

- Postgres resuelve las ventas en ~0,13 s. Desde la red de la oficina bajar el resultado tardó 14–26 s (la red rindió ~45 KB/s ese día); desde Vercel, que está junto a la base, debería ser una fracción. **Medir en Vercel después del primer deploy.**
- Inventario de SIESA: 224 productos en ~6–8 s.
