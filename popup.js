/**
 * GPT Account Switcher - Refactored with State Management and Components
 */
const CHATGPT_URL = "https://chatgpt.com";
const COOKIE_NAME = "__Secure-next-auth.session-token";
const STORAGE_KEY = "accounts";
const TAGS_KEY = "tags";
const FILTER_TAG_KEY = "filterTagId";
const TAG_ORDERS_KEY = "tagOrders";
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
  li.dataset.token = account.token;  // 改用 token 作为唯一标识

  const accountInfo = document.createElement('div');
  accountInfo.className = 'account-info';

  const accountHeader = document.createElement('div');
  accountHeader.className = 'account-header';

  const accountName = document.createElement('span');
  accountName.className = 'account-name';

  const badges = document.createElement('div');
  badges.className = 'badges';

  // 标签显示区域（放在用户名行）
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
    badges.innerHTML = badgeHTML;

    // 显示标签
    const { tags: allTags } = store.getState();
    const accountTagIds = account.tagIds || [];
    tagsContainer.innerHTML = accountTagIds.map(tagId => {
      const tag = allTags.find(t => t.id === tagId);
      if (!tag) return '';
      return `<span class="tag" style="background:${tag.color}20;color:${tag.color};border:1px solid ${tag.color}40">${tag.name}</span>`;
    }).join('');
  };

  update(account);

  li.addEventListener('click', (e) => {
    if (e.target.closest('.account-actions')) return;
    switchAccount(account.email, account.token);
  });

  return { element: li, update };
}

// 根据标签名获取颜色类
function getTagColor(tag) {
  const colorMap = {
    '工作': 'green',
    '备用': 'blue',
    '测试': 'yellow',
    'vip': 'purple',
    '主力': 'green'
  };
  return colorMap[tag.toLowerCase()] || 'gray';
}

function App(store) {
  const listEl = $('accountList');
  const components = new Map();
  let sortableInstance = null;

  const render = (state) => {
    const { accounts, filter, filterTagId, tagOrders } = state;

    // 确定当前排序 key
    const orderKey = (!filterTagId || filterTagId === 'all') ? 'all' : filterTagId;

    // 先按标签筛选
    let filteredAccounts = accounts;
    if (filterTagId === 'untagged') {
      filteredAccounts = accounts.filter(acc => !acc.tagIds || acc.tagIds.length === 0);
    } else if (filterTagId && filterTagId !== 'all') {
      filteredAccounts = accounts.filter(acc => (acc.tagIds || []).includes(filterTagId));
    }

    // 再按搜索词筛选
    if (filter) {
      filteredAccounts = filteredAccounts.filter(acc => acc.email.toLowerCase().includes(filter.toLowerCase()));
    }

    // 按 tagOrders 排序
    const order = tagOrders[orderKey] || [];
    filteredAccounts = [...filteredAccounts].sort((a, b) => {
      const idxA = order.indexOf(a.token);
      const idxB = order.indexOf(b.token);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

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

    // 清除可能残留的 empty-state
    const emptyState = listEl.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

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

          const { tagOrders, filterTagId } = store.getState();
          const orderKey = (!filterTagId || filterTagId === 'all') ? 'all' : filterTagId;

          // 从 DOM 获取当前显示的 token 列表（不依赖闭包中的 filteredAccounts）
          const currentOrder = Array.from(listEl.querySelectorAll('li')).map(li => li.dataset.token);

          // 更新 tagOrders
          const newTagOrders = { ...tagOrders, [orderKey]: currentOrder };

          await chrome.storage.local.set({ [TAG_ORDERS_KEY]: newTagOrders });
          store.setState({ tagOrders: newTagOrders });
        }
      });
    }
  };

  store.subscribe(render);
  render(store.getState());
}

