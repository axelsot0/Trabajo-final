# Validación con Meta (Instagram Platform)

Registro de hipótesis y comprobaciones sobre la cuenta profesional real. **Sin datos
personales ni capturas con nombres, IDs o mensajes de clientes.** Anotar fecha, enlace de
la documentación consultada y resultado. Actualizar antes de ejecutar los pasos 3, 4 y 12
del plan.

## Hipótesis a comprobar

|   # | Hipótesis                                                                                                                                 | Estado    | Fecha | Resultado / evidencia anonimizada |
| --: | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----- | --------------------------------- |
|  H1 | La cuenta está en modo profesional (Business o Creator) y puede autorizar la app con Instagram Login.                                     | Pendiente |       |                                   |
|  H2 | Los permisos `instagram_business_basic` e `instagram_business_manage_messages` se conceden en la pantalla oficial.                        | Pendiente |       |                                   |
|  H3 | El webhook recibe el campo `messages` del objeto `instagram` con `sender.id`, `recipient.id`, `timestamp`, `message.mid`, `message.text`. | Pendiente |       |                                   |
|  H4 | Los ecos de mensajes propios llegan con `message.is_echo = true` y se descartan.                                                          | Pendiente |       |                                   |
|  H5 | El envío a `/{ig_user_id}/messages` responde en el mismo DM que abrió el cliente.                                                         | Pendiente |       |                                   |
|  H6 | Un usuario externo (no administrador/tester de la app) puede escribir y recibir respuesta sin App Review, o bien Meta exige revisión.     | Pendiente |       |                                   |
|  H7 | La etiqueta `HUMAN_AGENT` está disponible para esta app (ventana de 7 días para humanos).                                                 | Pendiente |       |                                   |
|  H8 | La Conversations API devuelve el histórico con paginación y límites conocidos.                                                            | Pendiente |       |                                   |
|  H9 | Los mensajes enviados desde la app nativa u otras herramientas llegan al webhook (eco) y no rompen el estado.                             | Pendiente |       |                                   |
| H10 | Los adjuntos llegan con `message.attachments[].type` y una URL temporal; no se descargan.                                                 | Pendiente |       |                                   |

## Versión de API y cuerpo exacto

- Versión de Graph API usada: `v23.0` por defecto en `wrangler.jsonc` (`META_GRAPH_VERSION`); confirmar la vigente antes del paso 4 real.
- Endpoint de envío implementado: `POST https://graph.instagram.com/{version}/{ig_user_id}/messages` con
  `{"recipient":{"id":"<IGSID>"},"message":{"text":"..."}}` y `Authorization: Bearer <token>`; para
  Human Agent se añade `"messaging_type":"MESSAGE_TAG","tag":"HUMAN_AGENT"`. Respuesta esperada:
  `{"recipient_id":"...","message_id":"..."}`. Cuerpo verificado contra la colección oficial de Postman: `pendiente`.
- Timeout del adaptador: 10 s. Un timeout se trata como acuse incierto y se concilia (ecos + H11) antes de reintentar.

## Referencias

- Instagram API with Instagram Login: <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/>
- Messaging API: <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api>
- Conversations API: <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api>
- Webhooks: <https://developers.facebook.com/documentation/instagram-platform/webhooks>
- Política de mensajería: <https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy>
- Niveles de acceso: <https://developers.facebook.com/docs/graph-api/overview/access-levels/>
