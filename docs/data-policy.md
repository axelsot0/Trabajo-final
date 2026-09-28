# Política de datos del MVP

## Qué se almacena

- Texto de mensajes de Instagram (entrantes y salientes) y metadatos: IDs con alcance de
  Instagram (IGSID), `mid`, marca de tiempo de Meta en UTC, dirección y origen.
- Nombre y usuario de Instagram del cliente (User Profile API), solo para que los agentes
  lo reconozcan en Telegram. El identificador estable sigue siendo el IGSID.
- Identidad de agentes: `telegram_user_id`, nombre visible y rol.
- Decisiones de triaje, variantes de respuesta, exposiciones y resultados declarados por
  agentes (venta confirmada, importe opcional).
- Eventos de webhook con retención corta del payload mínimo.

## Qué no se almacena

- Adjuntos ni medios (solo tipo y referencia temporal, sin descargar).
- Tokens o secretos en D1 en texto plano; van en secretos cifrados del entorno.
- Usernames como identificador estable; el identificador es el IGSID.
- Contraseñas, tarjetas ni datos de pago; la IA tiene prohibido pedirlos.

## Minimización y redacción

- Los prompts a la IA reciben solo los últimos mensajes relevantes con redacción de datos
  personales.
- Logs sin PII: se registran IDs internos y códigos de error, nunca texto de clientes.
- Las tarjetas de Telegram muestran lo mínimo necesario para atender.

## Retención

- `webhook_events.payload_minimal`: 7 días (configurable).
- Mensajes y conversaciones: configurable por el `owner`; por defecto 12 meses.
- `audit_events`: 12 meses.

## Derechos y exportación

- Corrección y borrado de una conversación por solicitud del cliente, ejecutados por un
  `owner` desde el dashboard con registro en `audit_events`.
- Exportaciones cifradas; nunca publicadas en GitHub.

## Transparencia

- Se informa al cliente de que conversa con una asistencia automatizada conforme a la
  política del negocio y a las normas de Meta.
- El tratamiento de datos debe revisarse frente a los términos aplicables de Meta y
  Telegram y a la normativa local antes del uso comercial.
