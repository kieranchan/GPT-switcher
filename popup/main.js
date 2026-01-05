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
    const filterTagId = data[FILTER_TAG_KEY] || null;

    // 初始化或修正 tagOrders
    let tagOrders = data[TAG_ORDERS_KEY] || {};
    let needsSave = false;

    // 确保 all 存在
    if (!tagOrders.all) {
        tagOrders.all = accounts.map(acc => acc.token);
        needsSave = true;
    }

    // 确保每个标签都有对应的 order
    tags.forEach(tag => {
        if (!tagOrders[tag.id]) {
            tagOrders[tag.id] = [];
            needsSave = true;
        }
    });

    // 确保 untagged 存在
    if (!tagOrders.untagged) {
        tagOrders.untagged = accounts.filter(a => !a.tagIds || a.tagIds.length === 0).map(a => a.token);
        needsSave = true;
    }

    // 确保所有账号都在对应的 order 中
    accounts.forEach(acc => {
        // 确保在 all 中
        if (!tagOrders.all.includes(acc.token)) {
            tagOrders.all.push(acc.token);
            needsSave = true;
        }

        // 确保在对应标签的 order 中
        if (acc.tagIds && acc.tagIds.length > 0) {
            acc.tagIds.forEach(tagId => {
                if (tagOrders[tagId] && !tagOrders[tagId].includes(acc.token)) {
                    tagOrders[tagId].push(acc.token);
                    needsSave = true;
                }
            });
        }
    });

    if (needsSave) {
        await chrome.storage.local.set({ [TAG_ORDERS_KEY]: tagOrders });
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
});

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

    const { accounts, tagOrders } = store.getState();
    const editIndex = getEditIndex();

    if (editIndex >= 0 && editIndex < accounts.length) {
        if (!email) return showToast("请输入名称");

        const oldTagIds = accounts[editIndex].tagIds || [];
        const newAccounts = accounts.map((acc, i) =>
            i === editIndex ? { ...acc, email, tagIds } : acc
        );

        await chrome.storage.local.set({ [STORAGE_KEY]: newAccounts });

        const token = accounts[editIndex].token;
        const newTagOrders = { ...tagOrders };

        const removedTags = oldTagIds.filter(id => !tagIds.includes(id));
        const addedTags = tagIds.filter(id => !oldTagIds.includes(id));
        const wasUntagged = oldTagIds.length === 0;
        const isNowUntagged = tagIds.length === 0;

        removedTags.forEach(tagId => {
            if (newTagOrders[tagId]) {
                newTagOrders[tagId] = newTagOrders[tagId].filter(t => t !== token);
            }
        });

        if (wasUntagged && !isNowUntagged && newTagOrders.untagged) {
            newTagOrders.untagged = newTagOrders.untagged.filter(t => t !== token);
        }

        addedTags.forEach(tagId => {
            if (!newTagOrders[tagId]) newTagOrders[tagId] = [];
            if (!newTagOrders[tagId].includes(token)) {
                newTagOrders[tagId].push(token);
            }
        });

        if (!wasUntagged && isNowUntagged) {
            if (!newTagOrders.untagged) newTagOrders.untagged = [];
            if (!newTagOrders.untagged.includes(token)) {
                newTagOrders.untagged.push(token);
            }
        }

        await chrome.storage.local.set({ [TAG_ORDERS_KEY]: newTagOrders });
        store.setState({ accounts: newAccounts, tagOrders: newTagOrders });

        // 检查当前筛选分类是否变空，如果空则跳回"全部"
        const { filterTagId } = store.getState();
        if (filterTagId && filterTagId !== 'all') {
            let isEmpty = false;
            if (filterTagId === 'untagged') {
                isEmpty = newAccounts.every(a => a.tagIds && a.tagIds.length > 0);
            } else {
                isEmpty = newAccounts.every(a => !(a.tagIds || []).includes(filterTagId));
            }
            if (isEmpty) {
                store.setState({ filterTagId: 'all' });
                chrome.storage.local.set({ [FILTER_TAG_KEY]: 'all' });
            }
        }

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

    const plan = getGrabPlan() || null;
    setGrabPlan(null);

    const newAccount = { email, token, plan, tagIds };
    const newAccounts = [...accounts, newAccount];

    const newTagOrders = { ...tagOrders };
    if (!newTagOrders.all) newTagOrders.all = [];
    newTagOrders.all.push(token);

    if (tagIds.length > 0) {
        tagIds.forEach(tagId => {
            if (!newTagOrders[tagId]) newTagOrders[tagId] = [];
            newTagOrders[tagId].push(token);
        });
    } else {
        if (!newTagOrders.untagged) newTagOrders.untagged = [];
        newTagOrders.untagged.push(token);
    }

    await chrome.storage.local.set({
        [STORAGE_KEY]: newAccounts,
        [TAG_ORDERS_KEY]: newTagOrders
    });
    store.setState({ accounts: newAccounts, tagOrders: newTagOrders });
    renderTagFilterBar(store);
    showToast("已保存");
    toggleModal(false);
}

