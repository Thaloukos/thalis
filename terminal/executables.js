import { state, dom } from './state.js';
import { tree } from './manifest.js';
import { parentOf, getNode, resolveFrom } from './path.js';
import { drainQueue, scrollToBottom } from './output.js';
import { updatePrompt } from './input.js';

// --- Executable resolution (tree-driven) ---
export function resolveExecutable(path) {
    let clean = path;
    if (clean.startsWith("./")) clean = clean.slice(2);

    // Try resolving as a relative/absolute path with exec at the end
    let basePath = state.currentPath;
    let execName = clean;

    if (clean.startsWith("~/")) {
        basePath = "~";
        clean = clean.slice(2);
    } else if (clean.startsWith("../")) {
        const parent = parentOf(state.currentPath);
        if (parent === null) return null;
        basePath = parent;
        clean = clean.slice(3);
    }

    // Handle path segments: walk to the directory, then check executable
    const parts = clean.split("/");
    execName = parts.pop();
    if (parts.length > 0) {
        basePath = resolveFrom(basePath, parts.join("/"));
        if (basePath === null) return null;
    }

    // Look for executable in the node
    const node = basePath === "~" ? null : getNode(basePath);
    if (basePath === "~") {
        // Check all top-level nodes for an executable match
        for (const topNode of Object.values(tree)) {
            const match = Object.keys(topNode.executables).find(k => k.toLowerCase() === execName.toLowerCase());
            if (match) return topNode.executables[match];
        }
        return null;
    }
    if (!node) return null;
    const match = Object.keys(node.executables).find(k => k.toLowerCase() === execName.toLowerCase());
    if (match) return node.executables[match];
    return null;
}

// --- Executable lifecycle ---
export async function startExecutable(exec) {
    state.gameMode = true;
    dom.output.style.display = "none";
    dom.inputLine.style.display = "none";
    document.getElementById("nav").style.display = "none";

    const container = document.createElement("div");
    container.id = "game-container";
    container.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:100;";
    document.body.appendChild(container);

    const mod = await import(exec.src);
    state.currentModule = mod;
    mod.start(container, stopExecutable);
}

export function stopExecutable() {
    if (state.currentModule) {
        state.currentModule.stop();
    }
    state.currentModule = null;
    state.gameMode = false;
    const container = document.getElementById("game-container");
    if (container) container.parentNode.removeChild(container);

    dom.output.style.display = "";
    dom.inputLine.style.display = "flex";
    document.getElementById("nav").style.display = "flex";

    state.animating = false;
    updatePrompt();
    scrollToBottom();
    drainQueue();
}

// --- Resize handler ---
let resizeTimer = null;
window.addEventListener("resize", function () {
    if (!state.gameMode || !state.currentModule) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        state.currentModule.handleResize();
    }, 150);
});
