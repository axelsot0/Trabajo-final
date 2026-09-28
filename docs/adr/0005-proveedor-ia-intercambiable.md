# 0005. Proveedor de IA intercambiable con Workers AI por defecto

- **Estado:** Aceptado · 2026-09-27
- **Contexto:** Workers AI ofrece una asignación gratuita diaria (10.000 Neurons a la
  fecha de revisión). El negocio puede querer otro proveedor más adelante. Un modelo local
  en `localhost` no es alcanzable desde un Worker alojado.
- **Decisión:** Puerto `AiProvider` con tres adaptadores: `workers-ai` (predeterminado),
  `external-http` (endpoint HTTPS, credencial y mapeo de formato explícitos) y `fake`
  (pruebas). Selector `AI_PROVIDER=workers-ai|external-http|disabled`. Modo operativo
  `AI_MODE=off|review|auto`.
- **Consecuencias:**
  - La salida del modelo es JSON validado contra un esquema; salida inválida o sin
    respaldo en catálogo → revisión humana.
  - Presupuesto diario interno y corte anticipado antes del límite del plan.
  - `disabled`/`off` conservan la atención humana; la IA nunca responde en modo `HUMAN`
    ni usa la etiqueta Human Agent.
  - Cada texto enviado pertenece a una `response_variant` para poder medirlo.
