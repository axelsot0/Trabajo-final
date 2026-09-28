const encoder = new TextEncoder();

async function hmacSha256(secret: string, body: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Comparación en tiempo constante; longitudes distintas devuelven `false` sin atajos. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Valor esperado de `X-Hub-Signature-256` para un cuerpo dado. Útil en pruebas. */
export async function computeMetaSignatureHeader(
  appSecret: string,
  rawBody: Uint8Array,
): Promise<string> {
  return `sha256=${toHex(await hmacSha256(appSecret, rawBody))}`;
}

/**
 * Verifica la firma HMAC SHA-256 de Meta sobre los bytes crudos del cuerpo.
 * Nunca se parsea el JSON antes de esta comprobación.
 */
export async function verifyMetaSignature(
  appSecret: string,
  rawBody: Uint8Array,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const provided = fromHex(header.slice('sha256='.length));
  if (provided?.byteLength !== 32) return false;
  const expected = await hmacSha256(appSecret, rawBody);
  return constantTimeEqual(provided, expected);
}

/** Comparación en tiempo constante de dos cadenas (verify token de Meta, secretos de cabecera). */
export function constantTimeEqualString(a: string, b: string): boolean {
  return constantTimeEqual(encoder.encode(a), encoder.encode(b));
}
