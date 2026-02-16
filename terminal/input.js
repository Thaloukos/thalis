import { state, dom } from './state.js';
import { isMobile } from './manifest.js';
import { getNode } from './path.js';

// --- Render input ---
export function renderInput() {
    dom.cursorEl.style.animation = 'none';
    dom.cursorEl.offsetHeight;
    dom.cursorEl.style.animation = '';
    dom.inputBefore.textContent = state.inputBuffer.slice(0, state.cursorPos);
    if (state.cursorPos < state.inputBuffer.length) {
        dom.cursorEl.textContent = state.inputBuffer[state.cursorPos];
        dom.inputAfter.textContent = state.inputBuffer.slice(state.cursorPos + 1);
    } else {
        dom.cursorEl.textContent = "";
        dom.inputAfter.textContent = "";
    }
}

// --- Word navigation helpers ---
export function wordLeft(pos) {
    let i = pos - 1;
    while (i > 0 && state.inputBuffer[i] === " ") i--;
    while (i > 0 && state.inputBuffer[i - 1] !== " ") i--;
    return Math.max(0, i);
}

export function wordRight(pos) {
    let i = pos;
    while (i < state.inputBuffer.length && state.inputBuffer[i] !== " ") i++;
    while (i < state.inputBuffer.length && state.inputBuffer[i] === " ") i++;
    return i;
}

// --- Prompt ---
export function getPromptHTML() {
    return '<span class="prompt-user">' + (state.isRoot ? 'root' : 'guest') + '@thalis</span>:<span class="prompt-path">' + state.currentPath + '</span><span class="prompt-dollar">$ </span>';
}

export function updatePrompt() {
    dom.promptEl.innerHTML = getPromptHTML();
    showHint();
}

// --- Hint system ---
export function showHint() {
    removeHint();
    if (!state.catUsed && state.currentPath !== "~" && state.inputBuffer === "") {
        const node = getNode(state.currentPath);
        const hasChildren = nodeHasContents(node);
        state.hintEl = document.createElement("span");
        state.hintEl.textContent = hasChildren
            ? "Hint: use cat/ls to view/list content"
            : "Hint: use cat to view content";
        state.hintEl.style.color = "#555";
        state.hintEl.style.pointerEvents = "none";
        dom.inputLine.appendChild(state.hintEl);
    }
}

export function removeHint() {
    if (state.hintEl && state.hintEl.parentNode) {
        state.hintEl.parentNode.removeChild(state.hintEl);
        state.hintEl = null;
    }
}

// --- Helper: check if a node has visible contents (children or executables) ---
export function nodeHasContents(node) {
    if (!node) return false;
    if (Object.keys(node.children).some(c => !c.startsWith("."))) return true;
    if (Object.keys(node.executables).some(e => !e.startsWith(".") && !(isMobile && node.executables[e].mobileHidden))) return true;
    return false;
}

// --- Input helpers ---
export function clearInput() {
    state.inputBuffer = "";
    state.cursorPos = 0;
    renderInput();
}

export function setInput(text) {
    state.inputBuffer = text;
    state.cursorPos = text.length;
    renderInput();
}

// --- Reverse search display ---
export function renderSearch(match) {
    dom.cursorEl.style.animation = 'none';
    dom.cursorEl.offsetHeight;
    dom.cursorEl.style.animation = '';
    dom.promptEl.textContent = "(reverse-i-search)'" + state.searchQuery + "': ";
    dom.inputBefore.textContent = match || "";
    dom.cursorEl.textContent = "";
    dom.inputAfter.textContent = "";
}