async function grabToken() {
    try {
        const cookie = await chrome.cookies.get({ url: CHATGPT_URL, name: COOKIE_NAME });
        if (!cookie) return showToast("未登录 ChatGPT");
        const token = cookie.value;
        $('inputToken').value = token;

        const result = await grabUserInfo();

        if (result?.name) {
            $('inputEmail').value = result.name;
            setGrabPlan(result.plan);
            showToast(`已获取: ${result.name} (${result.plan || 'Free'})`);
        } else {
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
                const allTruncate = document.querySelectorAll('.truncate');
                if (allTruncate.length < 2) return null;

                const planKeywords = ['free', 'plus', 'pro', 'team'];
                let name = null;
                let plan = null;

                for (let i = allTruncate.length - 1; i >= 0; i--) {
                    const text = allTruncate[i].textContent.trim();
                    const textLower = text.toLowerCase();

                    if (planKeywords.includes(textLower)) {
                        plan = text;
                    } else if (text.length > 0 && text.length < 50 && !plan) {
                        continue;
                    } else if (plan && text.length > 0 && text.length < 50) {
                        name = text;
                        break;
                    }
                }

                if (!name) {
                    for (let i = allTruncate.length - 1; i >= 0; i--) {
                        const el = allTruncate[i];
                        const parent = el.parentElement;
                        const text = el.textContent.trim();

                        if (parent?.className?.includes('text-token-text-tertiary')) {
                            plan = text;
                        } else if (parent?.className?.includes('grow') && parent?.className?.includes('items-center')) {
                            if (text.length > 0 && text.length < 50 && !['New chat', 'Search chats', 'Images', 'Apps', 'Projects'].includes(text)) {
                                name = text;
                            }
                        }
                    }
                }

                return { name, plan };
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

    await chrome.cookies.remove({ url: CHATGPT_URL, name: COOKIE_NAME });

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
    await chrome.cookies.remove({ url: CHATGPT_URL, name: COOKIE_NAME });
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

            const newTagOrders = {};
            for (const key in tagOrders) {
                newTagOrders[key] = tagOrders[key].filter(t => t !== tokenToRemove);
            }

            chrome.storage.local.set({
                [STORAGE_KEY]: newAccounts,
                [TAG_ORDERS_KEY]: newTagOrders
            }).then(() => {
                store.setState({ accounts: newAccounts, tagOrders: newTagOrders });

                // 检查当前筛选分类是否变空，如果空则跳回"全部"
                const { filterTagId } = store.getState();
                if (filterTagId && filterTagId !== 'all') {
                    let isEmpty = false;
                    if (filterTagId === 'untagged') {
                        isEmpty = newAccounts.every(a => a.tagIds && a.tagIds.length > 0);
                    } else {
                        isEmpty = newAccounts.every(a => !(a.tagIds || []).includes(filterTagId));
                    }
                    if (isEmpty) {
                        store.setState({ filterTagId: 'all' });
                        chrome.storage.local.set({ [FILTER_TAG_KEY]: 'all' });
                    }
                }

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

    const activeToken = await getActiveToken();
    if (!activeToken) {
        showToast("未登录 ChatGPT");
        return;
    }

    const { accounts } = store.getState();
    const idx = accounts.findIndex(a => a.token === activeToken);

    if (idx === -1) {
        showToast("当前账号不在列表中");
        return;
    }

    const result = await grabUserInfo();

    if (result?.name || result?.plan) {
        const newAccounts = accounts.map((acc, i) =>
            i === idx ? {
                ...acc,
                email: result.name || acc.email,
                plan: result.plan || acc.plan
            } : acc
        );

        await chrome.storage.local.set({ [STORAGE_KEY]: newAccounts });
        store.setState({ accounts: newAccounts });
        showToast(`已更新: ${result.name || ''} (${result.plan || 'Free'})`);
    } else {
        showToast("更新失败，请确保 ChatGPT 页面已打开");
    }
}

function importData(e, store) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            let json = JSON.parse(ev.target.result);
            const { accounts } = store.getState();
            let newAccounts = [...accounts];
            let addedCount = 0;

            if (!Array.isArray(json)) {
                json = Object.entries(json).map(([email, token]) => ({ email, token }));
            }

            json.forEach(a => {
                const normalized = {
                    email: a.email || a.name || '未命名',
                    token: a.token || a.key
                };
                if (!validateAccount(normalized)) return;

                const exists = newAccounts.some(acc => acc.token === normalized.token);
                if (!exists) {
                    newAccounts.push(normalized);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                await chrome.storage.local.set({ [STORAGE_KEY]: newAccounts });
                store.setState({ accounts: newAccounts });
                showToast(`导入 ${addedCount} 个账号`);
            } else {
                showToast("没有新账号");
            }
        } catch { showToast("格式错误"); }
    };
    if (e.target.files[0]) reader.readAsText(e.target.files[0]);
}

function clearData(store) {
    if (confirm("清空所有数据不可恢复!")) {
        chrome.storage.local.set({ [STORAGE_KEY]: [] }).then(() => {
            store.setState({ accounts: [] });
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
        setEditIndex(-1);
    }
}

async function getActiveToken() {
    try {
        const cookie = await chrome.cookies.get({ url: CHATGPT_URL, name: COOKIE_NAME });
        return cookie ? cookie.value : "";
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

function exportData(accounts) {
    const blob = new Blob([JSON.stringify(accounts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `gpt_accounts_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
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

    const { tags } = store.getState();

    if (tags.some(t => t.name === name)) {
        return showToast("标签已存在");
    }

    const newTag = {
        id: 'tag_' + Date.now(),
        name,
        color
    };

    const newTags = [...tags, newTag];
    chrome.storage.local.set({ [TAGS_KEY]: newTags }).then(() => {
        store.setState({ tags: newTags });
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
        const { tags, accounts, tagOrders } = store.getState();
        const newTags = tags.filter(t => t.id !== tagId);

        const newAccounts = accounts.map(acc => ({
            ...acc,
            tagIds: (acc.tagIds || []).filter(id => id !== tagId)
        }));

        const newTagOrders = { ...tagOrders };
        delete newTagOrders[tagId];

        chrome.storage.local.set({
            [TAGS_KEY]: newTags,
            [STORAGE_KEY]: newAccounts,
            [TAG_ORDERS_KEY]: newTagOrders
        }).then(() => {
            store.setState({ tags: newTags, accounts: newAccounts, tagOrders: newTagOrders });
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
    const newTags = tags.map(t => t.id === tagId ? { ...t, name: newName, color: newColor } : t);

    chrome.storage.local.set({ [TAGS_KEY]: newTags }).then(() => {
        store.setState({ tags: newTags });
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

    const hasUntagged = accounts.some(a => !a.tagIds || a.tagIds.length === 0);

    if ((!tags || tags.length === 0) && !hasUntagged) {
        container.innerHTML = '';
        return;
    }

    let html = `<span class="tag-filter-item ${!filterTagId || filterTagId === 'all' ? 'active' : ''}" data-id="all">全部</span>`;

    if (tags && tags.length > 0) {
        html += tags.map(tag => `
      <span class="tag-filter-item ${filterTagId === tag.id ? 'active' : ''}" data-id="${tag.id}">
        <span class="tag-dot" style="background:${tag.color}"></span>
        ${sanitize(tag.name)}
      </span>
    `).join('');
    }

    if (hasUntagged) {
        html += `<span class="tag-filter-item ${filterTagId === 'untagged' ? 'active' : ''}" data-id="untagged">无标签</span>`;
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
