import { state, dom, callbacks } from './state.js';
import { resolvePath, pathSegments, relativeCd, getNode, isTopLevelDir } from './path.js';
import { renderInput, clearInput, setInput, wordLeft, wordRight, removeHint, showHint, updatePrompt, nodeHasContents, renderSearch } from './input.js';
import { addLine, addPromptLine, scrollToBottom, skipAnimation, enqueueOrRun } from './output.js';
import { processCommand, welcomeText } from './commands.js';
import { stopExecutable } from './executables.js';
import { getCompletions } from './completion.js';

const isMac = /mac/i.test(navigator.userAgent);

// --- Reverse search helpers ---
function findHistoryMatch(query, fromIndex) {
    if (!query) return fromIndex >= 0 ? fromIndex : -1;
    const start = Math.min(fromIndex, state.commandHistory.length - 1);
    for (let i = start; i >= 0; i--) {
        if (state.commandHistory[i].includes(query)) return i;
    }
    return -1;
}

function getSearchMatch() {
    if (state.searchIndex < 0 || state.searchIndex >= state.commandHistory.length) return "";
    const cmd = state.commandHistory[state.searchIndex];
    if (!state.searchQuery) return cmd || "";
    return cmd && cmd.includes(state.searchQuery) ? cmd : "";
}

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

        // Reverse search mode
        if (state.searchMode) {
            if (e.key === "Escape" || (e.ctrlKey && (e.code === "KeyG" || e.code === "KeyC"))) {
                e.preventDefault();
                state.searchMode = false;
                state.searchQuery = "";
                clearInput();
                updatePrompt();
                return;
            }
            if (e.ctrlKey && e.code === "KeyR") {
                e.preventDefault();
                const from = state.searchIndex - 1;
                if (from >= 0) {
                    const idx = findHistoryMatch(state.searchQuery, from);
                    if (idx !== -1) state.searchIndex = idx;
                }
                renderSearch(getSearchMatch());
                return;
            }
            if (e.key === "Backspace") {
                e.preventDefault();
                if (state.searchQuery.length === 0) {
                    state.searchMode = false;
                    clearInput();
                    updatePrompt();
                } else {
                    state.searchQuery = state.searchQuery.slice(0, -1);
                    if (state.searchQuery === "") {
                        state.searchIndex = state.commandHistory.length;
                        renderSearch("");
                    } else {
                        const idx = findHistoryMatch(state.searchQuery, state.commandHistory.length - 1);
                        state.searchIndex = idx !== -1 ? idx : -1;
                        renderSearch(getSearchMatch());
                    }
                }
                return;
            }
            if (e.key === "Enter") {
                // Accept match — exit search and fall through to normal Enter
                const match = getSearchMatch();
                state.searchMode = false;
                state.searchQuery = "";
                state.inputBuffer = match;
                state.cursorPos = match.length;
                updatePrompt();
                // Don't return — let normal Enter handler process the command
            } else if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown") {
                // Accept match and allow editing
                e.preventDefault();
                const match = getSearchMatch();
                state.searchMode = false;
                state.searchQuery = "";
                updatePrompt();
                if (match) setInput(match);
                removeHint();
                return;
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                state.searchQuery += e.key;
                const idx = findHistoryMatch(state.searchQuery, state.searchIndex);
                if (idx !== -1) state.searchIndex = idx;
                renderSearch(getSearchMatch());
                return;
            } else {
                return;
            }
        }

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
            if (e.code === "KeyR") {
                e.preventDefault();
                removeHint();
                state.searchMode = true;
                state.searchQuery = "";
                state.searchIndex = state.commandHistory.length;
                renderSearch("");
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

        let needDir, cat;
        if (targetChild) {
            // Subpage: cd to parent, cat child
            needDir = targetParent;
            cat = "cat " + targetChild;
        } else if (!isTopLevelDir(segs[0])) {
            // Top-level file: cd to home, cat file
            needDir = "~";
            cat = "cat " + segs[0];
        } else {
            // Top-level directory: cd into it, cat .
            needDir = resolved;
            const node = getNode(resolved);
            const hasContents = nodeHasContents(node);
            cat = "cat ." + (hasContents ? " && ls ." : "");
        }

        const nav = relativeCd(needDir);

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
