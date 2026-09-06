import type { Attachment } from '../types';

/** Providers reject oversized bodies, so cap before base64 inflates them ~33%. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

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
export async function readFileAsAttachment(file: File): Promise<Attachment> {
  const base: Attachment = {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: isImageMime(file.type) ? 'image' : 'document',
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  };

  if (base.kind === 'image') {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ...base, error: `image is ${formatBytes(file.size)}, over the ${formatBytes(MAX_IMAGE_BYTES)} limit` };
    }
    return { ...base, dataUrl: await toDataUrl(file) };
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
