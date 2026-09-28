# MVP de atención y ventas: Instagram DM ↔ Telegram + IA + dashboard

Un cliente escribe por DM a la cuenta profesional de Instagram del negocio. Un
Cloudflare Worker recibe el evento oficial de Meta, lo registra en D1, clasifica la
intención y prepara una respuesta con un proveedor de IA intercambiable. Si la
respuesta pasa las reglas de seguridad se envía desde la cuenta de Instagram; si no,
se pide atención humana. Los agentes autorizados atienden desde su chat privado con
un bot de Telegram (`/chats`, tomar, responder, cerrar). Un dashboard privado muestra
colas, horarios locales, triaje, resultados comerciales y desempeño de variantes de IA.

La especificación completa está en
[`docs/plan-mvp-instagram-telegram-ia.md`](docs/plan-mvp-instagram-telegram-ia.md).
Las decisiones de arquitectura se registran en [`docs/adr/`](docs/adr/).

## Alcance congelado del MVP

- Una cuenta profesional de Instagram (Business o Creator) vía **Instagram API with
  Instagram Login**.
- Mensajes de texto en ambas direcciones. Los adjuntos entrantes se registran como
  evento con tipo y referencia, se avisan al agente y se derivan a humano. No se
  descargan ni almacenan medios.
- Hasta ocho agentes en chats privados de Telegram, verificados por `from.id` contra
  una allowlist.
- IA generativa real en la ruta automatizada (Workers AI por defecto), con
  `AI_MODE=off|review|auto` y respuesta de contingencia.
- Dashboard de lectura y gestión de catálogo, triaje, variantes y resultados, con
  login por enlace de un solo uso emitido desde Telegram.
- **Fuera de alcance:** DMs fríos, campañas masivas, scraping o automatización de la
  interfaz de Instagram, envío de medios, multi-cuenta.

## Definición de terminado

1. Desde una cuenta de cliente real se recibe un DM y queda en el historial con la
   hora correcta (UTC almacenado, `America/Santo_Domingo` presentado).
2. El bot o un humano responde en **ese mismo DM**.
3. `/chats` refleja el estado; dos agentes no pueden tomar el mismo chat.
4. El dashboard muestra métricas congruentes con los eventos almacenados.
5. Una variante de IA puede etiquetarse y compararse con una conversión confirmada.
6. El sistema sigue seguro cuando IA, Meta o Telegram fallan: no duplica envíos, no
   responde fuera de ventana y no pierde mensajes entrantes.

## Riesgos principales

| Riesgo                                                                     | Mitigación en el diseño                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Meta no autoriza DMs de clientes fuera de roles de prueba sin App Review   | Gate explícito en el paso 4; resultados en `docs/meta-validation.md`.                                       |
| Ventana de mensajería de 24 h (7 días con Human Agent, si está habilitado) | Se recalcula elegibilidad justo antes de cada envío; fuera de ventana se espera al cliente.                 |
| Cuotas del plan gratuito (Workers, D1, Workers AI)                         | Límites internos configurables, corte anticipado de IA, alertas al `owner`.                                 |
| Doble respuesta ante acuse incierto de Meta                                | Outbox con conciliación antes de reintentar.                                                                |
| Dos agentes toman el mismo chat                                            | `UPDATE ... WHERE mode='PENDING_HUMAN' AND assigned_employee_id IS NULL` y verificación de filas afectadas. |
| Fuga de secretos o PII                                                     | Secretos solo en Worker/GitHub Actions; PII redactada en logs; nada de datos reales en el repo.             |

## Estructura del repositorio

```text
docs/           plan, ADR, validación con Meta, runbook, política de datos
src/domain      entidades, estados y reglas puras (sin SDKs)
src/application casos de uso que dependen de interfaces
src/ports       InstagramGateway, TelegramGateway, AiProvider, repositorios
src/adapters    meta/, telegram/, ai/ (workers-ai, external-http, fake), d1/
src/http        rutas, autenticación, serialización
src/jobs        outbox, conciliación, métricas, cupos
dashboard/      SPA estática servida como Static Assets, sin secretos
migrations/     SQL versionado para D1
tests/          dominio, contratos, integraciones, E2E simulados
```

## Desarrollo local

Requisitos: Node.js 22 LTS y npm. Cloudflare Wrangler se instala como dependencia.

```bash
npm ci
cp .env.example .dev.vars        # rellenar valores locales; nunca se versiona
npm run db:migrate:local         # aplica migraciones a la D1 local
npm run dev                      # Worker + dashboard en http://localhost:8787
npm run check                    # format, lint, typecheck, test y build
```

## Estado de la construcción

| Paso | Entrega                                                                                | Estado    |
| ---: | -------------------------------------------------------------------------------------- | --------- |
|    0 | Documentación, alcance, ADR                                                            | Hecho     |
|    1 | Worker TypeScript, D1, dashboard (guardado con 401), CI                                | Hecho     |
|    2 | Dominio de estados, ventana de Meta, migración base, toma atómica                      | Hecho     |
|    3 | Webhook de Meta: verificación, firma, persistencia idempotente, procesamiento diferido | Hecho     |
|    4 | Envío a Instagram con outbox, reintentos, conciliación de acuses inciertos y ecos      | Hecho     |
|    5 | Bot de Telegram: allowlist, `/chats`, tarjetas, tokens opacos, avisos                  | Hecho     |
|    6 | Toma, Reply enrutado, transferencia, cierre con resultado y `/venta`                   | Hecho     |
|    7 | Triaje y analítica en hora local                                                       | Pendiente |
|    8 | IA con proveedor intercambiable y respuestas seguras de venta                          | Pendiente |
|    9 | Variantes, exposiciones y resultados comerciales                                       | Pendiente |
|   10 | Dashboard protegido con enlace de un solo uso                                          | Pendiente |
|   11 | Endurecimiento: reintentos, observabilidad, recuperación                               | Pendiente |
|   12 | Runbook de despliegue y checklist de salida                                            | Pendiente |

Con `AI_MODE=off` (valor actual), todo mensaje entrante pasa a la cola humana y el sistema
ya es operable de extremo a extremo por agentes desde Telegram una vez configuradas las
cuentas reales.

## Plan de construcción

Los pasos y sus criterios de aceptación están en la sección 10 del plan. Los puntos
marcados **TU ACCIÓN** requieren al dueño del negocio (crear la app de Meta, el bot
en BotFather, la cuenta de Cloudflare, aprobar catálogo y tono). Todo lo demás se
implementa y prueba con datos ficticios antes de esos puntos.

## Costo

El objetivo es operar dentro de planes gratuitos (Cloudflare Workers/D1/Workers AI,
GitHub, Telegram, Meta). No existe garantía universal de US$0: volumen, cambios de
precio o consumo de IA pueden forzar a reducir funcionalidad o pasar a atención
humana. El comportamiento ante cuota agotada es explícito y está documentado en el
plan (sección 3) y en el runbook.
