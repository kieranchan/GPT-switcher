/**
 * GPT-Switcher Main Module
 * 入口点、业务逻辑和标签管理系统
 */

import {
    $, ICONS, CHATGPT_URL, COOKIE_NAME,
    STORAGE_KEY, TAGS_KEY, FILTER_TAG_KEY, TAG_ORDERS_KEY, THEME_KEY
} from './constants.js';

import {
    createStore, sanitize, validateAccount,
    createAccountMap, createTagMap,
    setStore, getStore,
    setGrabPlan, getGrabPlan,
    setGrabProfile, getGrabProfile,
    setEditIndex, getEditIndex,
    setEditingTagId, getEditingTagId,
    setDeleteConfirmCallback, getDeleteConfirmCallback
} from './store.js';

import { App, setSwitchAccount } from './components.js';

// --- Main Entry ---
document.addEventListener('DOMContentLoaded', async () => {
    const data = await chrome.storage.local.get([STORAGE_KEY, TAGS_KEY, FILTER_TAG_KEY, TAG_ORDERS_KEY, THEME_KEY]);
    let accounts = data[STORAGE_KEY] || [];
    let tags = data[TAGS_KEY] || [];
    const rawFilterTagId = data[FILTER_TAG_KEY] || 'all';
    const rawTagOrders = data[TAG_ORDERS_KEY] || {};
    const filterTagId = getValidFilterTagId(rawFilterTagId, tags, accounts);
    const tagOrders = buildTagOrders(accounts, tags, rawTagOrders);

    if (!hasSameTagOrders(rawTagOrders, tagOrders) || rawFilterTagId !== filterTagId) {
        await chrome.storage.local.set({
            [TAG_ORDERS_KEY]: tagOrders,
            [FILTER_TAG_KEY]: filterTagId,
        });
    }

    const store = createStore({
        accounts,
        tags,
        tagOrders,
        filterTagId,
        activeToken: await getActiveToken(),
        filter: '',
        accountMap: createAccountMap(accounts),
        tagMap: createTagMap(tags),
    });

    setStore(store);

    // 注入依赖
    setSwitchAccount(switchAccount);

    App(store);
    initEventListeners(store);
    initTagManager(store);
    renderTagFilterBar(store);

    // Theme Init
    const isDark = data[THEME_KEY] === 'dark' || (!data[THEME_KEY] && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark);

    // Keep startup non-blocking so the popup never appears blank during ChatGPT page reloads.
    ensureCurrentAccountSynced(store).catch((error) => {
        console.debug('Startup sync skipped', error);
    });
});

function mergeOrder(existingOrder = [], nextTokens = []) {
    const normalizedTokens = [...new Set(nextTokens)];
    const allowed = new Set(normalizedTokens);
    const preserved = Array.isArray(existingOrder)
        ? existingOrder.filter(token => allowed.has(token))
        : [];
    const seen = new Set(preserved);

    normalizedTokens.forEach(token => {
        if (!seen.has(token)) {
            preserved.push(token);
            seen.add(token);
        }
    });

    return preserved;
}

function buildTagOrders(accounts, tags, existingTagOrders = {}) {
    const normalized = {
        all: mergeOrder(existingTagOrders.all, accounts.map(acc => acc.token)),
        untagged: mergeOrder(
            existingTagOrders.untagged,
            accounts.filter(acc => !acc.tagIds || acc.tagIds.length === 0).map(acc => acc.token)
        ),
    };

    tags.forEach(tag => {
        normalized[tag.id] = mergeOrder(
            existingTagOrders[tag.id],
            accounts
                .filter(acc => (acc.tagIds || []).includes(tag.id))
                .map(acc => acc.token)
        );
    });

    return normalized;
}

function hasSameTagOrders(current = {}, next = {}) {
    const currentKeys = Object.keys(current).sort();
    const nextKeys = Object.keys(next).sort();

    if (currentKeys.length !== nextKeys.length) {
        return false;
    }

    return nextKeys.every((key, index) => {
        const currentValue = current[currentKeys[index]];
        const nextValue = next[key];
        return currentKeys[index] === key &&
            Array.isArray(currentValue) &&
            Array.isArray(nextValue) &&
            currentValue.length === nextValue.length &&
            currentValue.every((token, valueIndex) => token === nextValue[valueIndex]);
    });
}

