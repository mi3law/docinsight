// The analysis in a Web Worker, so parsing and statistics never block scrolling or the scrubber.
import { analyse } from './analyse.js';

self.onmessage = e => {
  const { id, raw, settings, context } = e.data || {};
  try {
    self.postMessage({ id, A: analyse(raw, settings, context) });
  } catch (err) {
    self.postMessage({ id, error: { name: err && err.name, code: err && err.code, message: String(err && err.message || err) } });
  }
};
