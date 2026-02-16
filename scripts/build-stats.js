#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STATS_FILE = path.join(ROOT, "pages", "About", ".stats.txt");

// --- Total site size (files served to the browser) ---
function getServedSize() {
    const SKIP = new Set([".git", ".github", ".claude", "scripts", "node_modules"]);
    let total = 0;
    function walk(dir, isRoot) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (isRoot && SKIP.has(entry.name)) continue;
            if (isRoot && entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full, false);
            } else if (entry.isFile()) {
                total += fs.statSync(full).size;
            }
        }
    }
    walk(ROOT, true);
    return total;
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + " KB";
    const mb = kb / 1024;
    return mb.toFixed(2) + " MB";
}

// --- Lines of JavaScript ---
function countJSLines() {
    let lines = 0;
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(".js")) {
                lines += fs.readFileSync(full, "utf-8").split("\n").length;
            }
        }
    }
    lines += fs.readFileSync(path.join(ROOT, "terminal.js"), "utf-8").split("\n").length;
    walk(path.join(ROOT, "terminal"));
    walk(path.join(ROOT, "executables"));
    return lines;
}

function formatNumber(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// --- Git stats ---
function getCommitCount() {
    try {
        const count = parseInt(execSync("git rev-list --count --first-parent main", { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] }).toString().trim());
        return count + 1; // +1 for the squash merge being made
    } catch {
        return 1;
    }
}

function getLastUpdated() {
    return new Date().toISOString().split("T")[0];
}

// --- Generate ---
const size = getServedSize();
const jsLines = countJSLines();
const commits = getCommitCount();
const date = getLastUpdated();

const content = [
    "Site Stats",
    "----------",
    "Last updated    " + date,
    "Total size      " + formatSize(size),
    "Lines of JS     " + formatNumber(jsLines),
    "Commits         " + formatNumber(commits),
].join("\n");

fs.writeFileSync(STATS_FILE, content + "\n");
console.log("Generated " + path.relative(ROOT, STATS_FILE));