function getValidFilterTagId(filterTagId, tags, accounts) {
    if (!filterTagId || filterTagId === 'all') {
        return 'all';
    }

    if (filterTagId === 'untagged') {
        return accounts.some(acc => !acc.tagIds || acc.tagIds.length === 0) ? 'untagged' : 'all';
    }

    return tags.some(tag => tag.id === filterTagId) ? filterTagId : 'all';
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function formatLocalDateForFilename(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatPlanName(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return null;
    }

    const planNames = {
        free: 'Free',
        plus: 'Plus',
        pro: 'Pro',
        team: 'Team',
        business: 'Business',
        enterprise: 'Enterprise',
        edu: 'Edu',
    };

    return planNames[normalized] || normalizeText(value);
}

function normalizeProfilePayload(profile = {}) {
    const accountId = normalizeText(profile.accountId || profile.workspaceId);
    const planType = normalizeText(profile.planType || profile.plan).toLowerCase();

    return {
        displayName: normalizeText(profile.displayName || profile.name) || null,
        loginEmail: normalizeText(profile.loginEmail || profile.email) || null,
        workspaceName: normalizeText(profile.workspaceName) || null,
        userId: normalizeText(profile.userId) || null,
        accountId: accountId || null,
        organizationId: normalizeText(profile.organizationId) || null,
        accountStructure: normalizeText(profile.accountStructure || profile.structure) || null,
        planType: planType || null,
        plan: formatPlanName(profile.plan || profile.planType),
        token: normalizeText(profile.token || profile.sessionToken) || null,
    };
}

function buildAccountLabel(profile = {}) {
    const normalized = normalizeProfilePayload(profile);

    if (
        normalized.displayName &&
        normalized.workspaceName &&
        normalized.workspaceName.toLowerCase() !== normalized.displayName.toLowerCase() &&
        !normalized.workspaceName.toLowerCase().includes('account')
    ) {
        return `${normalized.displayName} · ${normalized.workspaceName}`;
    }

    return normalized.displayName ||
        normalized.loginEmail ||
        normalized.workspaceName ||
        normalized.userId ||
        'Current account';
}

function compactAccountRecord(record = {}) {
    const compacted = {};

    Object.entries(record).forEach(([key, value]) => {
        if (value == null) {
            return;
        }

        if (Array.isArray(value)) {
            compacted[key] = value;
            return;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed && key !== 'email') {
                return;
            }
            compacted[key] = trimmed;
            return;
        }

        compacted[key] = value;
    });

    if (!Array.isArray(compacted.tagIds)) {
        compacted.tagIds = [];
    }

    return compacted;
}

function createAccountFromProfile(profile = {}, overrides = {}) {
    const normalizedProfile = normalizeProfilePayload(profile);
    const token = normalizeText(overrides.token || normalizedProfile.token);
    const email = normalizeText(overrides.email) || buildAccountLabel(normalizedProfile);

    return compactAccountRecord({
        email,
        token,
        tagIds: Array.isArray(overrides.tagIds) ? overrides.tagIds : [],
        displayName: normalizedProfile.displayName,
        loginEmail: normalizedProfile.loginEmail,
        workspaceName: normalizedProfile.workspaceName,
        userId: normalizedProfile.userId,
        accountId: normalizedProfile.accountId,
        organizationId: normalizedProfile.organizationId,
        accountStructure: normalizedProfile.accountStructure,
        planType: normalizedProfile.planType,
        plan: formatPlanName(overrides.plan || normalizedProfile.plan || normalizedProfile.planType),
    });
}

function normalizeImportedAccount(raw = {}) {
    const email = normalizeText(
        raw.email ||
        raw.name ||
        raw.displayName ||
        raw.loginEmail ||
        raw.workspaceName ||
        raw.userId
    );
    const token = normalizeText(raw.token || raw.key || raw.sessionToken);
    const tagIds = Array.isArray(raw.tagIds)
        ? raw.tagIds.filter(id => typeof id === 'string' && id.trim())
        : [];

    return createAccountFromProfile(raw, {
        email,
        token,
        tagIds,
        plan: raw.plan || raw.planType,
    });
}

function areAccountsEqual(a, b) {
    return JSON.stringify(compactAccountRecord(a)) === JSON.stringify(compactAccountRecord(b));
}

function getCookiePriority(cookie) {
    const normalizedDomain = normalizeText(cookie.domain).replace(/^\./, '');
    let score = 0;

    if (normalizedDomain === 'chatgpt.com') {
        score += 4;
    }
    if (!normalizeText(cookie.domain).startsWith('.')) {
        score += 2;
    }
    if (cookie.secure) {
        score += 1;
    }
    if (cookie.path === '/') {
        score += 1;
    }

    return score;
}

async function getSessionCookies() {
    try {
        const cookies = await chrome.cookies.getAll({ name: COOKIE_NAME });
        return cookies
            .filter(cookie => /(^|\.)chatgpt\.com$/i.test(cookie.domain || ''))
            .sort((a, b) => getCookiePriority(b) - getCookiePriority(a));
    } catch {
        try {
            const cookie = await chrome.cookies.get({ url: CHATGPT_URL, name: COOKIE_NAME });
            return cookie ? [cookie] : [];
        } catch {
            return [];
        }
    }
}

async function getSessionTokenFromCookie() {
    const cookies = await getSessionCookies();
    return cookies[0]?.value || '';
}

async function clearSessionCookies() {
    const cookies = await getSessionCookies();

    if (cookies.length === 0) {
        try {
            await chrome.cookies.remove({ url: CHATGPT_URL, name: COOKIE_NAME });
        } catch {
            // Ignore cleanup failures when no cookie can be resolved.
        }
        return;
    }

    await Promise.all(cookies.map(cookie => chrome.cookies.remove({
        url: `${cookie.secure ? 'https' : 'http'}://${(cookie.domain || '').replace(/^\./, '')}${cookie.path || '/'}`,
        name: cookie.name,
        storeId: cookie.storeId,
    })));
}

