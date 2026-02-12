const isMobile = window.matchMedia("(pointer: coarse)").matches;
const pageNames = isMobile
    ? ["About", "Projects", "Contact"]
    : ["About", "Projects", "Games", "Contact"];
const pages = {};
const executableMap = isMobile ? {} : { "Games": ["fih"] };

Promise.all(pageNames.map(name =>
    fetch("/pages/" + name + ".txt")
        .then(r => r.text())
        .then(text => { pages[name] = text.trimEnd(); })
));

const sneakyCommands = [
    "rm", "mv", "cp", "mkdir", "rmdir", "touch", "chmod", "chown", "chgrp",
    "ln", "find", "grep", "sed", "awk", "sort", "uniq", "wc", "diff",
    "tar", "zip", "unzip", "gzip", "gunzip", "curl", "wget", "ssh", "scp",
    "ping", "traceroute", "netstat", "ifconfig", "ip", "dig", "nslookup",
    "ps", "top", "htop", "kill", "killall", "df", "du", "free", "mount",
    "umount", "fdisk", "mkfs", "dd", "whoami", "id", "su", "passwd",
    "useradd", "userdel", "groupadd", "crontab", "systemctl", "service",
    "journalctl", "dmesg", "lsof", "strace", "nmap", "iptables",
    "apt", "yum", "dnf", "pacman", "brew", "pip", "npm", "git",
    "docker", "kubectl", "man", "which", "alias", "export", "source",
    "history", "tail", "head", "less", "more", "nano", "vim", "vi", "emacs",
    "pwd", "env", "set", "unset", "xargs", "tee", "nc", "telnet",
    "reboot", "shutdown", "halt", "poweroff", "watch"
];

let currentPath = "~";
let inputBuffer = "";
let cursorPos = 0;
let commandHistory = [];
let historyIndex = -1;
let animating = false;
let gameMode = false;
let isRoot = false;
let animationQueue = [];
let lastTabInput = null;

const output = document.getElementById("output");
const inputBefore = document.getElementById("input-before");
const inputAfter = document.getElementById("input-after");
const promptEl = document.getElementById("prompt");
const terminal = document.getElementById("terminal");
const inputLine = document.getElementById("input-line");

// --- Render input ---
const cursorEl = document.querySelector("#input-line .cursor");

function renderInput() {
    cursorEl.style.animation = 'none';
    cursorEl.offsetHeight;
    cursorEl.style.animation = '';
    inputBefore.textContent = inputBuffer.slice(0, cursorPos);
    if (cursorPos < inputBuffer.length) {
        cursorEl.textContent = inputBuffer[cursorPos];
        inputAfter.textContent = inputBuffer.slice(cursorPos + 1);
    } else {
        cursorEl.textContent = "";
        inputAfter.textContent = "";
    }
}

// --- Word navigation helpers ---
function wordLeft(pos) {
    let i = pos - 1;
    // skip whitespace
    while (i > 0 && inputBuffer[i] === " ") i--;
    // skip word chars
    while (i > 0 && inputBuffer[i - 1] !== " ") i--;
    return Math.max(0, i);
}

function wordRight(pos) {
    let i = pos;
    // skip current word chars
    while (i < inputBuffer.length && inputBuffer[i] !== " ") i++;
    // skip whitespace
    while (i < inputBuffer.length && inputBuffer[i] === " ") i++;
    return i;
}

