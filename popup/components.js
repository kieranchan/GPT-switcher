/**
 * GPT-Switcher Components Module
 * UI 组件: AccountCard, App
 */

import { $, ICONS, TAG_ORDERS_KEY, WORKSPACE_FILTER_PREFIX } from './constants.js';
import { sanitize } from './store.js';

// --- 依赖注入 ---
let _switchAccount = null;
export function setSwitchAccount(fn) { _switchAccount = fn; }

function isAccountInScope(account, filterTagId) {
    if (filterTagId === 'untagged') {
        return (!account.tagIds || account.tagIds.length === 0) && !getAccountWorkspaceFilterId(account);
    }

    if (isWorkspaceFilterId(filterTagId)) {
        return getAccountWorkspaceFilterId(account) === filterTagId;
    }

    if (filterTagId && filterTagId !== 'all') {
        return (account.tagIds || []).includes(filterTagId);
    }

    return true;
}

function sortAccountsByOrder(accounts, order = []) {
    const orderIndexMap = new Map(order.map((token, index) => [token, index]));
    return [...accounts].sort((a, b) => {
        const idxA = orderIndexMap.get(a.token);
        const idxB = orderIndexMap.get(b.token);
        if (idxA === undefined && idxB === undefined) return 0;
        if (idxA === undefined) return 1;
        if (idxB === undefined) return -1;
        return idxA - idxB;
    });
}

function mergeVisibleOrder(fullOrder, visibleOrder) {
    const visibleSet = new Set(visibleOrder);
    let nextVisibleIndex = 0;

    const mergedOrder = fullOrder.map(token => (
        visibleSet.has(token) ? visibleOrder[nextVisibleIndex++] : token
    ));

    if (nextVisibleIndex < visibleOrder.length) {
        mergedOrder.push(...visibleOrder.slice(nextVisibleIndex));
    }

    return mergedOrder;
}

