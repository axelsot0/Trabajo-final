# Runbook operativo

Comandos y responsables exactos se completan cuando existan los IDs y la configuración
reales (paso 12 del plan). Este documento se mantiene sin secretos ni datos personales.

## Variables y secretos

| Nombre                    | Dónde vive                          | Uso                                                  |
| ------------------------- | ----------------------------------- | ---------------------------------------------------- |
| `META_APP_SECRET`         | Secreto del Worker / GitHub Actions | HMAC SHA-256 de `X-Hub-Signature-256`.               |
| `META_VERIFY_TOKEN`       | Secreto del Worker                  | Verificación `GET /webhooks/meta`.                   |
| `META_ACCESS_TOKEN`       | Secreto del Worker                  | Token de la cuenta profesional para enviar mensajes. |
| `TELEGRAM_BOT_TOKEN`      | Secreto del Worker                  | Bot API.                                             |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto del Worker                  | Encabezado `X-Telegram-Bot-Api-Secret-Token`.        |
| `AI_PROVIDER`, `AI_MODE`  | `wrangler.jsonc` (`vars`)           | Selección de proveedor y modo operativo.             |
| `AI_EXTERNAL_API_KEY`     | Secreto del Worker (si aplica)      | Adaptador `external-http`.                           |

Nunca en `wrangler.jsonc`, frontend, SQL, URL, logs ni capturas. Localmente van en
`.dev.vars` (ignorado por git). En producción: `npx wrangler secret put <NOMBRE>`.

## Telegram: alta del bot y de los agentes

1. Crear el bot en BotFather y guardar el token como secreto: `npx wrangler secret put TELEGRAM_BOT_TOKEN`.
2. Generar un secreto aleatorio para el webhook y guardarlo: `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`.
3. Registrar el webhook (una sola vez, tras el deploy). El valor de `secret_token` debe ser
   exactamente el mismo que el secreto anterior:

   ```bash
   curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<worker>.workers.dev/webhooks/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     -d "allowed_updates=[\"message\",\"callback_query\"]"
   curl -sS "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```

4. Alta de agentes desde Telegram (recomendado): un `owner` envía `/invitar` (o
   `/invitar owner`, `/invitar lectura`) y reenvía el enlace `t.me/<bot>?start=<código>`.
   Es de un solo uso y vence a las 48 h; al abrirlo, la persona queda registrada con su
   identidad de Telegram y el owner recibe un aviso. `/agentes` lista el equipo y permite
   quitar accesos. Alternativa manual: dar de alta a cada agente con su `telegram_user_id` verificado (lo muestra, por ejemplo,
   el bot oficial @userinfobot; pedirle al empleado que lo consulte). Hasta que exista la
   pantalla del dashboard, se hace con SQL:

   ```bash
   npx wrangler d1 execute DB --remote --command \
     "INSERT INTO employees (id, telegram_user_id, display_name, role, active, created_at_utc)
      VALUES ('<uuid>', <telegram_user_id>, '<Nombre>', 'agent', 1, '<fecha ISO UTC>');"
   ```

5. Cada agente debe abrir el bot y enviar `/start` una vez: así se registra su chat privado
   y empieza a recibir avisos. Sin ese paso, `/chats` funciona pero no recibe notificaciones.

   Flujo de trabajo del agente:
   - Recibe una tarjeta cuando una conversación pasa a humano; pulsa **Tomar** (gana uno solo).
   - Responde al cliente haciendo **Reply** sobre la tarjeta; el bot confirma «Enviado» o
     explica el motivo (ventana vencida, no asignado, Instagram sin confirmar, reintento).
   - **Transferir** elige otro agente activo; **Cerrar** (o `/cerrar` como Reply) pide el
     resultado: venta confirmada, sin venta, seguimiento o no determinado.
   - Tras una venta confirmada, `/venta <importe> [moneda] [nota]` como Reply al mensaje de
     cierre registra el importe declarado (no es prueba de pago).
   - `/mischats` muestra lo asignado; `/chats` toda la cola. Ningún envío se resuelve por
     "chat activo": sin Reply a una tarjeta no hay destino.

