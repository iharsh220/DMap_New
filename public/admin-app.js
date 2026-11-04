/* =====================================================================
   D-Map admin UI (no framework, no jQuery).
   window.DMap provides:
     shell(opts)          sidebar + top bar + page header; returns the content element
     api(path, opts)      fetch with the access token (401 -> login), JSON in/out
     grid(el, config)     server-side data grid: KPIs, status breakdown, quick filters,
                          filter panel, chips, column picker, density, sort, paging,
                          detail drawer, export of all filtered rows, URL state
     modal / drawer / confirm / toast, form controls, charts (line, bars)
   Every value from the API is inserted with esc() or textContent: the data is
   user-entered text and the admin token lives in localStorage.
   ===================================================================== */
(function () {
    'use strict';

    const D = (window.DMap = {});

    // ------------------------------------------------------------------
    // basics
    // ------------------------------------------------------------------
    const API_BASE = (() => {
        const p = window.location.pathname;
        const i = p.indexOf('/datatable/admin/');
        if (i > -1) return p.slice(0, i) + '/';
        return p.indexOf('/digilabs/uat/') !== -1 ? '/digilabs/uat/dmap/api/' : '/digilabs/dmap/api/';
    })();
    const ADMIN = API_BASE + 'datatable/admin/';
    D.apiBase = API_BASE;
    D.adminBase = ADMIN;
    D.pageUrl = page => ADMIN + page;

    const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = v => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, c => ESC[c]));
    D.esc = esc;

    const store = {
        get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
        set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
        raw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    };
    D.store = store;

    const token = () => store.raw('accessToken');
    const user = () => { try { return JSON.parse(store.raw('userData') || 'null'); } catch (e) { return null; } };
    D.user = user;
    D.isAdmin = () => { const u = user(); return !!(u && u.jobRole && u.jobRole.id === 1); };

    function clearSession() {
        try { ['accessToken', 'refreshToken', 'userData'].forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    }
    function toLogin() { window.location.href = ADMIN + 'login'; }
    D.logout = () => { clearSession(); toLogin(); };

    const nf = new Intl.NumberFormat('en-IN');
    const fmt = {
        num: v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? '—' : nf.format(Number(v))),
        compact: v => {
            const n = Number(v || 0);
            if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr';
            if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(1).replace(/\.0$/, '') + 'L';
            if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
            return nf.format(n);
        },
        money: v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? '—' : '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(v))),
        pct: (part, whole) => (whole ? (Math.round((part / whole) * 1000) / 10) + '%' : '—'),
        date: v => {
            const d = parseDate(v);
            return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
        },
        datetime: v => {
            const d = parseDate(v);
            if (!d) return null;
            const hasTime = /\d{2}:\d{2}/.test(String(v));
            return hasTime
                ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        },
        tat: v => {
            const m = String(v || '').match(/^\s*(\d+(?:\.\d+)?)\s*h\s*(\d+(?:\.\d+)?)?\s*m?/i);
            if (!m) return null;
            const h = Math.floor(Number(m[1]));
            const min = Math.round(Number(m[2] || 0));
            if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
            return `${h}h ${min}m`;
        },
        hours: v => (v === null || v === undefined ? '—' : (Number(v) >= 24 ? (Math.round(Number(v) / 24 * 10) / 10) + ' d' : (Math.round(Number(v) * 10) / 10) + ' h')),
        label: v => String(v || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
    };
    D.fmt = fmt;

    function parseDate(v) {
        if (!v || v === 'N/A') return null;
        const s = String(v).trim();
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        return isNaN(d.getTime()) ? null : d;
    }
    const isEmpty = v => v === null || v === undefined || v === '' || v === 'N/A' || v === '00' || v === '-';
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    D.isoDay = isoDay;
    D.debounce = debounce;

    // ------------------------------------------------------------------
    // API
    // ------------------------------------------------------------------
    async function api(path, opts = {}) {
        const headers = Object.assign({}, opts.headers || {});
        const t = token();
        if (t) headers.Authorization = 'Bearer ' + t;
        let body = opts.body;
        if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }
        const url = /^(https?:)?\//.test(path) ? path : ADMIN + path;
        const res = await fetch(url, { method: opts.method || 'GET', headers, body, signal: opts.signal });
        let data = null;
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        const error = data && (data.error || data.message);
        if (res.status === 401 || (res.status === 403 && error === 'Invalid or expired token')) {
            clearSession();
            toLogin();
            throw Object.assign(new Error('Session expired'), { status: res.status });
        }
        if (!res.ok || (data && data.success === false)) {
            throw Object.assign(new Error(error || `Request failed (${res.status})`), { status: res.status, data });
        }
        return data;
    }
    D.api = api;

    let filterOptionsPromise = null;
    D.filterOptions = () => {
        if (!filterOptionsPromise) {
            filterOptionsPromise = api('filter-options').then(r => r.data || {}).catch(() => { filterOptionsPromise = null; return {}; });
        }
        return filterOptionsPromise;
    };

    // ------------------------------------------------------------------
    // theme
    // ------------------------------------------------------------------
    D.theme = () => document.documentElement.getAttribute('data-theme') || 'light';
    D.setTheme = theme => {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('themePreference', theme); } catch (e) { /* ignore */ }
        document.querySelectorAll('[data-theme-icon]').forEach(i => { i.className = 'bi ' + (theme === 'dark' ? 'bi-sun' : 'bi-moon-stars'); });
        window.dispatchEvent(new CustomEvent('dm:theme'));
    };
    D.toggleTheme = () => D.setTheme(D.theme() === 'dark' ? 'light' : 'dark');

    // ------------------------------------------------------------------
    // status vocabulary (labels + pill tones + chart slots)
    // ------------------------------------------------------------------
    const STATUS = {
        draft: ['Draft', 'neutral'],
        pending: ['Pending', 'warning'],
        accepted: ['Accepted', 'accent'],
        assigned: ['Assigned', 'accent'],
        in_progress: ['In progress', 'info'],
        completed: ['Completed', 'success'],
        rejected: ['Rejected', 'danger'],
        deferred: ['Deferred', 'neutral'],
        cancelled: ['Cancelled', 'danger'],
        m_pending: ['Pending (manager)', 'warning'],
        u_pending: ['Pending (user)', 'warning'],
        m_accepted: ['Accepted (manager)', 'accent'],
        u_accepted: ['Accepted (user)', 'accent'],
        on_hold: ['On hold', 'neutral'],
        approved: ['Approved', 'success'],
        change_request: ['Change request', 'warning'],
        not_started: ['Not started', 'neutral'],
        manager_review: ['Manager review', 'info'],
        pm_review: ['PM review', 'accent'],
        change_requested: ['Change requested', 'warning'],
        final_approved: ['Final approved', 'success'],
        low: ['Low', 'neutral'],
        medium: ['Medium', 'info'],
        high: ['High', 'warning'],
        critical: ['Critical', 'danger'],
        Planned: ['Planned', 'success'],
        Unplanned: ['Unplanned', 'warning'],
        Inform: ['Informed', 'success'],
        'Not Inform': ['Not informed', 'danger']
    };
    // Fixed chart slot per status (categorical palette order; validated adjacent pairs).
    // Segments are always drawn in slot order; rejected folds into cancelled's slot.
    const STATUS_SLOT = {
        in_progress: 1, pending: 2, m_pending: 2, completed: 3, accepted: 4, u_pending: 4,
        assigned: 5, m_accepted: 5, deferred: 6, u_accepted: 6, draft: 7, on_hold: 7, cancelled: 8, rejected: 8
    };
    D.statusLabel = s => (STATUS[s] ? STATUS[s][0] : fmt.label(s));
    D.statusTone = s => (STATUS[s] ? STATUS[s][1] : 'neutral');
    D.statusSlot = s => STATUS_SLOT[s] || 7;
    D.pill = (value, label) => `<span class="dm-pill tone-${D.statusTone(value)}">${esc(label || D.statusLabel(value))}</span>`;

    // ------------------------------------------------------------------
    // shell
    // ------------------------------------------------------------------
    const NAV = [
        { section: 'Insights', items: [
            { page: 'overview', label: 'Overview', icon: 'grid-1x2' },
            { page: 'powerbi', label: 'Power BI', icon: 'bar-chart-line' }
        ] },
        { section: 'Work', items: [
            { page: 'clients', label: 'Client requests', icon: 'people' },
            { page: 'projectsdetails', label: 'Projects', icon: 'folder2-open' },
            { page: 'taskdetails', label: 'Tasks', icon: 'check2-square' },
            { page: 'issuedetails', label: 'Changes', icon: 'arrow-repeat' },
            { page: 'workrequesttasks', label: 'Raw data', icon: 'table', adminOnly: true }
        ] },
        // Weekly report (one page, its tabs as nav items): Super Admin and the Digilabs department's
        // Creative Managers (the API checks it too)
        { section: 'Report', items: [
            { page: 'reports', hash: 'client', label: 'Client work', icon: 'briefcase', reportsOnly: true },
            { page: 'reports', hash: 'init', label: 'Initiatives', icon: 'lightbulb', reportsOnly: true },
            { page: 'reports', hash: 'extra', label: 'Highlight & notes', icon: 'stars', reportsOnly: true },
            { page: 'reports', hash: 'settings', label: 'History & settings', icon: 'clock-history', reportsOnly: true }
        ] },
        // Manage pages (and Raw data above) are for the super admin only (their APIs are role-checked too)
        { section: 'Manage', adminOnly: true, items: [
            { page: 'feedback', label: 'Feedback', icon: 'chat-square-heart' },
            { page: 'leaves', label: 'Leaves', icon: 'calendar2-week' },
            { page: 'master-card', label: 'Rate card', icon: 'credit-card-2-front' }
        ] }
    ];

    const ADMIN_ONLY_PAGES = NAV.flatMap(g => g.items.filter(i => g.adminOnly || i.adminOnly).map(i => i.page));
    const REPORT_PAGES = NAV.flatMap(g => g.items.filter(i => i.reportsOnly).map(i => i.page));
    D.isDigilabsManager = () => {
        const u = user();
        return !!(u && u.jobRole && u.jobRole.id === 2 && u.department && u.department.department_name === 'Digilabs');
    };
    D.canOpenPage = page => D.isAdmin()
        || (REPORT_PAGES.includes(page) ? D.isDigilabsManager() : !ADMIN_ONLY_PAGES.includes(page));

    D.shell = function (opts) {
        if (!token()) { toLogin(); throw new Error('Not signed in'); }
        if (!D.canOpenPage(opts.page)) { window.location.replace(ADMIN + 'overview'); throw new Error('Admins only'); }
        const nav = NAV.filter(g => !g.adminOnly || D.isAdmin())
            .map(g => Object.assign({}, g, { items: g.items.filter(i => D.canOpenPage(i.page)) }))
            .filter(g => g.items.length);
        // items with a hash are tabs of one page (the weekly report): active when that tab is open
        const navActive = item => item.page === opts.page && (!item.hash || item.hash === opts.tab);
        const u = user() || {};
        const name = u.name || u.email || 'Admin';
        const initials = name.split(/\s+/).filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
        const role = (u.jobRole && u.jobRole.role_title) || 'Administrator';
        if (store.get('dmSidebarCollapsed', false)) document.body.classList.add('dm-collapsed');

        document.title = `${opts.title} · D-Map Admin`;
        document.body.innerHTML = `
<div class="dm-app">
  <aside class="dm-sidebar" aria-label="Main navigation">
    <div class="dm-brand">
      <div class="dm-brand-mark">D</div>
      <div class="dm-brand-text"><div class="dm-brand-name">D-Map</div><div class="dm-brand-sub">Digilabs admin</div></div>
    </div>
    <nav class="dm-nav">
      ${nav.map(group => `
        <div class="dm-nav-section">${esc(group.section)}</div>
        ${group.items.map(item => `
          <a class="dm-nav-item${navActive(item) ? ' is-active' : ''}" href="${esc(ADMIN + item.page + (item.hash ? '#' + item.hash : ''))}" data-nav-hash="${esc(item.hash || '')}" title="${esc(item.label)}"${navActive(item) ? ' aria-current="page"' : ''}>
            <i class="bi bi-${item.icon}"></i><span class="dm-nav-label">${esc(item.label)}</span>
          </a>`).join('')}`).join('')}
    </nav>
    <div class="dm-sidebar-foot"><span class="dm-dot-live"></span><span class="dm-foot-text">All systems operational</span></div>
  </aside>
  <div class="dm-backdrop" data-close-nav></div>
  <div class="dm-main">
    <header class="dm-topbar">
      <button class="dm-icon-btn" data-toggle-nav aria-label="Toggle navigation"><i class="bi bi-layout-sidebar"></i></button>
      <div class="dm-crumbs"><span>D-Map</span><i class="bi bi-chevron-right" style="font-size:11px"></i><strong>${esc(opts.title)}</strong></div>
      <div class="dm-topbar-spacer"></div>
      <button class="dm-icon-btn" data-toggle-theme aria-label="Toggle theme" title="Toggle light / dark"><i data-theme-icon class="bi ${D.theme() === 'dark' ? 'bi-sun' : 'bi-moon-stars'}"></i></button>
      <button class="dm-user" data-user-menu aria-haspopup="menu">
        <span class="dm-avatar">${esc(initials || 'A')}</span>
        <span class="dm-user-meta" style="text-align:left"><div class="dm-user-name">${esc(name)}</div><div class="dm-user-role">${esc(role)}</div></span>
        <i class="bi bi-chevron-down" style="font-size:11px;color:var(--text-3)"></i>
      </button>
    </header>
    <main class="dm-content">
      <div class="dm-page-head">
        <div>
          <h1 class="dm-page-title"><i class="bi bi-${esc(opts.icon || 'grid')}"></i>${esc(opts.title)}</h1>
          ${opts.subtitle ? `<p class="dm-page-sub">${esc(opts.subtitle)}</p>` : ''}
        </div>
        <div class="dm-page-actions" data-page-actions></div>
      </div>
      <div data-page-body></div>
    </main>
  </div>
</div>
<div class="dm-toasts" aria-live="polite"></div>`;

        const isMobile = () => window.matchMedia('(max-width: 960px)').matches;
        document.querySelector('[data-toggle-nav]').addEventListener('click', () => {
            if (isMobile()) { document.body.classList.toggle('dm-nav-open'); return; }
            const collapsed = document.body.classList.toggle('dm-collapsed');
            store.set('dmSidebarCollapsed', collapsed);
        });
        document.querySelector('[data-close-nav]').addEventListener('click', () => document.body.classList.remove('dm-nav-open'));
        document.querySelector('[data-toggle-theme]').addEventListener('click', D.toggleTheme);
        document.querySelector('[data-user-menu]').addEventListener('click', e => {
            D.menu(e.currentTarget, [
                { icon: 'person-badge', label: `${name} · ${role}`, disabled: true },
                { icon: D.theme() === 'dark' ? 'sun' : 'moon-stars', label: D.theme() === 'dark' ? 'Light theme' : 'Dark theme', onClick: D.toggleTheme },
                { icon: 'box-arrow-right', label: 'Sign out', onClick: async () => {
                    if (await D.confirm({ title: 'Sign out?', message: 'You will need to sign in again to use the admin panel.', confirmLabel: 'Sign out', icon: 'box-arrow-right' })) D.logout();
                } }
            ], { align: 'right' });
        });

        const actions = document.querySelector('[data-page-actions]');
        (opts.actions || []).forEach(a => actions.appendChild(D.button(a)));
        return document.querySelector('[data-page-body]');
    };

    // Marks the nav item of the open tab (pages whose tabs are nav items, see NAV hash)
    D.setNavTab = function (tab) {
        document.querySelectorAll('.dm-nav-item[data-nav-hash]').forEach(el => {
            if (!el.dataset.navHash) return;
            const on = el.dataset.navHash === tab;
            el.classList.toggle('is-active', on);
            if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
        });
        document.body.classList.remove('dm-nav-open');
    };

    D.button = function (a) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dm-btn' + (a.variant ? ' dm-btn-' + a.variant : '') + (a.small ? ' dm-btn-sm' : '');
        b.innerHTML = (a.icon ? `<i class="bi bi-${esc(a.icon)}"></i>` : '') + `<span>${esc(a.label)}</span>`;
        if (a.title) b.title = a.title;
        if (a.onClick) b.addEventListener('click', e => a.onClick(e, b));
        return b;
    };

    D.setBusy = function (btn, busy, label) {
        if (!btn) return;
        if (busy) {
            btn.dataset.html = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<i class="bi bi-arrow-repeat dm-spin"></i><span>${esc(label || 'Working…')}</span>`;
        } else {
            btn.disabled = false;
            if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
        }
    };

    // ------------------------------------------------------------------
    // toasts, popovers, menus
    // ------------------------------------------------------------------
    D.toast = function (message, tone = 'success', ms = 3800) {
        let host = document.querySelector('.dm-toasts');
        if (!host) { host = document.createElement('div'); host.className = 'dm-toasts'; document.body.appendChild(host); }
        const icon = { success: 'check-circle-fill', danger: 'exclamation-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' }[tone] || 'info-circle-fill';
        const el = document.createElement('div');
        el.className = 'dm-toast tone-' + tone;
        el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
        el.innerHTML = `<i class="bi bi-${icon}"></i><div></div>`;
        el.lastChild.textContent = message;
        host.appendChild(el);
        setTimeout(() => el.remove(), ms);
    };

    let openPopover = null;
    function closePopover() {
        if (openPopover) { const p = openPopover; openPopover = null; p.el.remove(); if (p.onClose) p.onClose(); }
    }
    D.closePopover = closePopover;
    D.popover = function (anchor, content, opts = {}) {
        closePopover();
        const el = document.createElement('div');
        el.className = 'dm-popover';
        if (opts.width) el.style.width = opts.width + 'px';
        if (typeof content === 'string') el.innerHTML = content; else el.appendChild(content);
        el.style.maxHeight = (window.innerHeight - 16) + 'px';
        el.style.overflowY = 'auto';
        document.body.appendChild(el);
        const r = anchor.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight;
        let left = opts.align === 'right' ? r.right - w : r.left;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = r.bottom + 6;
        if (top + h > window.innerHeight - 8) {
            // above the anchor if it fits there, otherwise pinned to the bottom of the viewport
            top = r.top - h - 6 > 8 ? r.top - h - 6 : window.innerHeight - h - 8;
        }
        el.style.left = left + 'px';
        el.style.top = Math.max(8, top) + 'px';
        openPopover = { el, anchor, onClose: opts.onClose };
        const first = el.querySelector('input, button');
        if (first && opts.focus !== false) setTimeout(() => first.focus(), 0);
        return { el, close: closePopover };
    };
    document.addEventListener('mousedown', e => {
        if (openPopover && !openPopover.el.contains(e.target) && !openPopover.anchor.contains(e.target)) closePopover();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && openPopover) { const a = openPopover.anchor; closePopover(); a.focus(); } });
    window.addEventListener('resize', () => closePopover());

    D.menu = function (anchor, items, opts = {}) {
        const box = document.createElement('div');
        box.setAttribute('role', 'menu');
        items.forEach(item => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'dm-menu-item';
            b.setAttribute('role', 'menuitem');
            b.innerHTML = `<i class="bi bi-${esc(item.icon || 'dot')}"></i><span></span>`;
            b.lastChild.textContent = item.label;
            if (item.disabled) { b.disabled = true; b.style.cursor = 'default'; b.style.color = 'var(--text-3)'; }
            b.addEventListener('click', () => { closePopover(); if (item.onClick) item.onClick(); });
            box.appendChild(b);
        });
        return D.popover(anchor, box, opts);
    };

    // ------------------------------------------------------------------
    // modal / drawer / confirm
    // ------------------------------------------------------------------
    function layer(kind, opts) {
        const root = document.createElement('div');
        root.className = 'dm-layer';
        root.innerHTML = `<div class="dm-layer-backdrop"></div>
<div class="${kind === 'drawer' ? 'dm-drawer' : 'dm-modal'} ${esc(opts.size ? 'is-' + opts.size : '')}" role="dialog" aria-modal="true">
  <div class="dm-dialog-head">
    ${opts.icon ? `<div class="dm-dialog-icon tone-${esc(opts.tone || 'brand')}"><i class="bi bi-${esc(opts.icon)}"></i></div>` : ''}
    <div style="min-width:0"><h3 class="dm-dialog-title"></h3>${opts.subtitle ? '<p class="dm-dialog-sub"></p>' : ''}</div>
    <button class="dm-icon-btn" data-close aria-label="Close"><i class="bi bi-x-lg"></i></button>
  </div>
  <div class="dm-dialog-body"></div>
  <div class="dm-dialog-foot"></div>
</div>`;
        root.querySelector('.dm-dialog-title').textContent = opts.title || '';
        if (opts.subtitle) root.querySelector('.dm-dialog-sub').textContent = opts.subtitle;
        const body = root.querySelector('.dm-dialog-body');
        if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
        const foot = root.querySelector('.dm-dialog-foot');
        const buttons = {};
        (opts.actions || []).forEach(a => {
            const b = D.button(Object.assign({}, a, { onClick: null }));
            if (a.left) b.classList.add('left');
            b.addEventListener('click', () => (a.onClick ? a.onClick(api_, b) : close()));
            foot.appendChild(b);
            if (a.id) buttons[a.id] = b;
        });
        if (!opts.actions || !opts.actions.length) foot.remove();
        const previous = document.activeElement;
        let closed = false;
        function close(result) {
            if (closed) return;
            closed = true;
            root.remove();
            document.removeEventListener('keydown', onKey);
            if (previous && previous.focus) previous.focus();
            if (opts.onClose) opts.onClose(result);
        }
        function onKey(e) {
            if (e.key === 'Escape' && !openPopover) close();
            if (e.key === 'Tab') {
                const f = [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(x => x.offsetParent !== null);
                if (!f.length) return;
                if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
                else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
            }
        }
        root.querySelector('[data-close]').addEventListener('click', () => close());
        root.querySelector('.dm-layer-backdrop').addEventListener('click', () => close());
        document.addEventListener('keydown', onKey);
        document.body.appendChild(root);
        const focusable = body.querySelector('input:not([readonly]):not([type=hidden]), select, textarea') || root.querySelector('[data-close]');
        setTimeout(() => focusable && focusable.focus(), 30);
        const api_ = { root, body, foot, buttons, close };
        return api_;
    }
    D.modal = opts => layer('modal', opts);
    D.drawer = opts => layer('drawer', opts);
    D.confirm = opts => new Promise(resolve => {
        let answered = false;
        const m = D.modal({
            title: opts.title, size: 'sm', icon: opts.icon || 'question-circle', tone: opts.tone || 'brand',
            body: `<p style="margin:0;color:var(--text-2)">${esc(opts.message || '')}</p>`,
            onClose: () => { if (!answered) resolve(false); },
            actions: [
                { label: 'Cancel' },
                { label: opts.confirmLabel || 'Confirm', variant: opts.tone === 'danger' ? 'danger' : 'primary', onClick: (dlg) => { answered = true; resolve(true); dlg.close(); } }
            ]
        });
        return m;
    });

    // ------------------------------------------------------------------
    // form controls
    // ------------------------------------------------------------------
    /**
     * Multi- (or single-) select dropdown with search. options: [value] or [{value,label,count}].
     * Returns { el, get(), set(values) }.
     */
    D.multiSelect = function (opts) {
        let values = (opts.values || []).map(String);
        let options = [];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dm-dd-btn' + (opts.block ? ' is-block' : '');
        const norm = list => (list || []).map(o => (typeof o === 'object' ? { value: String(o.value), label: o.label || String(o.value), count: o.count } : { value: String(o), label: opts.labeler ? opts.labeler(o) : String(o) }));
        const ready = Promise.resolve(typeof opts.options === 'function' ? opts.options() : opts.options).then(list => { options = norm(list); render(); });
        function summary() {
            if (!values.length) return null;
            const labels = values.map(v => (options.find(o => o.value === v) || { label: opts.labeler ? opts.labeler(v) : v }).label);
            return labels.length <= 2 ? labels.join(', ') : `${labels[0]} +${labels.length - 1}`;
        }
        function render() {
            const s = summary();
            btn.classList.toggle('has-value', !!s);
            btn.innerHTML = `${opts.block ? '' : `<i class="bi bi-${esc(opts.icon || (s ? 'funnel-fill' : 'plus-circle'))}"></i>`}<span>${esc(opts.placeholder || 'Select')}${s && !opts.block ? ':' : ''}</span>${s ? `<span class="v">${esc(s)}</span>` : ''}${opts.block ? '<i class="bi bi-chevron-down"></i>' : ''}`;
            if (opts.block && s) btn.firstChild.remove();
        }
        btn.addEventListener('click', () => {
            const box = document.createElement('div');
            const search = options.length > 8 ? '<input class="dm-input" placeholder="Search…" aria-label="Search options">' : '';
            box.innerHTML = `${search}<div class="dm-opt-list" role="listbox" aria-multiselectable="${opts.single ? 'false' : 'true'}"></div>
<div class="dm-pop-foot"><button type="button" class="dm-btn dm-btn-ghost dm-btn-sm" data-clear>Clear</button>${opts.single ? '' : '<button type="button" class="dm-btn dm-btn-primary dm-btn-sm" data-apply>Apply</button>'}</div>`;
            const list = box.querySelector('.dm-opt-list');
            let draft = values.slice();
            const draw = (q = '') => {
                const ql = q.toLowerCase();
                const shown = options.filter(o => !ql || o.label.toLowerCase().includes(ql));
                list.innerHTML = shown.length ? '' : '<div class="dm-help" style="padding:8px">No matches</div>';
                shown.slice(0, 300).forEach(o => {
                    const row = document.createElement('label');
                    row.className = 'dm-opt';
                    row.innerHTML = `<input type="${opts.single ? 'radio' : 'checkbox'}" name="dmopt"><span></span>${o.count !== undefined ? `<span class="c">${esc(fmt.num(o.count))}</span>` : ''}`;
                    row.children[1].textContent = o.label;
                    const input = row.firstChild;
                    input.checked = draft.includes(o.value);
                    input.addEventListener('change', () => {
                        if (opts.single) { values = [o.value]; render(); closePopover(); opts.onChange && opts.onChange(values.slice()); return; }
                        draft = input.checked ? draft.concat(o.value) : draft.filter(v => v !== o.value);
                    });
                    list.appendChild(row);
                });
            };
            draw();
            const q = box.querySelector('input.dm-input');
            if (q) q.addEventListener('input', () => draw(q.value));
            box.querySelector('[data-clear]').addEventListener('click', () => { values = []; render(); closePopover(); opts.onChange && opts.onChange([]); });
            const apply = box.querySelector('[data-apply]');
            if (apply) apply.addEventListener('click', () => { values = draft.slice(); render(); closePopover(); opts.onChange && opts.onChange(values.slice()); });
            D.popover(btn, box, { width: 280 });
        });
        render();
        return { el: btn, ready, get: () => values.slice(), set: v => { values = (v || []).map(String); render(); } };
    };

    const DATE_PRESETS = () => {
        const t = new Date();
        const today = isoDay(t);
        const ago = n => { const d = new Date(t); d.setDate(d.getDate() - n); return isoDay(d); };
        const fyStart = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
        return [
            { label: 'Last 7 days', from: ago(6), to: today },
            { label: 'Last 30 days', from: ago(29), to: today },
            { label: 'Last 90 days', from: ago(89), to: today },
            { label: 'This month', from: isoDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: today },
            { label: 'This FY', from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` },
            { label: 'Last FY', from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` }
        ];
    };
    D.datePresets = DATE_PRESETS;

    /** Range picker. kind: 'date' | 'number' | 'tat'. Returns { el, get(), set() }. */
    D.rangeInput = function (opts) {
        let value = { from: (opts.value && opts.value.from) || '', to: (opts.value && opts.value.to) || '' };
        const kind = opts.kind || 'date';
        const type = kind === 'date' ? 'date' : 'number';
        const unit = kind === 'tat' ? ' h' : '';
        if (!opts.button) {
            const wrap = document.createElement('div');
            wrap.className = 'dm-range';
            wrap.innerHTML = `<input class="dm-input dm-input-sm" type="${type}" aria-label="From" placeholder="${kind === 'date' ? '' : 'Min' + unit}"><span>to</span><input class="dm-input dm-input-sm" type="${type}" aria-label="To" placeholder="${kind === 'date' ? '' : 'Max' + unit}">`;
            const [a, b] = wrap.querySelectorAll('input');
            a.value = value.from; b.value = value.to;
            const fire = () => { value = { from: a.value, to: b.value }; opts.onChange && opts.onChange(Object.assign({}, value)); };
            a.addEventListener('change', fire); b.addEventListener('change', fire);
            if (kind === 'date') {
                const presets = document.createElement('div');
                presets.className = 'dm-presets';
                presets.style.gridColumn = '1 / -1';
                DATE_PRESETS().forEach(p => {
                    const pb = document.createElement('button');
                    pb.type = 'button';
                    pb.textContent = p.label;
                    pb.addEventListener('click', () => { a.value = p.from; b.value = p.to; fire(); });
                    presets.appendChild(pb);
                });
                wrap.appendChild(presets);
            }
            return { el: wrap, get: () => Object.assign({}, value), set: v => { value = { from: (v && v.from) || '', to: (v && v.to) || '' }; a.value = value.from; b.value = value.to; } };
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dm-dd-btn';
        const describe = () => {
            if (!value.from && !value.to) return null;
            const f = v => (kind === 'date' ? fmt.date(v) : v + unit);
            if (value.from && value.to) return `${f(value.from)} – ${f(value.to)}`;
            return value.from ? `from ${f(value.from)}` : `until ${f(value.to)}`;
        };
        const render = () => {
            const s = describe();
            btn.classList.toggle('has-value', !!s);
            btn.innerHTML = `<i class="bi bi-${kind === 'date' ? 'calendar3' : 'sliders'}"></i><span>${esc(opts.placeholder)}${s ? ':' : ''}</span>${s ? `<span class="v">${esc(s)}</span>` : ''}`;
        };
        btn.addEventListener('click', () => {
            const box = document.createElement('div');
            const inner = D.rangeInput({ kind, value });
            box.appendChild(inner.el);
            const foot = document.createElement('div');
            foot.className = 'dm-pop-foot';
            foot.innerHTML = '<button type="button" class="dm-btn dm-btn-ghost dm-btn-sm" data-clear>Clear</button><button type="button" class="dm-btn dm-btn-primary dm-btn-sm" data-apply>Apply</button>';
            box.appendChild(foot);
            foot.querySelector('[data-clear]').addEventListener('click', () => { value = { from: '', to: '' }; render(); closePopover(); opts.onChange && opts.onChange(Object.assign({}, value)); });
            foot.querySelector('[data-apply]').addEventListener('click', () => { value = inner.get(); render(); closePopover(); opts.onChange && opts.onChange(Object.assign({}, value)); });
            box.querySelectorAll('.dm-presets button').forEach(pb => pb.addEventListener('click', () => { value = inner.get(); render(); closePopover(); opts.onChange && opts.onChange(Object.assign({}, value)); }));
            D.popover(btn, box, { width: 300 });
        });
        render();
        return { el: btn, get: () => Object.assign({}, value), set: v => { value = { from: (v && v.from) || '', to: (v && v.to) || '' }; render(); } };
    };

    /**
     * Simple form builder. fields: [{name,label,type,value,options,readonly,required,span,help,step,min,max}]
     * type: text|number|date|datetime-local|select|textarea|readonly. Values are set via DOM
     * properties (never HTML), and read back with values().
     */
    D.form = function (fields) {
        const el = document.createElement('div');
        el.className = 'dm-form-grid';
        const inputs = {};
        fields.forEach(f => {
            const wrap = document.createElement('div');
            wrap.className = 'dm-field' + (f.span === 2 || f.type === 'textarea' ? ' span-2' : '');
            const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 7);
            const label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = f.label;
            if (f.required) { const r = document.createElement('span'); r.className = 'req'; r.textContent = ' *'; label.appendChild(r); }
            wrap.appendChild(label);
            let input;
            if (f.type === 'select') {
                input = document.createElement('select');
                input.className = 'dm-select';
                (f.options || []).forEach(o => {
                    const opt = document.createElement('option');
                    opt.value = typeof o === 'object' ? o.value : o;
                    opt.textContent = typeof o === 'object' ? o.label : (f.labeler ? f.labeler(o) : o);
                    input.appendChild(opt);
                });
            } else if (f.type === 'textarea') {
                input = document.createElement('textarea');
                input.className = 'dm-textarea';
                input.rows = f.rows || 3;
            } else {
                input = document.createElement('input');
                input.className = 'dm-input';
                input.type = f.type === 'readonly' ? 'text' : (f.type || 'text');
                if (f.step) input.step = f.step;
                if (f.min !== undefined) input.min = f.min;
                if (f.max !== undefined) input.max = f.max;
                if (f.placeholder) input.placeholder = f.placeholder;
            }
            input.id = id;
            input.name = f.name;
            if (f.readonly || f.type === 'readonly') input.readOnly = true;
            if (f.disabled) input.disabled = true;
            if (f.required) input.required = true;
            if (f.value !== undefined && f.value !== null) input.value = String(f.value);
            if (f.type === 'select' && (f.value === undefined || f.value === null || f.value === '') && f.placeholderOption) input.value = '';
            wrap.appendChild(input);
            if (f.help) { const h = document.createElement('div'); h.className = 'dm-help'; h.textContent = f.help; wrap.appendChild(h); }
            if (f.hidden) wrap.hidden = true;
            el.appendChild(wrap);
            inputs[f.name] = input;
        });
        return {
            el, inputs,
            values() { const out = {}; Object.keys(inputs).forEach(k => { out[k] = inputs[k].value; }); return out; },
            field: name => inputs[name]
        };
    };

    /** "2026-10-29 11:22:53" / ISO / date -> value for <input type="datetime-local"> */
    D.toDateTimeLocal = v => {
        if (!v) return '';
        const s = String(v);
        if (s.indexOf('T') !== -1 || s.indexOf(' ') !== -1) return s.replace(' ', 'T').slice(0, 16);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00';
        return s;
    };

    // ------------------------------------------------------------------
    // upload with server-sent progress (leaves, rate card)
    // ------------------------------------------------------------------
    D.uploadWithProgress = function (opts) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = opts.accept || '.xlsx,.csv';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            const body = document.createElement('div');
            body.innerHTML = `<div class="dm-callout tone-warning" style="margin-bottom:16px"><i class="bi bi-file-earmark-spreadsheet"></i><div><b></b><div class="dm-help"></div></div></div>
<div class="dm-progress"><span></span></div><div class="dm-progress-meta"><span data-msg>Starting upload…</span><b data-pct>0%</b></div>`;
            body.querySelector('b').textContent = file.name;
            body.querySelector('.dm-help').textContent = `${(file.size / 1024).toFixed(1)} KB`;
            const bar = body.querySelector('.dm-progress > span');
            const msg = body.querySelector('[data-msg]');
            const pct = body.querySelector('[data-pct]');
            const dlg = D.modal({ title: opts.title || 'Uploading file', subtitle: 'Keep this window open until the import finishes', icon: 'cloud-arrow-up', size: 'sm', body });
            const set = (p, m) => { const v = Math.max(0, Math.min(100, Math.round(p))); bar.style.width = v + '%'; pct.textContent = v + '%'; if (m) msg.textContent = m; };
            let source = null;
            try {
                source = new EventSource(ADMIN + opts.progress(jobId));
                source.onmessage = ev => { try { const d = JSON.parse(ev.data); set(d.progress || 0, d.message); } catch (e) { /* ignore */ } };
            } catch (e) { /* progress stream unavailable: the request result still reports */ }
            const form = new FormData();
            form.append('file', file);
            form.append('jobId', jobId);
            try {
                const res = await api(opts.endpoint, { method: 'POST', body: form });
                set(100, res.message || 'Import complete');
                D.toast(res.message || 'Import complete');
                setTimeout(() => dlg.close(), 700);
                if (opts.onDone) opts.onDone(res);
            } catch (err) {
                msg.textContent = err.message;
                bar.style.background = 'var(--danger)';
                D.toast('Upload failed: ' + err.message, 'danger', 6000);
            } finally {
                if (source) source.close();
            }
        });
        input.click();
    };

    // ------------------------------------------------------------------
    // export (CSV / Excel of all filtered rows)
    // ------------------------------------------------------------------
    let sheetJs = null;
    function loadSheetJs() {
        if (window.XLSX) return Promise.resolve();
        if (!sheetJs) {
            sheetJs = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                s.onload = resolve;
                s.onerror = () => { sheetJs = null; reject(new Error('Could not load the Excel exporter')); };
                document.head.appendChild(s);
            });
        }
        return sheetJs;
    }
    D.download = function (filename, header, rows, type) {
        if (type === 'csv') {
            const csv = [header].concat(rows).map(r => r.map(v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename + '.csv';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            return Promise.resolve();
        }
        return loadSheetJs().then(() => {
            const sheet = window.XLSX.utils.aoa_to_sheet([header].concat(rows));
            sheet['!cols'] = header.map(h => ({ wch: Math.min(40, Math.max(10, String(h).length + 2)) }));
            const book = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(book, sheet, 'Data');
            window.XLSX.writeFile(book, filename + '.xlsx');
        });
    };

    // ------------------------------------------------------------------
    // data grid
    // ------------------------------------------------------------------
    const NUMERIC_TYPES = ['number', 'money', 'id'];
    function defaultFilter(col) {
        if (col.filter !== undefined) return col.filter;
        switch (col.type) {
            case 'status': case 'enum': case 'bool': return 'select';
            case 'number': case 'money': case 'rating': case 'score': return 'range';
            case 'date': case 'datetime': return 'daterange';
            case 'tat': return 'tat';
            default: return 'text';
        }
    }

    function cellHtml(col, value, row) {
        if (col.render) return col.render(value, row);
        if (isEmpty(value) && col.type !== 'bool' && col.type !== 'number' && col.type !== 'money') return '<span class="dm-empty-cell">—</span>';
        switch (col.type) {
            case 'status': case 'enum': return D.pill(value, col.labels && col.labels[value]);
            case 'bool': {
                const yes = value === 1 || value === true || value === '1' || value === 'true';
                return `<span class="dm-pill no-dot tone-${yes ? 'success' : 'neutral'}">${yes ? 'Yes' : 'No'}</span>`;
            }
            case 'money': return isEmpty(value) ? '<span class="dm-empty-cell">—</span>' : esc(fmt.money(value));
            case 'number': return isEmpty(value) ? '<span class="dm-empty-cell">—</span>' : esc(fmt.num(value));
            case 'id': return `<span class="dm-cell-id">#${esc(value)}</span>`;
            case 'date': return esc(fmt.date(value) || value);
            case 'datetime': return `<span title="${esc(value)}">${esc(fmt.datetime(value) || value)}</span>`;
            case 'tat': { const t = fmt.tat(value); return t ? `<span title="${esc(value)}">${esc(t)}</span>` : '<span class="dm-empty-cell">—</span>'; }
            case 'rating': {
                const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
                return `<span class="dm-stars" aria-label="${n} of 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span> <span class="muted num">${esc(value)}</span>`;
            }
            case 'score': {
                const n = Number(value);
                const tone = n >= 9 ? 'success' : n >= 7 ? 'warning' : 'danger';
                return `<span class="dm-pill no-dot tone-${tone} num">${esc(value)}</span>`;
            }
            case 'link': {
                const s = String(value);
                return /^https?:\/\//i.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer" class="dm-cell-long" onclick="event.stopPropagation()">${esc(s)}</a>` : `<span class="dm-cell-long">${esc(s)}</span>`;
            }
            case 'longtext': return `<span class="dm-cell-long" title="${esc(value)}">${esc(value)}</span>`;
            case 'name': return `<span class="dm-cell-name dm-cell-long" title="${esc(value)}">${esc(value)}</span>`;
            default: return `<span class="dm-cell-long" title="${esc(value)}">${esc(value)}</span>`;
        }
    }
    D.cellHtml = cellHtml;

    function readHashState() {
        const m = window.location.hash.match(/(?:^#|&)s=([^&]*)/);
        if (!m) return null;
        try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
    }
    /** Builds a link to a grid page with filters applied (used by the overview). */
    D.gridLink = (page, state) => ADMIN + page + '#s=' + encodeURIComponent(JSON.stringify(state));

    D.grid = function (mount, cfg) { return new Grid(mount, cfg); };

    function Grid(mount, cfg) {
        this.mount = mount;
        this.cfg = cfg;
        this.admin = D.isAdmin();
        this.columns = cfg.columns.filter(c => !c.adminOnly || this.admin).map(c => Object.assign({ filterKind: defaultFilter(c) }, c));
        this.byKey = {};
        this.columns.forEach(c => { this.byKey[c.key] = c; });
        this.storeKey = 'dmGrid:' + cfg.id;
        const saved = store.get(this.storeKey, {});
        const defaultHidden = this.columns.filter(c => c.hidden).map(c => c.key);
        this.hidden = new Set(saved.hidden && saved.v === cfg.version ? saved.hidden : defaultHidden);
        this.compact = !!saved.compact;
        const hash = readHashState() || {};
        this.state = {
            page: hash.p || 1,
            // every page load starts at the default page size; "All" (-1) is never restored
            limit: hash.l > 0 ? hash.l : (cfg.pageSize || 25),
            search: hash.q || '',
            sort: hash.o ? { key: hash.o[0], dir: hash.o[1] } : (cfg.defaultSort || null),
            filters: hash.f || {}
        };
        this.summary = null;
        this.rows = [];
        this.total = 0;
        this.grandTotal = 0;
        this.request = null;
        this.build();
        this.load();
    }

    Grid.prototype.save = function () {
        store.set(this.storeKey, { v: this.cfg.version, hidden: [...this.hidden], compact: this.compact });
    };

    // filterOnly columns (e.g. a created date) can be filtered but are not shown as table columns
    Grid.prototype.visibleColumns = function () { return this.columns.filter(c => !c.filterOnly && !this.hidden.has(c.key)); };
    Grid.prototype.value = function (col, row) { return col.get ? col.get(row) : row[col.key]; };

    Grid.prototype.build = function () {
        const cfg = this.cfg;
        this.mount.innerHTML = `
${cfg.kpis ? '<div class="dm-kpis" data-kpis></div>' : ''}
${cfg.statusBar ? '<div class="dm-card dm-statusbar" data-status></div>' : ''}
<section class="dm-card dm-grid${this.compact ? ' is-compact' : ''}" aria-label="${esc(cfg.title || 'Records')}">
  <div class="dm-toolbar">
    <div class="dm-search"><i class="bi bi-search"></i><input type="search" placeholder="${esc(cfg.searchPlaceholder || 'Search…')}" aria-label="Search"><button class="dm-clear" type="button" aria-label="Clear search"><i class="bi bi-x-lg"></i></button></div>
    <div class="dm-toolbar-spacer"></div>
    <button class="dm-btn" data-act="filters"><i class="bi bi-funnel"></i><span>Filters</span><span class="dm-badge" data-filter-count hidden></span></button>
    <button class="dm-btn" data-act="columns"><i class="bi bi-layout-three-columns"></i><span>Columns</span></button>
    <button class="dm-icon-btn is-bordered" data-act="density" title="Toggle row density" aria-label="Toggle row density"><i class="bi bi-arrows-collapse"></i></button>
    <button class="dm-icon-btn is-bordered" data-act="refresh" title="Refresh" aria-label="Refresh"><i class="bi bi-arrow-clockwise"></i></button>
    <button class="dm-btn" data-act="export"><i class="bi bi-download"></i><span>Export</span></button>
  </div>
  ${cfg.quick && cfg.quick.length ? '<div class="dm-quick" data-quick><span class="dm-quick-label">Quick filters</span></div>' : ''}
  <div class="dm-chips" data-chips hidden></div>
  <div class="dm-table-wrap" data-wrap><div class="dm-loading-bar"></div><table class="dm-table"><thead></thead><tbody></tbody></table><div data-state></div></div>
  <div class="dm-pager" data-pager></div>
</section>`;
        this.el = {
            kpis: this.mount.querySelector('[data-kpis]'),
            status: this.mount.querySelector('[data-status]'),
            grid: this.mount.querySelector('.dm-grid'),
            search: this.mount.querySelector('.dm-search'),
            quick: this.mount.querySelector('[data-quick]'),
            chips: this.mount.querySelector('[data-chips]'),
            wrap: this.mount.querySelector('[data-wrap]'),
            thead: this.mount.querySelector('thead'),
            tbody: this.mount.querySelector('tbody'),
            state: this.mount.querySelector('[data-state]'),
            pager: this.mount.querySelector('[data-pager]'),
            filterCount: this.mount.querySelector('[data-filter-count]')
        };
        const input = this.el.search.querySelector('input');
        input.value = this.state.search;
        this.el.search.classList.toggle('has-value', !!this.state.search);
        const runSearch = debounce(() => { this.state.search = input.value.trim(); this.state.page = 1; this.load(); }, 350);
        input.addEventListener('input', () => { this.el.search.classList.toggle('has-value', !!input.value); runSearch(); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { this.state.search = input.value.trim(); this.state.page = 1; this.load(); } });
        this.el.search.querySelector('.dm-clear').addEventListener('click', () => { input.value = ''; this.el.search.classList.remove('has-value'); this.state.search = ''; this.state.page = 1; this.load(); input.focus(); });

        this.mount.querySelector('[data-act="filters"]').addEventListener('click', () => this.openFilterPanel());
        this.mount.querySelector('[data-act="columns"]').addEventListener('click', e => this.openColumnPicker(e.currentTarget));
        this.mount.querySelector('[data-act="density"]').addEventListener('click', () => { this.compact = !this.compact; this.el.grid.classList.toggle('is-compact', this.compact); this.save(); this.pin(); });
        this.mount.querySelector('[data-act="refresh"]').addEventListener('click', () => this.load());
        this.mount.querySelector('[data-act="export"]').addEventListener('click', e => {
            D.menu(e.currentTarget, [
                { icon: 'file-earmark-excel', label: 'Excel (.xlsx) – all filtered rows', onClick: () => this.export('xlsx') },
                { icon: 'filetype-csv', label: 'CSV – all filtered rows', onClick: () => this.export('csv') }
            ], { align: 'right' });
        });
        this.el.tbody.addEventListener('click', e => {
            const act = e.target.closest('[data-row-act]');
            const tr = e.target.closest('tr[data-i]');
            if (!tr) return;
            const row = this.rows[Number(tr.dataset.i)];
            if (act) { e.stopPropagation(); const a = this.cfg.rowActions[Number(act.dataset.rowAct)]; a.onClick(row, this); return; }
            this.openDetail(row, tr);
        });
        this.el.tbody.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-i]')) this.openDetail(this.rows[Number(e.target.dataset.i)], e.target); });
        this.buildQuick();
        window.addEventListener('resize', debounce(() => this.pin(), 150));
    };

    // ---- filter helpers
    Grid.prototype.optionsFor = function (col) {
        if (col.type === 'bool') return [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];
        if (Array.isArray(col.options)) return col.options.map(o => (typeof o === 'object' ? o : { value: o, label: col.type === 'status' || col.type === 'enum' ? (col.labels && col.labels[o]) || D.statusLabel(o) : o }));
        if (typeof col.options === 'string') {
            const key = col.options;
            return () => D.filterOptions().then(o => (o[key] || []).map(v => ({ value: v, label: col.type === 'status' || col.type === 'enum' ? D.statusLabel(v) : v })));
        }
        return [];
    };
    Grid.prototype.filterControl = function (col, opts = {}) {
        const current = this.state.filters[col.key];
        const set = f => { if (f) this.state.filters[col.key] = f; else delete this.state.filters[col.key]; if (!opts.deferred) { this.state.page = 1; this.load(); } };
        const kind = col.filterKind;
        if (kind === 'select') {
            const control = D.multiSelect({
                placeholder: col.title, block: opts.block, options: this.optionsFor(col), single: col.match === 'contains',
                values: current && current.type === 'exact' ? current.values : [],
                onChange: values => set(values.length ? { type: col.match === 'contains' ? 'contains' : 'exact', values, value: values[0] } : null)
            });
            if (col.match === 'contains' && current && current.type === 'contains') control.set([current.value]);
            return control;
        }
        if (kind === 'range' || kind === 'daterange' || kind === 'tat') {
            const control = D.rangeInput({
                kind: kind === 'daterange' ? 'date' : kind === 'tat' ? 'tat' : 'number',
                placeholder: col.title + (kind === 'tat' ? ' (hours)' : ''),
                button: !opts.block,
                value: current && current.type === 'range' ? current : null,
                onChange: v => set(v.from || v.to ? { type: 'range', from: v.from, to: v.to, unit: kind === 'tat' ? 'tat_hours' : undefined } : null)
            });
            return control;
        }
        // text
        const input = document.createElement('input');
        input.className = 'dm-input' + (opts.block ? '' : ' dm-input-sm');
        input.placeholder = opts.block ? 'Contains…' : col.title + ' contains…';
        input.value = current && current.type === 'contains' ? current.value : '';
        if (!opts.block) input.style.width = '200px';
        const apply = () => set(input.value.trim() ? { type: 'contains', value: input.value.trim() } : null);
        input.addEventListener(opts.deferred ? 'input' : 'change', apply);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
        return { el: input, get: () => input.value, set: v => { input.value = v || ''; } };
    };

    Grid.prototype.buildQuick = function () {
        if (!this.el.quick) return;
        this.el.quick.querySelectorAll(':scope > :not(.dm-quick-label)').forEach(n => n.remove());
        this.quickControls = {};
        this.cfg.quick.forEach(key => {
            const col = this.byKey[key];
            if (!col) return;
            const c = this.filterControl(col);
            this.quickControls[key] = c;
            this.el.quick.appendChild(c.el);
        });
    };

    Grid.prototype.filterSummary = function (col, f) {
        if (f.type === 'contains') return f.value;
        if (f.type === 'exact') {
            const labels = f.values.map(v => (col.type === 'bool' ? (v === '1' ? 'Yes' : 'No') : col.type === 'status' || col.type === 'enum' ? (col.labels && col.labels[v]) || D.statusLabel(v) : v));
            return labels.length <= 2 ? labels.join(', ') : `${labels[0]} +${labels.length - 1}`;
        }
        const fm = v => (col.filterKind === 'daterange' ? fmt.date(v) : col.filterKind === 'tat' ? v + 'h' : v);
        if (f.from && f.to) return `${fm(f.from)} – ${fm(f.to)}`;
        return f.from ? `≥ ${fm(f.from)}` : `≤ ${fm(f.to)}`;
    };

    Grid.prototype.renderChips = function () {
        const chips = [];
        if (this.state.search) chips.push({ label: 'Search', value: this.state.search, clear: () => { this.state.search = ''; const i = this.el.search.querySelector('input'); i.value = ''; this.el.search.classList.remove('has-value'); } });
        Object.keys(this.state.filters).forEach(key => {
            const col = this.byKey[key];
            if (!col) return;
            chips.push({ label: col.title, value: this.filterSummary(col, this.state.filters[key]), clear: () => { delete this.state.filters[key]; } });
        });
        const n = Object.keys(this.state.filters).filter(k => this.byKey[k]).length;
        this.el.filterCount.hidden = !n;
        this.el.filterCount.textContent = n;
        this.el.chips.hidden = !chips.length;
        this.el.chips.innerHTML = '';
        chips.forEach(chip => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'dm-chip';
            b.title = 'Remove filter';
            b.innerHTML = '<span class="k"></span><span></span><i class="bi bi-x"></i>';
            b.children[0].textContent = chip.label + ':';
            b.children[1].textContent = chip.value;
            b.addEventListener('click', () => { chip.clear(); this.state.page = 1; this.syncControls(); this.load(); });
            this.el.chips.appendChild(b);
        });
        if (chips.length) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'dm-chip-clear';
            clear.textContent = 'Clear all';
            clear.addEventListener('click', () => this.clearAll());
            this.el.chips.appendChild(clear);
            const count = document.createElement('span');
            count.className = 'dm-result-count';
            count.textContent = `${fmt.num(this.total)} of ${fmt.num(this.grandTotal || this.total)} records`;
            this.el.chips.appendChild(count);
        }
    };

    Grid.prototype.clearAll = function () {
        this.state.filters = {};
        this.state.search = '';
        this.state.page = 1;
        const i = this.el.search.querySelector('input');
        i.value = '';
        this.el.search.classList.remove('has-value');
        this.syncControls();
        this.load();
    };

    Grid.prototype.syncControls = function () {
        Object.keys(this.quickControls || {}).forEach(key => {
            const c = this.quickControls[key];
            const f = this.state.filters[key];
            const col = this.byKey[key];
            if (col.filterKind === 'select') c.set(f ? (f.values || [f.value]) : []);
            else if (col.filterKind === 'text') c.set(f ? f.value : '');
            else c.set(f || null);
        });
    };

    Grid.prototype.setFilter = function (key, filter) {
        if (filter) this.state.filters[key] = filter; else delete this.state.filters[key];
        this.state.page = 1;
        this.syncControls();
        this.load();
    };

    Grid.prototype.openFilterPanel = function () {
        const body = document.createElement('div');
        const draft = JSON.parse(JSON.stringify(this.state.filters));
        const realFilters = this.state.filters;
        this.state.filters = draft; // controls write into the draft until Apply
        body.innerHTML = '<div class="dm-filter-panel-search"><input class="dm-input" placeholder="Find a field…" aria-label="Find a field"></div><div data-fields></div>';
        const fieldsHost = body.querySelector('[data-fields]');
        const cols = this.columns.filter(c => c.filterKind);
        const rows = cols.map(col => {
            const wrap = document.createElement('div');
            wrap.className = 'dm-filter-field';
            wrap.dataset.title = col.title.toLowerCase();
            wrap.innerHTML = '<div class="dm-label"><span></span><button type="button">Clear</button></div>';
            wrap.querySelector('span').textContent = col.title;
            const control = this.filterControl(col, { block: true, deferred: true });
            wrap.appendChild(control.el);
            wrap.querySelector('button').addEventListener('click', () => { delete draft[col.key]; control.set(col.filterKind === 'select' ? [] : col.filterKind === 'text' ? '' : null); });
            fieldsHost.appendChild(wrap);
            return wrap;
        });
        const find = body.querySelector('.dm-filter-panel-search input');
        find.addEventListener('input', () => { const q = find.value.toLowerCase(); rows.forEach(r => { r.hidden = !!q && !r.dataset.title.includes(q); }); });
        let applied = false;
        D.drawer({
            title: 'Filters', subtitle: `${cols.length} filterable columns`, icon: 'funnel', size: 'narrow', body,
            onClose: () => { if (!applied) this.state.filters = realFilters; },
            actions: [
                { label: 'Reset all', variant: 'ghost', left: true, onClick: dlg => { applied = true; this.state.filters = {}; dlg.close(); this.state.page = 1; this.syncControls(); this.load(); } },
                { label: 'Cancel' },
                { label: 'Apply filters', variant: 'primary', icon: 'check2', onClick: dlg => { applied = true; this.state.filters = draft; dlg.close(); this.state.page = 1; this.syncControls(); this.load(); } }
            ]
        });
    };

    Grid.prototype.openColumnPicker = function (anchor) {
        const box = document.createElement('div');
        box.innerHTML = `<input class="dm-input" placeholder="Find a column…" aria-label="Find a column"><div class="dm-col-list"></div>
<div class="dm-pop-foot"><button type="button" class="dm-btn dm-btn-ghost dm-btn-sm" data-reset>Reset</button><button type="button" class="dm-btn dm-btn-ghost dm-btn-sm" data-all>Show all</button></div>`;
        const list = box.querySelector('.dm-col-list');
        const draw = (q = '') => {
            list.innerHTML = '';
            this.columns.filter(c => !c.filterOnly && (!q || c.title.toLowerCase().includes(q.toLowerCase()))).forEach(col => {
                const row = document.createElement('label');
                row.className = 'dm-opt';
                row.innerHTML = '<input type="checkbox"><span></span>';
                row.children[1].textContent = col.title;
                row.firstChild.checked = !this.hidden.has(col.key);
                row.firstChild.addEventListener('change', e => {
                    if (e.target.checked) this.hidden.delete(col.key); else this.hidden.add(col.key);
                    if (this.visibleColumns().length === 0) { this.hidden.delete(col.key); e.target.checked = true; }
                    this.save();
                    this.renderTable();
                });
                list.appendChild(row);
            });
        };
        draw();
        box.querySelector('input').addEventListener('input', e => draw(e.target.value));
        box.querySelector('[data-reset]').addEventListener('click', () => { this.hidden = new Set(this.columns.filter(c => c.hidden).map(c => c.key)); this.save(); this.renderTable(); draw(); });
        box.querySelector('[data-all]').addEventListener('click', () => { this.hidden.clear(); this.save(); this.renderTable(); draw(); });
        D.popover(anchor, box, { align: 'right', width: 300 });
    };

    // ---- data
    Grid.prototype.params = function (all) {
        const p = new URLSearchParams();
        p.set('page', all ? 1 : this.state.page);
        p.set('limit', all ? -1 : this.state.limit);
        if (this.state.search) p.set('search', this.state.search);
        if (this.state.sort) {
            const col = this.byKey[this.state.sort.key];
            p.set('order_column', (col && col.sortKey) || this.state.sort.key);
            p.set('order_dir', this.state.sort.dir);
        }
        const searches = {}, exact = {}, ranges = {};
        Object.keys(this.state.filters).forEach(key => {
            const f = this.state.filters[key];
            const col = this.byKey[key];
            if (!col) return;
            const k = col.filterKey || key;
            if (f.type === 'contains') searches[k] = f.value;
            else if (f.type === 'exact') exact[k] = f.values;
            else if (f.type === 'range') ranges[k] = { from: f.from || undefined, to: f.to || undefined, unit: f.unit };
        });
        if (Object.keys(searches).length) p.set('col_searches', JSON.stringify(searches));
        if (Object.keys(exact).length) p.set('col_exact', JSON.stringify(exact));
        if (Object.keys(ranges).length) p.set('col_ranges', JSON.stringify(ranges));
        Object.entries(this.cfg.params || {}).forEach(([k, v]) => p.set(k, v));
        return p;
    };

    Grid.prototype.writeHash = function () {
        const s = {};
        if (this.state.page > 1) s.p = this.state.page;
        if (this.state.limit > 0 && this.state.limit !== (this.cfg.pageSize || 25)) s.l = this.state.limit;
        if (this.state.search) s.q = this.state.search;
        if (this.state.sort && JSON.stringify(this.state.sort) !== JSON.stringify(this.cfg.defaultSort || null)) s.o = [this.state.sort.key, this.state.sort.dir];
        if (Object.keys(this.state.filters).length) s.f = this.state.filters;
        const hash = Object.keys(s).length ? '#s=' + encodeURIComponent(JSON.stringify(s)) : '';
        if (window.location.hash !== hash) history.replaceState(null, '', window.location.pathname + window.location.search + hash);
    };

    Grid.prototype.load = async function () {
        if (this.request) this.request.abort();
        const ctrl = new AbortController();
        this.request = ctrl;
        this.el.grid.classList.add('is-loading');
        if (!this.rows.length && !this.loadedOnce) this.renderSkeleton();
        this.renderChips();
        this.writeHash();
        try {
            const res = await api(this.cfg.endpoint + '?' + this.params(false).toString(), { signal: ctrl.signal });
            if (ctrl !== this.request) return;
            this.loadedOnce = true;
            this.rows = this.cfg.rowsFrom ? this.cfg.rowsFrom(res) : (res.data || []);
            this.total = Number(res.recordsFiltered !== undefined ? res.recordsFiltered : (res.total || 0));
            this.grandTotal = Number(res.recordsTotal !== undefined ? res.recordsTotal : this.total);
            this.summary = res.summary || null;
            this.error = null;
            const pages = this.state.limit === -1 ? 1 : Math.max(1, Math.ceil(this.total / this.state.limit));
            if (this.state.page > pages && this.total > 0) { this.state.page = pages; return this.load(); }
        } catch (err) {
            if (err.name === 'AbortError') return;
            this.error = err;
            this.rows = [];
            this.total = 0;
        } finally {
            if (ctrl === this.request) { this.el.grid.classList.remove('is-loading'); this.request = null; }
        }
        this.render();
        if (this.cfg.onLoad) this.cfg.onLoad(this);
    };
    Grid.prototype.reload = function () { return this.load(); };

    Grid.prototype.render = function () {
        this.renderKpis();
        this.renderStatusBar();
        this.renderChips();
        this.renderTable();
        this.renderPager();
    };

    Grid.prototype.renderSkeleton = function () {
        const cols = this.visibleColumns();
        this.renderHead(cols);
        this.el.tbody.innerHTML = Array.from({ length: 8 }, () => `<tr>${cols.map(() => '<td><span class="dm-skel" style="width:' + (40 + Math.random() * 50) + '%"></span></td>').join('')}${this.cfg.rowActions ? '<td class="t-actions"></td>' : ''}</tr>`).join('');
        if (this.el.kpis && !this.el.kpis.children.length) {
            this.el.kpis.innerHTML = this.cfg.kpis.map(() => '<div class="dm-kpi"><span class="dm-skel" style="width:50%"></span><span class="dm-skel" style="height:24px;width:60%"></span><span class="dm-skel" style="width:40%"></span></div>').join('');
        }
    };

    Grid.prototype.renderHead = function (cols) {
        const sort = this.state.sort;
        this.el.thead.innerHTML = `<tr>${cols.map(col => {
            const sorted = sort && sort.key === col.key;
            const icon = sorted ? (sort.dir === 'asc' ? 'bi-sort-up' : 'bi-sort-down') : 'bi-arrow-down-up';
            const filtered = this.state.filters[col.key] ? '<span class="dm-th-filtered" title="Filtered"></span>' : '';
            const numeric = NUMERIC_TYPES.includes(col.type) && col.type !== 'id';
            const label = col.sortable === false
                ? `<span>${esc(col.title)}</span>${filtered}`
                : `<button type="button" class="dm-th-btn${sorted ? ' is-sorted' : ''}" data-sort="${esc(col.key)}" title="${esc(col.title)} – click to sort"${sorted ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}><span>${esc(col.title)}</span><i class="bi ${icon}"></i>${filtered}</button>`;
            return `<th class="${numeric ? 't-num' : ''}" data-key="${esc(col.key)}" scope="col">${label}</th>`;
        }).join('')}${this.cfg.rowActions ? '<th class="t-actions" scope="col"><span class="sr-only">Actions</span></th>' : ''}</tr>`;
        this.el.thead.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
            const key = b.dataset.sort;
            const cur = this.state.sort;
            if (!cur || cur.key !== key) this.state.sort = { key, dir: 'asc' };
            else if (cur.dir === 'asc') this.state.sort = { key, dir: 'desc' };
            else this.state.sort = this.cfg.defaultSort || null;
            this.state.page = 1;
            this.load();
        }));
    };

    Grid.prototype.renderTable = function () {
        const cols = this.visibleColumns();
        this.renderHead(cols);
        this.el.state.innerHTML = '';
        if (this.error) {
            this.el.tbody.innerHTML = '';
            this.el.state.innerHTML = `<div class="dm-state"><i class="bi bi-cloud-slash"></i><h4>Couldn’t load records</h4><p></p><button class="dm-btn" type="button"><i class="bi bi-arrow-clockwise"></i>Try again</button></div>`;
            this.el.state.querySelector('p').textContent = this.error.message;
            this.el.state.querySelector('button').addEventListener('click', () => this.load());
            return;
        }
        if (!this.rows.length) {
            this.el.tbody.innerHTML = '';
            const filtered = this.state.search || Object.keys(this.state.filters).length;
            this.el.state.innerHTML = `<div class="dm-state"><i class="bi bi-${filtered ? 'funnel' : 'inbox'}"></i><h4>${filtered ? 'No records match these filters' : 'No records yet'}</h4><p>${filtered ? 'Try removing a filter or searching for something else.' : 'Records will appear here as soon as they are created.'}</p>${filtered ? '<button class="dm-btn" type="button">Clear all filters</button>' : ''}</div>`;
            const b = this.el.state.querySelector('button');
            if (b) b.addEventListener('click', () => this.clearAll());
            return;
        }
        const actions = this.cfg.rowActions || null;
        const html = this.rows.map((row, i) => {
            const cells = cols.map(col => {
                const numeric = NUMERIC_TYPES.includes(col.type) && col.type !== 'id';
                return `<td class="${numeric ? 't-num' : ''}">${cellHtml(col, this.value(col, row), row)}</td>`;
            }).join('');
            const acts = actions ? `<td class="t-actions"><span class="dm-row-actions">${actions.map((a, ai) => (a.visible && !a.visible(row) ? '' : `<button type="button" class="dm-icon-btn${a.tone === 'danger' ? ' is-danger' : ''}" data-row-act="${ai}" title="${esc(a.label)}" aria-label="${esc(a.label)}"><i class="bi bi-${esc(a.icon)}"></i></button>`)).join('')}</span></td>` : '';
            return `<tr data-i="${i}" tabindex="0">${cells}${acts}</tr>`;
        }).join('');
        this.el.tbody.innerHTML = html;
        this.pin();
    };

    /** Sticky first N columns (offsets measured after render). */
    Grid.prototype.pin = function () {
        const n = Math.min(this.cfg.pinned || 0, this.visibleColumns().length - 1);
        const headCells = this.el.thead.querySelectorAll('th');
        this.mount.querySelectorAll('.is-pinned, .is-pinned-last').forEach(c => { c.classList.remove('is-pinned', 'is-pinned-last'); c.style.left = ''; });
        if (n <= 0 || window.matchMedia('(max-width: 640px)').matches) return;
        let left = 0;
        for (let i = 0; i < n; i++) {
            const w = headCells[i].getBoundingClientRect().width;
            const cells = [headCells[i]].concat([...this.el.tbody.querySelectorAll(`tr > td:nth-child(${i + 1})`)]);
            cells.forEach(c => { c.classList.add('is-pinned'); c.style.left = left + 'px'; if (i === n - 1) c.classList.add('is-pinned-last'); });
            left += w;
        }
    };

    Grid.prototype.renderPager = function () {
        const { page, limit } = this.state;
        // limit -1 = all rows on one page
        const pages = limit === -1 ? 1 : Math.max(1, Math.ceil(this.total / limit));
        const from = this.total ? (limit === -1 ? 1 : (page - 1) * limit + 1) : 0;
        const to = limit === -1 ? this.total : Math.min(this.total, page * limit);
        const sizes = this.cfg.pageSizes || [25, 50, 100, 200, -1];
        const nums = [];
        const push = n => nums.push(n);
        if (pages <= 7) for (let i = 1; i <= pages; i++) push(i);
        else {
            push(1);
            if (page > 4) push('…');
            for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) push(i);
            if (page < pages - 3) push('…');
            push(pages);
        }
        this.el.pager.innerHTML = `
<label>Rows per page <select aria-label="Rows per page">${sizes.map(s => `<option value="${s}"${s === limit ? ' selected' : ''}>${s === -1 ? 'All' : s}</option>`).join('')}</select></label>
<span class="num">${fmt.num(from)}–${fmt.num(to)} of <b>${fmt.num(this.total)}</b>${this.grandTotal && this.grandTotal !== this.total ? ` <span class="muted">(filtered from ${fmt.num(this.grandTotal)})</span>` : ''}</span>
<div class="dm-pages" role="navigation" aria-label="Pagination">
  <button class="dm-page-btn" data-go="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>
  ${nums.map(n => (n === '…' ? '<span class="dm-page-gap">…</span>' : `<button class="dm-page-btn${n === page ? ' is-current' : ''}" data-go="${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`)).join('')}
  <button class="dm-page-btn" data-go="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Next page"><i class="bi bi-chevron-right"></i></button>
