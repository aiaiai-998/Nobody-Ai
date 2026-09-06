import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import '../src/config/polyfills';
import {
  MAX_ATTACHMENT_TEXT_CHARS,
  buildMessageContent,
  inlineDocumentText,
  messageHasImages,
  pruneOldImages,
} from '../src/services/aiService';
import {
  MAX_DOCUMENTS_PER_MESSAGE,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  dataUrlBytes,
  downscaleImage,
  formatBytes,
  imageBudget,
  isImageMime,
  isPdfMime,
  isPlainTextMime,
  pdfItemsToText,
} from '../src/services/attachments';
import type { Attachment, Message } from '../src/types';

const IMAGE: Attachment = {
  id: 'img1',
  kind: 'image',
  name: 'photo.png',
  mimeType: 'image/png',
  sizeBytes: 2048,
  dataUrl: 'data:image/png;base64,AAAA',
};

const DOC: Attachment = {
  id: 'doc1',
  kind: 'document',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 4096,
  text: 'Annual revenue rose 12% year over year.',
};

function userMessage(content: string, attachments?: Attachment[]): Message {
  return { id: 'm1', role: 'user', content, timestamp: 0, attachments };
}

/* ---------- mime helpers ---------- */

test('mime helpers classify attachments', () => {
  assert.equal(isImageMime('image/png'), true);
  assert.equal(isImageMime('image/svg+xml'), true);
  assert.equal(isImageMime('application/pdf'), false);
  assert.equal(isPdfMime('application/pdf'), true);
  assert.equal(isPdfMime('image/png'), false);
  assert.equal(isPlainTextMime('text/plain'), true);
  assert.equal(isPlainTextMime('text/csv'), true);
  assert.equal(isPlainTextMime('application/pdf'), false);
});

test('formatBytes is human readable', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  // A literal, not MAX_IMAGE_BYTES: this tests formatting, and tying it to the
  // constant made the test fail whenever the limit was retuned.
  assert.equal(formatBytes(4 * 1024 * 1024), '4.0 MB');
});

/* ---------- content building ---------- */

test('a message with no attachments stays a plain string', () => {
  assert.equal(buildMessageContent(userMessage('just text'), true), 'just text');
  assert.equal(buildMessageContent(userMessage('just text', []), true), 'just text');
});

test('document text is folded into the prompt', () => {
  const out = buildMessageContent(userMessage('Summarise this', [DOC]), false);
  assert.equal(typeof out, 'string');
  const text = out as string;
  assert.match(text, /^Summarise this/);
  assert.match(text, /--- Attached file: report\.pdf ---/);
  assert.match(text, /Annual revenue rose 12%/);
});

test('an image becomes a content array only for vision models', () => {
  const parts = buildMessageContent(userMessage('What is this?', [IMAGE]), true);
  assert.ok(Array.isArray(parts));
  const arr = parts as Array<Record<string, unknown>>;
  assert.equal(arr.length, 2);
  assert.deepEqual(arr[0], { type: 'text', text: 'What is this?' });
  assert.deepEqual(arr[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,AAAA' },
  });

  // A text-only model gets the prompt without the image rather than a 400.
  const textOnly = buildMessageContent(userMessage('What is this?', [IMAGE]), false);
  assert.equal(typeof textOnly, 'string');
  assert.equal(textOnly, 'What is this?');
});

test('multiple images all become parts', () => {
  const second = { ...IMAGE, id: 'img2', dataUrl: 'data:image/png;base64,BBBB' };
  const parts = buildMessageContent(userMessage('compare', [IMAGE, second]), true) as Array<
    Record<string, unknown>
  >;
  assert.equal(parts.length, 3);
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[2].type, 'image_url');
});

test('messageHasImages only counts images that actually carry bytes', () => {
  assert.equal(messageHasImages(userMessage('x', [IMAGE])), true);
  assert.equal(messageHasImages(userMessage('x', [DOC])), false);
  assert.equal(
    messageHasImages(userMessage('x', [{ ...IMAGE, dataUrl: undefined }])),
    false
  );
  assert.equal(messageHasImages(userMessage('x')), false);
});

test('an attachment that failed to read is reported to the model, not silently dropped', () => {
  const broken: Attachment = { ...DOC, id: 'doc2', text: undefined, error: 'password protected' };
  const text = inlineDocumentText('Summarise', [broken]);
  assert.match(text, /Could not read this file: password protected/);
});

test('oversized documents are truncated rather than blowing the context window', () => {
  const huge: Attachment = { ...DOC, id: 'doc3', text: 'x'.repeat(MAX_ATTACHMENT_TEXT_CHARS + 5000) };
  const text = inlineDocumentText('Summarise', [huge]);
  assert.match(text, /\[truncated\]$/);
  // The prompt itself plus a little scaffolding, but not the whole document.
  assert.ok(text.length < MAX_ATTACHMENT_TEXT_CHARS + 200);
});

test('the character budget is shared across several documents', () => {
  const half = MAX_ATTACHMENT_TEXT_CHARS / 2;
  const a = { ...DOC, id: 'd1', name: 'a.txt', text: 'A'.repeat(half) };
  const b = { ...DOC, id: 'd2', name: 'b.txt', text: 'B'.repeat(half + 1000) };
  const text = inlineDocumentText('q', [a, b]);
  assert.match(text, /a\.txt/);
  assert.match(text, /b\.txt/);
  assert.ok(text.length < MAX_ATTACHMENT_TEXT_CHARS + 200);
});