// --- Main ---
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get([STORAGE_KEY, TAGS_KEY, FILTER_TAG_KEY, TAG_ORDERS_KEY, THEME_KEY]);
  let accounts = data[STORAGE_KEY] || [];
  let tags = data[TAGS_KEY] || [];
  const filterTagId = data[FILTER_TAG_KEY] || null;
  let tagOrders = data[TAG_ORDERS_KEY] || {};

  // 转换旧数据格式
  if (!Array.isArray(accounts) && typeof accounts === 'object') {
    accounts = Object.entries(accounts).map(([email, token]) => ({ email, token }));
    await chrome.storage.local.set({ [STORAGE_KEY]: accounts });
  }

  // 初始化/同步 tagOrders
  let needsSave = false;

  // 确保 all 排序存在
  if (!tagOrders.all) {
    tagOrders.all = accounts.map(a => a.token);
    needsSave = true;
  }

  // 确保每个标签的排序都包含对应账号
  accounts.forEach(acc => {
    const accTagIds = acc.tagIds || [];

    if (accTagIds.length === 0) {
      // 无标签账号
      if (!tagOrders.untagged) tagOrders.untagged = [];
      if (!tagOrders.untagged.includes(acc.token)) {
        tagOrders.untagged.push(acc.token);
        needsSave = true;
      }
    } else {
      // 有标签账号
      accTagIds.forEach(tagId => {
        if (!tagOrders[tagId]) tagOrders[tagId] = [];
        if (!tagOrders[tagId].includes(acc.token)) {
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
  });

  window.store = store;

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
  // overlay 点击时关闭所有弹窗
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

  // Enter 键保存
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    // 账号编辑弹窗
    if ($('editForm').classList.contains('open')) {
      saveAccount(store);
    }
    // 标签管理弹窗（添加新标签）
    else if ($('tagManagerModal').classList.contains('open') && e.target.id === 'newTagName') {
      addNewTag(store);
    }
    // 标签编辑弹窗
    else if ($('tagEditModal').classList.contains('open')) {
      saveEditTag(store);
    }
  });

  // ESC 键关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    e.preventDefault();
    e.stopPropagation();

    // 按优先级关闭弹窗
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
  const editIndex = window._editIndex;

  // 编辑模式
  if (editIndex >= 0 && editIndex < accounts.length) {
    if (!email) return showToast("请输入名称");

    const oldTagIds = accounts[editIndex].tagIds || [];
    const newAccounts = [...accounts];
    newAccounts[editIndex].email = email;
    newAccounts[editIndex].tagIds = tagIds;

    await chrome.storage.local.set({ [STORAGE_KEY]: newAccounts });

    // 更新 tagOrders：只处理标签变化（添加/移除的标签）
    const token = accounts[editIndex].token;
    const newTagOrders = { ...tagOrders };

    // 计算标签变化
    const removedTags = oldTagIds.filter(id => !tagIds.includes(id));
    const addedTags = tagIds.filter(id => !oldTagIds.includes(id));
    const wasUntagged = oldTagIds.length === 0;
    const isNowUntagged = tagIds.length === 0;

    // 从移除的标签中删除
    removedTags.forEach(tagId => {
      if (newTagOrders[tagId]) {
        newTagOrders[tagId] = newTagOrders[tagId].filter(t => t !== token);
      }
    });

    // 如果之前是无标签，现在有标签了，从 untagged 移除
    if (wasUntagged && !isNowUntagged && newTagOrders.untagged) {
      newTagOrders.untagged = newTagOrders.untagged.filter(t => t !== token);
    }

    // 添加到新增的标签（末尾）
    addedTags.forEach(tagId => {
      if (!newTagOrders[tagId]) newTagOrders[tagId] = [];
      if (!newTagOrders[tagId].includes(token)) {
        newTagOrders[tagId].push(token);
      }
    });

    // 如果变为无标签
    if (!wasUntagged && isNowUntagged) {
      if (!newTagOrders.untagged) newTagOrders.untagged = [];
      if (!newTagOrders.untagged.includes(token)) {
        newTagOrders.untagged.push(token);
      }
    }

    await chrome.storage.local.set({ [TAG_ORDERS_KEY]: newTagOrders });
    store.setState({ accounts: newAccounts, tagOrders: newTagOrders });

    // 更新筛选栏（无标签状态可能变化）
    renderTagFilterBar(store);

    showToast("已更新");
    toggleModal(false);
    return;
  }

  // 新增模式
  let token = $('inputToken').value.trim();
  if (!email || !token) return showToast("请填写完整");

  const exists = accounts.some(a => a.token === token);
  if (exists) {
    showToast("Token 已存在");
    toggleModal(false);
    return;
  }

  // 获取抓取时临时存储的套餐
  const plan = window._grabPlan || null;
  window._grabPlan = null;

  const newAccount = { email, token, plan, tagIds };
  const newAccounts = [...accounts, newAccount];

  // 更新 tagOrders
  const newTagOrders = { ...tagOrders };

  // 加入 all 排序
  if (!newTagOrders.all) newTagOrders.all = [];
  newTagOrders.all.push(token);

  // 加入标签排序或无标签
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

  // 更新筛选栏
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
    await chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  } else {
    // 没有打开的 ChatGPT 页面，创建新标签页
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
  window.store.setState({ activeToken: "" });
  showToast("已登出，请重新登录");
}

// 切换编辑状态的辅助函数
function toggleEditState(li, isEditing) {
  const nameSpan = li.querySelector('.account-name');
  const nameInput = li.querySelector('.account-name-input');
  const tagsContainer = li.querySelector('.tags-container');
  const tagsInput = li.querySelector('.tags-input');
  const editBtn = li.querySelector('.action-edit');
  const saveBtn = li.querySelector('.action-save');

  if (isEditing) {
    nameSpan.style.display = 'none';
    nameInput.style.display = 'inline-block';
    nameInput.focus();
    nameInput.select();
    if (tagsContainer) tagsContainer.style.display = 'none';
    if (tagsInput) tagsInput.style.display = 'block';
    editBtn.style.display = 'none';
    saveBtn.style.display = 'inline-flex';
  } else {
    nameSpan.style.display = 'inline';
    nameInput.style.display = 'none';
    if (tagsContainer) tagsContainer.style.display = 'flex';
    if (tagsInput) tagsInput.style.display = 'none';
    editBtn.style.display = 'inline-flex';
    saveBtn.style.display = 'none';
  }
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
    // 使用弹窗编辑
    $('inputEmail').value = acc.email || '';
    toggleModal(true, idx, acc.tagIds || []);
  } else if (target.classList.contains('action-delete')) {
    // 显示删除确认弹窗
    showDeleteModal(acc.email, () => {
      const tokenToRemove = acc.token;
      const newAccounts = accounts.filter(a => a.token !== tokenToRemove);

      // 从所有 tagOrders 中移除该 token
      const newTagOrders = {};
      for (const key in tagOrders) {
        newTagOrders[key] = tagOrders[key].filter(t => t !== tokenToRemove);
      }

      chrome.storage.local.set({
        [STORAGE_KEY]: newAccounts,
        [TAG_ORDERS_KEY]: newTagOrders
      }).then(() => {
        store.setState({ accounts: newAccounts, tagOrders: newTagOrders });
        // 更新筛选栏
        renderTagFilterBar(store);
        showToast("已删除");
      });
    });
  }
}

