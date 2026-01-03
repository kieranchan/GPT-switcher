// content.js - GPT Limit Detector (Optimized from Claude-Switcher)

// Configuration
const CONFIG = {
    // Regex patterns to detect GPT usage limits
    LIMIT_REGEXES: [
        /limit reached/i,
        /try again (?:in\s+)?(\d+)\s*(hours?|minutes?|mins?)/i,
        /quota exceeded/i,
        /too many requests/i,
        /slow down/i
    ],
    THROTTLE_MS: 2000,
    MAX_NODES_PER_FRAME: 100
};

let isProcessing = false;
let throttleTimer = null;
let observer = null;

// --- Initialization ---

function init() {
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Initial check
    scheduleCheck();
}

// --- Throttled Mutation Handling ---

function handleMutations(mutations) {
    if (throttleTimer) return;

    throttleTimer = setTimeout(() => {
        throttleTimer = null;
        scheduleCheck();
    }, CONFIG.THROTTLE_MS);
}

function scheduleCheck() {
    if (isProcessing) return;
    isProcessing = true;
    requestAnimationFrame(() => {
        try {
            searchForLimitText(document.body);
        } catch (e) {
            console.error("GPT Switcher: Error during limit search", e);
        } finally {
            isProcessing = false;
        }
    });
}

function searchForLimitText(rootNode) {
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function (node) {
                const txt = node.nodeValue.trim();
                if (txt && txt.length > 5 && (txt.includes("limit") || txt.includes("try again") || txt.includes("quota"))) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        }
    );

    let currentNode = walker.lastChild();
    while (currentNode) {
        const text = currentNode.nodeValue;
        let match = null;

        for (const regex of CONFIG.LIMIT_REGEXES) {
            match = text.match(regex);
            if (match) break;
        }

        if (match) {
            showToast(`⚠️ GPT 使用限制: ${text.slice(0, 50)}...`);
            return true;
        }
        currentNode = walker.previousNode();
    }

    return false;
}

function showToast(msg) {
    if (document.getElementById('gpt-switcher-toast')) return;

    const div = document.createElement('div');
    div.id = 'gpt-switcher-toast';
    Object.assign(div.style, {
        position: 'fixed', top: '20px', right: '20px',
        backgroundColor: '#10a37f', color: 'white',
        padding: '10px 18px', borderRadius: '8px',
        zIndex: '2147483647', fontSize: '13px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)', pointerEvents: 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
    });
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