</div>`;
        this.el.pager.querySelector('select').addEventListener('change', e => { this.state.limit = Number(e.target.value); this.state.page = 1; this.save(); this.load(); });
        this.el.pager.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
            this.state.page = Number(b.dataset.go);
            this.load();
            this.el.wrap.scrollTop = 0;
        }));
    };

    // ---- KPIs and status breakdown
    Grid.prototype.renderKpis = function () {
        if (!this.el.kpis) return;
        const s = this.summary || {};
        const total = Number(s.total !== undefined ? s.total : this.total);
        this.el.kpis.innerHTML = '';
        this.cfg.kpis.forEach(k => {
            const raw = k.value(s, this);
            const value = raw === null || raw === undefined || (typeof raw === 'number' && isNaN(raw)) ? '—' : (k.format ? k.format(raw) : fmt.num(raw));
            const active = k.filter && this.isFilterActive(k.filter);
            const tag = k.filter ? 'button' : 'div';
            const el = document.createElement(tag);
            el.className = 'dm-kpi' + (active ? ' is-active' : '');
            if (tag === 'button') { el.type = 'button'; el.title = active ? 'Click to remove this filter' : 'Click to show only these records'; el.setAttribute('aria-pressed', active ? 'true' : 'false'); }
            const share = k.share && total ? Number(raw) / total : null;
            const hint = k.hint ? k.hint(s, this) : (share !== null ? `${fmt.pct(Number(raw), total)} of ${fmt.num(total)}` : '');
            el.innerHTML = `<span class="dm-kpi-filter-tag"><i class="bi bi-funnel-fill"></i></span>
