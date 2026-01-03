/**
 * GPT Account Switcher - Refactored with State Management and Components
 */
const CHATGPT_URL = "https://chatgpt.com";
const COOKIE_NAME = "__Secure-next-auth.session-token";
const STORAGE_KEY = "accounts";
const THEME_KEY = "user_theme";

// Simplified Icons
const ICONS = {
  copy: `<svg class="svg-icon" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  edit: `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  trash: `<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  sun: `<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
  moon: `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
  save: `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
  grab: `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
  sync: `<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>`
};

const $ = id => document.getElementById(id);

// --- State Management (Store) ---
function createStore(initialState = {}) {
  let state = initialState;
  const listeners = new Set();

  const setState = (updater) => {
    const newState = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...newState };
    publish();
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const publish = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  return {
    getState: () => state,
    setState,
    subscribe,
  };
}

// --- Components ---
function AccountCard(account, index, store) {
  const li = document.createElement('li');
  li.className = 'account-card';
  li.dataset.index = index;

  const accountInfo = document.createElement('div');
  accountInfo.className = 'account-info';

  const accountHeader = document.createElement('div');
  accountHeader.className = 'account-header';

  const accountName = document.createElement('span');
  accountName.className = 'account-name';

  const accountNameInput = document.createElement('input');
  accountNameInput.type = 'text';
  accountNameInput.className = 'account-name-input';
  accountNameInput.style.display = 'none';

  const badges = document.createElement('div');
  badges.className = 'badges';

  accountHeader.append(accountName, accountNameInput, badges);

  const accountKey = document.createElement('div');
  accountKey.className = 'account-key';
  accountKey.textContent = `${account.token.slice(0, 10)}...${account.token.slice(-6)}`;

  accountInfo.append(accountHeader, accountKey);

  const accountActions = document.createElement('div');
  accountActions.className = 'account-actions';
  accountActions.innerHTML = `
        <button class="icon-btn action-copy" title="复制 Token">${ICONS.copy}</button>
        <button class="icon-btn action-edit" title="编辑">${ICONS.edit}</button>
        <button class="icon-btn action-save" title="保存" style="display:none;">${ICONS.save}</button>
        <button class="icon-btn action-delete delete" title="删除">${ICONS.trash}</button>
    `;

  li.append(accountInfo, accountActions);

  const update = (newAccount) => {
    account = newAccount;
    const { activeToken } = store.getState();
    li.classList.toggle('active', account.token === activeToken);

    let badgeHTML = account.token === activeToken ? `<span class="badge badge-current">当前</span>` : '';

    // 显示套餐徽章
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

    accountName.textContent = account.email || '未命名';
    accountNameInput.value = account.email || '未命名';
    badges.innerHTML = badgeHTML;
  };

  update(account);

  li.addEventListener('click', (e) => {
    if (e.target.closest('.account-actions')) return;
    switchAccount(account.email, account.token);
  });

  return { element: li, update };
}

function App(store) {
  const listEl = $('accountList');
  const components = new Map();
  let sortableInstance = null;

  const render = (state) => {
    const { accounts, filter } = state;
    const filteredAccounts = accounts.filter(acc => !filter || acc.email.toLowerCase().includes(filter.toLowerCase()));

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

    // Remove old components
    for (const [key, component] of components.entries()) {
      if (!newKeys.has(key)) {
        component.element.remove();
        components.delete(key);
      }
    }

    // Add/update components
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

    // Initialize Sortable if not already done
    if (!sortableInstance && typeof Sortable !== 'undefined' && filteredAccounts.length > 0) {
      sortableInstance = new Sortable(listEl, {
        animation: 150,
        ghostClass: 'dragging',
        chosenClass: 'drag-over',
        onEnd: async (evt) => {
          const { oldIndex, newIndex } = evt;
          if (oldIndex === newIndex) return;

          const { accounts } = store.getState();
          const newAccounts = [...accounts];
          const [movedItem] = newAccounts.splice(oldIndex, 1);
          newAccounts.splice(newIndex, 0, movedItem);

          await chrome.storage.local.set({ [STORAGE_KEY]: newAccounts });
          store.setState({ accounts: newAccounts });
        }
      });
    }
  };

  store.subscribe(render);
  render(store.getState());
}

// --- Main ---
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get([STORAGE_KEY, THEME_KEY]);
  let accounts = data[STORAGE_KEY] || [];

  // 转换旧数据格式
  if (!Array.isArray(accounts) && typeof accounts === 'object') {
    accounts = Object.entries(accounts).map(([email, token]) => ({ email, token }));
    await chrome.storage.local.set({ [STORAGE_KEY]: accounts });
  }

  const store = createStore({
    accounts,
    activeToken: await getActiveToken(),
    filter: '',
  });

  window.store = store;

  App(store);
  initEventListeners(store);

  // Theme Init
  const isDark = data[THEME_KEY] === 'dark' || (!data[THEME_KEY] && window.matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme(isDark);
});

function initEventListeners(store) {
  $('toggleAddBtn').onclick = () => toggleModal(true);
  $('cancelEditBtn').onclick = $('modalOverlay').onclick = () => toggleModal(false);
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
    if (e.key === 'Enter' && e.target.classList.contains('account-name-input')) {
      e.target.closest('li').querySelector('.action-save').click();
    }
  });
}

// --- Actions ---

async function saveAccount(store) {
  const email = $('inputEmail').value.trim();
  let token = $('inputToken').value.trim();
  if (!email || !token) return showToast("请填写完整");

  const { accounts } = store.getState();
  const exists = accounts.some(a => a.token === token);
  if (exists) {
    showToast("Token 已存在");
    toggleModal(false);
    return;
  }

  // 获取抓取时临时存储的套餐
  const plan = window._grabPlan || null;
  window._grabPlan = null;

  const newAccount = { email, token, plan };
  const newAccounts = [...accounts, newAccount];

  await chrome.storage.local.set({ [STORAGE_KEY]: newAccounts });
  store.setState({ accounts: newAccounts });

  showToast("已保存");
  toggleModal(false);
}

async function grabToken() {
  try {
    const cookie = await chrome.cookies.get({ url: CHATGPT_URL, name: COOKIE_NAME });
    if (!cookie) return showToast("未登录 ChatGPT");
    const token = cookie.value;
    $('inputToken').value = token;

    // 尝试从 ChatGPT 页面抓取用户名和套餐
    const result = await grabUserInfo();

    if (result?.name) {
      $('inputEmail').value = result.name;
      window._grabPlan = result.plan;
      showToast(`已获取: ${result.name} (${result.plan || 'Free'})`);
    } else {
      window._grabPlan = null;
      $('inputEmail').focus();
      showToast("已获取 Token");
    }
  } catch {
    showToast("获取失败");
  }
}

// 通用抓取用户信息函数
async function grabUserInfo() {
  const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  if (tabs.length === 0) return null;

  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        // 获取所有 truncate 元素
        const allTruncate = document.querySelectorAll('.truncate');
        if (allTruncate.length < 2) return null;

        // 从后往前找用户名和套餐
        // 套餐通常是 Free/Plus/Pro/Team
        const planKeywords = ['free', 'plus', 'pro', 'team'];
        let name = null;
        let plan = null;

        for (let i = allTruncate.length - 1; i >= 0; i--) {
          const text = allTruncate[i].textContent.trim();
          const textLower = text.toLowerCase();

          // 如果是套餐关键词
          if (planKeywords.includes(textLower)) {
            plan = text;
          } else if (text.length > 0 && text.length < 50 && !plan) {
            // 可能是用户名（在套餐前面）
            continue;
          } else if (plan && text.length > 0 && text.length < 50) {
            // 找到套餐后，前一个非空短文本就是用户名
            name = text;
            break;
          }
        }

        // 如果上面没找到，尝试用父元素类名来定位
        if (!name) {
          for (let i = allTruncate.length - 1; i >= 0; i--) {
            const el = allTruncate[i];
            const parent = el.parentElement;
            const text = el.textContent.trim();

            // 套餐的父元素包含 text-token-text-tertiary
            if (parent?.className?.includes('text-token-text-tertiary')) {
              plan = text;
            }
            // 用户名的父元素包含 grow items-center
            else if (parent?.className?.includes('grow') && parent?.className?.includes('items-center')) {
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

  window.store.setState({ activeToken: token });
  showToast(`已切换到: ${email}`);

  // 刷新 ChatGPT 页面，如果没有则创建新页面
  const [tab] = await chrome.tabs.query({ url: "*://chatgpt.com/*" });
  if (tab) {
    await chrome.tabs.reload(tab.id);
    chrome.windows.update(tab.windowId, { focused: true });
  } else {
    // 没有打开的 ChatGPT 页面，创建新标签页
    chrome.tabs.create({ url: CHATGPT_URL });
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
  window.store.setState({ activeToken: "" });
  showToast("已登出，请重新登录");
}

function handleListClick(e, store) {
  const li = e.target.closest('li');
  if (!li) return;
  const idx = parseInt(li.dataset.index);
  const { accounts } = store.getState();
  const acc = accounts[idx];

  const target = e.target.closest('.icon-btn');
  if (!target) return;

  if (target.classList.contains('action-copy')) {
    navigator.clipboard.writeText(acc.token);
    showToast("已复制");
  } else if (target.classList.contains('action-edit')) {
    toggleEditState(li, true);
    li.querySelector('.account-name-input').onclick = (e) => e.stopPropagation();
  } else if (target.classList.contains('action-save')) {
    const newEmail = li.querySelector('.account-name-input').value.trim();
    if (newEmail) {
      const newAccounts = [...accounts];
      newAccounts[idx].email = newEmail;

      chrome.storage.local.set({ [STORAGE_KEY]: newAccounts }).then(() => {
        store.setState({ accounts: newAccounts });
        showToast("已更新");
        toggleEditState(li, false);
      });
    }
  } else if (target.classList.contains('action-delete')) {
    if (confirm("确定删除?")) {
      const newAccounts = accounts.filter((_, i) => i !== idx);

      chrome.storage.local.set({ [STORAGE_KEY]: newAccounts }).then(() => {
        store.setState({ accounts: newAccounts });
      });
    }
  }
}

// 更新当前账号信息（用户名和套餐）
async function syncCurrentAccount(store) {
  showToast("正在更新...");

  // 获取当前登录的 token
  const activeToken = await getActiveToken();
  if (!activeToken) {
    showToast("未登录 ChatGPT");
    return;
  }

  // 找到当前账号的索引
  const { accounts } = store.getState();
  const idx = accounts.findIndex(a => a.token === activeToken);

  if (idx === -1) {
    showToast("当前账号不在列表中");
    return;
  }

  // 抓取用户信息
  const result = await grabUserInfo();

  if (result?.name || result?.plan) {
    const newAccounts = [...accounts];
    if (result.name) newAccounts[idx].email = result.name;
    if (result.plan) newAccounts[idx].plan = result.plan;

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

      // 支持旧格式 {email: token} 和新格式 [{email, token}]
      if (!Array.isArray(json)) {
        json = Object.entries(json).map(([email, token]) => ({ email, token }));
      }

      json.forEach(a => {
        const exists = newAccounts.some(acc => acc.token === a.token);
        if (a.token && !exists) {
          newAccounts.push({ email: a.email || a.name || '未命名', token: a.token || a.key });
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

function toggleModal(show) {
  const el = $('editForm'), overlay = $('modalOverlay');
  if (show) {
    $('modalTitle').textContent = "添加账号";
    el.classList.add('open'); overlay.classList.add('open');
    $('inputEmail').focus();
  } else {
    el.classList.remove('open'); overlay.classList.remove('open');
    $('inputEmail').value = $('inputToken').value = '';
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

function toggleEditState(li, isEditing) {
  li.querySelector('.account-name').style.display = isEditing ? 'none' : 'inline-block';
  li.querySelector('.account-name-input').style.display = isEditing ? 'inline-block' : 'none';
  li.querySelector('.action-edit').style.display = isEditing ? 'none' : 'inline-block';
  li.querySelector('.action-save').style.display = isEditing ? 'inline-block' : 'none';

  if (isEditing) {
    li.querySelector('.account-name-input').focus();
    li.querySelector('.account-name-input').select();
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