function initEventListeners(store) {
    $('toggleAddBtn').onclick = () => toggleModal(true);
    $('cancelEditBtn').onclick = () => toggleModal(false);
    $('modalOverlay').onclick = () => {
        toggleModal(false);
        toggleTagManager(false, store);
        closeTagEditModal();
    };
    $('saveBtn').onclick = () => saveAccount(store);
    $('grabBtn').onclick = () => grabToken();
    $('loginLinkBtn').onclick = logoutAndLogin;

    $('themeBtn').onclick = () => {
        const newIsDark = !document.body.classList.contains('dark-mode');
        applyTheme(newIsDark);
        chrome.storage.local.set({ [THEME_KEY]: newIsDark ? 'dark' : 'light' });
    };

    $('toolsToggle').onclick = (e) => { e.stopPropagation(); $('toolsMenu').classList.toggle('show'); };
    document.onclick = () => $('toolsMenu').classList.remove('show');

    $('searchBox').oninput = debounce((e) => store.setState({ filter: e.target.value }), 300);

    $('exportBtn').onclick = () => exportData(store.getState().accounts);
    $('importBtn').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => importData(e, store);
    $('clearAllBtn').onclick = () => clearData(store);
    $('syncCurrentBtn').onclick = () => syncCurrentAccount(store);

    $('accountList').addEventListener('click', (e) => handleListClick(e, store));

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if ($('editForm').classList.contains('open')) {
            saveAccount(store);
        } else if ($('tagManagerModal').classList.contains('open') && e.target.id === 'newTagName') {
            addNewTag(store);
        } else if ($('tagEditModal').classList.contains('open')) {
            saveEditTag(store);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if ($('deleteModal').classList.contains('open')) {
            $('deleteModal').classList.remove('open');
        } else if ($('tagEditModal').classList.contains('open')) {
            $('tagEditModal').classList.remove('open');
            $('tagEditOverlay').classList.remove('open');
        } else if ($('tagManagerModal').classList.contains('open')) {
            $('tagManagerModal').classList.remove('open');
            $('modalOverlay').classList.remove('open');
        } else if ($('editForm').classList.contains('open')) {
            toggleModal(false);
        }
    });
}

// --- Actions ---

async function saveAccount(store) {
    const email = $('inputEmail').value.trim();
    const tagIds = getSelectedTagIds();

    const { accounts, tagOrders, tags, filterTagId } = store.getState();
    const editIndex = getEditIndex();

    if (editIndex >= 0 && editIndex < accounts.length) {
        if (!email) return showToast("请输入名称");

        const newAccounts = accounts.map((acc, i) =>
            i === editIndex ? { ...acc, email, tagIds } : acc
        );
        const newTagOrders = buildTagOrders(newAccounts, tags, tagOrders);
        const nextFilterTagId = getValidFilterTagId(filterTagId, tags, newAccounts);
        const payload = {
            [STORAGE_KEY]: newAccounts,
            [TAG_ORDERS_KEY]: newTagOrders,
        };

        if (nextFilterTagId !== filterTagId) {
            payload[FILTER_TAG_KEY] = nextFilterTagId;
        }

        await chrome.storage.local.set(payload);
        store.setState({
            accounts: newAccounts,
            tagOrders: newTagOrders,
            filterTagId: nextFilterTagId,
            accountMap: createAccountMap(newAccounts),
        });

        renderTagFilterBar(store);
        showToast("已更新");
        toggleModal(false);
        return;
    }

    let token = $('inputToken').value.trim();
    if (!email || !token) return showToast("请填写完整");

    const exists = accounts.some(a => a.token === token);
    if (exists) {
        showToast("Token 已存在");
        toggleModal(false);
        return;
    }

    const grabbedProfile = getGrabProfile() || {};
    const plan = formatPlanName(getGrabPlan() || grabbedProfile.plan || grabbedProfile.planType);
    setGrabPlan(null);
    setGrabProfile(null);

    const newAccount = createAccountFromProfile({ ...grabbedProfile, plan }, { email, token, tagIds, plan });
    const newAccounts = [...accounts, newAccount];
    const newTagOrders = buildTagOrders(newAccounts, tags, tagOrders);
    const nextFilterTagId = getValidFilterTagId(filterTagId, tags, newAccounts);

    await chrome.storage.local.set({
        [STORAGE_KEY]: newAccounts,
        [TAG_ORDERS_KEY]: newTagOrders,
        [FILTER_TAG_KEY]: nextFilterTagId,
    });
    store.setState({
        accounts: newAccounts,
        tagOrders: newTagOrders,
        filterTagId: nextFilterTagId,
        accountMap: createAccountMap(newAccounts),
    });
    renderTagFilterBar(store);
    showToast("已保存");
    toggleModal(false);
}

async function grabToken() {
    try {
        const profile = await grabUserInfo();
        const token = await getSessionTokenFromCookie() || normalizeText(profile?.token);
        if (!token) return showToast("未登录 ChatGPT");

        $('inputToken').value = token;
        const normalizedProfile = normalizeProfilePayload({ ...profile, token });
        const accountLabel = buildAccountLabel(normalizedProfile);
        const plan = formatPlanName(normalizedProfile.plan || normalizedProfile.planType) || 'Free';

        setGrabProfile(normalizedProfile);
        setGrabPlan(plan);

        if (accountLabel) {
            $('inputEmail').value = accountLabel;
            showToast(`已获取: ${accountLabel} (${plan})`);
        } else {
            setGrabProfile({ token });
            setGrabPlan(null);
            $('inputEmail').focus();
            showToast("已获取 Token");
        }
    } catch {
        showToast("获取失败");
    }
}

