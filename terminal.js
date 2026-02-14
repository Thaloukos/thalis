import { initDOM } from './terminal/state.js';
import { loadManifest } from './terminal/manifest.js';
import { boot } from './terminal/keyboard.js';

initDOM();
await loadManifest();
boot();
