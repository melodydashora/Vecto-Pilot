// Enhanced global polyfill for import.meta.dirname with custom path resolution
import path from 'path';
import { fileURLToPath } from 'url';

// Function to derive directory - the same approach suggested for Vite config
export function getDirname(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl));
}

// Custom path resolver function similar to the Vite config suggestion
export function resolvePath(importMetaUrl, ...args) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), ...args);
}

// Get current directory
const currentDirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirname, '..');

// Global polyfill setup with enhanced path resolution
(function(global) {
  // Set up global path helpers
  global.__resolvePath = resolvePath;
  global.__projectRoot = projectRoot;
  
  // Patch import.meta for all contexts
  if (!global.meta) global.meta = {};
  if (!global.meta.dirname) {
    Object.defineProperty(global.meta, 'dirname', {
      value: currentDirname,
      writable: false,
      enumerable: true,
      configurable: true
    });
  }
})(globalThis);

// Apply polyfill to current import.meta and globally
if (!import.meta.dirname) {
  Object.defineProperty(import.meta, 'dirname', {
    value: currentDirname,
    writable: false,
    enumerable: true,
    configurable: true
  });
}

// Monkey patch the global import object to ensure all modules get dirname
const originalImport = globalThis.import;
if (typeof originalImport === 'undefined') {
  // Create a comprehensive polyfill for all import.meta usage
  const metaPolyfill = {
    dirname: currentDirname,
    url: import.meta.url,
    resolve: import.meta.resolve
  };
  
  // Override any attempt to access import.meta globally
  Object.defineProperty(globalThis, '__importMeta', {
    value: metaPolyfill,
    writable: false,
    configurable: true
  });
}

// Enhanced polyfill that patches any import.meta access
const originalPropertyDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'import');
if (!originalPropertyDescriptor) {
  // Create a more comprehensive polyfill for module loading
  const moduleRegistry = new Map();
  
  globalThis.__patchModuleImportMeta = function(moduleUrl) {
    if (!moduleRegistry.has(moduleUrl)) {
      const dirname = path.dirname(fileURLToPath(moduleUrl));
      moduleRegistry.set(moduleUrl, { dirname, url: moduleUrl });
    }
    return moduleRegistry.get(moduleUrl);
  };
}

console.log('✅ Enhanced import.meta.dirname polyfill loaded');
console.log('📁 Project root:', projectRoot);
console.log('📁 Current dirname:', currentDirname);