/* ---------- pdf.js ---------- */

test('pdf.js extracts the text layer from a real PDF and pdfItemsToText renders it', async () => {
  // Exercised against pdf.js's Node-compatible build; the browser build differs
  // only in how the worker is loaded. Proves the Promise.try shim is doing its
  // job and that the item->text mapping produces real content.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(
    new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url)
  );

  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url)))
  );

  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    assert.ok(doc.numPages >= 1);
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    assert.equal(pdfItemsToText(content.items), 'Kian AI fixture document');
  } finally {
    await task.destroy();
  }
});

test('pdfItemsToText collapses whitespace and ignores non-text items', () => {
  assert.equal(
    pdfItemsToText([{ str: 'Hello' }, { str: '   world  ' }, {}]),
    'Hello world'
  );
  assert.equal(pdfItemsToText([]), '');
});

/* ---------- attachment count caps ---------- */

function imageAttachment(id: string): Attachment {
  return {
    id,
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 1024,
    dataUrl: `data:image/png;base64,${id}`,
  };
}

test('per-message caps stay under the provider limit of 20 images + documents', () => {
  assert.equal(MAX_IMAGES_PER_MESSAGE, 10);
  assert.equal(MAX_DOCUMENTS_PER_MESSAGE, 5);
  assert.ok(
    MAX_IMAGES_PER_MESSAGE + MAX_DOCUMENTS_PER_MESSAGE < 20,
    'OpenRouter rejects a request above 20 combined images and documents'
  );
});

test('pruneOldImages leaves a message alone when under the request cap', () => {
  const messages = [userMessage('a', [imageAttachment('i1'), imageAttachment('i2')])];
  assert.deepEqual(pruneOldImages(messages), messages);
});

test('pruneOldImages keeps the most recent images and drops the oldest', () => {
  const messages = [
    userMessage('oldest', [imageAttachment('old1'), imageAttachment('old2')]),
    userMessage('newest', [imageAttachment('new1'), imageAttachment('new2')]),
  ];

  const pruned = pruneOldImages(messages, 2);

  // Oldest message loses both images, newest keeps both.
  assert.deepEqual(pruned[0].attachments, []);
  assert.deepEqual(
    pruned[1].attachments?.map((a) => a.id),
    ['new1', 'new2']
  );
  // Content is untouched; only the image parts are trimmed.
  assert.equal(pruned[0].content, 'oldest');
});

test('pruneOldImages never removes document attachments', () => {
  const messages = [
    userMessage('doc', [DOC, imageAttachment('old')]),
    userMessage('img', [imageAttachment('new')]),
  ];

  const pruned = pruneOldImages(messages, 1);

  assert.deepEqual(
    pruned[0].attachments?.map((a) => a.id),
    ['doc1'],
    'the document survives even though its image was dropped'
  );
  assert.deepEqual(
    pruned[1].attachments?.map((a) => a.id),
    ['new']
  );
});

/* ---------- proxy body budget ---------- */

test('imageBudget sums only images and flags an over-budget message', () => {
  const under = [
    { kind: 'image', sizeBytes: 400_000 },
    { kind: 'image', sizeBytes: 400_000 },
    // Documents are inlined as text, not base64, so they do not count here.
    { kind: 'document', sizeBytes: 9_000_000 },
  ];
  const ok = imageBudget(under);
  assert.equal(ok.totalBytes, 800_000);
  assert.equal(ok.over, false);

  const heavy = Array.from({ length: 10 }, () => ({ kind: 'image', sizeBytes: 400_000 }));
  const bad = imageBudget(heavy);
  assert.equal(bad.totalBytes, 4_000_000);
  assert.equal(bad.over, true, '10 raw photos would blow a 4.5 MB function body');
  assert.equal(bad.limitBytes, MAX_TOTAL_IMAGE_BYTES);
});

test('the per-image limit fits inside what a serverless body can carry', () => {
  // Base64 inflates by ~4/3; Vercel rejects above 4.5 MB.
  const encoded = MAX_IMAGE_BYTES * (4 / 3);
  assert.ok(encoded < 4.5 * 1024 * 1024, `a single max image encodes to ${encoded} bytes`);
  const totalEncoded = MAX_TOTAL_IMAGE_BYTES * (4 / 3);
  assert.ok(totalEncoded < 4.5 * 1024 * 1024, `a full set encodes to ${totalEncoded} bytes`);
});

test('dataUrlBytes estimates the decoded size of a base64 payload', () => {
  const bytes = new Uint8Array(3000).fill(7);
  const b64 = Buffer.from(bytes).toString('base64');
  const estimate = dataUrlBytes(`data:image/jpeg;base64,${b64}`);
  assert.ok(Math.abs(estimate - 3000) <= 3, `estimated ${estimate}, expected ~3000`);
  assert.equal(dataUrlBytes('data:,'), 0);
});

test('downscaleImage leaves the original alone when there is no canvas', async () => {
  // Node has no document/canvas, so this exercises the fallback path: the
  // browser does the resizing, and a failure must not lose the image.
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    ),
    (c) => c.charCodeAt(0)
  );
  const file = new File([png], 'pixel.png', { type: 'image/png' });
  const out = await downscaleImage(file);
  assert.ok(out.dataUrl.startsWith('data:image/png;base64,'), 'original mime preserved');
  assert.equal(out.bytes, file.size);
});
