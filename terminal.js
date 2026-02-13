const isMobile = window.matchMedia("(pointer: coarse)").matches;

// --- Load manifest and build tree ---
const nocache = "?v=" + Date.now();
const manifest = await fetch("/manifest.json" + nocache).then(r => r.json());
const mobileHiddenPages = manifest.mobileHidden || [];
const pageNames = manifest.order.filter(name => !isMobile || !mobileHiddenPages.includes(name));

// Internal tree: each node has { content, children, executables }
const tree = {};

function buildNode(entry) {
    const node = { content: null, children: {}, childOrder: [], executables: {} };
    if (entry.content) node._contentPath = entry.content;
    if (entry.children) {
        for (const [ck, cv] of Object.entries(entry.children)) {
            node.children[ck] = buildNode(cv);
        }
    }
    if (entry.childOrder) node.childOrder = entry.childOrder;
    else if (entry.children) node.childOrder = Object.keys(entry.children);
    if (entry.executables) {
        for (const [ek, ev] of Object.entries(entry.executables)) {
            node.executables[ek] = { name: ek, src: ev.src, help: null, _helpPath: ev.help || null };
        }
    }
    return node;
}

for (const [key, entry] of Object.entries(manifest.tree)) {
    tree[key] = buildNode(entry);
}

// Fetch all content in parallel
const fetches = [];
function collectFetches(node) {
    if (node._contentPath) {
        fetches.push(
            fetch("/" + node._contentPath + nocache).then(r => r.text()).then(text => { node.content = text.trimEnd(); })
        );
    }
    for (const exec of Object.values(node.executables)) {
        if (exec._helpPath) {
            fetches.push(
                fetch(exec._helpPath + nocache).then(r => r.text()).then(text => { exec.help = text.trimEnd(); })
            );
        }
    }
    for (const child of Object.values(node.children)) {
        collectFetches(child);
    }
}
for (const node of Object.values(tree)) {
    collectFetches(node);
}
await Promise.all(fetches);

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
let currentModule = null;

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
    while (i > 0 && inputBuffer[i] === " ") i--;
    while (i > 0 && inputBuffer[i - 1] !== " ") i--;
    return Math.max(0, i);
}

function wordRight(pos) {
    let i = pos;
    while (i < inputBuffer.length && inputBuffer[i] !== " ") i++;
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

// Internal page link pattern: [text](~/Path) or [text](Path)
const pageLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

function linkifySegment(text) {
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
            parts.push('<a href="mailto:' + escapeHTML(raw) + '" target="_blank" title="external link">' + escapeHTML(raw) + '</a>');
        } else if (match[3]) {
            parts.push('<a href="https://' + escapeHTML(raw) + '" target="_blank" rel="noopener" title="external link">' + escapeHTML(raw) + '</a>');
        } else {
            parts.push('<a href="' + escapeHTML(raw) + '" target="_blank" rel="noopener" title="external link">' + escapeHTML(raw) + '</a>');
        }
        last = match.index + raw.length;
    }
    if (last < text.length) {
        parts.push(escapeHTML(text.slice(last)));
    }
    return parts.join("");
}

function linkify(text) {
    // Process internal page links first, then external links on remaining segments
    const parts = [];
    let last = 0;
    let match;
    let hasLinks = false;
    pageLinkPattern.lastIndex = 0;
    while ((match = pageLinkPattern.exec(text)) !== null) {
        hasLinks = true;
        if (match.index > last) {
            parts.push(linkifySegment(text.slice(last, match.index)));
        }
        const label = escapeHTML(match[1]);
        const target = match[2];
        if (target.startsWith("http://") || target.startsWith("https://")) {
            parts.push('<a href="' + escapeHTML(target) + '" target="_blank" rel="noopener" title="external link">' + label + '</a>');
        } else if (target.startsWith("mailto:")) {
            parts.push('<a href="' + escapeHTML(target) + '" target="_blank" title="external link">' + label + '</a>');
        } else {
            const path = escapeHTML(target.startsWith("~/") ? target : "~/" + target);
            parts.push('<span class="page-link clickable dir" data-path="' + path + '" title="go to">' + label + '</span>');
        }
        last = match.index + match[0].length;
    }
    if (last < text.length) {
        const tail = linkifySegment(text.slice(last));
        if (tail !== escapeHTML(text.slice(last))) hasLinks = true;
        parts.push(tail);
    }
    if (!hasLinks && last === 0) {
        // Try external links only
        const result = linkifySegment(text);
        if (result === escapeHTML(text)) return null;
        return result;
    }
    if (!hasLinks) return null;
    return parts.join("");
}