<div class="dm-kpi-top"><span class="dm-kpi-label"></span><span class="dm-kpi-icon tone-${esc(k.tone || 'brand')}"><i class="bi bi-${esc(k.icon || 'circle')}"></i></span></div>
<div class="dm-kpi-value"></div>
${share !== null ? `<div class="dm-kpi-meter fg-${esc(k.tone || 'brand')}"><span style="width:${Math.min(100, share * 100)}%"></span></div>` : ''}
<div class="dm-kpi-hint"></div>`;
            el.querySelector('.dm-kpi-label').textContent = k.label;
            el.querySelector('.dm-kpi-value').textContent = value;
            el.querySelector('.dm-kpi-hint').textContent = hint || '';
            if (k.filter) el.addEventListener('click', () => this.toggleFilter(k.filter));
            this.el.kpis.appendChild(el);
        });
    };

    Grid.prototype.isFilterActive = function (f) {
        const cur = this.state.filters[f.key];
        if (!cur) return false;
        if (f.type === 'range') return cur.type === 'range' && cur.from === f.from && cur.to === f.to;
        return cur.type === 'exact' && JSON.stringify([...cur.values].sort()) === JSON.stringify([...f.values].map(String).sort());
    };
    Grid.prototype.toggleFilter = function (f) {
        if (this.isFilterActive(f)) delete this.state.filters[f.key];
        else this.state.filters[f.key] = f.type === 'range' ? { type: 'range', from: f.from, to: f.to } : { type: 'exact', values: f.values.map(String) };
        if (f.also) Object.keys(f.also).forEach(k => { if (this.state.filters[f.key]) this.state.filters[k] = f.also[k]; else delete this.state.filters[k]; });
        this.state.page = 1;
        this.syncControls();
        this.load();
    };

    Grid.prototype.renderStatusBar = function () {
        if (!this.el.status) return;
        const sb = this.cfg.statusBar;
        const counts = (this.summary && this.summary.status_counts) || {};
        const items = Object.keys(counts).filter(k => counts[k] > 0).map(k => ({ key: k, value: counts[k], slot: D.statusSlot(k) }));
        items.sort((a, b) => a.slot - b.slot || b.value - a.value);
        const total = items.reduce((a, b) => a + b.value, 0);
        const cur = this.state.filters[sb.column];
        const activeSet = cur && cur.type === 'exact' ? cur.values : [];
        this.el.status.innerHTML = `<div class="dm-statusbar-head"><span class="dm-statusbar-title">${esc(sb.title || 'Status breakdown')}</span><span class="muted" style="font-size:12px">${fmt.num(total)} records · click a status to filter</span></div>
