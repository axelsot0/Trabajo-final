import { describe, expect, it } from 'vitest';

import {
  computeMetaSignatureHeader,
  constantTimeEqualString,
  verifyMetaSignature,
} from '../../../src/adapters/meta/signature.ts';

const body = new TextEncoder().encode('{"object":"instagram","entry":[]}');

describe('verifyMetaSignature', () => {
  it('acepta la firma correcta y rechaza secreto, cuerpo o cabecera alterados', async () => {
    const header = await computeMetaSignatureHeader('secreto', body);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);

    await expect(verifyMetaSignature('secreto', body, header)).resolves.toBe(true);
    await expect(verifyMetaSignature('otro', body, header)).resolves.toBe(false);
    await expect(
      verifyMetaSignature('secreto', new TextEncoder().encode('{"object":"instagram"}'), header),
    ).resolves.toBe(false);
    await expect(verifyMetaSignature('secreto', body, null)).resolves.toBe(false);
    await expect(verifyMetaSignature('secreto', body, 'sha1=abc')).resolves.toBe(false);
    await expect(verifyMetaSignature('secreto', body, 'sha256=zz')).resolves.toBe(false);
    await expect(verifyMetaSignature('secreto', body, 'sha256=00')).resolves.toBe(false);
  });

  it('acepta hexadecimal en mayúsculas', async () => {
    const header = await computeMetaSignatureHeader('secreto', body);
    await expect(
      verifyMetaSignature('secreto', body, header.toUpperCase().replace('SHA256', 'sha256')),
    ).resolves.toBe(true);
  });
});

describe('constantTimeEqualString', () => {
  it('compara sin atajos y trata longitudes distintas como diferentes', () => {
    expect(constantTimeEqualString('abc', 'abc')).toBe(true);
    expect(constantTimeEqualString('abc', 'abd')).toBe(false);
    expect(constantTimeEqualString('abc', 'abcd')).toBe(false);
    expect(constantTimeEqualString('', '')).toBe(true);
  });
});
