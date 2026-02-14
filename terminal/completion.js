import { state } from './state.js';
import { isMobile, tree } from './manifest.js';
import { getNode, parentOf, pathSegments, resolveFrom } from './path.js';

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
    let basePath = state.currentPath;
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
        const parent = parentOf(state.currentPath);
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
            const resolved = resolveFrom(state.currentPath, dirPart);
            if (resolved) {
                basePath = resolved;
                pathPrefix = dirPart + "/";
            }
        }
    }

    const baseDepth = pathSegments(basePath).length;
    // Determine the partial name being typed (after last /)
    const lastSlash = argPrefix.lastIndexOf("/");
    const partial = lastSlash !== -1 ? argPrefix.slice(lastSlash + 1) : argPrefix;
    const showHidden = partial.startsWith(".");

    // At home (depth 0): children are top-level pages (directories), show as dir/
    // At depth 1+: children are subpage content, only shown for cat/ls (not cd)
    if (baseDepth === 0) {
        const children = getNodeChildren(basePath);
        for (const child of children) {
            if (!showHidden && child.startsWith(".")) continue;
            targets.push(pathPrefix + child + "/");
        }
    } else if (!isDirOnly) {
        const children = getNodeChildren(basePath);
        for (const child of children) {
            if (!showHidden && child.startsWith(".")) continue;
            targets.push(pathPrefix + child);
        }
    }

    // Add executables (never for cd)
    if (!isMobile && !isDirOnly) {
        const execs = getNodeExecs(basePath);
        for (const exec of execs) {
            if (!showHidden && exec.startsWith(".")) continue;
            targets.push(pathPrefix + exec);
        }
    }


    return targets;
}

export function getCompletions(input) {
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
    const argParts = parts.slice(1);
    const flags = argParts.filter(a => a.startsWith("-"));
    const nonFlags = argParts.filter(a => !a.startsWith("-"));
    const flagStr = flags.length ? flags.join(" ") + " " : "";
    let argPrefix = nonFlags.join(" ");
    let argDotSlash = "";
    if (argPrefix.startsWith("./")) {
        argDotSlash = "./";
        argPrefix = argPrefix.slice(2);
    }
    const targets = getCompletionTargets(argPrefix, cmd);
    return targets
        .filter(t => t.toLowerCase().startsWith(argPrefix.toLowerCase()) && t.toLowerCase() !== argPrefix.toLowerCase())
        .map(t => prefix + cmd + " " + flagStr + argDotSlash + t);
}
