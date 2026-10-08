import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MHR_CORRECTIVES_DECODED_BYTES, MHR_CORRECTIVES_GZIP_MAX_BYTES,
  MHR_CORRECTIVES_GZIP_URL, readMHRCorrectives,
} from './MHRTransport';

const raw = readFileSync(new URL('../public/models/neutral-mhr-correctives-v1.bin', import.meta.url));
const gzip = gzipSync(raw);
const buffer = (value: Uint8Array): ArrayBuffer => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
const serve = (response: Response) => {
  const request = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', request); return request;
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('lossless bounded MHR wire compression', () => {
  it('restores the exact original source bytes using one cached-policy static request', async () => {
    const signal = new AbortController().signal;
    const request = serve(new Response(buffer(gzip), { headers: { 'content-length': String(gzip.byteLength) } }));
    const decoded = await readMHRCorrectives(signal);
    expect(decoded.byteLength).toBe(MHR_CORRECTIVES_DECODED_BYTES);
    expect(Buffer.from(decoded).equals(raw)).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith(MHR_CORRECTIVES_GZIP_URL, { signal });
  });

  it('accepts Fetch-transparent HTTP gzip without decompressing twice or applying the encoded cap to decoded bytes', async () => {
    const signal = new AbortController().signal;
    const request = serve(new Response(buffer(raw), { headers: { 'content-encoding': 'gzip', 'content-length': String(gzip.byteLength) } }));
    const decoded = await readMHRCorrectives(signal);
    expect(decoded.byteLength).toBeGreaterThan(MHR_CORRECTIVES_GZIP_MAX_BYTES);
    expect(Buffer.from(decoded).equals(raw)).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith(MHR_CORRECTIVES_GZIP_URL, { signal });
  });

  it('preserves either representation when its signature spans one-to-eight-byte chunks', async () => {
    for (const payload of [raw, gzip]) for (let size = 1; size <= 8; size++) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < 8; offset += size) controller.enqueue(new Uint8Array(payload.subarray(offset, Math.min(offset + size, 8))));
          controller.enqueue(new Uint8Array(payload.subarray(8))); controller.close();
        },
      });
      const request = serve(new Response(body));
      expect(Buffer.from(await readMHRCorrectives(new AbortController().signal)).equals(raw)).toBe(true);
      expect(request).toHaveBeenCalledOnce();
    }
  });

  it('rejects empty, truncated signatures and unexpected plain bodies without a second request', async () => {
    for (const payload of [new Uint8Array(), raw.subarray(0, 7), new TextEncoder().encode('unexpected body')]) {
      const request = serve(new Response(buffer(payload)));
      await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow('压缩数据无效');
      expect(request).toHaveBeenCalledOnce();
    }
  });

  it('rejects a declared oversized wire body and cancels it before decompression', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    serve(new Response(body, { headers: { 'content-length': String(MHR_CORRECTIVES_GZIP_MAX_BYTES + 1) } }));
    await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow('压缩资产超过大小限制');
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('enforces the wire cap during streaming without trusting content-length', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MHR_CORRECTIVES_GZIP_MAX_BYTES + 1)); },
      cancel: cancelled,
    });
    const request = serve(new Response(body));
    await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow('压缩资产超过大小限制');
    expect(request).toHaveBeenCalledOnce(); expect(cancelled).toHaveBeenCalledOnce();
  });

  it('stops expansion at the fixed decoded cap before hashing or applying data', async () => {
    serve(new Response(buffer(gzipSync(new Uint8Array(MHR_CORRECTIVES_DECODED_BYTES + 1)))));
    const digest = vi.spyOn(crypto.subtle, 'digest');
    await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow('展开资产超过大小限制');
    expect(digest).not.toHaveBeenCalled();
  });

  it('bounds and verifies the already-decoded representation as strictly as explicit gzip', async () => {
    const oversized = new Uint8Array(MHR_CORRECTIVES_DECODED_BYTES + 1); oversized.set(raw);
    serve(new Response(buffer(oversized))); const digest = vi.spyOn(crypto.subtle, 'digest');
    await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow('展开资产超过大小限制');
    expect(digest).not.toHaveBeenCalled();
    const different = new Uint8Array(raw); different[100] ^= 1;
    serve(new Response(buffer(different)));
    await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow('资产校验失败');
  });

  it('rejects truncated, CRC-corrupt and different same-size decoded payloads', async () => {
    const invalidCRC = new Uint8Array(gzip); invalidCRC[invalidCRC.length - 8] ^= 1;
    for (const payload of [gzipSync(new Uint8Array(32)), invalidCRC, gzipSync(new Uint8Array(MHR_CORRECTIVES_DECODED_BYTES))]) {
      const request = serve(new Response(buffer(payload)));
      await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow(/人体模型/);
      expect(request).toHaveBeenCalledOnce();
    }
  });

  it('honors pre-abort and unsupported browsers without issuing a fallback request', async () => {
    const request = serve(new Response(buffer(gzip))); const controller = new AbortController(); controller.abort();
    await expect(readMHRCorrectives(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(readMHRCorrectives(new AbortController().signal)).rejects.toThrow('更新浏览器');
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels a blocked source and decompression when the scene aborts', async () => {
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(gzip.subarray(0, 10000))); },
      pull() { started(); }, cancel: cancelled,
    });
    serve(new Response(body)); const controller = new AbortController();
    const pending = readMHRCorrectives(controller.signal); await ready; controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('cancels a blocked signature or already-decoded source when the scene aborts', async () => {
    for (const prefix of [raw.subarray(0, 3), raw.subarray(0, 10000)]) {
      let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
      const cancelled = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(prefix)); },
        pull() { started(); }, cancel: cancelled,
      });
      serve(new Response(body)); const controller = new AbortController();
      const pending = readMHRCorrectives(controller.signal); await ready; await Promise.resolve(); controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(cancelled).toHaveBeenCalledOnce();
    }
  });

  it('discards a completed decode if cancellation arrives during checksum verification', async () => {
    serve(new Response(buffer(gzip))); const controller = new AbortController();
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async () => { controller.abort(); return new ArrayBuffer(32); });
    await expect(readMHRCorrectives(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
