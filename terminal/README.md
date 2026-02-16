# terminal/

Terminal emulator modules. `terminal.js` at the project root is the entry point — it calls `initDOM()`, loads the manifest, and boots the keyboard/event system.

## Modules

| File | Purpose |
|------|---------|
| `state.js` | Shared mutable `state` object, cached `dom` refs, `callbacks` for late-bound functions |
| `manifest.js` | Fetches `manifest.json`, builds the filesystem tree, fetches all page content |
| `path.js` | Path resolution: `getNode`, `resolvePath`, `resolveFrom`, `relativeCd`, etc. |
| `input.js` | Input buffer rendering, word navigation, prompt HTML, hint system |
| `output.js` | Node builders, character-by-character animation, animation queue, linkification, `resolveConditional` |
| `commands.js` | `processCommand` switch statement, `sneakyCommands`, `welcomeText` |
| `executables.js` | `resolveExecutable`, `startExecutable`, `stopExecutable`, resize handler |
| `completion.js` | Tab completion: command names, path-aware argument completion |
| `keyboard.js` | Keydown/paste/click handlers, reverse history search, `simulateCommand`, `runCommand`, `boot()` |

## Dependency graph

```
state.js, manifest.js          (no internal imports)
        ↓
     path.js                   (imports state, manifest)
        ↓
     input.js                  (imports state, manifest, path)
        ↓
    output.js                  (imports state, manifest, path, input)
        ↓
  executables.js               (imports state, manifest, path, output, input)
        ↓
   commands.js                 (imports state, manifest, path, output, input, executables)
        ↓
   keyboard.js                 (imports everything above)

  completion.js                (imports state, manifest, path — independent branch)
```

No circular dependencies. `output.js` node builders need `runCommand` (defined in `keyboard.js`), which is resolved via `callbacks.runCommand` — set by `keyboard.js` at boot time.

## Shared state

All mutable globals live on a single `state` object from `state.js`. Modules mutate it directly (`state.animating = true`). DOM refs live on a `dom` object, populated once by `initDOM()`.
