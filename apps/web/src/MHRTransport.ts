import { MHR_CORRECTIVES_ASSET_URL } from './MHRCorrectives';

/** Wire compression only; the decoded learned-model bytes remain unchanged. */
export const MHR_CORRECTIVES_GZIP_URL = `${MHR_CORRECTIVES_ASSET_URL}.gz`;
export const MHR_CORRECTIVES_GZIP_MAX_BYTES = 8 * 1024 * 1024;
export const MHR_CORRECTIVES_DECODED_BYTES = 9587356;
export const MHR_CORRECTIVES_SHA256 = 'b09418f280a379c4f4a3fb72f4c8b909a6339a5fd1c7ed5513f3b8a17b947bde';

/** Peek through a tee without losing bytes or awaiting cancellation of only
 * one tee branch (that promise waits for the consuming branch to finish). */
async function inspectBody(body: ReadableStream<Uint8Array<ArrayBuffer>>, signal: AbortSignal) {
  const [peek, data] = body.tee(), reader = peek.getReader();
  const signature = new Uint8Array(8);
  let offset = 0, inspectedBytes = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
    void data.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (offset < signature.byteLength) {
      const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) throw new Error('人体模型压缩数据无效，请刷新页面重试。');
      inspectedBytes += value.byteLength;
      const count = Math.min(signature.byteLength - offset, value.byteLength);
      signature.set(value.subarray(0, count), offset); offset += count;
    }
    return { signature, inspectedBytes, data };
  } catch (error) {
    void data.cancel(error).catch(() => {});
    signal.throwIfAborted(); throw error;
  } finally {
    void reader.cancel().catch(() => {}); reader.releaseLock();
    signal.removeEventListener('abort', abort);
  }
}

export async function readMHRCorrectives(signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器无法载入人体模型，请更新浏览器后重试。');
  const response = await fetch(MHR_CORRECTIVES_GZIP_URL, { signal });
  signal.throwIfAborted();
  if (!response.ok || !response.body) throw new Error('人体模型载入失败，请刷新页面重试。');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MHR_CORRECTIVES_GZIP_MAX_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new Error('人体模型压缩资产超过大小限制。');
  }
  const { signature, inspectedBytes, data } = await inspectBody(response.body, signal);
  const raw = signature.every((byte, index) => byte === [77, 72, 82, 67, 79, 82, 82, 49][index]);
  const gzip = signature[0] === 0x1f && signature[1] === 0x8b && signature[2] === 8;
  if (!raw && (!gzip || inspectedBytes > MHR_CORRECTIVES_GZIP_MAX_BYTES)) {
    await data.cancel().catch(() => {});
    throw new Error(inspectedBytes > MHR_CORRECTIVES_GZIP_MAX_BYTES ? '人体模型压缩资产超过大小限制。' : '人体模型压缩数据无效，请刷新页面重试。');
  }
  // Servers can expose the file as an explicit gzip archive OR supply HTTP
  // Content-Encoding:gzip, which Fetch transparently restores to MHRCORR1.
  // Prefixes distinguish those representations, including an outer HTTP
  // encoding around an explicit archive, without fetching a second resource.
  let decoded: ReadableStream<Uint8Array<ArrayBuffer>>;
  if (raw) decoded = data;
  else {
    let encodedBytes = 0;
    const wire = data.pipeThrough(new TransformStream<Uint8Array<ArrayBuffer>, BufferSource>({
      transform(chunk, controller) {
        encodedBytes += chunk.byteLength;
        if (encodedBytes > MHR_CORRECTIVES_GZIP_MAX_BYTES) throw new Error('人体模型压缩资产超过大小限制。');
        controller.enqueue(chunk);
      },
    }), { signal });
    decoded = wire.pipeThrough(new DecompressionStream('gzip'), { signal });
  }
  const reader = decoded.getReader();
  const bytes = new Uint8Array(MHR_CORRECTIVES_DECODED_BYTES);
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let offset = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) throw new Error('人体模型展开资产超过大小限制。');
      bytes.set(value, offset); offset += value.byteLength;
    }
    if (offset !== bytes.byteLength) throw new Error('人体模型展开资产大小无效。');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    signal.throwIfAborted();
    const checksum = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
    if (checksum !== MHR_CORRECTIVES_SHA256) throw new Error('人体模型资产校验失败，请刷新页面重试。');
    return bytes.buffer;
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    signal.throwIfAborted();
    throw error instanceof Error && error.message.startsWith('人体模型') ? error : new Error('人体模型压缩数据无效，请刷新页面重试。', { cause: error });
  } finally { reader.releaseLock(); signal.removeEventListener('abort', abort); }
}
