# 0006. Procesamiento diferido con `waitUntil` y Cron Triggers, sin colas de pago

- **Estado:** Aceptado · 2026-09-27
- **Contexto:** Meta y Telegram exigen respuesta rápida al webhook y reintentan si no
  reciben 200. La generación de IA y el envío pueden tardar o fallar. Hay que evitar
  depender de productos fuera del plan gratuito.
- **Decisión:** El webhook valida, persiste el evento con clave única y responde 200 de
  inmediato. El procesamiento se lanza en el mismo request con `ctx.waitUntil` y un Cron
  Trigger periódico barre eventos pendientes y el `outbox` con reintentos y *backoff*.
- **Consecuencias:**
  - Idempotencia obligatoria: `webhook_events.external_event_key` y
    `messages.external_message_id` son únicos; los trabajos releen la versión de la
    conversación antes de actuar.
  - Ante acuse incierto de Meta (timeout) se concilia antes de reintentar para no duplicar
    respuestas.
  - Si más adelante se necesita una cola dedicada, se introduce detrás del mismo puerto.
