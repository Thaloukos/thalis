import { state, dom, callbacks } from './state.js';
import { resolvePath, pathSegments, relativeCd, getNode } from './path.js';
import { renderInput, clearInput, setInput, wordLeft, wordRight, removeHint, showHint, updatePrompt, nodeHasContents } from './input.js';
import { addLine, addPromptLine, scrollToBottom, skipAnimation, enqueueOrRun } from './output.js';
import { processCommand, welcomeText } from './commands.js';
import { stopExecutable } from './executables.js';
import { getCompletions } from './completion.js';

const isMac = /mac/i.test(navigator.userAgent);

// --- Simulate typing ---
function simulateCommand(cmd) {
    enqueueOrRun(function () {
        state.animating = true;
        clearInput();
        removeHint();
        dom.inputLine.style.display = "flex";
        updatePrompt();
        removeHint();
        let i = 0;
        function typeNext() {
            if (i < cmd.length) {
                state.inputBuffer += cmd[i];
                state.cursorPos = state.inputBuffer.length;
                renderInput();
                scrollToBottom();
                i++;
                setTimeout(typeNext, 40);
            } else {
                setTimeout(function () {
                    clearInput();
                    state.animating = false;
                    if (cmd.trim()) {
                        state.commandHistory.push(cmd);
                    }
                    state.historyIndex = state.commandHistory.length;
                    addPromptLine(cmd);
                    const cmds = cmd.split("&&").map(c => c.trim());
                    cmds.forEach((c, idx) => {
                        if (idx === 0) {
                            processCommand(c, true);
                        } else {
                            enqueueOrRun(function () {
                                processCommand(c, true);
                            });
                        }
                    });
                }, 100);
            }
        }
        typeNext();
    });
}

// --- Run command (used by nav buttons, clickable nodes, page links) ---
function runCommand(cmd) {
    dom.terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());
    simulateCommand(cmd);
}