async function grabUserInfo() {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    if (tabs.length === 0) return null;

    try {
        const res = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
                const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
                const toLines = (value) => (value || '')
                    .split(/\n+/)
                    .map(normalize)
                    .filter(Boolean);
                const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
                const formatPlan = (value) => {
                    const normalized = normalize(value).toLowerCase();
                    const planMap = {
                        free: 'Free',
                        plus: 'Plus',
                        pro: 'Pro',
                        team: 'Team',
                        business: 'Business',
                        enterprise: 'Enterprise',
                        edu: 'Edu',
                    };

                    return planMap[normalized] || normalize(value) || null;
                };
                const ignoredNames = new Set([
                    'New chat',
                    'Search chats',
                    'Images',
                    'Apps',
                    'Projects',
                    'ChatGPT',
                    'Codex',
                    'Deep research',
                    'Health',
                ]);

                const result = {
                    token: null,
                    name: null,
                    plan: null,
                    planType: null,
                    displayName: null,
                    loginEmail: null,
                    workspaceName: null,
                    userId: null,
                    accountId: null,
                    organizationId: null,
                    accountStructure: null,
                };

                const bootstrapEl = document.getElementById('client-bootstrap');
                if (bootstrapEl?.textContent) {
                    try {
                        const bootstrap = JSON.parse(bootstrapEl.textContent);
                        const session = bootstrap.session || {};
                        const account = session.account || {};
                        const user = session.user || bootstrap.user || {};

                        result.token = normalize(session.sessionToken);
                        result.loginEmail = normalize(user.email);
                        result.userId = normalize(user.id);
                        result.accountId = normalize(account.id);
                        result.organizationId = normalize(account.organizationId);
                        result.accountStructure = normalize(account.structure);
                        result.planType = normalize(account.planType).toLowerCase() || null;
                        result.plan = formatPlan(account.planType);
                    } catch (error) {
                        console.debug('Failed to parse client-bootstrap', error);
                    }
                }

                const profileButtons = [
                    ...document.querySelectorAll("button[aria-label*='open profile menu' i]"),
                ];

                for (const button of profileButtons) {
                    const aria = normalize(button.getAttribute('aria-label'));
                    const text = normalize(button.textContent);
                    const lines = [
                        ...toLines(button.innerText),
                        ...toLines(button.textContent),
                    ];
                    const combined = normalize(`${aria} ${text} ${lines.join(' ')}`);
                    const emailMatch = combined.match(emailRegex);

                    if (!result.loginEmail && emailMatch) {
                        result.loginEmail = emailMatch[0];
                    }

                    if (!result.displayName) {
                        const buttonDisplayName = lines.find(line =>
                            line &&
                            !/@/.test(line) &&
                            !/open profile menu/i.test(line) &&
                            !/account$/i.test(line)
                        );
                        const ariaDisplayName = aria.replace(/,?\s*open profile menu/i, '').trim();
                        result.displayName = buttonDisplayName || (!/@/.test(ariaDisplayName) ? ariaDisplayName : null);
                    }

                    if (!result.workspaceName) {
                        result.workspaceName = lines.find(line =>
                            line &&
                            !/@/.test(line) &&
                            line !== result.displayName &&
                            !/open profile menu/i.test(line)
                        ) || null;
                    }
                }

                if (!result.workspaceName || !result.displayName) {
                    const workspaceOptions = Array.from(document.querySelectorAll('[role="menuitemradio"]'))
                        .map(el => normalize(el.textContent))
                        .filter(Boolean)
                        .map(text => text.replace(/^[A-Z]\s*/, '').trim());

                    if (!result.workspaceName) {
                        result.workspaceName = workspaceOptions.find(text =>
                            text &&
                            text !== result.displayName &&
                            !/account$/i.test(text)
                        ) || null;
                    }

                    if (!result.displayName) {
                        const personalOption = workspaceOptions.find(text => /account$/i.test(text));
                        if (personalOption) {
                            result.displayName = personalOption.replace(/'s account$/i, '').trim();
                        }
                    }
                }

                const bodyText = normalize(document.body.innerText || document.body.textContent || '');
                if (!result.plan && /\bteam\b/i.test(bodyText) && (
                    bodyText.includes('Invite team members') ||
                    bodyText.includes('workspace data')
                )) {
                    result.plan = 'Team';
                    result.planType = result.planType || 'team';
                }

                if (!result.displayName) {
                    const headingButton = document.querySelector('h1 button');
                    const headingText = normalize(document.querySelector('h1')?.textContent);
                    if (headingButton) {
                        result.displayName = normalize(headingButton.textContent) || null;
                    } else if (/How can I help,\s*(.+?)\?/i.test(headingText)) {
                        result.displayName = headingText.match(/How can I help,\s*(.+?)\?/i)?.[1] || null;
                    }
                }

                if (!result.workspaceName && bodyText.includes('workspace data')) {
                    const workspaceMatch = bodyText.match(/doesn't use\s+(.+?)\s+workspace data/i);
                    if (workspaceMatch) {
                        result.workspaceName = normalize(workspaceMatch[1]);
                    }
                }

                if (!result.displayName || !result.plan || !result.loginEmail) {
                    const allTruncate = document.querySelectorAll('.truncate');
                    const planKeywords = ['free', 'plus', 'pro', 'team'];

                    for (let i = allTruncate.length - 1; i >= 0; i--) {
                        const text = normalize(allTruncate[i].textContent);
                        const textLower = text.toLowerCase();

                        if (!result.plan && planKeywords.includes(textLower)) {
                            result.plan = formatPlan(text);
                            result.planType = result.planType || textLower;
                            continue;
                        }

                        if (!result.displayName && text.length > 0 && text.length < 80 && !ignoredNames.has(text) && !/@/.test(text)) {
                            result.displayName = text;
                        }

                        if (!result.loginEmail) {
                            const emailMatch = text.match(emailRegex);
                            if (emailMatch) {
                                result.loginEmail = emailMatch[0];
                            }
                        }

                        if (result.displayName && result.plan && result.loginEmail) {
                            break;
                        }
                    }
                }

                result.name = result.displayName || result.loginEmail || result.workspaceName || result.userId || null;
                result.plan = result.plan || formatPlan(result.planType);

                return result;
            }
        });
        return res?.[0]?.result || null;
    } catch (e) {
        console.log("DOM grab failed", e);
        return null;
    }
}

