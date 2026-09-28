# 0003. Telegram por webhook y respuestas vinculadas por Reply

- **Estado:** Aceptado · 2026-09-27
- **Contexto:** `getUpdates` y webhook son excluyentes en la Bot API. Un Worker no puede
  hacer *long polling*. Varios agentes atienden varias conversaciones a la vez desde un
  mismo chat privado con el bot, así que "el chat activo" es ambiguo.
- **Decisión:** Webhook HTTPS en el mismo Worker (`/webhooks/telegram`), autenticado con
  el encabezado `X-Telegram-Bot-Api-Secret-Token`. Cada conversación de Instagram tiene
  una tarjeta de contexto enviada por el bot y registrada en `telegram_message_links`. El
  agente responde haciendo **Reply** a esa tarjeta; el destino se resuelve por
  `(telegram_chat_id, telegram_message_id)` y nunca por "último chat visto".
- **Consecuencias:**
  - Solo chats privados; `from.id` debe estar en la allowlist de empleados activos.
  - Los botones inline usan tokens opacos cortos almacenados en D1 con caducidad; el
    Worker valida agente y estado antes de actuar y responde con `answerCallbackQuery`.
  - Un Reply a una tarjeta ajena, antigua o de una conversación cerrada devuelve un error
    claro al agente y no envía nada a Instagram.