// --- Boot sequence ---
export function boot() {
    // Register runCommand callback for node builders
    callbacks.runCommand = runCommand;

    // Nav buttons
    document.getElementById("nav-home").addEventListener("click", () => runCommand("cd ~"));
    document.getElementById("nav-menu").addEventListener("click", () => runCommand("ls ~"));
    document.getElementById("nav-clear").addEventListener("click", () => runCommand("clear"));

    // Paste handler
    document.addEventListener("paste", function (e) {
        if (state.gameMode || state.animating) return;
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text");
        if (!text) return;
        // Take only the first line, ignore newlines
        const line = text.split(/[\r\n]/)[0];
        state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos) + line + state.inputBuffer.slice(state.cursorPos);
        state.cursorPos += line.length;
        removeHint();
        dom.terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());
        renderInput();
    });

    // Keyboard handler
    document.addEventListener("keydown", function (e) {
        // Ctrl+C stops executable
        if (state.gameMode && e.ctrlKey && e.code === "KeyC") {
            e.preventDefault();
            stopExecutable();
            return;
        }
        if (state.gameMode) return;

        // Ctrl+C interrupts animation
        if (state.animating && e.ctrlKey && e.code === "KeyC") {
            e.preventDefault();
            skipAnimation();
            return;
        }

        if (state.animating) return;

        if (e.ctrlKey && !e.metaKey && !e.altKey) {
            if (!isMac && e.key === "ArrowLeft") {
                e.preventDefault();
                state.cursorPos = wordLeft(state.cursorPos);
                renderInput();
                return;
            }
            if (!isMac && e.key === "ArrowRight") {
                e.preventDefault();
                state.cursorPos = wordRight(state.cursorPos);
                renderInput();
                return;
            }
            if (!isMac && e.key === "Backspace") {
                e.preventDefault();
                const newPos = wordLeft(state.cursorPos);
                state.inputBuffer = state.inputBuffer.slice(0, newPos) + state.inputBuffer.slice(state.cursorPos);
                state.cursorPos = newPos;
                renderInput();
                if (state.inputBuffer === "") showHint();
                return;
            }
            if (e.code === "KeyL") {
                e.preventDefault();
                dom.output.innerHTML = "";
                dom.terminal.querySelectorAll(":scope > .line").forEach(el => el.remove());
                clearInput();
                updatePrompt();
                scrollToBottom();
                return;
            }
            if (e.code === "KeyC") {
                e.preventDefault();
                dom.terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());
                addPromptLine(state.inputBuffer + "^C");
                clearInput();
                updatePrompt();
                scrollToBottom();
                return;
            }
            if (e.code === "KeyU") {
                e.preventDefault();
                dom.terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());
                state.inputBuffer = state.inputBuffer.slice(state.cursorPos);
                state.cursorPos = 0;
                renderInput();
                if (state.inputBuffer === "") showHint();
                return;
            }
            if (e.code === "KeyA") {
                e.preventDefault();
                state.cursorPos = 0;
                renderInput();
                return;
            }
            if (e.code === "KeyE") {
                e.preventDefault();
                state.cursorPos = state.inputBuffer.length;
                renderInput();
                return;
            }
            if (e.code === "KeyK") {
                e.preventDefault();
                state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos);
                renderInput();
                return;
            }
            if (e.code === "KeyW") {
                e.preventDefault();
                const newPos = wordLeft(state.cursorPos);
                state.inputBuffer = state.inputBuffer.slice(0, newPos) + state.inputBuffer.slice(state.cursorPos);
                state.cursorPos = newPos;
                renderInput();
                if (state.inputBuffer === "") showHint();
                return;
            }
            return;
        }

        if (e.metaKey && !e.altKey && !e.ctrlKey) {
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                state.cursorPos = 0;
                renderInput();
                return;
            }
            if (e.key === "ArrowRight") {
                e.preventDefault();
                state.cursorPos = state.inputBuffer.length;
                renderInput();
                return;
            }
            if (e.key === "Backspace") {
                e.preventDefault();
                state.inputBuffer = state.inputBuffer.slice(state.cursorPos);
                state.cursorPos = 0;
                renderInput();
                if (state.inputBuffer === "") showHint();
                return;
            }
            return;
        }

        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                state.cursorPos = wordLeft(state.cursorPos);
                renderInput();
                return;
            }
            if (e.key === "ArrowRight") {
                e.preventDefault();
                state.cursorPos = wordRight(state.cursorPos);
                renderInput();
                return;
            }
            if (e.key === "Backspace") {
                e.preventDefault();
                const newPos = wordLeft(state.cursorPos);
                state.inputBuffer = state.inputBuffer.slice(0, newPos) + state.inputBuffer.slice(state.cursorPos);
                state.cursorPos = newPos;
                renderInput();
                if (state.inputBuffer === "") showHint();
                return;
            }
            if (e.code === "KeyD" && e.altKey) {
                e.preventDefault();
                const newEnd = wordRight(state.cursorPos);
                state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos) + state.inputBuffer.slice(newEnd);
                renderInput();
                return;
            }
            return;
        }

        if (e.key === "Tab") {
            e.preventDefault();
            const completions = getCompletions(state.inputBuffer);
            if (completions.length === 1) {
                setInput(completions[0]);
                state.lastTabInput = null;
            } else if (completions.length > 1) {
                if (state.lastTabInput === state.inputBuffer) {
                    dom.terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());
                    completions.forEach(c => {
                        const arg = c.split(/\s+/).pop();
                        const lastSlash = arg.lastIndexOf("/", arg.length - 2);
                        const display = lastSlash !== -1 ? arg.slice(lastSlash + 1) : arg;
                        const div = document.createElement("div");
                        div.className = "line tab-completion";
                        div.textContent = display;
                        dom.terminal.appendChild(div);
                    });
                    scrollToBottom();
                    state.lastTabInput = null;
                } else {
                    state.lastTabInput = state.inputBuffer;
                }
            }
            return;
        }

        if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta" || e.key === "CapsLock") return;

        state.lastTabInput = null;
        dom.terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());

        if (e.key === "Enter") {
            e.preventDefault();
            const cmd = state.inputBuffer;
            if (cmd.trim()) {
                state.commandHistory.push(cmd);
            }
            state.historyIndex = state.commandHistory.length;
            clearInput();
            removeHint();
            addPromptLine(cmd);
            const cmds = cmd.split("&&").map(c => c.trim());
            cmds.forEach((c, idx) => {
                if (idx === 0) {
                    processCommand(c, true);
                } else {
                    (function(sub) {
                        enqueueOrRun(function () {
                            processCommand(sub, true);
                        });
                    })(c);
                }
            });
        } else if (e.key === "Backspace") {
            e.preventDefault();
            if (state.cursorPos > 0) {
                state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos - 1) + state.inputBuffer.slice(state.cursorPos);
                state.cursorPos--;
                renderInput();
                if (state.inputBuffer === "") showHint();
                else removeHint();
            }
        } else if (e.key === "Delete") {
            e.preventDefault();
            if (state.cursorPos < state.inputBuffer.length) {
                state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos) + state.inputBuffer.slice(state.cursorPos + 1);
                renderInput();
            }
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (state.cursorPos > 0) {
                state.cursorPos--;
                renderInput();
            }
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (state.cursorPos < state.inputBuffer.length) {
                state.cursorPos++;
                renderInput();
            }
        } else if (e.key === "Home") {
            e.preventDefault();
            state.cursorPos = 0;
            renderInput();
        } else if (e.key === "End") {
            e.preventDefault();
            state.cursorPos = state.inputBuffer.length;
            renderInput();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (state.historyIndex > 0) {
                state.historyIndex--;
                setInput(state.commandHistory[state.historyIndex]);
                removeHint();
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (state.historyIndex < state.commandHistory.length - 1) {
                state.historyIndex++;
                setInput(state.commandHistory[state.historyIndex]);
                removeHint();
            } else {
                state.historyIndex = state.commandHistory.length;
                clearInput();
                showHint();
            }
        } else if (e.key.length === 1) {
            e.preventDefault();
            if (state.inputBuffer === "") removeHint();
            state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos) + e.key + state.inputBuffer.slice(state.cursorPos);
            state.cursorPos++;
            renderInput();
            scrollToBottom();
        }
    });

    // Page link click handler (delegated)
    document.addEventListener("click", function (e) {
        const link = e.target.closest(".page-link");
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        const path = link.dataset.path;
        if (!path) return;
        const resolved = resolvePath(path);
        if (!resolved || resolved === "~") return;
        const segs = pathSegments(resolved);
        const targetParent = segs.length > 1 ? "~/" + segs.slice(0, -1).join("/") : "~";
        const targetChild = segs.length > 1 ? segs[segs.length - 1] : null;

        // Determine the directory we need to be in
        const needDir = targetChild ? targetParent : resolved;

        // Build shortest relative cd command
        const nav = relativeCd(needDir);

        // Build cat command
        let cat;
        if (targetChild) {
            cat = "cat " + targetChild;
        } else {
            const node = getNode(resolved);
            const hasContents = nodeHasContents(node);
            cat = "cat ." + (hasContents ? " && ls ." : "");
        }

        runCommand(nav ? nav + " && " + cat : cat);
    });

    // Mobile tap handler
    dom.terminal.addEventListener("click", function (e) {
        if (e.target.closest("#nav") || e.target.classList.contains("clickable") || e.target.tagName === "A" || e.target.closest(".page-link")) return;
        if (window.matchMedia("(pointer: coarse)").matches && !state.animating) {
            const hasContents = state.currentPath === "~" || nodeHasContents(getNode(state.currentPath));
            runCommand(hasContents ? "cat . && ls ." : "cat .");
            return;
        }
        window.focus();
    });

    // Welcome message
    const welcomeLine = addLine(welcomeText);
    welcomeLine.style.color = "#666";
    welcomeLine.classList.add("welcome");
    addLine("");
    updatePrompt();
}
