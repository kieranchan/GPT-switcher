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

const AUTHJS_COOKIE_CHUNK_SIZE = 3936;
const PENDING_SWITCH_KEY = 'pendingSwitchContext';
const PENDING_SWITCH_TTL_MS = 2 * 60 * 1000;

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

function getValidAccountDisplayMode(value) {
    return value === 'loginEmail' ? 'loginEmail' : 'label';
}

function getAccountDisplayModeMeta(displayMode) {
    if (displayMode === 'loginEmail') {
        return {
            label: '邮箱',
            title: '当前显示: 邮箱',
        };
    }

    return {
        label: '标签',
        title: '当前显示: 备注/标签名',
    };
}

function parseImportedAccountDisplayMode(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return null;
    }

    if (payload.preferences && typeof payload.preferences === 'object' && 'accountDisplayMode' in payload.preferences) {
        return getValidAccountDisplayMode(payload.preferences.accountDisplayMode);
    }

    if ('accountDisplayMode' in payload) {
        return getValidAccountDisplayMode(payload.accountDisplayMode);
    }

    return null;
}

function formatLocalDateForFilename(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const PLAN_NAME_MAP = {
    free: 'Free',
    plus: 'Plus',
    pro: 'Pro',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise',
    edu: 'Edu',
};

const PERSONAL_WORKSPACE_LABELS = new Set([
    'personal',
    'personal account',
]);

function getPlanKey(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return null;
    }

    return Object.keys(PLAN_NAME_MAP).find(planKey =>
        normalized === planKey ||
        normalized === `${planKey} plan` ||
        normalized.startsWith(`${planKey} `) ||
        normalized.endsWith(` ${planKey}`) ||
        normalized.includes(` ${planKey} plan`)
    ) || null;
}

function isPlanLike(value) {
    return Boolean(getPlanKey(value));
}

function isPersonalWorkspaceLabel(value) {
    return PERSONAL_WORKSPACE_LABELS.has(normalizeText(value).toLowerCase());
}

function formatPlanName(value) {
    const planKey = getPlanKey(value);
    if (planKey) {
        return PLAN_NAME_MAP[planKey];
    }

    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }

    return normalized;
}

function normalizeProfilePayload(profile = {}) {
    const accountId = normalizeText(profile.accountId || profile.workspaceId);
    const rawPlanType = normalizeText(profile.planType || profile.plan);
    const planType = getPlanKey(rawPlanType) || rawPlanType.toLowerCase();

    return {
        displayName: normalizeText(
            profile.displayName ||
            profile.name ||
            profile.userName ||
            profile.userDisplayName ||
            profile.fullName
        ) || null,
        loginEmail: normalizeText(profile.loginEmail || profile.email || profile.userEmail) || null,
        workspaceName: normalizeText(
            profile.workspaceName ||
            profile.accountName ||
            profile.organizationName
        ) || null,
        userId: normalizeText(profile.userId || profile.id) || null,
        accountId: accountId || null,
        organizationId: normalizeText(profile.organizationId || profile.orgId) || null,
        accountStructure: normalizeText(profile.accountStructure || profile.structure) || null,
        planType: planType || null,
        plan: formatPlanName(profile.plan || profile.planType),
        token: normalizeText(profile.token || profile.sessionToken) || null,
    };
}

function buildWorkspaceScopedAccountLabel(profile = {}) {
    const normalized = normalizeProfilePayload(profile);
    const workspaceName = (
        normalized.workspaceName &&
        !isPlanLike(normalized.workspaceName) &&
        !isPersonalWorkspaceLabel(normalized.workspaceName)
    ) ? normalized.workspaceName : null;

    if (
        normalized.displayName &&
        workspaceName &&
        workspaceName.toLowerCase() !== normalized.displayName.toLowerCase() &&
        !workspaceName.toLowerCase().includes('account')
    ) {
        return `${normalized.displayName} · ${workspaceName}`;
    }

    return normalized.displayName ||
        normalized.loginEmail ||
        workspaceName ||
        normalized.userId ||
        null;
}

function buildAccountLabel(profile = {}) {
    const normalized = normalizeProfilePayload(profile);

    return normalized.displayName ||
        normalized.loginEmail ||
        normalized.userId ||
        (
            normalized.workspaceName &&
            !isPlanLike(normalized.workspaceName) &&
            !isPersonalWorkspaceLabel(normalized.workspaceName)
                ? normalized.workspaceName
                : null
        ) ||
        null;
}

