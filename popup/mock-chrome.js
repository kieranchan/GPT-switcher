(() => {
    if (globalThis.chrome?.storage?.local) {
        return;
    }

    const STORAGE_STATE_KEY = 'gpt-switcher-mock-state-v1';
    const COOKIE_NAME = '__Secure-next-auth.session-token';
    const COOKIE_CHUNK_SIZE = 3936;
    const DEFAULT_STATE = {
        storage: {
            accounts: [
                { email: 'Alpha', token: 'tok_alpha_1234567890', plan: 'Free', tagIds: ['tag_work'] },
                {
                    email: 'Beta · team-beta',
                    token: 'tok_beta_1234567890',
                    plan: 'Team',
                    planType: 'team',
                    displayName: 'Beta',
                    loginEmail: 'beta@example.com',
                    workspaceName: 'team-beta',
                    userId: 'user_beta',
                    accountId: 'acct_beta',
                    organizationId: 'org_beta',
                    accountStructure: 'workspace',
                    tagIds: []
                },
                { email: 'Gamma', token: 'tok_gamma_1234567890', plan: 'Team', tagIds: ['tag_backup'] }
            ],
            tags: [
                { id: 'tag_work', name: '工作', color: '#22c55e' },
                { id: 'tag_backup', name: '备用', color: '#3b82f6' }
            ],
            filterTagId: 'all',
            tagOrders: {
                all: ['tok_gamma_1234567890', 'tok_alpha_1234567890', 'tok_beta_1234567890'],
                untagged: ['tok_beta_1234567890'],
                tag_work: ['tok_alpha_1234567890'],
                tag_backup: ['tok_gamma_1234567890']
            },
            user_theme: 'light'
        },
        activeToken: 'tok_beta_1234567890',
        sessionCookieChunks: null,
        profile: {
            name: 'Beta',
            plan: 'Team',
            planType: 'team',
            displayName: 'Beta',
            loginEmail: 'beta@example.com',
            workspaceName: 'team-beta',
            userId: 'user_beta',
            accountId: 'acct_beta',
            organizationId: 'org_beta',
            accountStructure: 'workspace',
            token: 'tok_beta_1234567890'
        },
        hasChatGPTTab: true,
        confirmResult: true,
        clipboard: '',
        lastDownloadAction: null,
        lastTabAction: null,
        lastWindowAction: null,
        lastConfirm: null
    };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    const readState = () => {
        try {
            const saved = localStorage.getItem(STORAGE_STATE_KEY);
            if (!saved) {
                return clone(DEFAULT_STATE);
            }

            return {
                ...clone(DEFAULT_STATE),
                ...JSON.parse(saved)
            };
        } catch {
            return clone(DEFAULT_STATE);
        }
    };

    let state = readState();

    const getSessionTokenChunks = (token) => {
        if (!token) {
            return [];
        }

        if (token.length <= COOKIE_CHUNK_SIZE) {
            return [{ name: COOKIE_NAME, value: token }];
        }

        const chunks = [];
        for (let start = 0; start < token.length; start += COOKIE_CHUNK_SIZE) {
            chunks.push({
                name: `${COOKIE_NAME}.${chunks.length}`,
                value: token.slice(start, start + COOKIE_CHUNK_SIZE)
            });
        }

        return chunks;
    };

    const getMockSessionCookies = (nameFilter) => {
        if (!state.activeToken) {
            return [];
        }

        return getSessionTokenChunks(state.activeToken)
            .flatMap(({ name, value }) => ([
                {
                    name,
                    value,
                    domain: 'chatgpt.com',
                    path: '/',
                    secure: true,
                    httpOnly: false,
                    storeId: '0'
                },
                {
                    name,
                    value,
                    domain: '.chatgpt.com',
                    path: '/',
                    secure: true,
                    httpOnly: true,
                    storeId: '0'
                }
            ]))
            .filter((cookie) => !nameFilter || cookie.name === nameFilter);
    };

    const setMockSessionCookie = (name, value) => {
        if (name === COOKIE_NAME) {
            state.activeToken = value;
            state.sessionCookieChunks = null;
            return;
        }

        if (!name?.startsWith(`${COOKIE_NAME}.`)) {
            return;
        }

        const index = Number.parseInt(name.slice(COOKIE_NAME.length + 1), 10);
        if (!Number.isInteger(index) || index < 0) {
            return;
        }

        const chunks = Array.isArray(state.sessionCookieChunks) ? [...state.sessionCookieChunks] : [];
        chunks[index] = value;
        state.sessionCookieChunks = chunks;
        state.activeToken = chunks.filter((part) => typeof part === 'string').join('');
    };

    const persist = () => {
        localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(state));
    };

    const setState = (patch = {}) => {
        state = {
            ...state,
            ...patch,
            storage: {
                ...state.storage,
                ...(patch.storage || {})
            }
        };
        persist();
        return clone(state);
    };

    const reset = () => {
        state = clone(DEFAULT_STATE);
        persist();
        return clone(state);
    };

    const storageGet = async (keys) => {
        const source = state.storage;
        if (keys == null) {
            return clone(source);
        }

        if (Array.isArray(keys)) {
            return keys.reduce((acc, key) => {
                acc[key] = clone(source[key]);
                return acc;
            }, {});
        }

        if (typeof keys === 'string') {
            return { [keys]: clone(source[keys]) };
        }

        if (typeof keys === 'object') {
            return Object.entries(keys).reduce((acc, [key, fallback]) => {
                acc[key] = source[key] === undefined ? clone(fallback) : clone(source[key]);
                return acc;
            }, {});
        }

        return {};
    };

    const storageSet = async (items) => {
        setState({ storage: items });
    };

    const getChatGPTTabs = () => {
        if (!state.hasChatGPTTab) {
            return [];
        }

        return [{
            id: 101,
            windowId: 1,
            active: true,
            url: 'https://chatgpt.com/'
        }];
    };

    const clipboard = {
        async writeText(text) {
            state.clipboard = text;
            persist();
        }
    };

    if (!navigator.clipboard) {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: clipboard
        });
    }

    globalThis.confirm = (message) => {
        state.lastConfirm = message;
        persist();
        return state.confirmResult;
    };

    globalThis.chrome = {
        storage: {
            local: {
                get: storageGet,
                set: storageSet
            }
        },
        cookies: {
            async get({ name }) {
                return getMockSessionCookies(name)[0] || null;
            },
            async getAll({ name } = {}) {
                return getMockSessionCookies(name);
            },
            async remove() {
                state.activeToken = '';
                state.sessionCookieChunks = null;
                persist();
            },
            async set({ name, value }) {
                setMockSessionCookie(name, value);
                persist();
                return { name, value };
            }
        },
        tabs: {
            async query(queryInfo = {}) {
                const tabs = getChatGPTTabs();
                if (!queryInfo.url) {
                    return tabs;
                }

                return tabs.filter((tab) => tab.url.includes('chatgpt.com'));
            },
            async reload(tabId) {
                state.lastTabAction = { type: 'reload', tabId };
                persist();
            },
            async update(tabId, updateProperties) {
                state.lastTabAction = { type: 'update', tabId, updateProperties };
                persist();
                return {
                    id: tabId,
                    windowId: 1,
                    ...updateProperties
                };
            },
            async create(createProperties) {
                state.lastTabAction = { type: 'create', createProperties };
                persist();
                return {
                    id: 102,
                    windowId: 1,
                    ...createProperties
                };
            }
        },
        downloads: {
            async download(options) {
                state.lastDownloadAction = {
                    ...options,
                    id: 1
                };
                persist();
                return 1;
            }
        },
        windows: {
            async update(windowId, updateInfo) {
                state.lastWindowAction = { windowId, updateInfo };
                persist();
            }
        },
        scripting: {
            async executeScript() {
                return [{
                    result: clone(state.profile)
                }];
            }
        }
    };

    globalThis.__GPT_SWITCHER_MOCK__ = {
        getState: () => clone(state),
        setState,
        reset
    };

    persist();
})();
