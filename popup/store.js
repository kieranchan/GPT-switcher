/**
 * GPT-Switcher Store Module
 * 状态管理、安全函数和工具函数
 */

// --- 模块私有变量 ---
let _store = null;
let _grabPlan = null;
let _editIndex = -1;
let _editingTagId = null;
let _deleteConfirmCallback = null;

// --- 模块变量访问器 ---
export function setStore(store) { _store = store; }
export function getStore() { return _store; }

export function setGrabPlan(plan) { _grabPlan = plan; }
export function getGrabPlan() { return _grabPlan; }

export function setEditIndex(index) { _editIndex = index; }
export function getEditIndex() { return _editIndex; }

export function setEditingTagId(id) { _editingTagId = id; }
export function getEditingTagId() { return _editingTagId; }

export function setDeleteConfirmCallback(cb) { _deleteConfirmCallback = cb; }
export function getDeleteConfirmCallback() { return _deleteConfirmCallback; }

// --- 状态管理 ---
export function createStore(initialState = {}) {
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

// --- 安全工具函数 ---

// HTML 转义 - 防止 XSS 攻击
export function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>&"']/g, c => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;'
    })[c]);
}

// 验证账号数据结构
export function validateAccount(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.token !== 'string' || obj.token.length < 10) return false;
    if (typeof obj.email !== 'string') return false;
    if (obj.tagIds && !Array.isArray(obj.tagIds)) return false;
    return true;
}

// --- 性能优化函数 ---

// O(1) 账号查找 Map
export function createAccountMap(accounts) {
    const map = new Map();
    accounts.forEach(acc => map.set(acc.token, acc));
    return map;
}

// O(1) 标签查找 Map
export function createTagMap(tags) {
    const map = new Map();
    tags.forEach(tag => map.set(tag.id, tag));
    return map;
}

// 记忆化函数
export function memoize(fn) {
    let lastArgs = null;
    let lastResult = null;
    return (...args) => {
        if (lastArgs && args.length === lastArgs.length &&
            args.every((arg, i) => arg === lastArgs[i])) {
            return lastResult;
        }
        lastArgs = args;
        lastResult = fn(...args);
        return lastResult;
    };
}

// 错误边界包装器
export function trySafe(fn, fallback = null) {
    return (...args) => {
        try {
            return fn(...args);
        } catch (e) {
            console.error('[trySafe]', e);
            return typeof fallback === 'function' ? fallback(...args) : fallback;
        }
    };
}
