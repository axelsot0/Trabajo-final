# 0004. Arquitectura por puertos y adaptadores, dominio sin SDKs

- **Estado:** Aceptado · 2026-09-27
- **Contexto:** Meta, Telegram y el proveedor de IA cambian sus APIs; Cloudflare aporta
  bindings propios. Las reglas de negocio (estados, ventana, toma atómica, triaje) deben
  probarse sin red ni cuentas reales.
- **Decisión:** TypeScript estricto con capas `domain` → `application` → `ports` ←
  `adapters`. El dominio no importa nada de Cloudflare, Telegram ni Meta. Los casos de uso
  reciben dependencias por constructor/fábrica a través de interfaces pequeñas
  (`InstagramGateway`, `TelegramGateway`, `AiProvider`, repositorios). Validación de
  payloads con esquemas en las fronteras HTTP.
- **Consecuencias:**
  - Cada adaptador tiene una versión `fake` para pruebas y una real.
  - No se agrega una capa genérica sin un caso de uso concreto.
  - Contratos, migraciones y prompts se versionan.
  - CI bloquea merge sin formato, lint, `tsc`, pruebas y build en verde.
