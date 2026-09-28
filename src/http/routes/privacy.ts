import type { Handler } from '../router.ts';

/**
 * Política de privacidad pública, exigida por Meta para publicar la app. Resume
 * `docs/data-policy.md` para clientes; mantener ambos documentos alineados.
 * HTML estático sin scripts ni recursos externos.
 */
const PRIVACY_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de privacidad · Yorki Cuties</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 42rem; margin: 0 auto; padding: 2rem 1rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  @media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #141414; } }
</style>
</head>
<body>
<h1>Política de privacidad</h1>
<p>Última actualización: 28 de septiembre de 2026.</p>
<p>Esta política describe cómo la cuenta de Instagram <strong>@yorki.cuties</strong> (tienda de mascotas en
República Dominicana) trata los mensajes directos que recibe a través de su sistema de atención al cliente.</p>

<h2>Qué datos tratamos</h2>
<ul>
  <li>El texto de los mensajes directos que nos envías por Instagram y nuestras respuestas.</li>
  <li>El identificador que Instagram asigna a tu cuenta para esta conversación, tu nombre y usuario de Instagram, y la fecha y hora de cada mensaje.</li>
  <li>Notas internas de atención: tipo de consulta, prioridad y, si compras, el resultado de la venta.</li>
</ul>
<p>No descargamos fotos, videos ni adjuntos. Nunca te pediremos contraseñas ni datos de tarjetas.</p>

<h2>Para qué los usamos</h2>
<ul>
  <li>Responder tus consultas sobre productos, precios, disponibilidad, pedidos y envíos.</li>
  <li>Permitir que nuestro equipo continúe la conversación contigo.</li>
  <li>Medir, de forma interna y agregada, la calidad de nuestra atención.</li>
</ul>
<p>Algunas respuestas pueden generarse con asistencia automatizada; siempre puedes pedir hablar con una persona.</p>

<h2>Con quién los compartimos</h2>
<p>No vendemos tus datos. Solo los procesan los proveedores técnicos necesarios para operar el servicio:
Meta (Instagram), Cloudflare (alojamiento y base de datos) y Telegram (herramienta interna del equipo de atención).</p>

<h2>Cuánto tiempo los conservamos</h2>
<p>Los mensajes y conversaciones se conservan hasta 12 meses. Los registros técnicos de recepción, hasta 7 días.</p>

<h2 id="eliminacion">Tus derechos y cómo eliminar tus datos</h2>
<p>Puedes pedir una copia, la corrección o la eliminación de tus datos. Escríbenos por mensaje directo a
<strong>@yorki.cuties</strong> en Instagram con el texto «eliminar mis datos». Confirmaremos la eliminación
en un plazo máximo de 30 días.</p>

<h2>Cambios</h2>
<p>Si cambiamos esta política, actualizaremos la fecha de esta página.</p>
</body>
</html>`;

export const privacyHandler: Handler = () =>
  new Response(PRIVACY_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'public, max-age=3600',
    },
  });