function normalizeAccountText(value) {
    return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isWorkspaceFilterId(filterTagId) {
    return typeof filterTagId === 'string' && filterTagId.startsWith(WORKSPACE_FILTER_PREFIX);
}

function normalizeWorkspaceFilterLabel(value) {
    const workspaceName = (value || '').replace(/\s+/g, ' ').trim();
    if (!workspaceName) {
        return '';
    }

    const normalizedWorkspace = normalizeAccountText(workspaceName);
    if (
        !normalizedWorkspace ||
        [
            'personal',
            'personal account',
            'personal workspace',
            'launch a workspace',
            'open',
            'team',
            'plus',
            'pro',
            'free',
            'business',
            'enterprise',
            'edu',
        ].includes(normalizedWorkspace)
    ) {
        return '';
    }

    return workspaceName;
}

function getAccountWorkspaceFilterId(account = {}) {
    const workspaceLabel = normalizeWorkspaceFilterLabel(account.workspaceName);
    return workspaceLabel
        ? `${WORKSPACE_FILTER_PREFIX}${encodeURIComponent(workspaceLabel.toLowerCase())}`
        : '';
}

function getWorkspaceLabel(account = {}) {
    const workspaceName = normalizeWorkspaceFilterLabel(account.workspaceName);
    if (!workspaceName) {
        return '';
    }
    const normalizedWorkspace = normalizeAccountText(workspaceName);

    const duplicateCandidates = [
        account.displayName,
        account.loginEmail,
        account.email,
    ]
        .map(normalizeAccountText)
        .filter(Boolean);

    if (
        duplicateCandidates.includes(normalizedWorkspace) ||
        duplicateCandidates.some(candidate => candidate.includes(normalizedWorkspace))
    ) {
        return '';
    }

    return workspaceName;
}

// --- 组件 ---

// 账号卡片组件
export function AccountCard(account, index, store) {
    const li = document.createElement('li');
    li.className = 'account-card';
    li.dataset.token = account.token;

    const accountInfo = document.createElement('div');
    accountInfo.className = 'account-info';

    const accountHeader = document.createElement('div');
    accountHeader.className = 'account-header';

    const accountName = document.createElement('span');
    accountName.className = 'account-name';

    const badges = document.createElement('div');
    badges.className = 'badges';

    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'tags-container';

    accountHeader.append(accountName, badges, tagsContainer);

    const accountKey = document.createElement('div');
    accountKey.className = 'account-key';
    accountKey.textContent = `${account.token.slice(0, 10)}...${account.token.slice(-6)}`;

    accountInfo.append(accountHeader, accountKey);

    const accountActions = document.createElement('div');
    accountActions.className = 'account-actions';
    accountActions.innerHTML = `
    <button class="icon-btn action-copy" title="复制 Token">${ICONS.copy}</button>
    <button class="icon-btn action-edit" title="编辑">${ICONS.edit}</button>
    <button class="icon-btn action-delete delete" title="删除">${ICONS.trash}</button>
  `;

    li.append(accountInfo, accountActions);

    const update = (newAccount) => {
        account = newAccount;
        const { activeToken, currentAccountToken } = store.getState();
        const isCurrent = account.token === (currentAccountToken || activeToken);
        li.classList.toggle('active', isCurrent);

        let badgeHTML = isCurrent ? `<span class="badge badge-current">当前</span>` : '';

        if (account.plan) {
            const planLower = account.plan.toLowerCase();
            if (planLower.includes('pro')) {
                badgeHTML += `<span class="badge badge-pro">Pro</span>`;
            } else if (planLower.includes('plus')) {
                badgeHTML += `<span class="badge badge-plus">Plus</span>`;
            } else if (planLower.includes('team')) {
                badgeHTML += `<span class="badge badge-team">Team</span>`;
            } else if (planLower.includes('free')) {
                badgeHTML += `<span class="badge badge-free">Free</span>`;
            }
        }

        const workspaceLabel = getWorkspaceLabel(account);
        if (workspaceLabel) {
            badgeHTML += `<span class="badge badge-workspace" title="${sanitize(workspaceLabel)}">${sanitize(workspaceLabel)}</span>`;
        }

        accountName.textContent = account.email || '未命名';
        badges.innerHTML = badgeHTML;

        const { tags: allTags } = store.getState();
        const accountTagIds = account.tagIds || [];
        tagsContainer.innerHTML = accountTagIds.map(tagId => {
            const tag = allTags.find(t => t.id === tagId);
            if (!tag) return '';
            return `<span class="tag" style="background:${tag.color}20;color:${tag.color};border:1px solid ${tag.color}40">${sanitize(tag.name)}</span>`;
        }).join('');
    };

    update(account);

    li.addEventListener('click', (e) => {
        if (e.target.closest('.account-actions')) return;
        if (_switchAccount) _switchAccount(account.email, account.token);
    });

    return { element: li, update };
}

// 标签颜色映射
export function getTagColor(tag) {
    const colorMap = {
        '工作': 'green',
        '备用': 'blue',
        '测试': 'yellow',
        'vip': 'purple',
        '主力': 'green'
    };
    return colorMap[tag.toLowerCase()] || 'gray';
}

// 主应用组件
export function App(store) {
    const listEl = $('accountList');
    const components = new Map();
    let sortableInstance = null;

    const render = (state) => {
        const { accounts, filter, filterTagId, tagOrders } = state;

        const orderKey = (!filterTagId || filterTagId === 'all') ? 'all' : filterTagId;

        let filteredAccounts = accounts;
        filteredAccounts = accounts.filter(acc => isAccountInScope(acc, filterTagId));

        if (filter) {
            const normalizedFilter = filter.toLowerCase();
            filteredAccounts = filteredAccounts.filter(acc => [
                acc.email,
                acc.displayName,
                acc.loginEmail,
                acc.workspaceName,
                acc.userId,
                acc.accountId,
                acc.organizationId,
            ]
                .filter(Boolean)
                .some(value => value.toLowerCase().includes(normalizedFilter)));
        }

        const order = tagOrders[orderKey] || [];
        filteredAccounts = sortAccountsByOrder(filteredAccounts, order);

        if (filteredAccounts.length === 0) {
            listEl.innerHTML = `<div class="empty-state">📭 暂无账号</div>`;
            components.clear();
            if (sortableInstance) {
                sortableInstance.destroy();
                sortableInstance = null;
            }
            return;
        }

        const newKeys = new Set(filteredAccounts.map(acc => acc.token));

        const emptyState = listEl.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        for (const [key, component] of components.entries()) {
            if (!newKeys.has(key)) {
                component.element.remove();
                components.delete(key);
            }
        }

        filteredAccounts.forEach((acc, idx) => {
            const originalIndex = accounts.indexOf(acc);
            if (components.has(acc.token)) {
                const component = components.get(acc.token);
                component.update(acc);
                if (listEl.children[idx] !== component.element) {
                    listEl.insertBefore(component.element, listEl.children[idx]);
                }
            } else {
                const card = AccountCard(acc, originalIndex, store);
                listEl.insertBefore(card.element, listEl.children[idx]);
                components.set(acc.token, card);
            }
        });

        if (!sortableInstance && typeof Sortable !== 'undefined' && filteredAccounts.length > 0) {
            sortableInstance = new Sortable(listEl, {
                animation: 150,
                ghostClass: 'dragging',
                chosenClass: 'drag-over',
                onEnd: async (evt) => {
                    const { oldIndex, newIndex } = evt;
                    if (oldIndex === newIndex) return;

                    const { accounts, tagOrders, filterTagId } = store.getState();
                    const orderKey = (!filterTagId || filterTagId === 'all') ? 'all' : filterTagId;
                    const fullOrder = sortAccountsByOrder(
                        accounts.filter(acc => isAccountInScope(acc, filterTagId)),
                        tagOrders[orderKey] || []
                    ).map(acc => acc.token);
                    const visibleOrder = Array.from(listEl.querySelectorAll('li')).map(li => li.dataset.token);
                    const nextOrder = mergeVisibleOrder(fullOrder, visibleOrder);
                    const newTagOrders = { ...tagOrders, [orderKey]: nextOrder };

                    await chrome.storage.local.set({ [TAG_ORDERS_KEY]: newTagOrders });
                    store.setState({ tagOrders: newTagOrders });
                }
            });
        }
    };

    store.subscribe(render);
    render(store.getState());
}