async function switchAccount(email, token) {
    if (!token) return;

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 80);

    await clearSessionCookies();

    await chrome.cookies.set({
        url: CHATGPT_URL,
        name: COOKIE_NAME,
        value: token,
        secure: true,
        expirationDate: expirationDate.getTime() / 1000
    });

    getStore().setState({ activeToken: token });
    showToast(`已切换到: ${email}`);

    const [tab] = await chrome.tabs.query({ url: "*://chatgpt.com/*" });
    if (tab) {
        await chrome.tabs.reload(tab.id);
        await chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
    } else {
        chrome.tabs.create({ url: CHATGPT_URL, active: true });
    }
}

async function logoutAndLogin() {
    await clearSessionCookies();
    const [tab] = await chrome.tabs.query({ url: "*://chatgpt.com/*" });
    if (tab) {
        await chrome.tabs.update(tab.id, { url: "https://chatgpt.com/auth/login", active: true });
        chrome.windows.update(tab.windowId, { focused: true });
    } else {
        chrome.tabs.create({ url: "https://chatgpt.com/auth/login" });
    }
    getStore().setState({ activeToken: "" });
    showToast("已登出，请重新登录");
}

function handleListClick(e, store) {
    const li = e.target.closest('li');
    if (!li) return;
    const token = li.dataset.token;
    const { accounts, tagOrders } = store.getState();
    const acc = accounts.find(a => a.token === token);
    const idx = accounts.findIndex(a => a.token === token);

    if (!acc) return;

    const target = e.target.closest('.icon-btn');
    if (!target) return;

    if (target.classList.contains('action-copy')) {
        navigator.clipboard.writeText(acc.token);
        showToast("已复制");
    } else if (target.classList.contains('action-edit')) {
        $('inputEmail').value = acc.email || '';
        toggleModal(true, idx, acc.tagIds || []);
    } else if (target.classList.contains('action-delete')) {
        showDeleteModal(acc.email, () => {
            const tokenToRemove = acc.token;
            const newAccounts = accounts.filter(a => a.token !== tokenToRemove);
            const { tags, filterTagId } = store.getState();
            const newTagOrders = buildTagOrders(newAccounts, tags, tagOrders);
            const nextFilterTagId = getValidFilterTagId(filterTagId, tags, newAccounts);
            const payload = {
                [STORAGE_KEY]: newAccounts,
                [TAG_ORDERS_KEY]: newTagOrders,
                [FILTER_TAG_KEY]: nextFilterTagId,
            };

            chrome.storage.local.set(payload).then(() => {
                store.setState({
                    accounts: newAccounts,
                    tagOrders: newTagOrders,
                    filterTagId: nextFilterTagId,
                    accountMap: createAccountMap(newAccounts),
                });

                renderTagFilterBar(store);
                showToast("已删除");
            });
        });
    }
}

function showDeleteModal(accountName, onConfirm) {
    const modal = $('deleteModal');
    $('deleteMessage').textContent = `确定要删除「${accountName}」吗？此操作不可撤销。`;
    modal.classList.add('open');

    setDeleteConfirmCallback(onConfirm);

    $('cancelDeleteBtn').onclick = () => modal.classList.remove('open');
    $('confirmDeleteBtn').onclick = () => {
        modal.classList.remove('open');
        const cb = getDeleteConfirmCallback();
        if (cb) {
            cb();
            setDeleteConfirmCallback(null);
        }
    };

    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.remove('open');
    };
}

async function syncCurrentAccount(store) {
    showToast("正在更新...");

    const result = await ensureCurrentAccountSynced(store, { force: true });
    if (!result.ok) {
        showToast(result.message);
        return;
    }

    if (result.changed) {
        showToast(`已更新: ${result.account.email} (${result.account.plan || 'Free'})`);
    } else {
        showToast("当前账号已是最新");
    }
}

