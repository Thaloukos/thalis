#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");
const EXEC_DIR = path.join(ROOT, "executables");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");

function scanPages(dir, prefix) {
    const tree = {};
    if (!fs.existsSync(dir)) return tree;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const txtFiles = entries.filter(e => e.isFile() && e.name.endsWith(".txt"));
    const dirs = entries.filter(e => e.isDirectory());

    for (const f of txtFiles) {
        const name = f.name.replace(/\.txt$/, "");
        const contentPath = prefix ? prefix + "/" + f.name : "pages/" + f.name;
        if (!tree[name]) tree[name] = {};
        tree[name].content = contentPath;
    }

    for (const d of dirs) {
        const childDir = path.join(dir, d.name);
        const childPrefix = prefix ? prefix + "/" + d.name : "pages/" + d.name;
        const children = scanPages(childDir, childPrefix);
        if (Object.keys(children).length > 0) {
            if (!tree[d.name]) tree[d.name] = {};
            tree[d.name].children = children;

            // Read .order file if present
            const orderFile = path.join(childDir, ".order");
            if (fs.existsSync(orderFile)) {
                const lines = fs.readFileSync(orderFile, "utf-8").split("\n").map(l => l.trim().replace(/\.txt$/, "")).filter(Boolean);
                const allChildren = Object.keys(children);
                const ordered = lines.filter(l => allChildren.includes(l));
                const remaining = allChildren.filter(c => !ordered.includes(c)).sort();
                tree[d.name].childOrder = ordered.concat(remaining);
            } else {
                tree[d.name].childOrder = Object.keys(children).sort();
            }
        }
    }

    return tree;
}

function scanExecutables(dir, prefix) {
    const result = {};
    if (!fs.existsSync(dir)) return result;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());
    const jsFiles = entries.filter(e => e.isFile() && e.name.endsWith(".js"));

    // Collect executables at this level
    const execs = {};
    for (const f of jsFiles) {
        const name = f.name.replace(/\.js$/, "");
        const src = "/" + (prefix ? prefix + "/" + f.name : "executables/" + f.name);
        const entry = { src };

        // Check for companion .txt help file
        const helpFile = path.join(dir, name + ".txt");
        if (fs.existsSync(helpFile)) {
            entry.help = "/" + (prefix ? prefix + "/" + name + ".txt" : "executables/" + name + ".txt");
        }
        execs[name] = entry;
    }

    if (Object.keys(execs).length > 0) {
        // The directory name is the page this attaches to
        result._execs = execs;
    }

    // Recurse into subdirectories
    for (const d of dirs) {
        const childDir = path.join(dir, d.name);
        const childPrefix = prefix ? prefix + "/" + d.name : "executables/" + d.name;
        const childResult = scanExecutables(childDir, childPrefix);
        result[d.name] = childResult;
    }

    return result;
}

function attachExecutables(tree, execTree) {
    for (const [dirName, execData] of Object.entries(execTree)) {
        if (dirName === "_execs") continue;
        if (tree[dirName]) {
            // Attach executables from this exec dir to the matching page node
            if (execData._execs) {
                tree[dirName].executables = execData._execs;
            }
            // Recurse for nested
            const nested = { ...execData };
            delete nested._execs;
            if (Object.keys(nested).length > 0 && tree[dirName].children) {
                attachExecutables(tree[dirName].children, nested);
            }
        }
    }
}

function buildManifest() {
    const tree = scanPages(PAGES_DIR, null);
    const execTree = scanExecutables(EXEC_DIR, null);
    attachExecutables(tree, execTree);

    // Determine order from pages/.order file, append new pages alphabetically
    let order;
    const orderFile = path.join(PAGES_DIR, ".order");
    if (fs.existsSync(orderFile)) {
        const lines = fs.readFileSync(orderFile, "utf-8").split("\n").map(l => l.trim().replace(/\.txt$/, "")).filter(Boolean);
        const allPages = Object.keys(tree);
        const ordered = lines.filter(l => allPages.includes(l));
        const remaining = allPages.filter(p => !ordered.includes(p)).sort();
        order = ordered.concat(remaining);
    } else {
        order = Object.keys(tree).sort();
    }

    // Read mobile-hidden pages
    let mobileHidden = [];
    const mobileHiddenFile = path.join(PAGES_DIR, ".mobile-hidden");
    if (fs.existsSync(mobileHiddenFile)) {
        mobileHidden = fs.readFileSync(mobileHiddenFile, "utf-8").split("\n").map(l => l.trim()).filter(Boolean);
    }

    return { order, mobileHidden, tree };
}

function main() {
    const checkMode = process.argv.includes("--check");
    const manifest = buildManifest();
    const json = JSON.stringify(manifest, null, 2) + "\n";

    if (checkMode) {
        let existing = "";
        try {
            existing = fs.readFileSync(MANIFEST_PATH, "utf-8");
        } catch {
            console.error("manifest.json not found. Run: node scripts/build-manifest.js");
            process.exit(1);
        }
        if (existing !== json) {
            console.error("manifest.json is out of date. Run: node scripts/build-manifest.js");
            process.exit(1);
        }
        console.log("manifest.json is up to date.");
        process.exit(0);
    }

    fs.writeFileSync(MANIFEST_PATH, json);
    console.log("Generated manifest.json");
}

main();