function isGeneratedAccountLabel(account = {}) {
    const currentLabel = normalizeText(account?.email);
    if (!currentLabel) {
        return false;
    }

    const generatedLabels = [
        buildAccountLabel(account),
        buildWorkspaceScopedAccountLabel(account),
        normalizeText(account?.displayName),
        normalizeText(account?.loginEmail),
    ]
        .map(normalizeText)
        .filter(Boolean);

    return generatedLabels.includes(currentLabel);
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

function serializeAccountForExport(account = {}) {
    const normalized = compactAccountRecord(account);
    const loginEmail = normalizeText(normalized.loginEmail || normalized.email);

    return compactAccountRecord({
        label: normalizeText(normalized.email),
        email: loginEmail || null,
        loginEmail: loginEmail || null,
        displayName: normalizeText(normalized.displayName) || null,
        workspaceName: normalizeText(normalized.workspaceName) || null,
        userId: normalizeText(normalized.userId) || null,
        accountId: normalizeText(normalized.accountId) || null,
        organizationId: normalizeText(normalized.organizationId) || null,
        accountStructure: normalizeText(normalized.accountStructure) || null,
        planType: normalizeText(normalized.planType) || null,
        plan: formatPlanName(normalized.plan || normalized.planType),
        token: normalizeText(normalized.token) || null,
        lastSeenAt: normalizeText(normalized.lastSeenAt) || null,
        tokenUpdatedAt: normalizeText(normalized.tokenUpdatedAt) || null,
        lastSyncSource: normalizeText(normalized.lastSyncSource) || null,
        lastSyncReason: normalizeText(normalized.lastSyncReason) || null,
        lastMatchMode: normalizeText(normalized.lastMatchMode) || null,
        rotationCount: normalizeRotationCount(normalized.rotationCount),
        tagIds: Array.isArray(normalized.tagIds) ? normalized.tagIds : [],
    });
}

function createAccountFromProfile(profile = {}, overrides = {}) {
    const normalizedProfile = normalizeProfilePayload(profile);
    const token = normalizeText(overrides.token || normalizedProfile.token);
    const email = normalizeText(overrides.email) || buildAccountLabel(normalizedProfile);
    const tagIds = Array.isArray(overrides.tagIds)
        ? overrides.tagIds
        : (Array.isArray(profile.tagIds) ? profile.tagIds : []);

    return compactAccountRecord({
        email,
        token,
        tagIds,
        displayName: normalizedProfile.displayName,
        loginEmail: normalizedProfile.loginEmail,
        workspaceName: normalizedProfile.workspaceName,
        userId: normalizedProfile.userId,
        accountId: normalizedProfile.accountId,
        organizationId: normalizedProfile.organizationId,
        accountStructure: normalizedProfile.accountStructure,
        planType: normalizedProfile.planType,
        plan: formatPlanName(overrides.plan || normalizedProfile.plan || normalizedProfile.planType),
        lastSeenAt: normalizeText(overrides.lastSeenAt || profile.lastSeenAt) || null,
        tokenUpdatedAt: normalizeText(overrides.tokenUpdatedAt || profile.tokenUpdatedAt) || null,
        lastSyncSource: normalizeText(overrides.lastSyncSource || profile.lastSyncSource) || null,
        lastSyncReason: normalizeText(overrides.lastSyncReason || profile.lastSyncReason) || null,
        lastMatchMode: normalizeText(overrides.lastMatchMode || profile.lastMatchMode) || null,
        rotationCount: normalizeRotationCount(overrides.rotationCount ?? profile.rotationCount),
    });
}

function normalizeImportedAccount(raw = {}) {
    const email = normalizeText(
        raw.label ||
        raw.accountLabel ||
        raw.displayLabel ||
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

const ACCOUNT_SYNC_METADATA_KEYS = [
    'lastSeenAt',
    'tokenUpdatedAt',
    'lastSyncSource',
    'lastSyncReason',
    'lastMatchMode',
    'rotationCount',
];

function stripAccountSyncMetadata(record = {}) {
    const nextRecord = { ...(record || {}) };
    ACCOUNT_SYNC_METADATA_KEYS.forEach((key) => {
        delete nextRecord[key];
    });
    return compactAccountRecord(nextRecord);
}

function areAccountsSemanticallyEqual(a, b) {
    return JSON.stringify(stripAccountSyncMetadata(a)) === JSON.stringify(stripAccountSyncMetadata(b));
}

function normalizeRotationCount(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeIdentityValue(value) {
    return normalizeText(value).toLowerCase();
}

function normalizeTimestamp(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}

function buildPendingSwitchContext(account = {}) {
    return compactAccountRecord({
        token: normalizeText(account.token) || null,
        email: normalizeText(account.email) || null,
        displayName: normalizeText(account.displayName || account.name) || null,
        loginEmail: normalizeText(account.loginEmail) || null,
        workspaceName: normalizeText(account.workspaceName) || null,
        userId: normalizeText(account.userId) || null,
        accountId: normalizeText(account.accountId) || null,
        organizationId: normalizeText(account.organizationId) || null,
        accountStructure: normalizeText(account.accountStructure) || null,
        createdAt: new Date().toISOString(),
    });
}

function isPendingSwitchFresh(context = {}) {
    const createdAt = normalizeTimestamp(context?.createdAt);
    if (!createdAt) {
        return false;
    }

    const createdAtTime = Date.parse(createdAt);
    return Number.isFinite(createdAtTime) && (Date.now() - createdAtTime) <= PENDING_SWITCH_TTL_MS;
}

async function getPendingSwitchContext() {
    try {
        const data = await chrome.storage.local.get([PENDING_SWITCH_KEY]);
        const context = data?.[PENDING_SWITCH_KEY];
        return context && isPendingSwitchFresh(context) ? context : null;
    } catch {
        return null;
    }
}

async function setPendingSwitchContext(account = {}) {
    try {
        await chrome.storage.local.set({
            [PENDING_SWITCH_KEY]: buildPendingSwitchContext(account),
        });
    } catch (error) {
        console.debug('Failed to store pending switch context', error);
    }
}

async function clearPendingSwitchContext() {
    try {
        await chrome.storage.local.set({ [PENDING_SWITCH_KEY]: null });
    } catch (error) {
        console.debug('Failed to clear pending switch context', error);
    }
}

function findUniqueAccountMatch(accounts = [], predicate, matchMode) {
    const matchIndex = accounts.findIndex(predicate);
    return matchIndex >= 0
        ? { index: matchIndex, matchMode }
        : { index: -1, matchMode: null };
}

function findAccountMatchByIdentity(accounts = [], profile = {}) {
    const userId = normalizeIdentityValue(profile.userId);
    if (userId) {
        return findUniqueAccountMatch(
            accounts,
            account => normalizeIdentityValue(account.userId) === userId,
            'userId'
        );
    }

    const loginEmail = normalizeIdentityValue(profile.loginEmail);
    if (loginEmail) {
        return findUniqueAccountMatch(
            accounts,
            account => normalizeIdentityValue(account.loginEmail) === loginEmail,
            'loginEmail'
        );
    }

    const accountId = normalizeIdentityValue(profile.accountId);
    if (accountId) {
        return findUniqueAccountMatch(
            accounts,
            account => normalizeIdentityValue(account.accountId) === accountId,
            'accountId'
        );
    }

    const organizationId = normalizeIdentityValue(profile.organizationId);
    const workspaceName = normalizeIdentityValue(profile.workspaceName);
    if (organizationId && workspaceName) {
        return findUniqueAccountMatch(
            accounts,
            account => (
                normalizeIdentityValue(account.organizationId) === organizationId &&
                normalizeIdentityValue(account.workspaceName) === workspaceName
            ),
            'organizationWorkspace'
        );
    }

    return { index: -1, matchMode: null };
}

function getAccountIdentityKey(profile = {}) {
    const normalized = normalizeProfilePayload(profile);
    const userId = normalizeIdentityValue(normalized.userId);
    if (userId) {
        return `user:${userId}`;
    }

    const loginEmail = normalizeIdentityValue(normalized.loginEmail);
    if (loginEmail) {
        return `email:${loginEmail}`;
    }

    return null;
}

function mergeAccountsByIdentity(accounts = [], primaryIndex = -1) {
    if (!Array.isArray(accounts) || primaryIndex < 0 || primaryIndex >= accounts.length) {
        return { accounts, primaryIndex, removed: false };
    }

    const identityKey = getAccountIdentityKey(accounts[primaryIndex]);
    if (!identityKey) {
        return { accounts, primaryIndex, removed: false };
    }

    const duplicateIndices = accounts
        .map((account, index) => ({ account, index }))
        .filter(({ index, account }) => index !== primaryIndex && getAccountIdentityKey(account) === identityKey)
        .map(({ index }) => index);

    if (duplicateIndices.length === 0) {
        return { accounts, primaryIndex, removed: false };
    }

    const duplicateIndexSet = new Set(duplicateIndices);
    const adjustedPrimaryIndex = primaryIndex - duplicateIndices.filter(index => index < primaryIndex).length;
    const mergedTagIds = [...new Set(
        [accounts[primaryIndex], ...duplicateIndices.map(index => accounts[index])]
            .flatMap(account => Array.isArray(account?.tagIds) ? account.tagIds : [])
            .filter(tagId => typeof tagId === 'string' && tagId.trim())
    )];

    const nextAccounts = accounts
        .filter((_, index) => !duplicateIndexSet.has(index))
        .map((account, index) => (
            index === adjustedPrimaryIndex
                ? compactAccountRecord({
                    ...account,
                    tagIds: mergedTagIds,
                })
                : account
        ));

    return {
        accounts: nextAccounts,
        primaryIndex: adjustedPrimaryIndex,
        removed: true,
    };
}

function findPendingSwitchTarget(accounts = [], pendingSwitch = {}) {
    if (!pendingSwitch || !isPendingSwitchFresh(pendingSwitch)) {
        return { index: -1, matchMode: null };
    }

    const token = normalizeText(pendingSwitch.token);
    if (token) {
        const tokenIndex = accounts.findIndex(account => account.token === token);
        if (tokenIndex >= 0) {
            return { index: tokenIndex, matchMode: 'pendingSwitchToken' };
        }
    }

    return findAccountMatchByIdentity(accounts, pendingSwitch);
}

function buildAccountSyncMetadata(current = {}, options = {}) {
    const {
        timestamp,
        tokenChanged = false,
        syncSource = null,
        syncReason = null,
        matchMode = null,
    } = options;
    const nextTimestamp = normalizeText(timestamp) || new Date().toISOString();
    const previousRotationCount = normalizeRotationCount(current?.rotationCount);

    return {
        lastSeenAt: nextTimestamp,
        tokenUpdatedAt: tokenChanged || !normalizeText(current?.tokenUpdatedAt)
            ? nextTimestamp
            : normalizeText(current?.tokenUpdatedAt),
        lastSyncSource: syncSource || normalizeText(current?.lastSyncSource) || null,
        lastSyncReason: syncReason || normalizeText(current?.lastSyncReason) || null,
        lastMatchMode: matchMode || normalizeText(current?.lastMatchMode) || null,
        rotationCount: tokenChanged ? previousRotationCount + 1 : previousRotationCount,
    };
}

function replaceTokenInOrder(order = [], previousToken, nextToken) {
    if (!Array.isArray(order) || !previousToken || !nextToken || previousToken === nextToken) {
        return Array.isArray(order) ? [...order] : [];
    }

    let replaced = false;
    return order
        .map(token => {
            if (!replaced && token === previousToken) {
                replaced = true;
                return nextToken;
            }
            return token;
        })
        .filter((token, index, values) => values.indexOf(token) === index);
}

function replaceTokenInTagOrders(tagOrders = {}, previousToken, nextToken) {
    if (!previousToken || !nextToken || previousToken === nextToken) {
        return tagOrders;
    }

    return Object.fromEntries(
        Object.entries(tagOrders).map(([key, order]) => [
            key,
            replaceTokenInOrder(order, previousToken, nextToken),
        ])
    );
}

function inferTagIdsFromOrders(token, tags = [], tagOrders = {}) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
        return [];
    }

    return tags
        .map(tag => normalizeText(tag?.id))
        .filter(Boolean)
        .filter(tagId => Array.isArray(tagOrders[tagId]) && tagOrders[tagId].includes(normalizedToken));
}

function resolveAccountTagIds(account = {}, tags = [], tagOrders = {}) {
    const explicitTagIds = Array.isArray(account?.tagIds)
        ? account.tagIds.filter(tagId => typeof tagId === 'string' && tagId.trim())
        : [];

    if (explicitTagIds.length > 0) {
        return [...new Set(explicitTagIds)];
    }

    return inferTagIdsFromOrders(account?.token, tags, tagOrders);
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

function getSessionCookieChunkIndex(name = '') {
    if (name === COOKIE_NAME) {
        return -1;
    }

    const escapedName = COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = normalizeText(name).match(new RegExp(`^${escapedName}\\.(\\d+)$`));
    return match ? Number(match[1]) : null;
}

function isSessionCookieName(name = '') {
    return name === COOKIE_NAME || Number.isInteger(getSessionCookieChunkIndex(name));
}

function getSessionCookieScopeKey(cookie = {}) {
    return [
        normalizeText(cookie.storeId),
        normalizeText(cookie.domain),
        normalizeText(cookie.path || '/'),
        cookie.secure ? '1' : '0',
        cookie.httpOnly ? '1' : '0',
    ].join('|');
}

function sortSessionCookies(cookies = []) {
    return [...cookies].sort((a, b) => {
        const priorityDiff = getCookiePriority(b) - getCookiePriority(a);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        const chunkIndexA = getSessionCookieChunkIndex(a.name);
        const chunkIndexB = getSessionCookieChunkIndex(b.name);

        if (chunkIndexA === chunkIndexB) {
            return 0;
        }
        if (chunkIndexA === null) {
            return 1;
        }
        if (chunkIndexB === null) {
            return -1;
        }

        return chunkIndexA - chunkIndexB;
    });
}

function getPrimarySessionCookieGroup(cookies = []) {
    if (cookies.length === 0) {
        return [];
    }

    const groups = new Map();
    cookies.forEach((cookie) => {
        const key = getSessionCookieScopeKey(cookie);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(cookie);
    });

    const [primaryGroup = []] = Array.from(groups.values()).sort((groupA, groupB) => {
        const priorityDiff = Math.max(...groupB.map(getCookiePriority)) - Math.max(...groupA.map(getCookiePriority));
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        return groupB.length - groupA.length;
    });

    return sortSessionCookies(primaryGroup);
}

function chunkSessionToken(token = '') {
    if (!token) {
        return [];
    }

    if (token.length <= AUTHJS_COOKIE_CHUNK_SIZE) {
        return [{ name: COOKIE_NAME, value: token }];
    }

    const chunks = [];
    for (let start = 0; start < token.length; start += AUTHJS_COOKIE_CHUNK_SIZE) {
        chunks.push({
            name: `${COOKIE_NAME}.${chunks.length}`,
            value: token.slice(start, start + AUTHJS_COOKIE_CHUNK_SIZE),
        });
    }

    return chunks;
}

function normalizeCookieUrlPath(path = '/') {
    const normalizedPath = normalizeText(path) || '/';
    return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

function buildCookieRemovalUrl(cookie = {}) {
    const normalizedDomain = normalizeText(cookie.domain).replace(/^\./, '');
    const normalizedPath = normalizeCookieUrlPath(cookie.path);
    const protocol = cookie.secure === false ? 'http' : 'https';
    return `${protocol}://${normalizedDomain || 'chatgpt.com'}${normalizedPath}`;
}

function normalizeChromeSameSite(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'no_restriction' || normalized === 'lax' || normalized === 'strict') {
        return normalized;
    }

    return 'lax';
}

async function getSessionCookies() {
    try {
        const cookies = await chrome.cookies.getAll({});
        return sortSessionCookies(
            cookies.filter(cookie => (
                /(^|\.)chatgpt\.com$/i.test(cookie.domain || '') &&
                isSessionCookieName(cookie.name)
            ))
        );
    } catch {
        const fallbackNames = [
            COOKIE_NAME,
            ...Array.from({ length: 16 }, (_, index) => `${COOKIE_NAME}.${index}`),
        ];
        const cookies = [];

        for (const name of fallbackNames) {
            try {
                const cookie = await chrome.cookies.get({ url: CHATGPT_URL, name });
                if (cookie) {
                    cookies.push(cookie);
                }
            } catch {
                // Ignore partial fallback misses and continue probing.
            }
        }

        return sortSessionCookies(cookies);
    }
}

async function getSessionTokenFromCookie() {
    const cookies = getPrimarySessionCookieGroup(await getSessionCookies());

    if (cookies.length === 0) {
        return '';
    }

    const baseCookie = cookies.find(cookie => cookie.name === COOKIE_NAME);
    if (baseCookie) {
        return baseCookie.value || '';
    }

    const chunks = cookies
        .map(cookie => ({ cookie, index: getSessionCookieChunkIndex(cookie.name) }))
        .filter(({ index }) => Number.isInteger(index) && index >= 0)
        .sort((a, b) => a.index - b.index);

    if (chunks.length === 0 || chunks[0].index !== 0) {
        return '';
    }

    for (let i = 1; i < chunks.length; i += 1) {
        if (chunks[i].index !== chunks[i - 1].index + 1) {
            return '';
        }
    }

    return chunks.map(({ cookie }) => cookie.value || '').join('');
}

async function setSessionTokenCookies(token, expirationDate, cookieContext = {}) {
    const chunkedCookies = chunkSessionToken(token);
    const sessionCookies = Array.isArray(cookieContext.sessionCookies)
        ? cookieContext.sessionCookies
        : [];
    const templateCookie = sortSessionCookies(sessionCookies)[0] || {};
    const cookiePath = normalizeCookieUrlPath(templateCookie.path);
    const cookieStoreId = normalizeText(cookieContext.storeId || templateCookie.storeId) || undefined;
    const cookieSameSite = normalizeChromeSameSite(templateCookie.sameSite);

    for (const cookieChunk of chunkedCookies) {
        await chrome.cookies.set({
            url: CHATGPT_URL,
            name: cookieChunk.name,
            value: cookieChunk.value,
            domain: '.chatgpt.com',
            secure: true,
            httpOnly: templateCookie.httpOnly !== false,
            sameSite: cookieSameSite,
            path: cookiePath,
            expirationDate: expirationDate.getTime() / 1000,
            ...(cookieStoreId ? { storeId: cookieStoreId } : {}),
        });
    }
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
        url: buildCookieRemovalUrl(cookie),
        name: cookie.name,
        storeId: cookie.storeId,
    })));
}