async function ensureCurrentAccountSynced(store, options = {}) {
    const { force = false } = options;
    const activeToken = await getActiveToken();

    if (!activeToken) {
        return { ok: false, changed: false, message: "未登录 ChatGPT" };
    }

    const profile = await grabUserInfo();
    const normalizedProfile = normalizeProfilePayload(profile || {});
    const profileName = buildAccountLabel(normalizedProfile);
    const profilePlan = formatPlanName(normalizedProfile.plan || normalizedProfile.planType);

    if (!profileName && !profilePlan && !normalizedProfile.userId && !force) {
        return { ok: false, changed: false, message: "未能读取当前账号信息" };
    }

    const { accounts, tagOrders, tags, filterTagId } = store.getState();
    const idx = accounts.findIndex(a => a.token === activeToken);
    const current = idx >= 0 ? accounts[idx] : null;
    const currentEmail = normalizeText(current?.email);

    // Preserve custom account names; automatic sync should only fill a blank name.
    const nextEmail = currentEmail || profileName || "Current account";
    const nextPlan = profilePlan || current?.plan || "Free";

    let changed = false;
    let newAccounts;

    if (idx >= 0) {
        const updated = compactAccountRecord({
            ...current,
            email: nextEmail,
            plan: nextPlan,
            planType: normalizedProfile.planType || current?.planType || null,
            displayName: normalizedProfile.displayName || current?.displayName || null,
            loginEmail: normalizedProfile.loginEmail || current?.loginEmail || null,
            workspaceName: normalizedProfile.workspaceName || current?.workspaceName || null,
            userId: normalizedProfile.userId || current?.userId || null,
            accountId: normalizedProfile.accountId || current?.accountId || null,
            organizationId: normalizedProfile.organizationId || current?.organizationId || null,
            accountStructure: normalizedProfile.accountStructure || current?.accountStructure || null,
            tagIds: Array.isArray(current.tagIds) ? current.tagIds : [],
        });

        changed = !areAccountsEqual(updated, current);

        newAccounts = accounts.map((acc, i) => (i === idx ? updated : acc));
    } else {
        newAccounts = [...accounts, createAccountFromProfile(
            { ...normalizedProfile, token: activeToken, plan: nextPlan },
            { email: nextEmail, token: activeToken, tagIds: [], plan: nextPlan }
        )];
        changed = true;
    }

    const newTagOrders = buildTagOrders(newAccounts, tags, tagOrders);
    const nextFilterTagId = getValidFilterTagId(filterTagId, tags, newAccounts);

    if (changed || force || nextFilterTagId !== filterTagId) {
        await chrome.storage.local.set({
            [STORAGE_KEY]: newAccounts,
            [TAG_ORDERS_KEY]: newTagOrders,
            [FILTER_TAG_KEY]: nextFilterTagId,
        });
    }

    store.setState({
        accounts: newAccounts,
        tagOrders: newTagOrders,
        filterTagId: nextFilterTagId,
        activeToken,
        accountMap: createAccountMap(newAccounts),
    });

    return {
        ok: true,
        changed,
        account: {
            email: nextEmail,
            plan: nextPlan,
            planType: normalizedProfile.planType || null,
            userId: normalizedProfile.userId || null,
            accountId: normalizedProfile.accountId || null,
        },
    };
}

function importData(e, store) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            let json = JSON.parse(ev.target.result);
            const { accounts, tags, tagOrders, filterTagId } = store.getState();
            let newAccounts = [...accounts];
            let addedCount = 0;

            if (!Array.isArray(json)) {
                if (Array.isArray(json.accounts)) {
                    json = json.accounts;
                } else {
                    json = Object.entries(json).map(([email, token]) => (
                        typeof token === 'string' ? { email, token } : { email, ...(token || {}) }
                    ));
                }
            }

            json.forEach(a => {
                const normalized = normalizeImportedAccount(a);
                if (!validateAccount(normalized)) return;

                const exists = newAccounts.some(acc => acc.token === normalized.token);
                if (!exists) {
                    newAccounts.push(normalized);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                const newTagOrders = buildTagOrders(newAccounts, tags, tagOrders);
                const nextFilterTagId = getValidFilterTagId(filterTagId, tags, newAccounts);
                await chrome.storage.local.set({
                    [STORAGE_KEY]: newAccounts,
                    [TAG_ORDERS_KEY]: newTagOrders,
                    [FILTER_TAG_KEY]: nextFilterTagId,
                });
                store.setState({
                    accounts: newAccounts,
                    tagOrders: newTagOrders,
                    filterTagId: nextFilterTagId,
                    accountMap: createAccountMap(newAccounts),
                });
                renderTagFilterBar(store);
                showToast(`导入 ${addedCount} 个账号`);
            } else {
                showToast("没有新账号");
            }
        } catch { showToast("格式错误"); }
    };
    if (e.target.files[0]) reader.readAsText(e.target.files[0]);
    e.target.value = '';
}

function clearData(store) {
    if (confirm("清空所有数据不可恢复!")) {
        const emptyTagOrders = buildTagOrders([], [], {});
        chrome.storage.local.set({
            [STORAGE_KEY]: [],
            [TAGS_KEY]: [],
            [TAG_ORDERS_KEY]: emptyTagOrders,
            [FILTER_TAG_KEY]: 'all',
        }).then(() => {
            store.setState({
                accounts: [],
                tags: [],
                tagOrders: emptyTagOrders,
                filterTagId: 'all',
                accountMap: createAccountMap([]),
                tagMap: createTagMap([]),
            });
            renderTagFilterBar(store);
            showToast("已清空");
        });
    }
}

