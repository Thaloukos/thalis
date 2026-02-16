import { state, dom, callbacks } from './state.js';
import { isMobile } from './manifest.js';
import { pathSegments, getNode, isTopLevelDir } from './path.js';
import { getPromptHTML, updatePrompt } from './input.js';

// --- Conditional text: {{desktop text}{mobile text}} ---
const conditionalPattern = /\{\{([^}]*)\}\{([^}]*)\}\}/g;

export function resolveConditional(text) {
    return text.replace(conditionalPattern, function (_, desktop, mobile) {
        return isMobile ? mobile : desktop;
    });
}

// --- Link detection ---
const linkPattern = /(https?:\/\/[^\s]+)|([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})|([a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
const pageLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

export function escapeHTML(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

export function linkifySegment(text) {
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

export function linkify(text) {
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
            const path = target.startsWith("~/") ? target : "~/" + target;
            const segs = pathSegments(path);
            let cls = "page-link clickable dir";
            let title = "go to";
            if (segs.length > 1) {
                const parentPath = "~/" + segs.slice(0, -1).join("/");
                const parentNode = getNode(parentPath);
                if (parentNode && parentNode.executables[segs[segs.length - 1]]) {
                    cls = "page-link clickable exec";
                    title = "run";
                } else {
                    cls = "page-link clickable subpage";
                    title = "open";
                }
            } else if (segs.length === 1 && !isTopLevelDir(segs[0])) {
                cls = "page-link clickable subpage";
                title = "open";
            }
            parts.push('<span class="' + cls + '" data-path="' + escapeHTML(path) + '" title="' + title + '">' + label + '</span>');
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

// --- Output helpers ---
export function addLine(text) {
    const div = document.createElement("div");
    div.className = "line";
    div.textContent = text;
    dom.output.appendChild(div);
    return div;
}

export function scrollToBottom() {
    window.scrollTo(0, document.body.scrollHeight);
}

export function addPromptLine(cmd) {
    const div = document.createElement("div");
    div.className = "line";
    div.innerHTML = getPromptHTML() + escapeHTML(cmd);
    dom.output.appendChild(div);
    return div;
}

// --- Animated output ---
export function skipAnimation() {
    if (!state.currentAnimation) return;
    state.currentAnimation = null;
    state.animationQueue = [];
    dom.inputLine.style.display = "flex";
    state.animating = false;
    addLine("^C");
    updatePrompt();
    scrollToBottom();
}

export function animateOutput(elements, callback) {
    state.animating = true;
    dom.inputLine.style.display = "none";
    let elIdx = 0;
    let charIdx = 0;
    state.currentAnimation = { elements, elIdx, callback };

    for (let i = 0; i < elements.length; i++) {
        if (elements[i]._fullText) {
            elements[i]._fullText = resolveConditional(elements[i]._fullText);
        }
    }

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
        if (!state.currentAnimation) return;
        if (elIdx >= elements.length) {
            state.currentAnimation = null;
            dom.inputLine.style.display = "flex";
            state.animating = false;
            scrollToBottom();
            if (callback) callback();
            drainQueue();
            return;
        }
        const el = elements[elIdx];
        const text = el._fullText;

        if (el._instant || !text || text.length === 0) {
            el.node.textContent = text || "";
            dom.output.appendChild(el.node);
            if (text) {
                const linked = linkify(text);
                if (linked) el.node.innerHTML = linked;
            }
            elIdx++;
            state.currentAnimation.elIdx = elIdx;
            charIdx = 0;
            next();
            return;
        }

        if (charIdx === 0) {
            el.node.textContent = "";
            dom.output.appendChild(el.node);
        }

        charIdx = Math.min(charIdx + charsPerTick, text.length);
        el.node.textContent = text.slice(0, charIdx);
        scrollToBottom();

        if (charIdx >= text.length) {
            const linked = linkify(text);
            if (linked) el.node.innerHTML = linked;
            elIdx++;
            state.currentAnimation.elIdx = elIdx;
            charIdx = 0;
            setTimeout(next, delay);
        } else {
            setTimeout(next, delay);
        }
    }

    next();
}

// --- Node builders ---
export function makeLineNode(text) {
    const div = document.createElement("div");
    div.className = "line";
    return { node: div, _fullText: text };
}

export function makeClickableNode(text, commandFn) {
    const div = document.createElement("div");
    div.className = "line clickable dir";
    div.title = "go to";
    div.addEventListener("click", function () {
        const cmd = typeof commandFn === "function" ? commandFn() : commandFn;
        callbacks.runCommand(cmd);
    });
    return { node: div, _fullText: text };
}

export function makeDirNode(text) {
    const div = document.createElement("div");
    div.className = "line dir";
    return { node: div, _fullText: text };
}

export function makeSubpageNode(text, commandFn) {
    const div = document.createElement("div");
    div.className = "line clickable subpage";
    div.title = "open";
    div.addEventListener("click", function () {
        const cmd = typeof commandFn === "function" ? commandFn() : commandFn;
        callbacks.runCommand(cmd);
    });
    return { node: div, _fullText: text };
}

export function makeExecNode(text, commandFn) {
    const div = document.createElement("div");
    div.className = "line clickable exec";
    div.title = "run";
    div.addEventListener("click", function () {
        const cmd = typeof commandFn === "function" ? commandFn() : commandFn;
        callbacks.runCommand(cmd);
    });
    return { node: div, _fullText: text };
}

export function makeColoredNode(text, color, opts) {
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
export function drainQueue() {
    if (state.animationQueue.length > 0) {
        const next = state.animationQueue.shift();
        next();
    }
}

export function enqueueOrRun(fn) {
    if (state.animating) {
        state.animationQueue.push(fn);
    } else {
        fn();
    }
}
