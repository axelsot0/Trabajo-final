# Runbook operativo

Comandos y responsables exactos se completan cuando existan los IDs y la configuración
reales (paso 12 del plan). Este documento se mantiene sin secretos ni datos personales.

## Variables y secretos

| Nombre | Dónde vive | Uso |
|---|---|---|
| `META_APP_SECRET` | Secreto del Worker / GitHub Actions | HMAC SHA-256 de `X-Hub-Signature-256`. |
| `META_VERIFY_TOKEN` | Secreto del Worker | Verificación `GET /webhooks/meta`. |
| `META_ACCESS_TOKEN` | Secreto del Worker | Token de la cuenta profesional para enviar mensajes. |
| `TELEGRAM_BOT_TOKEN` | Secreto del Worker | Bot API. |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto del Worker | Encabezado `X-Telegram-Bot-Api-Secret-Token`. |
| `AI_PROVIDER`, `AI_MODE` | `wrangler.jsonc` (`vars`) | Selección de proveedor y modo operativo. |
| `AI_EXTERNAL_API_KEY` | Secreto del Worker (si aplica) | Adaptador `external-http`. |

Nunca en `wrangler.jsonc`, frontend, SQL, URL, logs ni capturas. Localmente van en
`.dev.vars` (ignorado por git). En producción: `npx wrangler secret put <NOMBRE>`.

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
- Errores de Meta/Telegram en `outbox` (status `failed`, `attempts`).
- Validez del token de Instagram (`ig_accounts.last_token_check_at`).
- Cupo de Worker, D1 y Workers AI en el panel de Cloudflare.
- Conversaciones cerca del cierre de ventana y mensajes sin respuesta.

Si hay fallos persistentes, el bot alerta al rol `owner` por Telegram; si Telegram falla,
el dashboard muestra la alerta.

## Incidentes

| Situación | Acción |
|---|---|
| IA responde mal o consume cupo | `AI_MODE=off` y redeploy (o cambio de var). Los entrantes siguen llegando a agentes. |
| Meta no entrega o la ventana venció | El agente ve el estado y espera el próximo mensaje del cliente. Nunca enviar por rutas no oficiales. |
| Token de Instagram revocado | Reconectar por el flujo oficial de Instagram Login, actualizar el secreto y revalidar la suscripción del webhook. |
| Webhook de Telegram caído | `setWebhook` de nuevo con el secreto; comprobar `getWebhookInfo`. |
| Cuota D1/Worker agotada | Registrar incidencia; el servicio se restaura al volver el cupo. No prometer respuesta automática si el almacenamiento falló. |

## Backup y restauración

- D1 Time Travel Free tiene ventana limitada. Exportar periódicamente con
  `npx wrangler d1 export <DB> --remote --output backup.sql`, cifrar y guardar en un
  destino controlado por el dueño. Nunca en GitHub.
- Probar restauración en una base local: `npx wrangler d1 execute <DB> --local --file backup.sql`.