async function getOpenChatgptTabs() {
    try {
        const tabs = await chrome.tabs.query({});
        return tabs.filter(tab => /^https:\/\/(?:[\w-]+\.)*chatgpt\.com\//i.test(normalizeText(tab?.url)));
    } catch {
        return [];
    }
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

    if ($('displayModeBtn')) $('displayModeBtn').onclick = async () => {
        const currentMode = getValidAccountDisplayMode(store.getState().accountDisplayMode);
        const nextMode = currentMode === 'label' ? 'loginEmail' : 'label';
        await chrome.storage.local.set({ [ACCOUNT_DISPLAY_MODE_KEY]: nextMode });
        store.setState({ accountDisplayMode: nextMode });
        showToast(`已切换为${getAccountDisplayModeMeta(nextMode).label}显示`);
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
            func: async () => {
                const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
                const toLines = (value) => (value || '')
                    .split(/\n+/)
                    .map(normalize)
                    .filter(Boolean);
                const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
                const planMap = {
                    free: 'Free',
                    plus: 'Plus',
                    pro: 'Pro',
                    team: 'Team',
                    business: 'Business',
                    enterprise: 'Enterprise',
                    edu: 'Edu',
                };
                const ignoredTexts = new Set([
                    'new chat',
                    'search chats',
                    'images',
                    'apps',
                    'projects',
                    'chatgpt',
                    'codex',
                    'deep research',
                    'health',
                    'settings',
                    'upgrade',
                    'my plan',
                    'upgrade plan',
                    'customize chatgpt',
                    'keyboard shortcuts',
                    'help & faq',
                    'help',
                    'invite team members',
                    'launch a workspace',
                    'log out',
                    'logout',
                    'open',
                    'personal',
                    'personal account',
                    'personal workspace',
                ]);
                const getPlanKey = (value) => {
                    const normalized = normalize(value).toLowerCase();
                    if (!normalized) {
                        return null;
                    }

                    return Object.keys(planMap).find(planKey =>
                        normalized === planKey ||
                        normalized === `${planKey} plan` ||
                        normalized.startsWith(`${planKey} `) ||
                        normalized.endsWith(` ${planKey}`) ||
                        normalized.includes(` ${planKey} plan`)
                    ) || null;
                };
                const formatPlan = (value) => {
                    const planKey = getPlanKey(value);
                    if (planKey) {
                        return planMap[planKey];
                    }

                    return normalize(value) || null;
                };

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
                const isIgnoredText = (value) => ignoredTexts.has(normalize(value).toLowerCase());
                const isPlanText = (value) => Boolean(getPlanKey(value));
                const extractPersonalAccountName = (value) => {
                    const normalized = normalize(value);
                    const match = normalized.match(/^(.+?)(?:'s|\u2019s)\s+account$/i);
                    return match ? normalize(match[1]) : null;
                };
                const isDisplayNameCandidate = (value) => {
                    const normalized = normalize(value);
                    if (!normalized || normalized.length > 80) {
                        return false;
                    }

                    if (emailRegex.test(normalized) || isPlanText(normalized) || isIgnoredText(normalized)) {
                        return false;
                    }

                    return !/account$/i.test(normalized) || Boolean(extractPersonalAccountName(normalized));
                };
                const isWorkspaceCandidate = (value, displayName) => {
                    const normalized = normalize(value);
                    if (!normalized || normalized.length > 80) {
                        return false;
                    }

                    if (emailRegex.test(normalized) || isPlanText(normalized) || isIgnoredText(normalized)) {
                        return false;
                    }

                    if (/account$/i.test(normalized)) {
                        return false;
                    }

                    if (/^\d+\s+members?$/i.test(normalized)) {
                        return false;
                    }

                    if (/^[A-Z]{1,4}$/i.test(normalized) && !/\s/.test(normalized)) {
                        return false;
                    }

                    return !displayName || normalized.toLowerCase() !== displayName.toLowerCase();
                };
                const setPlan = (value) => {
                    const planKey = getPlanKey(value);
                    if (!planKey) {
                        return false;
                    }

                    result.planType = result.planType || planKey;
                    result.plan = result.plan || planMap[planKey];
                    return true;
                };
                const applyUserPayload = (user = {}) => {
                    const loginEmail = normalize(user.email || user.loginEmail);
                    const userId = normalize(user.id || user.userId || user.sub);
                    const displayName = normalize(
                        user.name ||
                        user.displayName ||
                        user.fullName ||
                        user.username
                    );

                    if (!result.loginEmail && loginEmail) {
                        result.loginEmail = loginEmail;
                    }

                    if (!result.userId && userId) {
                        result.userId = userId;
                    }

                    if (!result.displayName && isDisplayNameCandidate(displayName)) {
                        result.displayName = displayName;
                    }
                };
                const applyAccountPayload = (account = {}) => {
                    const accountId = normalize(account.id || account.accountId || account.workspaceId);
                    const organizationId = normalize(
                        account.organizationId ||
                        account.orgId ||
                        account.organization?.id
                    );
                    const accountStructure = normalize(
                        account.structure ||
                        account.accountStructure ||
                        account.type
                    );
                    const workspaceName = normalize(
                        account.workspaceName ||
                        account.name ||
                        account.accountName ||
                        account.slug
                    );
                    const displayName = normalize(account.displayName || account.ownerName);
                    const planValue = normalize(
                        account.planType ||
                        account.plan ||
                        account.subscriptionPlan
                    );

                    if (!result.accountId && accountId) {
                        result.accountId = accountId;
                    }

                    if (!result.organizationId && organizationId) {
                        result.organizationId = organizationId;
                    }

                    if (!result.accountStructure && accountStructure) {
                        result.accountStructure = accountStructure;
                    }

                    if (!result.plan && planValue) {
                        result.plan = formatPlan(planValue);
                    }

                    if (!result.planType && planValue) {
                        result.planType = getPlanKey(planValue) || normalize(planValue).toLowerCase();
                    }

                    if (!result.displayName && isDisplayNameCandidate(displayName)) {
                        result.displayName = displayName;
                    }

                    if (!result.workspaceName && isWorkspaceCandidate(workspaceName, result.displayName)) {
                        result.workspaceName = workspaceName;
                    }
                };

                try {
                    const sessionResponse = await fetch('/api/auth/session', { credentials: 'include' });
                    if (sessionResponse.ok) {
                        const sessionPayload = await sessionResponse.json();
                        applyUserPayload(sessionPayload.user || {});

                        if (!result.token) {
                            result.token = normalize(
                                sessionPayload.sessionToken ||
                                sessionPayload.accessToken
                            );
                        }

                        setPlan(sessionPayload.planType || sessionPayload.plan);
                    }
                } catch (error) {
                    console.debug('Failed to fetch auth session', error);
                }

                const bootstrapEl = document.getElementById('client-bootstrap');
                if (bootstrapEl?.textContent) {
                    try {
                        const bootstrap = JSON.parse(bootstrapEl.textContent);
                        const session = bootstrap.session || {};
                        const accounts = Array.isArray(session.accounts) ? session.accounts : [];
                        const account = session.account ||
                            accounts.find(item => item?.active || item?.current || item?.isCurrent) ||
                            accounts[0] ||
                            {};
                        const user = session.user || bootstrap.user || {};

                        if (!result.token) {
                            result.token = normalize(session.sessionToken);
                        }

                        applyUserPayload(user);
                        applyAccountPayload(account);
                        setPlan(session.planType || session.plan);
                    } catch (error) {
                        console.debug('Failed to parse client-bootstrap', error);
                    }
                }

                const profileButtons = [
                    ...document.querySelectorAll("[aria-label*='open profile menu' i]"),
                ];

                for (const button of profileButtons) {
                    const aria = normalize(button.getAttribute('aria-label'))
                        .replace(/,?\s*open profile menu/i, '')
                        .trim();
                    const visibleLines = toLines(button.innerText);
                    const lines = [
                        aria,
                        ...visibleLines,
                        ...(visibleLines.length === 0 ? toLines(button.textContent) : []),
                    ]
                        .map(normalize)
                        .filter(Boolean)
                        .filter((value, index, values) => values.indexOf(value) === index);
                    const combined = normalize(lines.join(' '));
                    const emailMatch = combined.match(emailRegex);

                    if (!result.loginEmail && emailMatch) {
                        result.loginEmail = emailMatch[0];
                    }

                    for (const line of lines) {
                        if (setPlan(line)) {
                            continue;
                        }

                        const personalName = extractPersonalAccountName(line);
                        if (!result.displayName && personalName) {
                            result.displayName = personalName;
                            result.accountStructure = result.accountStructure || 'personal';
                            continue;
                        }

                        if (!result.displayName && isDisplayNameCandidate(line)) {
                            result.displayName = line;
                            continue;
                        }

                        if (!result.workspaceName && isWorkspaceCandidate(line, result.displayName)) {
                            result.workspaceName = line;
                        }
                    }
                }

                if (!result.workspaceName || !result.displayName) {
                    const workspaceOptions = Array.from(document.querySelectorAll('[role="menuitemradio"]'))
                        .map(el => normalize(el.textContent))
                        .filter(Boolean)
                        .map(text => text.replace(/^[A-Z]\s*/, '').trim());

                    for (const text of workspaceOptions) {
                        if (setPlan(text)) {
                            continue;
                        }

                        const personalName = extractPersonalAccountName(text);
                        if (!result.displayName && personalName) {
                            result.displayName = personalName;
                            result.accountStructure = result.accountStructure || 'personal';
                            continue;
                        }

                        if (!result.workspaceName && isWorkspaceCandidate(text, result.displayName)) {
                            result.workspaceName = text;
                            continue;
                        }

                        if (!result.displayName && isDisplayNameCandidate(text)) {
                            result.displayName = text;
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

                if (!result.plan && /\bfree\b/i.test(bodyText) && (
                    /\bupgrade plan\b/i.test(bodyText) ||
                    /\bfree plan\b/i.test(bodyText) ||
                    /\bget plus\b/i.test(bodyText)
                )) {
                    result.plan = 'Free';
                    result.planType = result.planType || 'free';
                }

                if (!result.displayName) {
                    const headingButton = document.querySelector('h1 button');
                    const headingText = normalize(document.querySelector('h1')?.textContent);
                    if (headingButton) {
                        const headingName = normalize(headingButton.textContent);
                        result.displayName = isDisplayNameCandidate(headingName) ? headingName : null;
                    } else if (/How can I help,\s*(.+?)\?/i.test(headingText)) {
                        const headingName = headingText.match(/How can I help,\s*(.+?)\?/i)?.[1] || null;
                        result.displayName = isDisplayNameCandidate(headingName) ? headingName : null;
                    }
                }

                if (!result.workspaceName && bodyText.includes('workspace data')) {
                    const workspaceMatch = bodyText.match(/doesn't use\s+(.+?)\s+workspace data/i);
                    if (workspaceMatch) {
                        const workspaceName = normalize(workspaceMatch[1]);
                        if (isWorkspaceCandidate(workspaceName, result.displayName)) {
                            result.workspaceName = workspaceName;
                        }
                    }
                }

                if (!result.displayName || !result.plan || !result.loginEmail) {
                    const scopeRoots = [
                        ...profileButtons,
                        ...profileButtons.map(button => button.parentElement).filter(Boolean),
                        ...profileButtons.map(button => button.closest('aside')).filter(Boolean),
                        ...profileButtons.map(button => button.closest('nav')).filter(Boolean),
                    ];
                    const seen = new Set();
                    const scopedTruncate = [];

                    scopeRoots.forEach(root => {
                        root?.querySelectorAll?.('.truncate').forEach(node => {
                            if (!seen.has(node)) {
                                seen.add(node);
                                scopedTruncate.push(node);
                            }
                        });
                    });

                    const allTruncate = scopedTruncate.length > 0
                        ? scopedTruncate
                        : Array.from(document.querySelectorAll('.truncate'));

                    for (let i = allTruncate.length - 1; i >= 0; i--) {
                        const text = normalize(allTruncate[i].textContent);

                        if (setPlan(text)) {
                            continue;
                        }

                        const personalName = extractPersonalAccountName(text);
                        if (!result.displayName && personalName) {
                            result.displayName = personalName;
                            result.accountStructure = result.accountStructure || 'personal';
                            continue;
                        }

                        if (!result.displayName && isDisplayNameCandidate(text)) {
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

                if (result.workspaceName && !isWorkspaceCandidate(result.workspaceName, result.displayName)) {
                    result.workspaceName = null;
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

    try {
        const selectedAccount = getStore()?.getState?.().accounts?.find(account => account.token === token)
            || { email, token };
        await setPendingSwitchContext(selectedAccount);

        const tabs = await getOpenChatgptTabs();
        const existingSessionCookies = await getSessionCookies();
        const cookieContext = {
            storeId: existingSessionCookies[0]?.storeId,
            sessionCookies: existingSessionCookies,
        };

        await clearSessionCookies();
        await setSessionTokenCookies(token, expirationDate, cookieContext);

        getStore().setState({ activeToken: token });
        showToast(`已切换到: ${email}`);

        const [tab] = tabs;
        if (tab) {
            await chrome.tabs.update(tab.id, { url: CHATGPT_URL, active: true });
            chrome.windows.update(tab.windowId, { focused: true });
        } else {
            chrome.tabs.create({ url: CHATGPT_URL, active: true });
        }
    } catch (error) {
        console.error('Failed to switch account', error);
        showToast('切换失败，请重试');
    }
}

async function logoutAndLogin() {
    await clearPendingSwitchContext();
    const tabs = await getOpenChatgptTabs();
    await clearSessionCookies();
    const [tab] = tabs;
    if (tab) {
        await chrome.tabs.update(tab.id, { url: "https://chatgpt.com/auth/login", active: true });
        chrome.windows.update(tab.windowId, { focused: true });
    } else {
        chrome.tabs.create({ url: "https://chatgpt.com/auth/login" });
    }
    getStore().setState({ activeToken: "" });
    showToast("已登出，请重新登录");
}

function handleListClickLegacy(e, store) {
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
                if (addedCount > 0 && importedDisplayMode) {
                    showToast(`导入 ${addedCount} 个账号，并同步显示模式`);
                    return;
                }
                if (addedCount > 0) {
                    showToast(`导入 ${addedCount} 个账号`);
                    return;
                }
                showToast(`已同步显示模式为${getAccountDisplayModeMeta(importedDisplayMode).label}`);
                return;
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

async function ensureCurrentAccountSyncedLegacy(store, options = {}) {
    return ensureCurrentAccountSynced(store, options);
}

async function ensureCurrentAccountSynced(store, options = {}) {
    const { force = false, source = force ? 'manual' : 'startup' } = options;
    const activeToken = await getActiveToken();

    if (!activeToken) {
        return { ok: false, changed: false, message: "鏈櫥褰?ChatGPT" };
    }

    const profile = await grabUserInfo();
    const normalizedProfile = normalizeProfilePayload(profile || {});
    const profileName = buildAccountLabel(normalizedProfile);
    const profilePlan = formatPlanName(normalizedProfile.plan || normalizedProfile.planType);

    if (!profileName && !profilePlan && !normalizedProfile.userId && !force) {
        return { ok: false, changed: false, message: "鏈兘璇诲彇褰撳墠璐﹀彿淇℃伅" };
    }

    const { accounts, tagOrders, tags, filterTagId } = store.getState();
    const pendingSwitch = await getPendingSwitchContext();
    const matchedIndex = accounts.findIndex(a => a.token === activeToken);
    const accountMatch = matchedIndex >= 0
        ? { index: matchedIndex, matchMode: 'token' }
        : findAccountMatchByIdentity(accounts, normalizedProfile);
    const profileIdentityMatch = findAccountMatchByIdentity(accounts, normalizedProfile);
    const pendingSwitchTarget = findPendingSwitchTarget(accounts, pendingSwitch);
    const expectedAccountMatch = pendingSwitchTarget.index >= 0 ? pendingSwitchTarget : accountMatch;
    const current = accountMatch.index >= 0 ? accounts[accountMatch.index] : null;
    const currentEmail = normalizeText(current?.email);
    const previousToken = current && current.token !== activeToken ? current.token : null;
    const syncTimestamp = new Date().toISOString();
    const preservedTagIds = current
        ? resolveAccountTagIds(current, tags, tagOrders)
        : [];

    const hasConflictingKnownProfile = (
        expectedAccountMatch.index >= 0 &&
        profileIdentityMatch.index >= 0 &&
        profileIdentityMatch.index !== expectedAccountMatch.index
    );

    if (hasConflictingKnownProfile) {
        return {
            ok: true,
            changed: false,
            message: "ChatGPT 正在完成账号切换，暂时跳过自动录入",
            account: null,
            sync: {
                source,
                timestamp: syncTimestamp,
                matchMode: 'pending-switch-guard',
                tokenChanged: false,
                reason: 'profile-conflict',
                rotationCount: normalizeRotationCount(current?.rotationCount),
            },
        };
    }

    const shouldRefreshLabel = force || !current || isGeneratedAccountLabel(current);
    const nextEmail = shouldRefreshLabel
        ? (profileName || currentEmail || "Current account")
        : (currentEmail || profileName || "Current account");
    const nextPlan = profilePlan || current?.plan || "Free";

    let changed = false;
    let newAccounts;
    const nextTagOrdersSeed = previousToken
        ? replaceTokenInTagOrders(tagOrders, previousToken, activeToken)
        : tagOrders;
    let targetIndex = accountMatch.index;

    if (accountMatch.index >= 0) {
        const updatedCore = compactAccountRecord({
            ...current,
            token: activeToken,
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
            tagIds: preservedTagIds,
        });
        const tokenChanged = Boolean(previousToken);
        const changedReason = tokenChanged
            ? 'token-rotated'
            : (areAccountsSemanticallyEqual(updatedCore, current) ? 'observed' : 'profile-refreshed');
        const updated = compactAccountRecord({
            ...updatedCore,
            ...buildAccountSyncMetadata(current, {
                timestamp: syncTimestamp,
                tokenChanged,
                syncSource: source,
                syncReason: changedReason,
                matchMode: accountMatch.matchMode,
            }),
        });

        changed = !areAccountsSemanticallyEqual(updatedCore, current);
        newAccounts = accounts.map((acc, i) => (i === accountMatch.index ? updated : acc));
    } else {
        newAccounts = [...accounts, createAccountFromProfile(
            { ...normalizedProfile, token: activeToken, plan: nextPlan },
            {
                email: nextEmail,
                token: activeToken,
                tagIds: [],
                plan: nextPlan,
                lastSeenAt: syncTimestamp,
                tokenUpdatedAt: syncTimestamp,
                lastSyncSource: source,
                lastSyncReason: 'new-account',
                lastMatchMode: 'new-account',
                rotationCount: 0,
            }
        )];
        changed = true;
        targetIndex = newAccounts.length - 1;
    }

    const mergeResult = mergeAccountsByIdentity(newAccounts, targetIndex);
    newAccounts = mergeResult.accounts;
    targetIndex = mergeResult.primaryIndex;
    changed = changed || mergeResult.removed;

    const newTagOrders = buildTagOrders(newAccounts, tags, nextTagOrdersSeed);
    const nextFilterTagId = getValidFilterTagId(filterTagId, tags, newAccounts);
    const auditChanged = current
        ? !areAccountsEqual(newAccounts[targetIndex], current)
        : changed;

    if (changed || auditChanged || force || nextFilterTagId !== filterTagId) {
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

    if (pendingSwitch) {
        await clearPendingSwitchContext();
    }

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
        sync: {
            source,
            timestamp: syncTimestamp,
            matchMode: accountMatch.matchMode || 'new-account',
            tokenChanged: Boolean(previousToken),
            reason: !current
                ? 'new-account'
                : (previousToken ? 'token-rotated' : (changed ? 'profile-refreshed' : 'observed')),
            rotationCount: normalizeRotationCount(
                current
                    ? newAccounts[targetIndex]?.rotationCount
                    : newAccounts[newAccounts.length - 1]?.rotationCount
            ),
        },
    };
}

function importDataLegacy(e, store) {
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

            if (addedCount > 0 || importedDisplayMode) {
                const newTagOrders = buildTagOrders(newAccounts, tags, tagOrders);
                const nextFilterTagId = getValidFilterTagId(filterTagId, tags, newAccounts);
                const nextDisplayMode = importedDisplayMode || accountDisplayMode;
                await chrome.storage.local.set({
                    [STORAGE_KEY]: newAccounts,
                    [TAG_ORDERS_KEY]: newTagOrders,
                    [FILTER_TAG_KEY]: nextFilterTagId,
                    [ACCOUNT_DISPLAY_MODE_KEY]: nextDisplayMode,
                });
                store.setState({
                    accounts: newAccounts,
                    tagOrders: newTagOrders,
                    filterTagId: nextFilterTagId,
                    accountDisplayMode: nextDisplayMode,
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

function initAccountDisplayModeToggle(store) {
    const button = $('displayModeBtn');
    const label = $('displayModeBtnLabel');

    if (!button || !label) {
        return;
    }

    const render = (state) => {
        const displayMode = getValidAccountDisplayMode(state.accountDisplayMode);
        const meta = getAccountDisplayModeMeta(displayMode);
        label.textContent = meta.label;
        button.title = meta.title;
        button.dataset.mode = displayMode;
        button.classList.toggle('is-email-mode', displayMode === 'loginEmail');
    };

    store.subscribe(render);
    render(store.getState());
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

function handleListClick(e, store) {
    const li = e.target.closest('li');
    if (!li) return;

    const token = li.dataset.token;
    const { accounts, tagOrders } = store.getState();
    const acc = accounts.find(account => account.token === token);
    const idx = accounts.findIndex(account => account.token === token);

    if (!acc) return;

    const target = e.target.closest('.icon-btn');
    if (!target) return;

    if (target.classList.contains('action-copy')) {
        navigator.clipboard.writeText(acc.token);
        showToast("已复制");
        return;
    }

    if (target.classList.contains('action-edit')) {
        $('inputEmail').value = acc.email || '';
        toggleModal(true, idx, acc.tagIds || []);
        return;
    }

    if (!target.classList.contains('action-delete')) {
        return;
    }

    showDeleteModal(acc.email, () => {
        const tokenToRemove = acc.token;
        const newAccounts = accounts.filter(account => account.token !== tokenToRemove);
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

function importData(e, store) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            let json = JSON.parse(ev.target.result);
            const importedDisplayMode = parseImportedAccountDisplayMode(json);
            const { accounts, tags, tagOrders, filterTagId, accountDisplayMode } = store.getState();
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

            json.forEach(account => {
                const normalized = normalizeImportedAccount(account);
                if (!validateAccount(normalized)) return;

                const exists = newAccounts.some(item => item.token === normalized.token);
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
                return;
            }

            showToast("没有新账号");
        } catch {
            showToast("格式错误");
        }
    };

    if (e.target.files[0]) reader.readAsText(e.target.files[0]);
    e.target.value = '';
}

async function exportData(accounts) {
    if (!Array.isArray(accounts) || accounts.length === 0) {
        showToast("暂无可导出账号");
        return;
    }

    const payload = {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        accounts: accounts.map(account => serializeAccountForExport(account)),
    };
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
