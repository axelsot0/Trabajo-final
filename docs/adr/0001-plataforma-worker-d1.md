# 0001. Cloudflare Worker + D1 + Static Assets como plataforma única

- **Estado:** Aceptado · 2026-09-27
- **Contexto:** El MVP debe operar dentro de planes gratuitos, sin servidor encendido en
  casa ni intermediario de automatización (Zapier, Make, ManyChat). Necesita un endpoint
  HTTPS público para webhooks de Meta y Telegram, una base de datos relacional pequeña y
  un dashboard estático.
- **Decisión:** Un único Cloudflare Worker sirve webhooks, API JSON, tareas programadas y
  el dashboard (Static Assets). D1 es la base de datos. La URL pública inicial es
  `*.workers.dev`.
- **Consecuencias:**
  - Workers Free: 100.000 solicitudes/día y límite de CPU por invocación. D1 Free:
    5 M filas leídas/día, 100.000 escritas/día, 500 MB por base. Los excesos producen
    errores; el sistema debe degradar de forma explícita (pausar IA, conservar entrantes,
    avisar a agentes).
  - `workers.dev` está orientado a proyectos no críticos según Cloudflare. Un dominio
    propio es opcional y probablemente no gratuito.
  - No se almacenan adjuntos; solo texto y metadatos, para proteger la cuota de D1.
  - Backup: D1 Time Travel Free tiene ventana limitada; se exportan copias cifradas de
    forma periódica a un destino controlado por el dueño (ver runbook).
- **Alternativas descartadas:** VPS gratuito (sin garantía de continuidad), Vercel/Netlify
  Functions + Postgres externo (más piezas y más cuotas que vigilar), Raspberry Pi en casa
  (disponibilidad y exposición de red).