// 显示删除确认弹窗
function showDeleteModal(accountName, onConfirm) {
  const modal = $('deleteModal');
  $('deleteMessage').textContent = `确定要删除「${accountName}」吗？此操作不可撤销。`;
  modal.classList.add('open');

  // 存储回调
  window._deleteConfirmCallback = onConfirm;

  // 绑定事件
  $('cancelDeleteBtn').onclick = () => modal.classList.remove('open');
  $('confirmDeleteBtn').onclick = () => {
    modal.classList.remove('open');
    if (window._deleteConfirmCallback) {
      window._deleteConfirmCallback();
      window._deleteConfirmCallback = null;
    }
  };

  // 点击背景关闭
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.remove('open');
  };
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

function toggleModal(show, editIndex = -1, selectedTagIds = []) {
  const el = $('editForm'), overlay = $('modalOverlay');
  window._editIndex = editIndex; // 存储编辑索引，-1 表示新增模式

  if (show) {
    if (editIndex >= 0) {
      $('modalTitle').textContent = "编辑账号";
      // 编辑模式：隐藏 token 输入行和抓取按钮
      $('inputToken').parentElement.style.display = 'none';
    } else {
      $('modalTitle').textContent = "添加账号";
      $('inputToken').parentElement.style.display = 'flex';
    }
    // 渲染标签选择器
    renderTagSelector(window.store, selectedTagIds);
    el.classList.add('open'); overlay.classList.add('open');
    $('inputEmail').focus();
  } else {
    el.classList.remove('open'); overlay.classList.remove('open');
    $('inputEmail').value = $('inputToken').value = '';
    window._editIndex = -1;
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

// ========== 标签管理系统 ==========

function initTagManager(store) {
  // 标签管理按钮
  $('tagsManageBtn').onclick = () => toggleTagManager(true, store);
  $('closeTagManagerBtn').onclick = () => toggleTagManager(false, store);

  // 添加标签按钮
  $('addTagBtn').onclick = () => addNewTag(store);

  // 颜色选择器
  $('colorPicker').onclick = (e) => {
    if (e.target.classList.contains('color-option')) {
      $('colorPicker').querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
      e.target.classList.add('selected');
    }
  };

  // 编辑弹窗颜色选择器
  $('editColorPicker').onclick = (e) => {
    if (e.target.classList.contains('color-option')) {
      $('editColorPicker').querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
      e.target.classList.add('selected');
    }
  };

  // 编辑弹窗按钮
  $('cancelEditTagBtn').onclick = () => closeTagEditModal();
  $('saveEditTagBtn').onclick = () => saveEditTag(store);

  // 点击编辑弹窗遮罩关闭
  $('tagEditOverlay').onclick = () => closeTagEditModal();

  // 标签列表事件委托
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
      <span class="tag-name">${tag.name}</span>
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

  // 检查重复
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

    // 同时从账号中移除该标签
    const newAccounts = accounts.map(acc => ({
      ...acc,
      tagIds: (acc.tagIds || []).filter(id => id !== tagId)
    }));

    // 从 tagOrders 中移除该标签的排序
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

// 打开标签编辑弹窗
function openTagEditModal(tagId, store) {
  const { tags } = store.getState();
  const tag = tags.find(t => t.id === tagId);
  if (!tag) return;

  window._editingTagId = tagId;

  // 填充当前标签信息
  $('editTagName').value = tag.name;

  // 选中当前颜色
  $('editColorPicker').querySelectorAll('.color-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.color === tag.color);
  });

  // 打开弹窗
  $('tagEditOverlay').classList.add('open');
  $('tagEditModal').classList.add('open');
  $('editTagName').focus();
}

// 关闭标签编辑弹窗
function closeTagEditModal() {
  $('tagEditModal').classList.remove('open');
  $('tagEditOverlay').classList.remove('open');
  window._editingTagId = null;
}

// 保存编辑的标签
function saveEditTag(store) {
  const tagId = window._editingTagId;
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
    closeTagEditModal();
    showToast("标签已更新");
  });
}

