import type { Attachment } from '../types';

/**
 * Serverless proxies cap the request body hard — Vercel rejects anything over
 * 4.5 MB with a 413, and no config flag changes it. Base64 then inflates the
 * payload by ~33%, so a single 4 MB phone photo (5.3 MB encoded) would fail
 * before reaching the model.
 *
 * Images are therefore downscaled in the browser first, which is what the
 * vision models want anyway: they internally resize to roughly this dimension,
 * so the extra pixels only ever cost bandwidth.
 */
export const MAX_IMAGE_DIMENSION = 1024;
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
/** All images in one message combined, after downscaling. */
export const MAX_TOTAL_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/**
 * OpenRouter rejects a request outright once it carries more than 20 images and
 * documents combined ("too many images and documents: 27 + 0 > 20"). These
 * per-message caps sit well under that, and leave room for the same files
 * reappearing in conversation history.
 */
export const MAX_IMAGES_PER_MESSAGE = 10;
export const MAX_DOCUMENTS_PER_MESSAGE = 5;

const IMAGE_MIME_PREFIX = 'image/';
const PDF_MIME = 'application/pdf';
const PLAIN_TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
]);

export function isImageMime(mime: string): boolean {
  return mime.startsWith(IMAGE_MIME_PREFIX);
}

export function isPdfMime(mime: string): boolean {
  return mime === PDF_MIME;
}

export function isPlainTextMime(mime: string): boolean {
  return PLAIN_TEXT_MIMES.has(mime) || mime.startsWith('text/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Join pdf.js text items into page text. Exported for testing. */
export function pdfItemsToText(items: ReadonlyArray<{ str?: string }>): string {
  return items
    .map((item) => item.str ?? '')
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Pull the text layer out of a PDF. No provider we target accepts a PDF
 * directly on every model, so extracting client-side is both free and portable.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Loaded on demand so the ~860 KB pdf.js bundle stays out of the initial
  // download for the many users who never attach a PDF.
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;

  // `destroy()` lives on the loading task, not on the resolved document proxy.
  const task = getDocument({ data: bytes.slice() });
  const pages: string[] = [];

  try {
    const doc = await task.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = pdfItemsToText(content.items as Array<{ str?: string }>);
      if (text) pages.push(text);
    }
  } finally {
    await task.destroy();
  }

  if (pages.length === 0) {
    throw new Error('no selectable text found (it may be a scanned image PDF — try OCR, or attach it as an image instead)');
  }

  return pages.join('\n\n');
}

async function toDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const view = new Uint8Array(buffer);
  // Chunked to avoid blowing the call-stack limit on multi-MB files.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** Turn a picked file into an Attachment, capturing failures as data. */
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode that image'));
    img.src = src;
  });
}

/** Approximate decoded size of a data URL's base64 payload. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  return Math.round((b64.length * 3) / 4);
}

/**
 * Shrink an image so it survives the proxy's body limit. Falls back to the
 * untouched original whenever the browser cannot do the work (no canvas, an
 * exotic format, a decode failure) — a slightly-too-big image that the provider
 * might still accept beats refusing outright.
 */
export async function downscaleImage(
  file: File,
  maxDim = MAX_IMAGE_DIMENSION,
  quality = 0.82
): Promise<{ dataUrl: string; bytes: number }> {
  const original = await toDataUrl(file);

  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return { dataUrl: original, bytes: file.size };
  }

  let url: string | null = null;
  try {
    url = URL.createObjectURL(file);
    const img = await loadImageElement(url);
    const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl: original, bytes: file.size };
    ctx.drawImage(img, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = dataUrlBytes(dataUrl);
    // Never make it worse: keep the original if re-encoding grew it.
    return bytes < file.size ? { dataUrl, bytes } : { dataUrl: original, bytes: file.size };
  } catch {
    return { dataUrl: original, bytes: file.size };
  } finally {
    if (url !== null) URL.revokeObjectURL(url);
  }
}

/**
 * Pure budget check over already-built attachments, so the caller can warn
 * before sending rather than collecting a 413 from the proxy.
 */
export function imageBudget(attachments: ReadonlyArray<{ kind: string; sizeBytes: number }>): {
  totalBytes: number;
  over: boolean;
  limitBytes: number;
} {
  const totalBytes = attachments
    .filter((a) => a.kind === 'image')
    .reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
  return { totalBytes, over: totalBytes > MAX_TOTAL_IMAGE_BYTES, limitBytes: MAX_TOTAL_IMAGE_BYTES };
}

export async function readFileAsAttachment(file: File): Promise<Attachment> {
  const base: Attachment = {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: isImageMime(file.type) ? 'image' : 'document',
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  };

  if (base.kind === 'image') {
    const scaled = await downscaleImage(file);
    if (scaled.bytes > MAX_IMAGE_BYTES) {
      return {
        ...base,
        error: `image is still ${formatBytes(scaled.bytes)} after resizing, over the ${formatBytes(
          MAX_IMAGE_BYTES
        )} limit. Try a smaller or simpler photo.`,
      };
    }
    // Report what will actually be sent, not the size on disk.
    return { ...base, sizeBytes: scaled.bytes, dataUrl: scaled.dataUrl };
  }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ...base, error: `file is ${formatBytes(file.size)}, over the ${formatBytes(MAX_DOCUMENT_BYTES)} limit` };
  }

  try {
    if (isPdfMime(file.type)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { ...base, text: await extractPdfText(bytes) };
    }

    if (isPlainTextMime(file.type)) {
      return { ...base, text: await file.text() };
    }

    return {
      ...base,
      error: `unsupported file type "${file.type || 'unknown'}". Images, PDFs and plain text work.`,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}
