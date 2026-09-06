/**
 * pdf.js 6.x calls `Promise.try`, which is ES2025 and still missing from
 * Safari < 18.2, Chrome < 130 and Firefox < 134. Without this shim, attaching a
 * PDF on those browsers throws instead of extracting text.
 *
 * Imported before anything that touches pdf.js.
 */

type TryFn = (callback: () => unknown) => Promise<unknown>;

const PromiseCtor = Promise as unknown as { try?: TryFn };

if (typeof PromiseCtor.try !== 'function') {
  PromiseCtor.try = function tryFn(callback: () => unknown): Promise<unknown> {
    // `new Promise` catches a synchronous throw and rejects, matching the spec.
    return new Promise((resolve) => resolve(callback()));
  };
}

export {};
