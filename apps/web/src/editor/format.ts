/** mm:ss for transport displays. */
export const formatClock = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';

/** File name derived from a scene name, safe on common file systems. */
export const safeFileName = (name: string, fallback = 'scene') => name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || fallback;

/** Start a browser download for a locally generated file. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = fileName; link.hidden = true;
  // A connected anchor keeps the suggested file name in every browser.
  document.body.append(link); link.click(); link.remove();
  // Some browsers start reading the object URL after click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
