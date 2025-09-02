// Minimal polyfills used by the editor for older browsers.

// Fallback for structuredClone, which copies objects without references.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = obj => JSON.parse(JSON.stringify(obj));
}