// --- UI & Helpers ---

function toggleModal(show, editIndex = -1, selectedTagIds = []) {
    const el = $('editForm'), overlay = $('modalOverlay');
    setEditIndex(editIndex);

    if (show) {
        if (editIndex >= 0) {
            $('modalTitle').textContent = "编辑账号";
            $('inputToken').parentElement.style.display = 'none';
        } else {
            $('modalTitle').textContent = "添加账号";
            $('inputToken').parentElement.style.display = 'flex';
        }
        renderTagSelector(getStore(), selectedTagIds);
        el.classList.add('open'); overlay.classList.add('open');
        $('inputEmail').focus();
    } else {
        el.classList.remove('open'); overlay.classList.remove('open');
        $('inputEmail').value = $('inputToken').value = '';
        setGrabPlan(null);
        setGrabProfile(null);
        setEditIndex(-1);
    }
}

async function getActiveToken() {
    try {
        return await getSessionTokenFromCookie();
    } catch {
        return "";
    }
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

function applyTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    $('themeBtn').innerHTML = isDark ? ICONS.sun : ICONS.moon;
}

function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 3000);
}

async function exportData(accounts) {
    if (!Array.isArray(accounts) || accounts.length === 0) {
        showToast("暂无可导出账号");
        return;
    }

    const payload = accounts.map(account => compactAccountRecord(account));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `gpt_accounts_${formatLocalDateForFilename()}.json`;

    try {
        if (chrome.downloads?.download) {
            await chrome.downloads.download({
                url,
                filename,
                saveAs: true,
                conflictAction: 'uniquify',
            });
            showToast("请选择导出保存位置");
            return;
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        showToast("已开始导出");
    } catch (error) {
        console.error("Export failed", error);
        showToast("导出失败");
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}

// ========== 标签管理系统 ==========

function initTagManager(store) {
    $('tagsManageBtn').onclick = () => toggleTagManager(true, store);
    $('closeTagManagerBtn').onclick = () => toggleTagManager(false, store);
    $('addTagBtn').onclick = () => addNewTag(store);

    $('colorPicker').onclick = (e) => {
        if (e.target.classList.contains('color-option')) {
            $('colorPicker').querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
            e.target.classList.add('selected');
        }
    };

    $('editColorPicker').onclick = (e) => {
        if (e.target.classList.contains('color-option')) {
            $('editColorPicker').querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
            e.target.classList.add('selected');
        }
    };

    $('cancelEditTagBtn').onclick = () => closeTagEditModal();
    $('saveEditTagBtn').onclick = () => saveEditTag(store);
    $('tagEditOverlay').onclick = () => closeTagEditModal();

    $('tagList').onclick = (e) => {
        const tagItem = e.target.closest('.tag-item');
        if (!tagItem) return;
        const tagId = tagItem.dataset.id;

        if (e.target.closest('.tag-delete')) {
            deleteTag(tagId, store);
        } else if (e.target.closest('.tag-edit')) {
            openTagEditModal(tagId, store);
        }
    };
}

function toggleTagManager(show, store) {
    const el = $('tagManagerModal'), overlay = $('modalOverlay');
    if (show) {
        renderTagList(store);
        el.classList.add('open');
        overlay.classList.add('open');
    } else {
        el.classList.remove('open');
        overlay.classList.remove('open');
        $('newTagName').value = '';
    }
}

function renderTagList(store) {
    const { tags } = store.getState();
    const container = $('tagList');

    if (!tags || tags.length === 0) {
        container.innerHTML = '<div class="empty-tags">暂无标签，添加一个吧！</div>';
        return;
    }

    container.innerHTML = tags.map(tag => `
    <div class="tag-item" data-id="${tag.id}">
      <span class="tag-color" style="background:${tag.color}"></span>
      <span class="tag-name">${sanitize(tag.name)}</span>
      <div class="tag-actions">
        <button class="tag-edit" title="编辑">✏️</button>
        <button class="tag-delete" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');
}

function addNewTag(store) {
    const name = $('newTagName').value.trim();
    if (!name) return showToast("请输入标签名称");

    const selectedColor = $('colorPicker').querySelector('.color-option.selected');
    const color = selectedColor ? selectedColor.dataset.color : '#6b7280';

    const { tags, accounts, tagOrders } = store.getState();

    if (tags.some(t => t.name === name)) {
        return showToast("标签已存在");
    }

    const newTag = {
        id: 'tag_' + Date.now(),
        name,
        color
    };

    const newTags = [...tags, newTag];
    const newTagOrders = buildTagOrders(accounts, newTags, tagOrders);
    chrome.storage.local.set({
        [TAGS_KEY]: newTags,
        [TAG_ORDERS_KEY]: newTagOrders,
    }).then(() => {
        store.setState({
            tags: newTags,
            tagOrders: newTagOrders,
            tagMap: createTagMap(newTags),
        });
        renderTagList(store);
        renderTagFilterBar(store);  // 同步更新筛选栏
        $('newTagName').value = '';
        showToast("标签已添加");
    });
}

function deleteTag(tagId, store) {
    const { tags } = store.getState();
    const tag = tags.find(t => t.id === tagId);
    const tagName = tag ? tag.name : '此标签';

    showDeleteModal(tagName, () => {
        const { tags, accounts, tagOrders, filterTagId } = store.getState();
        const newTags = tags.filter(t => t.id !== tagId);

        const newAccounts = accounts.map(acc => ({
            ...acc,
            tagIds: (acc.tagIds || []).filter(id => id !== tagId)
        }));

        const newTagOrders = buildTagOrders(newAccounts, newTags, tagOrders);
        const nextFilterTagId = getValidFilterTagId(filterTagId, newTags, newAccounts);

        chrome.storage.local.set({
            [TAGS_KEY]: newTags,
            [STORAGE_KEY]: newAccounts,
            [TAG_ORDERS_KEY]: newTagOrders,
            [FILTER_TAG_KEY]: nextFilterTagId,
        }).then(() => {
            store.setState({
                tags: newTags,
                accounts: newAccounts,
                tagOrders: newTagOrders,
                filterTagId: nextFilterTagId,
                accountMap: createAccountMap(newAccounts),
                tagMap: createTagMap(newTags),
            });
            renderTagList(store);
            renderTagFilterBar(store);
            showToast("标签已删除");
        });
    });
}

function openTagEditModal(tagId, store) {
    const { tags } = store.getState();
    const tag = tags.find(t => t.id === tagId);
    if (!tag) return;

    setEditingTagId(tagId);

    $('editTagName').value = tag.name;

    $('editColorPicker').querySelectorAll('.color-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.color === tag.color);
    });

    $('tagEditOverlay').classList.add('open');
    $('tagEditModal').classList.add('open');
    $('editTagName').focus();
}

function closeTagEditModal() {
    $('tagEditModal').classList.remove('open');
    $('tagEditOverlay').classList.remove('open');
    setEditingTagId(null);
}

function saveEditTag(store) {
    const tagId = getEditingTagId();
    if (!tagId) return;

    const newName = $('editTagName').value.trim();
    if (!newName) return showToast("请输入标签名称");

    const selectedColor = $('editColorPicker').querySelector('.color-option.selected');
    const newColor = selectedColor ? selectedColor.dataset.color : '#6b7280';

    const { tags } = store.getState();
    if (tags.some(t => t.id !== tagId && t.name === newName)) {
        return showToast("标签已存在");
    }
    const newTags = tags.map(t => t.id === tagId ? { ...t, name: newName, color: newColor } : t);

    chrome.storage.local.set({ [TAGS_KEY]: newTags }).then(() => {
        store.setState({ tags: newTags, tagMap: createTagMap(newTags) });
        renderTagList(store);
        renderTagFilterBar(store);  // 同步更新筛选栏
        closeTagEditModal();
        showToast("标签已更新");
    });
}

function renderTagSelector(store, selectedTagIds = []) {
    const { tags } = store.getState();
    const container = $('tagSelector');

    if (!tags || tags.length === 0) {
        container.innerHTML = '<span class="empty-tags">暂无标签</span>';
        return;
    }

    container.innerHTML = tags.map(tag => {
        const isSelected = selectedTagIds.includes(tag.id);
        return `
      <span class="tag-option ${isSelected ? 'selected' : ''}" data-id="${tag.id}">
        <span class="tag-dot" style="background:${tag.color}"></span>
        ${sanitize(tag.name)}
      </span>
    `;
    }).join('');

    container.onclick = (e) => {
        const option = e.target.closest('.tag-option');
        if (option) {
            option.classList.toggle('selected');
        }
    };
}

function getSelectedTagIds() {
    const selected = $('tagSelector').querySelectorAll('.tag-option.selected');
    return Array.from(selected).map(el => el.dataset.id);
}

function renderTagFilterBar(store) {
    const { tags, filterTagId, accounts } = store.getState();
    const container = $('tagFilterBar');
    const activeFilterTagId = getValidFilterTagId(filterTagId, tags, accounts);

    const hasUntagged = accounts.some(a => !a.tagIds || a.tagIds.length === 0);

    if ((!tags || tags.length === 0) && !hasUntagged) {
        container.innerHTML = '';
        return;
    }

    let html = `<span class="tag-filter-item ${activeFilterTagId === 'all' ? 'active' : ''}" data-id="all">全部</span>`;

    if (tags && tags.length > 0) {
        html += tags.map(tag => `
      <span class="tag-filter-item ${activeFilterTagId === tag.id ? 'active' : ''}" data-id="${tag.id}">
        <span class="tag-dot" style="background:${tag.color}"></span>
        ${sanitize(tag.name)}
      </span>
    `).join('');
    }

    if (hasUntagged) {
        html += `<span class="tag-filter-item ${activeFilterTagId === 'untagged' ? 'active' : ''}" data-id="untagged">无标签</span>`;
    }

    container.innerHTML = html;

    container.onclick = (e) => {
        const item = e.target.closest('.tag-filter-item');
        if (!item) return;

        const tagId = item.dataset.id || 'all';

        store.setState({ filterTagId: tagId });
        chrome.storage.local.set({ [FILTER_TAG_KEY]: tagId });

        container.querySelectorAll('.tag-filter-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === tagId);
        });
    };
}
