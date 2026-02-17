import { state, dom } from './state.js';
import { isMobile, pageNames, tree } from './manifest.js';
import { resolvePath, pathSegments, getNode, cdCommandFor, relativeCd, isTopLevelDir, isDirectory } from './path.js';
import { addPromptLine, makeLineNode, makeClickableNode, makeSubpageNode, makeExecNode, makeColoredNode, animateOutput, scrollToBottom, resolveConditional } from './output.js';
import { updatePrompt, nodeHasContents } from './input.js';
import { resolveExecutable, startExecutable } from './executables.js';

const wittyCommands = {
    date: "sorry, I'm taken",
    env: "cozy, thanks for asking",
    exit: "there is no escape",
    finger: "that's rude",
    fork: "spoon",
    fsck: "language!",
    head: "shoulders, knees and toes",
    history: "what happens in the terminal stays in the terminal",
    jobs: "market looking rough right now eh?",
    less: "is more",
    man: "no need to conform to gender binaries",
    more: "or less",
    mount: "neigh",
    ping: "pong",
    sleep: "none for the wicked",
    ssh: "shell already secure, don't worry",
    top: "I'm flattered",
    touch: "that's inappropriate",
    watch: "👀",
    which: "witch?",
    whoami: "why are you being philosophical?",
};

const sneakyCommands = [
    "rm", "mv", "cp", "mkdir", "rmdir", "touch", "chmod", "chown", "chgrp",
    "ln", "find", "grep", "sed", "awk", "sort", "uniq", "wc", "diff",
    "tar", "zip", "unzip", "gzip", "gunzip", "curl", "wget", "ssh", "scp",
    "ping", "traceroute", "netstat", "ifconfig", "ip", "dig", "nslookup",
    "ps", "top", "htop", "kill", "killall", "df", "du", "free", "mount",
    "umount", "fdisk", "mkfs", "dd", "id", "su", "passwd",
    "useradd", "userdel", "groupadd", "crontab", "systemctl", "service",
    "journalctl", "dmesg", "lsof", "strace", "nmap", "iptables",
    "apt", "yum", "dnf", "pacman", "brew", "pip", "npm", "git",
    "docker", "kubectl", "man", "which", "alias", "export", "source",
    "history", "tail", "head", "less", "more", "nano", "vim", "vi", "emacs",
    "pwd", "env", "set", "unset", "xargs", "tee", "nc", "telnet",
    "reboot", "shutdown", "halt", "poweroff", "watch"
];

export const welcomeText = resolveConditional("Welcome! {{Type 'help' for available commands, or click a button}{Tap on the screen to view current page content or navigate with the buttons}} ^");

export function processCommand(cmd, silent) {
    const trimmed = cmd.trim();
    if (!silent) addPromptLine(cmd);

    if (!trimmed) {
        updatePrompt();
        scrollToBottom();
        return;
    }

    let effective = trimmed;
    if (effective.startsWith("sudo ")) {
        state.isRoot = true;
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
            const showAll = args.includes("-a");
            const target = args.find(a => !a.startsWith("-"));
            let listPath = state.currentPath;
            if (target) {
                const resolved = resolvePath(target);
                if (resolved === null) {
                    elements.push(makeLineNode("ls: cannot access '" + target + "': No such directory"));
                    break;
                }
                if (!isDirectory(resolved)) {
                    elements.push(makeLineNode("ls: cannot access '" + target + "': Not a directory"));
                    break;
                }
                listPath = resolved;
            }

            if (listPath === "~") {
                pageNames.forEach(name => {
                    if (!showAll && name.startsWith(".")) return;
                    if (isTopLevelDir(name)) {
                        const node = tree[name];
                        const hasContents = nodeHasContents(node);
                        elements.push(makeClickableNode(name, () => {
                            if (state.currentPath === "~/" + name) return hasContents ? "cat . && ls ." : "cat .";
                            const nav = cdCommandFor(name) + " && cat .";
                            return hasContents ? nav + " && ls ." : nav;
                        }));
                    } else {
                        elements.push(makeSubpageNode(name, () => {
                            if (state.currentPath === "~") return "cat " + name;
                            return relativeCd("~") + " && cat " + name;
                        }));
                    }
                });
            } else {
                const node = getNode(listPath);
                const backNode = makeClickableNode("..", () => {
                    if (state.currentPath === listPath) return "cd ..";
                    return relativeCd("~") || "cd ~";
                });
                backNode.node.title = "back";
                elements.push(backNode);
                if (node) {
                    // Show children as subpage content nodes (cat-only, not cd targets)
                    for (const childName of node.childOrder) {
                        if (!showAll && childName.startsWith(".")) continue;
                        elements.push(makeSubpageNode(childName, () => {
                            if (state.currentPath === listPath) return "cat " + childName;
                            const nav = relativeCd(listPath);
                            return nav ? nav + " && cat " + childName : "cat " + childName;
                        }));
                    }
                    // Show executables
                    for (const execName of Object.keys(node.executables)) {
                        if (!showAll && execName.startsWith(".")) continue;
                        if (isMobile && node.executables[execName].mobileHidden) continue;
                        elements.push(makeExecNode(execName, () => {
                            if (state.currentPath === listPath) return "sh " + execName;
                            const nav = relativeCd(listPath);
                            return nav ? nav + " && sh " + execName : "sh " + execName;
                        }));
                    }
                }
            }
            if (elements.length > 0) elements.push(makeLineNode("\u00a0"));
            break;
        }

        case "cd": {
            const target = args[0];
            if (!target) {
                state.catUsed = false;
                state.currentPath = "~";
                break;
            }
            const resolved = resolvePath(target);
            if (resolved === null) {
                elements.push(makeLineNode("cd: no such directory: " + target));
            } else if (!isDirectory(resolved)) {
                elements.push(makeLineNode("cd: not a directory: " + target));
            } else {
                if (resolved !== state.currentPath) state.catUsed = false;
                state.currentPath = resolved;
            }
            break;
        }

        case "cat": {
            const target = args[0];

            // Handle cat <executable> — resolve via executable paths
            if (target) {
                const exec = resolveExecutable(target);
                if (exec && !(isMobile && exec.mobileHidden)) {
                    state.catUsed = true;
                    const helpText = exec.help || (exec.name + ": no help available");
                    helpText.split("\n").forEach(line => elements.push(makeLineNode(line || "\u00a0")));
                    elements.push(makeLineNode("\u00a0"));
                    break;
                }
            }

            let catPath = state.currentPath;
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
                    state.catUsed = true;
                    node.content.split("\n").forEach(line => elements.push(makeLineNode(line || "\u00a0")));
                    elements.push(makeLineNode("\u00a0"));
                } else {
                    elements.push(makeLineNode("cat: No such file or directory"));
                }
            }
            break;
        }

        case "clear":
            dom.output.innerHTML = "";
            dom.terminal.querySelectorAll(":scope > .line").forEach(el => el.remove());
            updatePrompt();
            scrollToBottom();
            return;

        case "hostname":
            elements.push(makeLineNode("thalis.sh"));
            break;

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
                if (isMobile && shExec.mobileHidden) {
                    elements.push(makeLineNode(target + ": not available on mobile devices"));
                    break;
                }
                state.animating = true;
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
                    if (isMobile && pathExec.mobileHidden) {
                        elements.push(makeLineNode(command + ": not available on mobile devices"));
                        break;
                    }
                    state.animating = true;
                    startExecutable(pathExec);
                    return;
                }
                elements.push(makeLineNode(command + ": not executable"));
            } else if (wittyCommands[command]) {
                elements.push(makeLineNode(command + ": " + wittyCommands[command]));
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
