# 0002. Instagram API with Instagram Login como ruta de integración

- **Estado:** Aceptado · 2026-09-27
- **Contexto:** Meta ofrece dos rutas para mensajería de Instagram: mediante Facebook
  Login con una Página vinculada, o **Instagram API with Instagram Login** para cuentas
  profesionales (Business o Creator) sin presuponer una Página.
- **Decisión:** Usar Instagram API with Instagram Login. Permisos iniciales:
  `instagram_business_basic` e `instagram_business_manage_messages`. Webhooks del objeto
  `instagram`, campos `messages` y, cuando se usen botones, `messaging_postbacks`.
- **Consecuencias:**
  - El envío usa el ID de destinatario con alcance de Instagram (IGSID) asociado a la
    conversación; nunca el username visible.
  - La ventana estándar es de 24 h desde el último mensaje del cliente. La etiqueta
    `HUMAN_AGENT` (hasta 7 días) solo se usa para respuestas humanas y solo si Meta la
    habilita para esta app; la IA jamás la usa.
  - El acceso a DMs de clientes reales fuera de roles de prueba puede exigir App Review.
    Es un gate explícito antes de producción. Los hallazgos se anotan en
    `docs/meta-validation.md`.
  - Si una hipótesis bloquea el uso real, no se sustituye por scraping ni automatización de
    la interfaz de Instagram.
- **Verificación pendiente en cuenta real:** flujo exacto de Business Login, campos
  concretos del webhook, disponibilidad de Human Agent, límites de la Conversations API.