// --- Hint system ---
let hintEl = null;
let catUsed = false;

function showHint() {
    removeHint();
    if (!catUsed && currentPath !== "~" && inputBuffer === "") {
        const node = getNode(currentPath);
        const hasChildren = nodeHasContents(node);
        hintEl = document.createElement("span");
        hintEl.textContent = hasChildren
            ? "Hint: use cat/ls to view/list content"
            : "Hint: use cat to view content";
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

// --- Path resolution (N-level depth) ---
function isInSubpage() {
    return currentPath !== "~";
}

function pathSegments(p) {
    if (p === "~") return [];
    if (p.startsWith("~/")) return p.slice(2).split("/");
    return p.split("/");
}

function getNode(p) {
    const segs = pathSegments(p);
    let node = null;
    let container = tree;
    for (const seg of segs) {
        const match = Object.keys(container).find(k => k.toLowerCase() === seg.toLowerCase());
        if (!match) return null;
        node = container[match];
        container = node.children;
    }
    return node;
}

function parentOf(p) {
    if (p === "~") return null;
    const segs = pathSegments(p);
    if (segs.length <= 1) return "~";
    return "~/" + segs.slice(0, -1).join("/");
}

function resolveFrom(basePath, relPath) {
    if (!relPath || relPath === "") return basePath;
    const parts = relPath.split("/");
    let current = basePath;
    for (const part of parts) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            const parent = parentOf(current);
            if (parent === null) return null;
            current = parent;
            continue;
        }
        // Walk into children
        const node = current === "~" ? null : getNode(current);
        const container = current === "~" ? tree : (node ? node.children : {});
        const match = Object.keys(container).find(k => k.toLowerCase() === part.toLowerCase());
        if (!match) return null;
        current = current === "~" ? "~/" + match : current + "/" + match;
    }
    return current;
}

function resolvePath(target) {
    if (!target || target === "~" || target === "/") return "~";
    if (target.length > 1 && target.endsWith("/")) target = target.slice(0, -1);
    if (target.startsWith("./")) target = target.slice(2);
    if (target === ".") return currentPath;

    if (target === "..") {
        return parentOf(currentPath);
    }
    if (target.startsWith("../")) {
        const parent = parentOf(currentPath);
        if (parent === null) return null;
        return resolveFrom(parent, target.slice(3));
    }

    if (target.startsWith("~/")) {
        return resolveFrom("~", target.slice(2));
    }

    // Bare name: resolve relative to current dir
    return resolveFrom(currentPath, target);
}