// 渲染账号编辑弹窗中的标签选择器
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
        ${tag.name}
      </span>
    `;
  }).join('');

  // 标签选择事件
  container.onclick = (e) => {
    const option = e.target.closest('.tag-option');
    if (option) {
      option.classList.toggle('selected');
    }
  };
}

// 获取当前选中的标签ID列表
function getSelectedTagIds() {
  const selected = $('tagSelector').querySelectorAll('.tag-option.selected');
  return Array.from(selected).map(el => el.dataset.id);
}

// 渲染标签筛选栏
function renderTagFilterBar(store) {
  const { tags, filterTagId, accounts } = store.getState();
  const container = $('tagFilterBar');

  // 检查是否有无标签账号
  const hasUntagged = accounts.some(a => !a.tagIds || a.tagIds.length === 0);

  if ((!tags || tags.length === 0) && !hasUntagged) {
    container.innerHTML = '';
    return;
  }

  // 生成"全部"按钮 + 各标签 + "无标签"
  let html = `<span class="tag-filter-item ${!filterTagId || filterTagId === 'all' ? 'active' : ''}" data-id="all">全部</span>`;

  if (tags && tags.length > 0) {
    html += tags.map(tag => `
      <span class="tag-filter-item ${filterTagId === tag.id ? 'active' : ''}" data-id="${tag.id}">
        <span class="tag-dot" style="background:${tag.color}"></span>
        ${tag.name}
      </span>
    `).join('');
  }

  // 无标签选项
  if (hasUntagged) {
    html += `<span class="tag-filter-item ${filterTagId === 'untagged' ? 'active' : ''}" data-id="untagged">无标签</span>`;
  }

  container.innerHTML = html;

  // 点击事件
  container.onclick = (e) => {
    const item = e.target.closest('.tag-filter-item');
    if (!item) return;

    const tagId = item.dataset.id || 'all';

    // 更新 store
    store.setState({ filterTagId: tagId });

    // 持久化保存
    chrome.storage.local.set({ [FILTER_TAG_KEY]: tagId });

    // 更新 UI
    container.querySelectorAll('.tag-filter-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === tagId);
    });
  };
}