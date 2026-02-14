import { state } from './state.js';
import { tree } from './manifest.js';

export function isInSubpage() {
    return state.currentPath !== "~";
}

export function pathSegments(p) {
    if (p === "~") return [];
    if (p.startsWith("~/")) return p.slice(2).split("/");
    return p.split("/");
}

export function getNode(p) {
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

export function parentOf(p) {
    if (p === "~") return null;
    const segs = pathSegments(p);
    if (segs.length <= 1) return "~";
    return "~/" + segs.slice(0, -1).join("/");
}

export function resolveFrom(basePath, relPath) {
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

export function resolvePath(target) {
    if (!target || target === "~" || target === "/") return "~";
    if (target.length > 1 && target.endsWith("/")) target = target.slice(0, -1);
    if (target.startsWith("./")) target = target.slice(2);
    if (target === ".") return state.currentPath;

    if (target === "..") {
        return parentOf(state.currentPath);
    }
    if (target.startsWith("../")) {
        const parent = parentOf(state.currentPath);
        if (parent === null) return null;
        return resolveFrom(parent, target.slice(3));
    }

    if (target.startsWith("~/")) {
        return resolveFrom("~", target.slice(2));
    }

    // Bare name: resolve relative to current dir
    return resolveFrom(state.currentPath, target);
}

export function relativeCd(targetDir) {
    if (state.currentPath === targetDir) return "";
    if (targetDir === "~") return "cd ~";
    if (state.currentPath === "~") {
        // From home, just use the top-level name
        return "cd " + pathSegments(targetDir)[0];
    }
    const curSegs = pathSegments(state.currentPath);
    const tarSegs = pathSegments(targetDir);
    if (curSegs[0] === tarSegs[0]) {
        // Same top-level page — use ../ to go up then down
        let up = curSegs.length;
        let rel = "../".repeat(up) + tarSegs.join("/");
        return "cd " + rel;
    }
    if (curSegs.length === 1 && tarSegs.length === 1) {
        // Sibling top-level pages
        return "cd ../" + tarSegs[0];
    }
    // Different branches — ../ up to home then down
    let up = curSegs.length;
    return "cd " + "../".repeat(up) + tarSegs.join("/");
}

export function cdCommandFor(pageName) {
    return relativeCd("~/" + pageName);
}

export function isTopLevelDir(name) {
    const base = name.startsWith(".") ? name.slice(1) : name;
    return base.length > 0 && base[0] >= 'A' && base[0] <= 'Z';
}

export function isDirectory(p) {
    if (p === "~") return true;
    const segs = pathSegments(p);
    if (segs.length !== 1) return false;
    return isTopLevelDir(segs[0]);
}