function cdCommandFor(pageName) {
    if (currentPath === "~") return "cd " + pageName;
    return "cd ~/" + pageName;
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
let currentAnimation = null;

function skipAnimation() {
    if (!currentAnimation) return;
    currentAnimation = null;
    animationQueue = [];
    inputLine.style.display = "flex";
    animating = false;
    addLine("^C");
    updatePrompt();
    scrollToBottom();
}

function animateOutput(elements, callback) {
    animating = true;
    inputLine.style.display = "none";
    let elIdx = 0;
    let charIdx = 0;
    currentAnimation = { elements, elIdx, callback };

    let totalChars = 0;
    for (let i = 0; i < elements.length; i++) {
        if (!elements[i]._instant && elements[i]._fullText) {
            totalChars += elements[i]._fullText.length;
        }
    }
    // Target ~1200ms total animation. Short text gets slower per-char delay,
    // long text renders multiple chars per tick to keep total time bounded.
    const targetMs = 1200;
    const charsPerTick = Math.max(1, Math.ceil(totalChars / 333));
    const delay = Math.max(2, Math.min(8, Math.floor(targetMs / totalChars)));

    function next() {
        if (!currentAnimation) return;
        if (elIdx >= elements.length) {
            currentAnimation = null;
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
            currentAnimation.elIdx = elIdx;
            charIdx = 0;
            next();
            return;
        }

        if (charIdx === 0) {
            el.node.textContent = "";
            output.appendChild(el.node);
        }

        charIdx = Math.min(charIdx + charsPerTick, text.length);
        el.node.textContent = text.slice(0, charIdx);
        scrollToBottom();

        if (charIdx >= text.length) {
            const linked = linkify(text);
            if (linked) el.node.innerHTML = linked;
            elIdx++;
            currentAnimation.elIdx = elIdx;
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
    div.title = "go to page";
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

function makeSubpageNode(text, commandFn) {
    const div = document.createElement("div");
    div.className = "line clickable subpage";
    div.title = "open";
    div.addEventListener("click", function () {
        const cmd = typeof commandFn === "function" ? commandFn() : commandFn;
        runCommand(cmd);
    });
    return { node: div, _fullText: text };
}

function makeExecNode(text, commandFn) {
    const div = document.createElement("div");
    div.className = "line clickable exec";
    div.title = "run";
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

// --- Helper: check if a node has visible contents (children or executables) ---
function nodeHasContents(node) {
    if (!node) return false;
    if (Object.keys(node.children).length > 0) return true;
    if (!isMobile && Object.keys(node.executables).length > 0) return true;
    return false;
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
                "  sh [path]   Run executable",
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
                if (pathSegments(resolved).length > 1) {
                    elements.push(makeLineNode("ls: cannot access '" + target + "': Not a directory"));
                    break;
                }
                listPath = resolved;
            }

            if (listPath === "~") {
                pageNames.forEach(name => {
                    const node = tree[name];
                    const hasContents = nodeHasContents(node);
                    elements.push(makeClickableNode(name, () => {
                        if (currentPath === "~/" + name) return hasContents ? "cat . && ls ." : "cat .";
                        const nav = cdCommandFor(name) + " && cat .";
                        return hasContents ? nav + " && ls ." : nav;
                    }));
                });
            } else {
                const node = getNode(listPath);
                const backNode = makeClickableNode("..", () => "cd ..");
                backNode.node.title = "back";
                elements.push(backNode);
                if (node) {
                    // Show children as subpage content nodes (cat-only, not cd targets)
                    for (const childName of node.childOrder) {
                        elements.push(makeSubpageNode(childName, () => {
                            return "cat " + childName;
                        }));
                    }
                    // Show executables
                    if (!isMobile) {
                        for (const execName of Object.keys(node.executables)) {
                            elements.push(makeExecNode(execName, () => {
                                if (currentPath === listPath) return "sh " + execName;
                                return "sh " + listPath.slice(2) + "/" + execName;
                            }));
                        }
                    }
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
            } else if (pathSegments(resolved).length > 1) {
                elements.push(makeLineNode("cd: not a directory: " + target));
            } else {
                if (resolved !== currentPath) catUsed = false;
                currentPath = resolved;
            }
            break;
        }

        case "cat": {
            const target = args[0];

            // Handle cat <executable> — resolve via executable paths
            if (target && !isMobile) {
                const exec = resolveExecutable(target);
                if (exec) {
                    catUsed = true;
                    const helpText = exec.help || (exec.name + ": no help available");
                    helpText.split("\n").forEach(line => elements.push(makeLineNode(line || "\u00a0")));
                    elements.push(makeLineNode("\u00a0"));
                    break;
                }
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
                const node = getNode(catPath);
                if (node && node.content) {
                    catUsed = true;
                    node.content.split("\n").forEach(line => elements.push(makeLineNode(line || "\u00a0")));
                    elements.push(makeLineNode("\u00a0"));
                } else {
                    elements.push(makeLineNode("cat: No such file or directory"));
                }
            }
            break;
        }

        case "clear":
            output.innerHTML = "";
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
                if (isMobile) {
                    elements.push(makeLineNode(target + ": executables are not available on mobile devices"));
                    break;
                }
                animating = true;
                startExecutable(shExec);
                return;
            }
            elements.push(makeLineNode(target + ": not executable"));
            break;
        }

        default:
            if (command.startsWith("./") || command.startsWith("~/") || command.startsWith("../") || command.includes("/")) {
                const pathExec = resolveExecutable(command);
                if (pathExec) {
                    if (isMobile) {
                        elements.push(makeLineNode(command + ": executables are not available on mobile devices"));
                        break;
                    }
                    animating = true;
                    startExecutable(pathExec);
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

document.getElementById("nav-home").addEventListener("click", () => runCommand("cd ~"));
document.getElementById("nav-menu").addEventListener("click", () => runCommand("ls ~"));
document.getElementById("nav-clear").addEventListener("click", () => runCommand("clear"));

// --- Executable lifecycle (generic) ---
async function startExecutable(exec) {
    gameMode = true;
    output.style.display = "none";
    inputLine.style.display = "none";
    document.getElementById("nav").style.display = "none";

    const container = document.createElement("div");
    container.id = "game-container";
    container.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:100;";
    document.body.appendChild(container);

    const mod = await import(exec.src);
    currentModule = mod;
    mod.start(container, stopExecutable);
}

function stopExecutable() {
    if (currentModule) {
        currentModule.stop();
    }
    currentModule = null;
    gameMode = false;
    const container = document.getElementById("game-container");
    if (container) container.parentNode.removeChild(container);

    output.style.display = "";
    inputLine.style.display = "flex";
    document.getElementById("nav").style.display = "flex";

    animating = false;
    updatePrompt();
    scrollToBottom();
    drainQueue();
}

let resizeTimer = null;
window.addEventListener("resize", function () {
    if (!gameMode || !currentModule) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        currentModule.handleResize();
    }, 150);
});

// --- Executable resolution (tree-driven) ---
function resolveExecutable(path) {
    let clean = path;
    if (clean.startsWith("./")) clean = clean.slice(2);

    // Try resolving as a relative/absolute path with exec at the end
    // e.g. "fih", "Games/fih", "~/Games/fih", "../Games/fih"
    let basePath = currentPath;
    let execName = clean;

    if (clean.startsWith("~/")) {
        basePath = "~";
        clean = clean.slice(2);
    } else if (clean.startsWith("../")) {
        const parent = parentOf(currentPath);
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

// --- Tab completion ---
const commandNames = isMobile
    ? ["help", "ls", "cd", "cat", "clear", "claude", "echo"]
    : ["help", "ls", "cd", "cat", "clear", "claude", "echo", "sh"];
const argCommands = ["cd", "cat", "ls", "sh"];

function getNodeChildren(p) {
    if (p === "~") return Object.keys(tree);
    const node = getNode(p);
    if (!node) return [];
    return Object.keys(node.children);
}

function getNodeExecs(p) {
    if (p === "~") return [];
    const node = getNode(p);
    if (!node) return [];
    return Object.keys(node.executables);
}

function getCompletionTargets(argPrefix, cmd) {
    let targets = [];
    const isDirOnly = (cmd === "cd" || cmd === "ls");

    // Determine base path and prefix for completion
    let basePath = currentPath;
    let pathPrefix = "";

    if (argPrefix.startsWith("~/")) {
        basePath = "~";
        pathPrefix = "~/";
        const rest = argPrefix.slice(2);
        const slash = rest.lastIndexOf("/");
        if (slash !== -1) {
            const dirPart = rest.slice(0, slash);
            const resolved = resolveFrom("~", dirPart);
            if (resolved) {
                basePath = resolved;
                pathPrefix = "~/" + dirPart + "/";
            }
        }
    } else if (argPrefix.startsWith("../")) {
        const parent = parentOf(currentPath);
        if (parent !== null) {
            basePath = parent;
            pathPrefix = "../";
            const rest = argPrefix.slice(3);
            const slash = rest.lastIndexOf("/");
            if (slash !== -1) {
                const dirPart = rest.slice(0, slash);
                const resolved = resolveFrom(parent, dirPart);
                if (resolved) {
                    basePath = resolved;
                    pathPrefix = "../" + dirPart + "/";
                }
            }
        }
    } else {
        const slash = argPrefix.lastIndexOf("/");
        if (slash !== -1) {
            const dirPart = argPrefix.slice(0, slash);
            const resolved = resolveFrom(currentPath, dirPart);
            if (resolved) {
                basePath = resolved;
                pathPrefix = dirPart + "/";
            }
        }
    }

    const baseDepth = pathSegments(basePath).length;

    // At home (depth 0): children are top-level pages (directories), show as dir/
    // At depth 1+: children are subpage content, only shown for cat/ls (not cd)
    if (baseDepth === 0) {
        const children = getNodeChildren(basePath);
        for (const child of children) {
            targets.push(pathPrefix + child + "/");
        }
    } else if (!isDirOnly) {
        const children = getNodeChildren(basePath);
        for (const child of children) {
            targets.push(pathPrefix + child);
        }
    }

    // Add executables (never for cd)
    if (!isMobile && !isDirOnly) {
        const execs = getNodeExecs(basePath);
        for (const exec of execs) {
            targets.push(pathPrefix + exec);
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

        // Handle path-based completion: ./ ~/ ../ or contains /
        if (p.startsWith("./") || p.startsWith("~/") || p.startsWith("../") || p.includes("/")) {
            let pathPrefix = "";
            let argPrefix = parts[0];
            if (p.startsWith("./")) {
                pathPrefix = "./";
                argPrefix = parts[0].slice(2);
            }
            const targets = getCompletionTargets(argPrefix);
            return targets
                .filter(e => e.toLowerCase().startsWith(argPrefix.toLowerCase()) && e.toLowerCase() !== argPrefix.toLowerCase())
                .map(e => prefix + pathPrefix + e);
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
const isMac = /mac/i.test(navigator.userAgent);

document.addEventListener("keydown", function (e) {
    // Ctrl+C stops executable
    if (gameMode && e.ctrlKey && e.code === "KeyC") {
        e.preventDefault();
        stopExecutable();
        return;
    }
    if (gameMode) return;

    // Ctrl+C interrupts animation
    if (animating && e.ctrlKey && e.code === "KeyC") {
        e.preventDefault();
        skipAnimation();
        return;
    }

    if (animating) return;

    if (e.ctrlKey && !e.metaKey && !e.altKey) {
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

    if (e.metaKey && !e.altKey && !e.ctrlKey) {
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
            inputBuffer = inputBuffer.slice(cursorPos);
            cursorPos = 0;
            renderInput();
            if (inputBuffer === "") showHint();
            return;
        }
        return;
    }

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
            const newPos = wordLeft(cursorPos);
            inputBuffer = inputBuffer.slice(0, newPos) + inputBuffer.slice(cursorPos);
            cursorPos = newPos;
            renderInput();
            if (inputBuffer === "") showHint();
            return;
        }
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

// --- Page link click handler (delegated) ---
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
    const targetPage = segs[0];

    // Determine the directory we need to be in
    const needDir = targetChild ? targetParent : resolved;

    // Build shortest relative cd command
    let nav = "";
    if (currentPath === needDir) {
        // Already there
    } else if (currentPath === "~") {
        nav = "cd " + targetPage;
    } else if (needDir === "~") {
        nav = "cd ~";
    } else if (parentOf(currentPath) === parentOf(needDir)) {
        // Sibling pages
        nav = "cd ../" + pathSegments(needDir).pop();
    } else {
        nav = "cd " + needDir;
    }

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

terminal.addEventListener("click", function (e) {
    if (e.target.closest("#nav") || e.target.classList.contains("clickable") || e.target.tagName === "A" || e.target.closest(".page-link")) return;
    if (window.matchMedia("(pointer: coarse)").matches && !animating) {
        const hasContents = currentPath === "~" || nodeHasContents(getNode(currentPath));
        runCommand(hasContents ? "cat . && ls ." : "cat .");
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
