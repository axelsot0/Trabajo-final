export type BodyReadResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' };

/**
 * Lee el cuerpo crudo con un tope de bytes. Se comprueba `Content-Length` primero y
 * después el flujo real, porque la cabecera puede faltar o mentir.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<BodyReadResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };

  if (request.body === null) return { ok: true, bytes: new Uint8Array(0) };

  // En Workers el cuerpo es `ReadableStream<Uint8Array>`; el tipo genérico no lo fija.
  const reader = (request.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