6. Baja de un agente: `UPDATE employees SET active = 0 WHERE id = '<uuid>'`. Sus tokens de
   botones dejan de valer de inmediato y no puede tomar ni responder conversaciones.

## IA de ventas y catálogo

- Modo en `wrangler.jsonc` → `AI_MODE`: `off` (todo a humanos), `review` (la IA solo redacta
  borradores para el agente) o `auto`. Solo esos tres valores; cualquier otro tumba el Worker.
- La IA solo afirma lo que está en `catalog_items`. Precios, tramos por volumen, existencias y
  hechos se cambian en `seeds/yorki-cuties.sql` y se aplican con:

  ```bash
  npx wrangler d1 execute DB --remote --file seeds/yorki-cuties.sql
  ```

  Al vender un cachorro, bajar `quantity_available`; con 0 la IA deja de ofrecerlo.

- `min_unit_price_minor` es el piso para negociar: solo aparece en las alertas de Telegram,
  nunca en el prompt.
- Traspasos automáticos a humano (con alerta en Telegram): regateo o contraoferta, compra de
  3 o más, cliente listo para comprar, petición de persona, queja, tema delicado, pregunta
  fuera de los datos aprobados, baja confianza, precio no aprobado en la respuesta, fallo del
  proveedor o cupo diario (`AI_DAILY_LIMIT`) agotado.
- Auditoría: `ai_replies` (una fila por mensaje respondido, con decisión, modelo, tokens y
  latencia) y `triage_events` (intención, etapa, prioridad).

## Despliegue

1. `npm run check` en verde en la rama protegida.
2. Aplicar migraciones antes del código que dependa de ellas:
   `npx wrangler d1 migrations apply <DB> --remote`.
3. `npx wrangler deploy` desde CI con credencial de alcance mínimo.
4. Verificar `GET /health` y que Meta/Telegram reciban 200 en sus webhooks.
5. Rollback: `npx wrangler rollback` al deploy anterior; plan de reversión de datos por
   migración inversa documentada en el PR correspondiente.

## Vigilancia diaria

- Eventos pendientes en `webhook_events` con `process_status != 'done'`.
- Errores de Meta/Telegram en `outbox` (status `failed`, `attempts`, `last_error_code`).
- Envíos con acuse incierto: `outbox.status = 'uncertain'`. El cron los concilia consultando
  ecos y la Conversations API; si pasan 24 h sin resolverse quedan `failed` con
  `unreconciled_timeout` y hay que revisarlos a mano. Nunca reenviar manualmente sin
  comprobar el DM real.
- Validez del token de Instagram (`ig_accounts.last_token_check_at`).
- Cupo de Worker, D1 y Workers AI en el panel de Cloudflare.
- Conversaciones cerca del cierre de ventana y mensajes sin respuesta.

Si hay fallos persistentes, el bot alerta al rol `owner` por Telegram; si Telegram falla,
el dashboard muestra la alerta.

## Incidentes

| Situación                           | Acción                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| IA responde mal o consume cupo      | `AI_MODE=off` y redeploy (o cambio de var). Los entrantes siguen llegando a agentes.                                          |
| Meta no entrega o la ventana venció | El agente ve el estado y espera el próximo mensaje del cliente. Nunca enviar por rutas no oficiales.                          |
| Token de Instagram revocado         | Reconectar por el flujo oficial de Instagram Login, actualizar el secreto y revalidar la suscripción del webhook.             |
| Webhook de Telegram caído           | `setWebhook` de nuevo con el secreto; comprobar `getWebhookInfo`.                                                             |
| Cuota D1/Worker agotada             | Registrar incidencia; el servicio se restaura al volver el cupo. No prometer respuesta automática si el almacenamiento falló. |

## Backup y restauración

- D1 Time Travel Free tiene ventana limitada. Exportar periódicamente con
  `npx wrangler d1 export <DB> --remote --output backup.sql`, cifrar y guardar en un
  destino controlado por el dueño. Nunca en GitHub.
- Probar restauración en una base local: `npx wrangler d1 execute <DB> --local --file backup.sql`.