<div class="dm-stack${activeSet.length ? ' has-active' : ''}" role="group" aria-label="Status breakdown"></div><div class="dm-legend"></div>`;
        const stack = this.el.status.querySelector('.dm-stack');
        const legend = this.el.status.querySelector('.dm-legend');
        if (!total) { stack.innerHTML = ''; legend.innerHTML = '<span class="muted" style="font-size:12.5px">No records</span>'; return; }
        items.forEach(item => {
            const active = activeSet.includes(item.key);
            const label = D.statusLabel(item.key);
            const color = `var(--series-${item.slot})`;
            const seg = document.createElement('button');
            seg.type = 'button';
            seg.style.flex = String(item.value);
            seg.style.background = color;
            seg.className = active ? 'is-active' : '';
            seg.title = `${label}: ${fmt.num(item.value)} (${fmt.pct(item.value, total)})`;
            seg.setAttribute('aria-label', seg.title);
            const toggle = () => this.setFilter(sb.column, active && activeSet.length === 1 ? null : { type: 'exact', values: [item.key] });
            seg.addEventListener('click', toggle);
            stack.appendChild(seg);
            const li = document.createElement('button');
            li.type = 'button';
            li.className = 'dm-legend-item' + (active ? ' is-active' : '');
            li.innerHTML = `<span class="dm-swatch" style="background:${color}"></span><span></span><b class="num"></b><span class="muted num"></span>`;
            li.children[1].textContent = label;
            li.children[2].textContent = fmt.num(item.value);
            li.children[3].textContent = fmt.pct(item.value, total);
            li.addEventListener('click', toggle);
            legend.appendChild(li);
        });
    };

    // ---- detail drawer
    Grid.prototype.openDetail = function (row, tr) {
        this.el.tbody.querySelectorAll('tr.is-selected').forEach(r => r.classList.remove('is-selected'));
        if (tr) tr.classList.add('is-selected');
        const body = document.createElement('div');
        const shown = this.columns.filter(c => !c.filterOnly).map(c => c.key);
        const groups = this.cfg.detailGroups || [{ title: 'Details', keys: shown }];
        const used = new Set();
        const sections = groups.map(g => {
            const keys = (g.keys || []).filter(k => this.byKey[k] && !this.byKey[k].filterOnly);
            keys.forEach(k => used.add(k));
            return { title: g.title, keys };
        });
        const rest = shown.filter(k => !used.has(k));
        if (rest.length) sections.push({ title: 'More', keys: rest });
        body.innerHTML = '<div class="dm-detail-search"><input class="dm-input" placeholder="Find a field…" aria-label="Find a field"></div>';
        sections.forEach(sec => {
            if (!sec.keys.length) return;
            const g = document.createElement('div');
            g.className = 'dm-detail-group';
            g.innerHTML = `<h5>${esc(sec.title)}</h5><div class="dm-dl"></div>`;
            const dl = g.querySelector('.dm-dl');
            sec.keys.forEach(k => {
                const col = this.byKey[k];
                const v = this.value(col, row);
                dl.insertAdjacentHTML('beforeend', `<div data-f="${esc(col.title.toLowerCase())}">${esc(col.title)}</div><div data-f="${esc(col.title.toLowerCase())}">${col.type === 'longtext' || col.type === 'text' || !col.type ? (isEmpty(v) ? '<span class="dm-empty-cell">—</span>' : esc(v)) : cellHtml(col, v, row)}</div>`);
            });
            body.appendChild(g);
        });
        const find = body.querySelector('.dm-detail-search input');
        find.addEventListener('input', () => {
            const q = find.value.toLowerCase();
            body.querySelectorAll('[data-f]').forEach(n => { n.hidden = !!q && !n.dataset.f.includes(q); });
            body.querySelectorAll('.dm-detail-group').forEach(g => { g.hidden = !!q && !g.querySelector('.dm-dl > div:not([hidden])'); });
        });
        const actions = (this.cfg.rowActions || []).filter(a => !a.visible || a.visible(row)).map(a => ({
            label: a.label, icon: a.icon, variant: a.tone === 'danger' ? 'danger' : 'primary',
            onClick: dlg => { dlg.close(); a.onClick(row, this); }
        }));
        const title = this.cfg.detailTitle ? this.cfg.detailTitle(row) : 'Record details';
        D.drawer({
            title, subtitle: this.cfg.detailSubtitle ? this.cfg.detailSubtitle(row) : '', icon: this.cfg.icon || 'card-text', body,
            onClose: () => tr && tr.classList.remove('is-selected'),
            actions: actions.length ? [{ label: 'Close' }].concat(actions) : [{ label: 'Close' }]
        });
    };

    // ---- export
    // Exports every column of the grid (also ones hidden with "Columns"; filter-only keys are not
    // columns), with numbers, amounts and ids as real numbers in Excel
    Grid.prototype.export = async function (type) {
        const cols = this.columns.filter(c => !c.filterOnly);
        D.toast(`Preparing ${type === 'csv' ? 'CSV' : 'Excel'} export of ${fmt.num(this.total)} rows…`, 'info', 2500);
        try {
            const res = await api(this.cfg.endpoint + '?' + this.params(true).toString());
            const rows = (this.cfg.rowsFrom ? this.cfg.rowsFrom(res) : res.data || []).map(row => cols.map(c => {
                const v = c.exportValue ? c.exportValue(row) : this.value(c, row);
                if (v === null || v === undefined) return '';
                if (NUMERIC_TYPES.includes(c.type) && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
                return v;
            }));
            await D.download(`${this.cfg.exportName || this.cfg.id}_${isoDay(new Date())}`, cols.map(c => c.title), rows, type);
            D.toast(`Exported ${fmt.num(rows.length)} rows`);
        } catch (err) {
            D.toast('Export failed: ' + err.message, 'danger', 6000);
        }
    };

    // ------------------------------------------------------------------
    // shared edit / delete flows for projects, tasks, changes
    // ------------------------------------------------------------------
    /** Opens the delete preview (GET delete/preview/:type/:id) and deletes on confirm. */
    D.confirmDelete = async function (opts) {
        const body = document.createElement('div');
        body.innerHTML = '<div class="dm-state" style="padding:24px"><i class="bi bi-arrow-repeat dm-spin" style="font-size:22px"></i></div>';
        const dlg = D.modal({
            title: opts.title, subtitle: 'This cannot be undone', icon: 'trash3', tone: 'danger', body,
            actions: [{ label: 'Cancel' }, { id: 'go', label: opts.confirmLabel || 'Delete', icon: 'trash3', variant: 'danger', onClick: async (d, btn) => {
                D.setBusy(btn, true, 'Deleting…');
                try {
                    await api(`delete/${opts.type}/${encodeURIComponent(opts.id)}`, { method: 'DELETE' });
                    d.close();
                    D.toast(opts.doneMessage || 'Deleted');
                    if (opts.onDone) opts.onDone();
                } catch (err) {
                    D.setBusy(btn, false);
                    D.toast('Delete failed: ' + err.message, 'danger', 6000);
                }
            } }]
        });
        dlg.buttons.go.disabled = true;
        try {
            const res = await api(`delete/preview/${opts.type}/${encodeURIComponent(opts.id)}`);
            body.innerHTML = '';
            body.appendChild(opts.renderPreview(res.preview || {}));
            dlg.buttons.go.disabled = false;
        } catch (err) {
            body.innerHTML = '<div class="dm-callout tone-danger"><i class="bi bi-exclamation-octagon"></i><div></div></div>';
            body.querySelector('.dm-callout div').textContent = 'Could not load the preview: ' + err.message;
        }
    };

    /** Builds the "what will be deleted" preview: a summary block plus a list of linked items. */
    D.previewBlock = function (title, fields, list) {
        const el = document.createElement('div');
        el.innerHTML = `<div class="dm-callout tone-danger"><i class="bi bi-exclamation-triangle"></i><div style="flex:1"><b></b><div class="dm-dl" style="margin-top:10px"></div></div></div>`;
        el.querySelector('b').textContent = title;
        const dl = el.querySelector('.dm-dl');
        fields.forEach(([k, v]) => { dl.insertAdjacentHTML('beforeend', `<div>${esc(k)}</div><div>${isEmpty(v) ? '<span class="dm-empty-cell">—</span>' : esc(v)}</div>`); });
        if (list) {
            const wrap = document.createElement('div');
            if (list.items.length) {
                wrap.innerHTML = `<div class="dm-callout tone-warning"><i class="bi bi-diagram-2"></i><div></div></div><div class="dm-list"></div>`;
                wrap.querySelector('.dm-callout div').textContent = list.title;
                const l = wrap.querySelector('.dm-list');
                list.items.forEach(([a, b]) => { l.insertAdjacentHTML('beforeend', `<div class="dm-list-item"><span>${esc(a)}</span><span class="muted">${esc(b)}</span></div>`); });
            } else {
                wrap.innerHTML = '<div class="dm-callout tone-success"><i class="bi bi-check-circle"></i><div></div></div>';
                wrap.querySelector('.dm-callout div').textContent = list.empty;
            }
            el.appendChild(wrap);
        }
        return el;
    };

    /** Loads GET edit/:type/:id, shows a form built by `fields(res)`, PUTs the values. */
    D.editRecord = async function (opts) {
        const body = document.createElement('div');
        body.innerHTML = '<div class="dm-state" style="padding:24px"><i class="bi bi-arrow-repeat dm-spin" style="font-size:22px"></i></div>';
        let form = null;
        const dlg = D.modal({
            title: opts.title, subtitle: opts.subtitle, icon: 'pencil-square', size: 'lg', body,
            actions: [{ label: 'Cancel' }, { id: 'save', label: 'Save changes', icon: 'check2', variant: 'primary', onClick: async (d, btn) => {
                if (!form) return;
                const bad = Object.values(form.inputs).find(i => !i.checkValidity());
                if (bad) { bad.reportValidity(); return; }
                D.setBusy(btn, true, 'Saving…');
                try {
                    await api(`edit/${opts.type}/${encodeURIComponent(opts.id)}`, { method: 'PUT', body: opts.payload ? opts.payload(form.values()) : form.values() });
                    d.close();
                    D.toast(opts.doneMessage || 'Changes saved');
                    if (opts.onDone) opts.onDone();
                } catch (err) {
                    D.setBusy(btn, false);
                    D.toast('Update failed: ' + err.message, 'danger', 6000);
                }
            } }]
        });
        dlg.buttons.save.disabled = true;
        try {
            const res = await api(`edit/${opts.type}/${encodeURIComponent(opts.id)}`);
            form = D.form(opts.fields(res));
            body.innerHTML = '';
            body.appendChild(form.el);
            dlg.buttons.save.disabled = false;
            const first = body.querySelector('input:not([readonly]), select, textarea');
            if (first) first.focus();
        } catch (err) {
            body.innerHTML = '<div class="dm-callout tone-danger"><i class="bi bi-exclamation-octagon"></i><div></div></div>';
            body.querySelector('.dm-callout div').textContent = 'Could not load the record: ' + err.message;
        }
    };

    // ------------------------------------------------------------------
    // charts (SVG / HTML, hover tooltips, text in text tokens)
    // ------------------------------------------------------------------
    function niceMax(v) {
        if (v <= 0) return 4;
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        const n = v / p;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
    }

    /** Multi-series line chart: { labels:[], series:[{name, values:[], slot}] } on one axis. */
    D.lineChart = function (host, data, opts = {}) {
        host.classList.add('dm-chart');
        const draw = () => {
            const W = Math.max(280, host.clientWidth);
            const H = opts.height || 260;
            const m = { t: 10, r: 14, b: 26, l: 40 };
            const iw = W - m.l - m.r, ih = H - m.t - m.b;
            const max = niceMax(Math.max(1, ...data.series.flatMap(s => s.values)));
            const n = data.labels.length;
            const x = i => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
            const y = v => m.t + ih - (v / max) * ih;
            const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
            const step = Math.ceil(n / Math.max(2, Math.floor(iw / 70)));
            let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(opts.label || 'Trend chart')}">`;
            svg += `<g class="grid">${ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>`;
            svg += `<g class="axis">${ticks.map(t => `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmt.compact(t))}</text>`).join('')}`;
            svg += data.labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>` : '')).join('') + '</g>';
            data.series.forEach(s => {
                const color = `var(--series-${s.slot})`;
                const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
                // area wash only for a single series; overlapping washes muddy each other
                if (data.series.length === 1) svg += `<polygon points="${m.l},${y(0)} ${pts} ${x(n - 1)},${y(0)}" fill="${color}" opacity="0.1"/>`;
                svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
                const last = s.values[n - 1];
                svg += `<circle cx="${x(n - 1)}" cy="${y(last)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
            });
            svg += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
            svg += `<g data-dots></g><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" data-hit/></svg>`;
            host.innerHTML = svg + '<div class="dm-tooltip" role="status"></div>';
            const tip = host.querySelector('.dm-tooltip');
            const cross = host.querySelector('.crosshair');
            const dots = host.querySelector('[data-dots]');
            const hit = host.querySelector('[data-hit]');
            const show = clientX => {
                const r = host.getBoundingClientRect();
                const px = ((clientX - r.left) / r.width) * W;
                const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
                cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
                dots.innerHTML = data.series.map(s => `<circle cx="${x(i)}" cy="${y(s.values[i])}" r="4.5" fill="var(--series-${s.slot})" stroke="var(--surface)" stroke-width="2"/>`).join('');
                tip.innerHTML = `<div class="tt-title"></div>${data.series.map(s => `<div class="tt-row"><span class="dm-swatch-line" style="background:var(--series-${s.slot})"></span><b>${esc(fmt.num(s.values[i]))}</b><span>${esc(s.name)}</span></div>`).join('')}`;
                tip.firstChild.textContent = data.fullLabels ? data.fullLabels[i] : data.labels[i];
                tip.style.display = 'block';
                const left = (x(i) / W) * r.width;
                tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + 'px';
                tip.style.top = '8px';
            };
            hit.addEventListener('pointermove', e => show(e.clientX));
            hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; });
        };
        draw();
        const ro = new ResizeObserver(debounce(draw, 100));
        ro.observe(host);
        return { redraw: draw };
    };

    /** Horizontal bar list. items: [{label, value, parts:[{name,value,slot}], href, sub}]. */
    D.barList = function (host, items, opts = {}) {
        const max = Math.max(1, ...items.map(i => i.value));
        host.innerHTML = '<div class="dm-bars"></div><div class="dm-tooltip" role="status"></div>';
        host.classList.add('dm-chart');
        const list = host.querySelector('.dm-bars');
        const tip = host.querySelector('.dm-tooltip');
        if (!items.length) { list.innerHTML = '<div class="muted" style="font-size:13px">No data for this period</div>'; return; }
        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'dm-bar-row';
            if (item.href || item.onClick) { row.dataset.href = item.href || ''; row.tabIndex = 0; row.setAttribute('role', item.href ? 'link' : 'button'); }
            row.innerHTML = '<span class="dm-bar-label"></span><div class="dm-bar-track"></div><span class="dm-bar-value"></span>';
            row.children[0].textContent = item.label;
            row.children[0].title = item.label;
            row.children[2].textContent = fmt.num(item.value);
            const track = row.children[1];
            const parts = item.parts || [{ name: opts.seriesName || '', value: item.value, slot: opts.slot || 1 }];
            parts.filter(p => p.value > 0).forEach(p => {
                const seg = document.createElement('span');
                seg.style.width = (p.value / max) * 100 + '%';
                seg.style.background = `var(--series-${p.slot})`;
                track.appendChild(seg);
            });
            const showTip = e => {
                const r = host.getBoundingClientRect();
                tip.innerHTML = `<div class="tt-title"></div>${parts.map(p => `<div class="tt-row"><span class="dm-swatch" style="background:var(--series-${p.slot})"></span><b>${esc(fmt.num(p.value))}</b><span>${esc(p.name || 'Total')}</span></div>`).join('')}`;
                tip.firstChild.textContent = item.label;
                tip.style.display = 'block';
                const rr = row.getBoundingClientRect();
                tip.style.top = (rr.bottom - r.top + 4) + 'px';
                tip.style.left = Math.min(r.width - tip.offsetWidth, Math.max(0, (e && e.clientX ? e.clientX - r.left : rr.left - r.left + 120) - 40)) + 'px';
            };
            row.addEventListener('pointermove', showTip);
            row.addEventListener('focus', () => showTip());
            row.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
            row.addEventListener('blur', () => { tip.style.display = 'none'; });
            if (item.href || item.onClick) {
                const go = () => (item.onClick ? item.onClick() : (window.location.href = item.href));
                row.addEventListener('click', go);
                row.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
            }
            list.appendChild(row);
        });
    };

    /** Legend for multi-series charts (identity is never colour alone). */
    D.legend = function (host, series, kind) {
        host.className = 'dm-legend';
        host.innerHTML = series.map(s => `<span class="dm-legend-item" style="cursor:default"><span class="${kind === 'line' ? 'dm-swatch-line' : 'dm-swatch'}" style="background:var(--series-${s.slot})"></span><span>${esc(s.name)}</span></span>`).join('');
    };
})();