// --- Link detection ---
const linkPattern = /(https?:\/\/[^\s]+)|([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})|([a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;

function escapeHTML(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function linkify(text) {
    const parts = [];
    let last = 0;
    let match;
    linkPattern.lastIndex = 0;
    while ((match = linkPattern.exec(text)) !== null) {
        if (match.index > last) {
            parts.push(escapeHTML(text.slice(last, match.index)));
        }
        const raw = match[0];
        if (match[2]) {
            parts.push('<a href="mailto:' + escapeHTML(raw) + '" target="_blank">' + escapeHTML(raw) + '</a>');
        } else if (match[3]) {
            parts.push('<a href="https://' + escapeHTML(raw) + '" target="_blank" rel="noopener">' + escapeHTML(raw) + '</a>');
        } else {
            parts.push('<a href="' + escapeHTML(raw) + '" target="_blank" rel="noopener">' + escapeHTML(raw) + '</a>');
        }
        last = match.index + raw.length;
    }
    if (last < text.length) {
        parts.push(escapeHTML(text.slice(last)));
    }
    if (parts.length === 0) return null;
    if (last === 0) return null;
    return parts.join("");
}

// --- Hint system ---
let hintEl = null;
let catUsed = false;

function showHint() {
    removeHint();
    if (!catUsed && currentPath !== "~" && inputBuffer === "") {
        hintEl = document.createElement("span");
        hintEl.textContent = "Hint: use cat to view content";
        hintEl.style.color = "#555";
        hintEl.style.pointerEvents = "none";
        inputLine.appendChild(hintEl);
    }
}

function removeHint() {
    if (hintEl && hintEl.parentNode) {
        hintEl.parentNode.removeChild(hintEl);
        hintEl = null;
    }
}

// --- Path resolution ---
function isInSubpage() {
    return currentPath !== "~";
}

function resolvePath(target) {
    if (!target || target === "~" || target === "/") return "~";
    if (target.length > 1 && target.endsWith("/")) target = target.slice(0, -1);
    if (target.startsWith("./")) target = target.slice(2);
    if (target === ".") return currentPath;

    if (target === "..") {
        if (isInSubpage()) return "~";
        return null;
    }
    if (target.startsWith("../")) {
        const rest = target.slice(3);
        if (isInSubpage()) {
            return resolveFromHome(rest);
        }
        return null;
    }

    if (target.startsWith("~/")) {
        return resolveFromHome(target.slice(2));
    }

    if (isInSubpage()) {
        return null;
    }
    return resolveFromHome(target);
}

function resolveFromHome(name) {
    if (!name || name === "") return "~";
    const match = Object.keys(pages).find(
        p => p.toLowerCase() === name.toLowerCase()
    );
    if (match) return "~/" + match;
    return null;
}

function cdCommandFor(pageName) {
    if (isInSubpage()) {
        return "cd ../" + pageName;
    }
    return "cd " + pageName;
}

// --- Prompt ---
function getPromptHTML() {
    return '<span class="prompt-user">' + (isRoot ? 'root' : 'guest') + '@thalis</span>:<span class="prompt-path">' + currentPath + '</span><span class="prompt-dollar">$ </span>';
}

function updatePrompt() {
    promptEl.innerHTML = getPromptHTML();
    showHint();
}

// --- Output helpers ---
function addLine(text) {
    const div = document.createElement("div");
    div.className = "line";
    div.textContent = text;
    output.appendChild(div);
    return div;
}

function scrollToBottom() {
    window.scrollTo(0, document.body.scrollHeight);
}

function addPromptLine(cmd) {
    const div = document.createElement("div");
    div.className = "line";
    div.innerHTML = getPromptHTML() + escapeHTML(cmd);
    output.appendChild(div);
    return div;
}

// --- Animated output ---
function animateOutput(elements, callback) {
    animating = true;
    inputLine.style.display = "none";
    let elIdx = 0;
    let charIdx = 0;

    let totalChars = 0;
    for (let i = 0; i < elements.length; i++) {
        if (!elements[i]._instant && elements[i]._fullText) {
            totalChars += elements[i]._fullText.length;
        }
    }
    const delay = Math.max(2, Math.min(20, Math.floor(600 / (totalChars || 1))));

    function next() {
        if (elIdx >= elements.length) {
            inputLine.style.display = "flex";
            animating = false;
            scrollToBottom();
            if (callback) callback();
            drainQueue();
            return;
        }
        const el = elements[elIdx];
        const text = el._fullText;

        if (el._instant || !text || text.length === 0) {
            el.node.textContent = text || "";
            output.appendChild(el.node);
            if (text) {
                const linked = linkify(text);
                if (linked) el.node.innerHTML = linked;
            }
            elIdx++;
            charIdx = 0;
            next();
            return;
        }

        if (charIdx === 0) {
            el.node.textContent = "";
            output.appendChild(el.node);
        }

        el.node.textContent = text.slice(0, charIdx + 1);
        charIdx++;
        scrollToBottom();

        if (charIdx >= text.length) {
            const linked = linkify(text);
            if (linked) el.node.innerHTML = linked;
            elIdx++;
            charIdx = 0;
            setTimeout(next, delay);
        } else {
            setTimeout(next, delay);
        }
    }

    next();
}

// --- Node builders ---
function makeLineNode(text) {
    const div = document.createElement("div");
    div.className = "line";
    return { node: div, _fullText: text };
}

function makeClickableNode(text, commandFn) {
    const div = document.createElement("div");
    div.className = "line clickable dir";
    div.addEventListener("click", function () {
        const cmd = typeof commandFn === "function" ? commandFn() : commandFn;
        runCommand(cmd);
    });
    return { node: div, _fullText: text };
}

function makeDirNode(text) {
    const div = document.createElement("div");
    div.className = "line dir";
    return { node: div, _fullText: text };
}

function makeExecNode(text, commandFn) {
    const div = document.createElement("div");
    div.className = "line clickable exec";
    div.addEventListener("click", function () {
        const cmd = typeof commandFn === "function" ? commandFn() : commandFn;
        runCommand(cmd);
    });
    return { node: div, _fullText: text };
}

function makeColoredNode(text, color, opts) {
    const div = document.createElement("div");
    div.className = "line";
    div.style.color = color;
    if (opts && opts.tight) {
        div.style.lineHeight = "1";
        div.style.letterSpacing = "-0.05em";
    }
    const node = { node: div, _fullText: text };
    if (opts && opts.instant) node._instant = true;
    return node;
}

// --- Queue ---
function drainQueue() {
    if (animationQueue.length > 0) {
        const next = animationQueue.shift();
        next();
    }
}

function enqueueOrRun(fn) {
    if (animating) {
        animationQueue.push(fn);
    } else {
        fn();
    }
}

// --- Input helpers ---
function clearInput() {
    inputBuffer = "";
    cursorPos = 0;
    renderInput();
}

function setInput(text) {
    inputBuffer = text;
    cursorPos = text.length;
    renderInput();
}

// --- Command processor ---
function processCommand(cmd, silent) {
    const trimmed = cmd.trim();
    if (!silent) addPromptLine(cmd);

    if (!trimmed) {
        updatePrompt();
        scrollToBottom();
        return;
    }

    let effective = trimmed;
    if (effective.startsWith("sudo ")) {
        isRoot = true;
        effective = effective.slice(5).trim();
        if (!effective) {
            updatePrompt();
            scrollToBottom();
            return;
        }
    }

    const parts = effective.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    let elements = [];

    switch (command) {
        case "help":
            [
                "Available commands:",
                "  ls [path]   List pages",
                "  cd [path]   Navigate",
                "  cat [path]  View content",
                "  clear       Clear the terminal",
                "  help        Show this help message"
            ].forEach(line => elements.push(makeLineNode(line)));
            break;

        case "ls": {
            const target = args[0];
            let listPath = currentPath;
            if (target) {
                const resolved = resolvePath(target);
                if (resolved === null) {
                    elements.push(makeLineNode("ls: cannot access '" + target + "': No such directory"));
                    break;
                }
                listPath = resolved;
            }

            if (listPath === "~") {
                pageNames.forEach(name => {
                    const hasContents = !!(executableMap[name] && executableMap[name].length);
                    elements.push(makeClickableNode(name, () => {
                        if (currentPath === "~/" + name) return hasContents ? "cat . && ls ." : "cat .";
                        const nav = cdCommandFor(name) + " && cat .";
                        return hasContents ? nav + " && ls ." : nav;
                    }));
                });
            } else {
                elements.push(makeClickableNode("..", () => "cd .."));
                if (listPath === "~/Games" && !isMobile) {
                    elements.push(makeExecNode("fih", () => {
                        if (currentPath === "~/Games") return "sh fih";
                        if (isInSubpage()) return "sh ../Games/fih";
                        return "sh Games/fih";
                    }));
                }
            }
            break;
        }

        case "cd": {
            const target = args[0];
            if (!target) {
                catUsed = false;
                currentPath = "~";
                break;
            }
            const resolved = resolvePath(target);
            if (resolved === null) {
                elements.push(makeLineNode("cd: no such directory: " + target));
            } else {
                if (resolved !== currentPath) catUsed = false;
                currentPath = resolved;
            }
            break;
        }

        case "cat": {
            const target = args[0];

            // Handle cat <executable> — resolve via executable paths
            if (target && !isMobile && resolveExecutable(target)) {
                catUsed = true;
                [
                    "fih - 3D ASCII Fish Tank",
                    "",
                    "Swim around a fish tank as a little ASCII fish.",
                    "NPC fish wander, bubbles rise, seaweed sways.",
                    "",
                    "Controls:",
                    "  Mouse         Look around",
                    "  W/A/S/D       Swim",
                    "  Space         Swim up",
                    "  Left Shift    Swim down",
                    "  Escape        Exit",
                    "",
                    "Usage: run the 'fih' executable to play",
                ].forEach(line => elements.push(makeLineNode(line || "\u00a0")));
                elements.push(makeLineNode("\u00a0"));
                break;
            }

            let catPath = currentPath;
            if (target && target !== ".") {
                const resolved = resolvePath(target);
                if (resolved === null) {
                    elements.push(makeLineNode("cat: " + target + ": No such file or directory"));
                    break;
                }
                catPath = resolved;
            }

            if (catPath === "~") {
                elements.push(makeLineNode(welcomeText.replace("Welcome! ", "").replace(/ \^$/, "")));
                elements.push(makeLineNode("\u00a0"));
            } else {
                const pageName = catPath.replace("~/", "");
                if (pages[pageName]) {
                    catUsed = true;
                    pages[pageName].split("\n").forEach(line => elements.push(makeLineNode(line || "\u00a0")));
                    elements.push(makeLineNode("\u00a0"));
                } else {
                    elements.push(makeLineNode("cat: No such file or directory"));
                }
            }
            break;
        }

        case "clear":
            output.innerHTML = "";
            // Remove any tab-completion lines inserted outside #output
            terminal.querySelectorAll(":scope > .line").forEach(el => el.remove());
            updatePrompt();
            scrollToBottom();
            return;

        case "claude": {
            const claude = [
                "",
                "    \u2590\u259B\u2588\u2588\u2588\u259C\u258C",
                "   \u259D\u259C\u2588\u2588\u2588\u2588\u2588\u259B\u2598",
                "     \u2598\u2598 \u259D\u259D",
                "",
            ];
            const msg = '  You really think I\'d pay for this?';
            claude.forEach(line => elements.push(makeColoredNode(line, "#D97757", { instant: true, tight: true })));
            elements.push(makeColoredNode(msg, "#D97757"));
            elements.push(makeLineNode(""));
            break;
        }

        case "echo": {
            // Parse the raw argument string (everything after "echo ")
            const rawArgs = trimmed.slice(5);
            let result = "";
            let i = 0;
            while (i < rawArgs.length) {
                const ch = rawArgs[i];
                if (ch === '"' || ch === "'") {
                    const close = rawArgs.indexOf(ch, i + 1);
                    if (close !== -1) {
                        result += rawArgs.slice(i + 1, close);
                        i = close + 1;
                    } else {
                        result += rawArgs.slice(i + 1);
                        i = rawArgs.length;
                    }
                } else if (ch === " ") {
                    if (result.length > 0 && result[result.length - 1] !== " ") result += " ";
                    i++;
                } else {
                    result += ch;
                    i++;
                }
            }
            elements.push(makeLineNode(result));
            break;
        }

        case "sh": {
            const target = args[0];
            if (!target) {
                elements.push(makeLineNode("sh: missing file operand"));
                break;
            }
            const shExec = resolveExecutable(target);
            if (shExec) {
                if (!runExecutable(shExec)) {
                    elements.push(makeLineNode(target + ": games are not available on mobile devices"));
                    break;
                }
                return;
            }
            elements.push(makeLineNode(target + ": not executable"));
            break;
        }

        default:
            if (command.startsWith("./")) {
                const dotExec = resolveExecutable(command);
                if (dotExec) {
                    if (!runExecutable(dotExec)) {
                        elements.push(makeLineNode(command + ": games are not available on mobile devices"));
                        break;
                    }
                    return;
                }
                elements.push(makeLineNode(command + ": not executable"));
            } else if (sneakyCommands.includes(command)) {
                elements.push(makeLineNode(command + ": why are you trying to be sneaky?"));
            } else {
                elements.push(makeLineNode(command + ": command not found"));
            }
            break;
    }

    if (elements.length > 0) {
        animateOutput(elements, function () {
            updatePrompt();
            scrollToBottom();
        });
    } else {
        updatePrompt();
        scrollToBottom();
    }
}

// --- Simulate typing ---
function simulateCommand(cmd) {
    enqueueOrRun(function () {
        animating = true;
        clearInput();
        removeHint();
        inputLine.style.display = "flex";
        updatePrompt();
        removeHint();
        let i = 0;
        function typeNext() {
            if (i < cmd.length) {
                inputBuffer += cmd[i];
                cursorPos = inputBuffer.length;
                renderInput();
                scrollToBottom();
                i++;
                setTimeout(typeNext, 40);
            } else {
                setTimeout(function () {
                    clearInput();
                    animating = false;
                    if (cmd.trim()) {
                        commandHistory.push(cmd);
                    }
                    historyIndex = commandHistory.length;
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

// --- Nav buttons ---
function runCommand(cmd) {
    simulateCommand(cmd);
}

function navHome() {
    runCommand("cd ~");
}

function navMenu() {
    runCommand("ls ~");
}

function navClear() {
    runCommand("clear");
}

// --- Game lifecycle ---
function startFihGame() {
    gameMode = true;
    output.style.display = "none";
    inputLine.style.display = "none";
    document.getElementById("nav").style.display = "none";

    const container = document.createElement("div");
    container.id = "game-container";
    container.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:100;";
    document.body.appendChild(container);

    FihGame.start(container, stopFihGame);
}

function stopFihGame() {
    gameMode = false;
    const container = document.getElementById("game-container");
    if (container) container.parentNode.removeChild(container);

    output.style.display = "";
    inputLine.style.display = "flex";
    document.getElementById("nav").style.display = "flex";

    updatePrompt();
    scrollToBottom();
}

var resizeTimer = null;
window.addEventListener("resize", function () {
    if (!gameMode) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        FihGame.handleResize();
    }, 150);
});

// --- Executable resolution ---
function execsInCurrentDir() {
    if (currentPath === "~") return [];
    const dirName = currentPath.replace("~/", "");
    return executableMap[dirName] || [];
}

function resolveExecutable(path) {
    // Resolve a path like "fih", "./fih", "Games/fih", "~/Games/fih" to an exec name, or null
    let clean = path;
    if (clean.startsWith("./")) clean = clean.slice(2);
    if (clean.startsWith("~/")) clean = clean.slice(2);
    if (clean.startsWith("../")) clean = clean.slice(3);

    // Try as dir/exec path (works from anywhere)
    const slash = clean.indexOf("/");
    if (slash !== -1) {
        const dir = clean.slice(0, slash);
        const file = clean.slice(slash + 1);
        const dirMatch = Object.keys(executableMap).find(d => d.toLowerCase() === dir.toLowerCase());
        if (dirMatch && executableMap[dirMatch].includes(file)) return file;
        return null;
    }

    // Try as bare name in current directory
    const execs = execsInCurrentDir();
    if (execs.includes(clean)) return clean;
    return null;
}

function runExecutable(name) {
    if (name === "fih") {
        if (isMobile) return false;
        startFihGame();
        return true;
    }
    return false;
}

// --- Tab completion ---
const commandNames = isMobile
    ? ["help", "ls", "cd", "cat", "clear", "claude", "echo"]
    : ["help", "ls", "cd", "cat", "clear", "claude", "echo", "sh"];
const argCommands = ["cd", "cat", "ls", "sh"];

function allExecPaths() {
    // Returns executable paths relative to current directory
    if (currentPath === "~") {
        const paths = [];
        Object.keys(executableMap).forEach(dir => {
            executableMap[dir].forEach(e => paths.push(dir + "/" + e));
        });
        return paths;
    } else {
        return execsInCurrentDir().slice();
    }
}

function getCompletionTargets(argPrefix) {
    let targets = [];

    if (isInSubpage()) {
        if (argPrefix.startsWith("../")) {
            Object.keys(pages).forEach(p => targets.push("../" + p + "/"));
        } else if (argPrefix.startsWith("~/")) {
            Object.keys(pages).forEach(p => targets.push("~/" + p + "/"));
        } else {
            targets.push("../");
            execsInCurrentDir().forEach(e => targets.push(e));
        }
    } else {
        if (argPrefix.startsWith("~/")) {
            Object.keys(pages).forEach(p => targets.push("~/" + p + "/"));
        } else {
            Object.keys(pages).forEach(p => targets.push(p + "/"));
        }
    }

    // Nested path: e.g. "Games/f", "~/Games/f", "../Games/f"
    let nested = argPrefix;
    let nestedPrefix = "";
    if (nested.startsWith("~/")) { nestedPrefix = "~/"; nested = nested.slice(2); }
    else if (nested.startsWith("../")) { nestedPrefix = "../"; nested = nested.slice(3); }
    const slash = nested.indexOf("/");
    if (slash !== -1) {
        const dir = nested.slice(0, slash);
        const dirMatch = Object.keys(pages).find(pg => pg.toLowerCase() === dir.toLowerCase());
        if (dirMatch) {
            (executableMap[dirMatch] || []).forEach(e => targets.push(nestedPrefix + dirMatch + "/" + e));
        }
    }

    return targets;
}

function getCompletions(input) {
    let prefix = "";
    let effective = input;
    if (effective.toLowerCase().startsWith("sudo ")) {
        prefix = "sudo ";
        effective = effective.slice(5);
    }
    const parts = effective.split(/\s+/);
    if (parts.length <= 1) {
        const p = parts[0].toLowerCase();
        if (!p) return [];

        // Handle ./ completion — all items, with nested path support
        if (p.startsWith("./")) {
            const partial = p.slice(2);
            let items = [];
            const slash = partial.indexOf("/");
            if (slash !== -1 && currentPath === "~") {
                // Nested: e.g. "./Games/" — complete inside that dir
                const dir = partial.slice(0, slash);
                const dirMatch = Object.keys(pages).find(pg => pg.toLowerCase() === dir.toLowerCase());
                if (dirMatch) {
                    (executableMap[dirMatch] || []).forEach(e => items.push(dirMatch + "/" + e));
                }
            } else if (currentPath === "~") {
                Object.keys(pages).forEach(pg => items.push(pg + "/"));
            } else {
                items.push("../");
                execsInCurrentDir().forEach(e => items.push(e));
            }
            return items
                .filter(e => e.toLowerCase().startsWith(partial) && e.toLowerCase() !== partial)
                .map(e => prefix + "./" + e);
        }

        return commandNames
            .filter(c => c.startsWith(p) && c !== p)
            .map(c => prefix + c);
    }
    const cmd = parts[0].toLowerCase();
    if (!argCommands.includes(cmd)) return [];
    let argPrefix = parts.slice(1).join(" ");
    let argDotSlash = "";
    if (argPrefix.startsWith("./")) {
        argDotSlash = "./";
        argPrefix = argPrefix.slice(2);
    }
    const targets = getCompletionTargets(argPrefix, cmd);
    return targets
        .filter(t => t.toLowerCase().startsWith(argPrefix.toLowerCase()) && t.toLowerCase() !== argPrefix.toLowerCase())
        .map(t => prefix + cmd + " " + argDotSlash + t);
}

// --- Keyboard ---
// Detect macOS for Option key word-nav (Alt on other platforms)
const isMac = /mac/i.test(navigator.userAgent);

document.addEventListener("keydown", function (e) {
    if (gameMode) return;
    if (animating) return;

    // Ctrl shortcuts (always) — use e.code for language/capslock independence
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
        // Ctrl+Arrow: word navigation (Windows/Linux)
        if (!isMac && e.key === "ArrowLeft") {
            e.preventDefault();
            cursorPos = wordLeft(cursorPos);
            renderInput();
            return;
        }
        if (!isMac && e.key === "ArrowRight") {
            e.preventDefault();
            cursorPos = wordRight(cursorPos);
            renderInput();
            return;
        }
        if (!isMac && e.key === "Backspace") {
            e.preventDefault();
            const newPos = wordLeft(cursorPos);
            inputBuffer = inputBuffer.slice(0, newPos) + inputBuffer.slice(cursorPos);
            cursorPos = newPos;
            renderInput();
            if (inputBuffer === "") showHint();
            return;
        }
        if (e.code === "KeyL") {
            e.preventDefault();
            output.innerHTML = "";
            terminal.querySelectorAll(":scope > .line").forEach(el => el.remove());
            clearInput();
            updatePrompt();
            scrollToBottom();
            return;
        }
        if (e.code === "KeyC") {
            e.preventDefault();
            addPromptLine(inputBuffer + "^C");
            clearInput();
            updatePrompt();
            scrollToBottom();
            return;
        }
        if (e.code === "KeyU") {
            e.preventDefault();
            inputBuffer = inputBuffer.slice(cursorPos);
            cursorPos = 0;
            renderInput();
            if (inputBuffer === "") showHint();
            return;
        }
        if (e.code === "KeyA") {
            e.preventDefault();
            cursorPos = 0;
            renderInput();
            return;
        }
        if (e.code === "KeyE") {
            e.preventDefault();
            cursorPos = inputBuffer.length;
            renderInput();
            return;
        }
        if (e.code === "KeyK") {
            e.preventDefault();
            inputBuffer = inputBuffer.slice(0, cursorPos);
            renderInput();
            return;
        }
        if (e.code === "KeyW") {
            e.preventDefault();
            const newPos = wordLeft(cursorPos);
            inputBuffer = inputBuffer.slice(0, newPos) + inputBuffer.slice(cursorPos);
            cursorPos = newPos;
            renderInput();
            if (inputBuffer === "") showHint();
            return;
        }
        return;
    }

    // Cmd shortcuts on Mac (let browser handle Cmd+C copy, Cmd+V paste etc.)
    if (e.metaKey && !e.altKey && !e.ctrlKey) {
        // Arrow keys with Cmd: Home/End of line
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            cursorPos = 0;
            renderInput();
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            cursorPos = inputBuffer.length;
            renderInput();
            return;
        }
        if (e.key === "Backspace") {
            e.preventDefault();
            // Delete to beginning of line
            inputBuffer = inputBuffer.slice(cursorPos);
            cursorPos = 0;
            renderInput();
            if (inputBuffer === "") showHint();
            return;
        }
        // Let other Cmd shortcuts pass (copy, paste, etc.)
        return;
    }

    // Word navigation: Option+Arrow on Mac, Alt+Arrow on Windows/Linux
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            cursorPos = wordLeft(cursorPos);
            renderInput();
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            cursorPos = wordRight(cursorPos);
            renderInput();
            return;
        }
        if (e.key === "Backspace") {
            e.preventDefault();
            // Delete word before cursor
            const newPos = wordLeft(cursorPos);
            inputBuffer = inputBuffer.slice(0, newPos) + inputBuffer.slice(cursorPos);
            cursorPos = newPos;
            renderInput();
            if (inputBuffer === "") showHint();
            return;
        }
        // Alt+D: delete word forward (common in terminals)
        if (e.code === "KeyD" && e.altKey) {
            e.preventDefault();
            const newEnd = wordRight(cursorPos);
            inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(newEnd);
            renderInput();
            return;
        }
        return;
    }

    if (e.key === "Tab") {
        e.preventDefault();
        const completions = getCompletions(inputBuffer);
        if (completions.length === 1) {
            setInput(completions[0]);
            lastTabInput = null;
        } else if (completions.length > 1) {
            if (lastTabInput === inputBuffer) {
                // Double tab — show completions below the input line
                // Remove any previous tab completions
                terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());
                completions.forEach(c => {
                    const parts = c.split(/\s+/);
                    const div = document.createElement("div");
                    div.className = "line tab-completion";
                    div.textContent = parts.length > 1 ? parts.slice(1).join(" ") : c;
                    terminal.appendChild(div);
                });
                scrollToBottom();
                lastTabInput = null;
            } else {
                lastTabInput = inputBuffer;
            }
        }
        return;
    }

    lastTabInput = null;
    terminal.querySelectorAll(".tab-completion").forEach(el => el.remove());

    if (e.key === "Enter") {
        e.preventDefault();
        const cmd = inputBuffer;
        if (cmd.trim()) {
            commandHistory.push(cmd);
        }
        historyIndex = commandHistory.length;
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
        if (cursorPos > 0) {
            inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
            cursorPos--;
            renderInput();
            if (inputBuffer === "") showHint();
            else removeHint();
        }
    } else if (e.key === "Delete") {
        e.preventDefault();
        if (cursorPos < inputBuffer.length) {
            inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
            renderInput();
        }
    } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (cursorPos > 0) {
            cursorPos--;
            renderInput();
        }
    } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (cursorPos < inputBuffer.length) {
            cursorPos++;
            renderInput();
        }
    } else if (e.key === "Home") {
        e.preventDefault();
        cursorPos = 0;
        renderInput();
    } else if (e.key === "End") {
        e.preventDefault();
        cursorPos = inputBuffer.length;
        renderInput();
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            setInput(commandHistory[historyIndex]);
            removeHint();
        }
    } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
            setInput(commandHistory[historyIndex]);
            removeHint();
        } else {
            historyIndex = commandHistory.length;
            clearInput();
            showHint();
        }
    } else if (e.key.length === 1) {
        e.preventDefault();
        if (inputBuffer === "") removeHint();
        inputBuffer = inputBuffer.slice(0, cursorPos) + e.key + inputBuffer.slice(cursorPos);
        cursorPos++;
        renderInput();
        scrollToBottom();
    }
});

terminal.addEventListener("click", function (e) {
    if (e.target.closest("#nav") || e.target.classList.contains("clickable") || e.target.tagName === "A") return;
    if (window.matchMedia("(pointer: coarse)").matches && !animating) {
        runCommand("cat .");
        return;
    }
    window.focus();
});

// Boot sequence
const welcomeText = isMobile
    ? "Welcome! Tap on the screen to view current page content or navigate with the buttons ^"
    : "Welcome! Type 'help' for available commands, or click a button ^";
const welcomeLine = addLine(welcomeText);
welcomeLine.style.color = "#666";
welcomeLine.classList.add("welcome");
addLine("");
updatePrompt();
