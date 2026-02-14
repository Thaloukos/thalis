export const state = {
    currentPath: "~",
    inputBuffer: "",
    cursorPos: 0,
    commandHistory: [],
    historyIndex: -1,
    animating: false,
    gameMode: false,
    isRoot: false,
    animationQueue: [],
    lastTabInput: null,
    currentModule: null,
    currentAnimation: null,
    catUsed: false,
    hintEl: null,
};

// DOM refs populated by initDOM()
export const dom = {
    output: null,
    inputBefore: null,
    inputAfter: null,
    promptEl: null,
    terminal: null,
    inputLine: null,
    cursorEl: null,
};

// Late-bound callbacks to avoid circular imports
export const callbacks = {};

export function initDOM() {
    dom.output = document.getElementById("output");
    dom.inputBefore = document.getElementById("input-before");
    dom.inputAfter = document.getElementById("input-after");
    dom.promptEl = document.getElementById("prompt");
    dom.terminal = document.getElementById("terminal");
    dom.inputLine = document.getElementById("input-line");
    dom.cursorEl = document.querySelector("#input-line .cursor");
}
