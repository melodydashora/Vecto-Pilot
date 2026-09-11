const { TextEncoder, TextDecoder } = require('node:util');
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
// jsdom has no layout engine; behavior tests retain the real Radix controls.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
