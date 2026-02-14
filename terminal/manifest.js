export const isMobile = window.matchMedia("(pointer: coarse)").matches;
export let pageNames = [];
export const tree = {};
export let mobileHiddenPages = [];

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

export async function loadManifest() {
    const nocache = "?v=" + Date.now();
    const manifest = await fetch("/manifest.json" + nocache).then(r => r.json());
    mobileHiddenPages = manifest.mobileHidden || [];
    pageNames = manifest.order.filter(name => !isMobile || !mobileHiddenPages.includes(name));

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
}
