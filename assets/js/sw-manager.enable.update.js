import { fetchRuntimeJson, getRuntimeBuildVersion, getRuntimeI18nUrl, getRuntimeManifest } from './runtime-manifest.js';

const UPDATE_STATE_ATTR = 'data-site-update';
const UPDATE_STATE_READY = 'ready';
const SW_ACTIVATION_TIMEOUT_MS = 4000;
const NAVIGATION_CACHE_PREFIX = 'nav-html-';
const VERSIONED_ASSET_CACHE_PREFIX = 'asset-versioned-';
const LEGACY_VERSIONED_ASSET_CACHE_PREFIX = 'asset-static-';
const FINGERPRINT_ASSET_CACHE = 'asset-fingerprint';

const root = document.documentElement;
const updateCopyPromises = new Map();
const updateCopyCache = new Map();

let waitingWorker = null;
let reloadOnControllerChange = false;
let updateCheckTimer = null;
let warmedCurrentUrl = '';
let updateFallbackPrompted = false;
let enableModeStarted = false;
let activeRuntime = null;
let versionMenuStatus = 'idle';
let versionMenuLatencyMs = null;
let versionMenuCheckPromise = null;
let activationFallbackTimer = null;

function getVersionMenus() {
    return Array.from(document.querySelectorAll('[data-site-version-menu]'));
}

function getUsableVersionMenu() {
    return getVersionMenus().find(isUsableElement) || null;
}

function getVersionMenuRoot(target) {
    return target instanceof Element ? target.closest('[data-site-version-menu]') : null;
}

function getVersionPanel(menuRoot) {
    return menuRoot instanceof Element ? menuRoot.querySelector('[data-nav-utility-panel]') : null;
}

function getVersionTrigger(menuRoot) {
    return menuRoot instanceof Element ? menuRoot.querySelector('[data-site-version-trigger]') : null;
}

function isVersionMenuOpen(menuRoot) {
    return menuRoot instanceof Element && menuRoot.classList.contains('is-open');
}

function closeVersionMenu(menuRoot) {
    if (!(menuRoot instanceof Element)) return;

    const closeRoot = window.__banyanNavUtilityMenus?.closeRoot;
    if (typeof closeRoot === 'function' && closeRoot(menuRoot)) return;

    const panel = getVersionPanel(menuRoot);
    const trigger = getVersionTrigger(menuRoot);
    menuRoot.classList.remove('is-open');
    menuRoot.removeAttribute('data-open');
    if (panel instanceof HTMLElement) panel.hidden = true;
    if (trigger instanceof HTMLElement) trigger.setAttribute('aria-expanded', 'false');
}

function isUsableElement(element) {
    if (!(element instanceof HTMLElement)) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return element.getClientRects().length > 0;
}

function setUpdateReadyState(ready) {
    if (ready) {
        versionMenuStatus = 'ready';
        root.setAttribute(UPDATE_STATE_ATTR, UPDATE_STATE_READY);
        void maybePromptUpdateFallback();
        void renderVersionMenus('ready', { onlyOpen: true });
        return;
    }

    root.removeAttribute(UPDATE_STATE_ATTR);
    updateFallbackPrompted = false;
    if (versionMenuStatus === 'ready') versionMenuStatus = 'idle';
    void renderVersionMenus(versionMenuStatus, { onlyOpen: true });
}

function getFallbackUpdateCopy() {
    return {
        message: 'A new version is ready. Refresh now?',
        confirm: 'Refresh',
        later: 'Later',
        versionCheck: 'Check now',
        versionChecking: 'Checking...',
        versionCheckFailed: 'Check failed',
        versionStatus: 'Status',
        versionStatusCurrent: 'Up to date',
        versionStatusReady: 'New version available',
        versionStatusOffline: 'Offline',
        versionStatusClickUpdate: 'click update',
        versionStatusClickRetry: 'click retry',
        versionChangelogHref: ''
    };
}

function normalizeUpdateCopy(messages) {
    const fallback = getFallbackUpdateCopy();
    if (!messages || typeof messages !== 'object') return fallback;

    return {
        message: typeof messages.site_update_prompt === 'string' && messages.site_update_prompt ? messages.site_update_prompt : fallback.message,
        confirm: typeof messages.site_update_confirm === 'string' && messages.site_update_confirm ? messages.site_update_confirm : fallback.confirm,
        later: typeof messages.site_update_later === 'string' && messages.site_update_later ? messages.site_update_later : fallback.later,
        versionCheck: typeof messages.site_version_check === 'string' && messages.site_version_check ? messages.site_version_check : fallback.versionCheck,
        versionChecking: typeof messages.site_version_checking === 'string' && messages.site_version_checking ? messages.site_version_checking : fallback.versionChecking,
        versionCheckFailed: typeof messages.site_version_check_failed === 'string' && messages.site_version_check_failed ? messages.site_version_check_failed : fallback.versionCheckFailed,
        versionStatus: typeof messages.site_version_status === 'string' && messages.site_version_status ? messages.site_version_status : fallback.versionStatus,
        versionStatusCurrent: typeof messages.site_version_status_current === 'string' && messages.site_version_status_current ? messages.site_version_status_current : fallback.versionStatusCurrent,
        versionStatusReady: typeof messages.site_version_status_ready === 'string' && messages.site_version_status_ready ? messages.site_version_status_ready : fallback.versionStatusReady,
        versionStatusOffline: typeof messages.site_version_status_offline === 'string' && messages.site_version_status_offline ? messages.site_version_status_offline : fallback.versionStatusOffline,
        versionStatusClickUpdate: typeof messages.site_version_status_click_update === 'string' && messages.site_version_status_click_update ? messages.site_version_status_click_update : fallback.versionStatusClickUpdate,
        versionStatusClickRetry: typeof messages.site_version_status_click_retry === 'string' && messages.site_version_status_click_retry ? messages.site_version_status_click_retry : fallback.versionStatusClickRetry,
        versionChangelogHref: typeof messages.site_version_changelog_href === 'string' ? messages.site_version_changelog_href : fallback.versionChangelogHref
    };
}

async function hydrateUpdateCopy(lang = document.documentElement.lang || '') {
    const langKey = typeof lang === 'string' && lang ? lang.toLowerCase() : '';
    if (updateCopyCache.has(langKey)) return updateCopyCache.get(langKey);

    if (!updateCopyPromises.has(langKey)) {
        updateCopyPromises.set(langKey, (async () => {
            const fallback = getFallbackUpdateCopy();
            const manifest = await getRuntimeManifest();
            const url = getRuntimeI18nUrl(manifest, langKey);
            if (!url) {
                updateCopyCache.set(langKey, fallback);
                return fallback;
            }

            try {
                const copy = normalizeUpdateCopy(await fetchRuntimeJson(url));
                updateCopyCache.set(langKey, copy);
                return copy;
            } catch (error) {
                updateCopyCache.set(langKey, fallback);
                return fallback;
            }
        })());
    }

    return updateCopyPromises.get(langKey);
}

async function maybePromptUpdateFallback() {
    if (updateFallbackPrompted || getUsableVersionMenu()) return;

    updateFallbackPrompted = true;
    const copy = await hydrateUpdateCopy();
    if (window.confirm(copy.message) && activeRuntime) {
        void applyWaitingWorker(activeRuntime);
    }
}

function getVersionChangelogHref(copy, menuRoot) {
    const menuHref = menuRoot instanceof HTMLElement ? menuRoot.dataset.siteVersionChangelogHref || '' : '';
    return menuHref || copy.versionChangelogHref || '';
}

function getVersionStatusValue(copy, status) {
    if (status === 'checking') return copy.versionChecking;
    if (status === 'failed') return `${copy.versionCheckFailed} · ${copy.versionStatusClickRetry}`;
    if (status === 'offline') return `${copy.versionStatusOffline} · ${copy.versionStatusClickRetry}`;
    if (root.getAttribute(UPDATE_STATE_ATTR) === UPDATE_STATE_READY) return `${copy.versionStatusReady} · ${copy.versionStatusClickUpdate}`;

    const latency = Number.isFinite(versionMenuLatencyMs) && versionMenuLatencyMs >= 0
        ? ` · ${Math.round(versionMenuLatencyMs)}ms`
        : '';
    return `${copy.versionStatusCurrent}${latency}`;
}

function createOption({ text, href = '', action = '', disabled = false, title = '' }) {
    const option = href ? document.createElement('a') : document.createElement('button');
    option.className = 'ui-dropdown-option site-nav-utility-option';
    option.dataset.navUtilityOption = 'true';
    option.textContent = text;
    if (href) {
        option.href = href;
    } else {
        option.type = 'button';
        option.disabled = disabled;
    }
    if (action) option.dataset.siteVersionAction = action;
    if (title) option.title = title;
    return option;
}

async function renderVersionMenu(menuRoot, status = versionMenuStatus) {
    const panel = getVersionPanel(menuRoot);
    if (!(panel instanceof HTMLElement)) return;

    const copy = await hydrateUpdateCopy();
    const manifest = await getRuntimeManifest();
    const version = getRuntimeBuildVersion(manifest) || '-';
    const changelogHref = getVersionChangelogHref(copy, menuRoot);
    const statusValue = getVersionStatusValue(copy, status);

    panel.replaceChildren(
        createOption({
            text: version,
            href: changelogHref,
            disabled: !changelogHref
        }),
        createOption({
            text: `${copy.versionStatus}: ${statusValue}`,
            action: 'check',
            disabled: status === 'checking',
            title: root.getAttribute(UPDATE_STATE_ATTR) === UPDATE_STATE_READY ? copy.versionStatusClickUpdate : copy.versionCheck
        })
    );
}

async function renderVersionMenus(status = versionMenuStatus, { onlyOpen = false } = {}) {
    await Promise.all(getVersionMenus().map((menuRoot) => {
        if (onlyOpen && !isVersionMenuOpen(menuRoot)) return Promise.resolve();
        return renderVersionMenu(menuRoot, status);
    }));
}

async function checkForUpdatesFromMenu(runtime, menuRoot) {
    if (root.getAttribute(UPDATE_STATE_ATTR) === UPDATE_STATE_READY) {
        closeVersionMenu(menuRoot);
        await applyWaitingWorker(runtime);
        return;
    }

    if (versionMenuCheckPromise) return versionMenuCheckPromise;

    if (navigator.onLine === false) {
        versionMenuLatencyMs = null;
        versionMenuStatus = 'offline';
        await renderVersionMenu(menuRoot, 'offline');
        return;
    }

    const checkStartedAt = performance.now();
    versionMenuLatencyMs = null;
    versionMenuStatus = 'checking';
    await renderVersionMenu(menuRoot, 'checking');

    versionMenuCheckPromise = (async () => {
        try {
            const registration = runtime.getActiveRegistration() || await runtime.getActiveWorkerRegistration();
            if (!registration) {
                versionMenuLatencyMs = null;
                versionMenuStatus = 'failed';
                await renderVersionMenu(menuRoot, 'failed');
                return;
            }

            await registration.update();
            versionMenuLatencyMs = Math.max(0, performance.now() - checkStartedAt);
            if (bindWaitingWorker(runtime, registration)) {
                versionMenuStatus = 'ready';
                await renderVersionMenu(menuRoot, 'ready');
                return;
            }

            versionMenuStatus = 'current';
            await renderVersionMenu(menuRoot, 'current');
        } catch (error) {
            versionMenuLatencyMs = null;
            versionMenuStatus = navigator.onLine === false ? 'offline' : 'failed';
            await renderVersionMenu(menuRoot, versionMenuStatus);
        } finally {
            versionMenuCheckPromise = null;
        }
    })();

    return versionMenuCheckPromise;
}

function clearActivationFallbackTimer() {
    if (!activationFallbackTimer) return;

    window.clearTimeout(activationFallbackTimer);
    activationFallbackTimer = null;
}

function isManagedCacheKey(key) {
    return key === FINGERPRINT_ASSET_CACHE
        || key.startsWith(NAVIGATION_CACHE_PREFIX)
        || key.startsWith(VERSIONED_ASSET_CACHE_PREFIX)
        || key.startsWith(LEGACY_VERSIONED_ASSET_CACHE_PREFIX);
}

async function clearManagedCaches() {
    if (!('caches' in window)) return;

    try {
        const keys = await caches.keys();
        await Promise.all(keys.filter(isManagedCacheKey).map((key) => caches.delete(key)));
    } catch (error) { }
}

function isReloadNavigation() {
    try {
        const entry = performance.getEntriesByType('navigation')[0];
        if (entry?.type) return entry.type === 'reload';
    } catch (error) { }

    try {
        return performance.navigation && performance.navigation.type === 1;
    } catch (error) {
        return false;
    }
}

async function warmCurrentPage(runtime) {
    const currentUrl = new URL(window.location.href);
    currentUrl.hash = '';
    const href = currentUrl.toString();
    if (warmedCurrentUrl === href) return;

    warmedCurrentUrl = href;
    try {
        const registration = runtime ? await runtime.getActiveWorkerRegistration() : null;
        const worker = registration?.active || null;
        if (!worker) return;

        worker.postMessage({
            type: 'WARM_NAV_BATCH',
            urls: [href]
        });
    } catch (error) { }
}

function bindWaitingWorker(runtime, registration) {
    if (!registration?.waiting) return false;

    runtime.setActiveRegistration(registration);
    waitingWorker = registration.waiting;
    setUpdateReadyState(true);
    void warmCurrentPage(runtime);
    return true;
}

function watchInstallingWorker(runtime, registration) {
    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            bindWaitingWorker(runtime, registration);
        }
    });
}

function markBackgroundUpdateChecked(runtime, registration) {
    if (bindWaitingWorker(runtime, registration)) return;
    versionMenuLatencyMs = null;
    if (versionMenuStatus !== 'ready') versionMenuStatus = 'current';
    void renderVersionMenus(versionMenuStatus, { onlyOpen: true });
}

function scheduleRegistrationUpdates(runtime, registration) {
    if (updateCheckTimer) return;

    const intervalMs = runtime.updateCheckInterval || 15 * 60 * 1000;
    const throttleMs = runtime.updateVisibilityThrottle || 3 * 60 * 1000;

    updateCheckTimer = window.setInterval(() => {
        registration.update()
            .then(() => markBackgroundUpdateChecked(runtime, registration))
            .catch(() => { });
    }, intervalMs);

    let lastUpdateCheck = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;

        const now = Date.now();
        if (now - lastUpdateCheck <= throttleMs) return;

        lastUpdateCheck = now;
        registration.update()
            .then(() => markBackgroundUpdateChecked(runtime, registration))
            .catch(() => { });
    });
}

async function resolveWaitingWorker(runtime, registration) {
    if (registration?.waiting) {
        runtime.setActiveRegistration(registration);
        waitingWorker = registration.waiting;
        setUpdateReadyState(true);
        void warmCurrentPage(runtime);
    }

    if (waitingWorker && waitingWorker.state !== 'redundant') return waitingWorker;

    waitingWorker = null;
    await registration?.update().catch(() => { });
    if (bindWaitingWorker(runtime, registration)) return waitingWorker;
    return null;
}

async function recoverStuckWaitingWorker(registration) {
    clearActivationFallbackTimer();
    waitingWorker = null;
    reloadOnControllerChange = false;
    setUpdateReadyState(false);

    try {
        await registration?.unregister();
    } catch (error) { }

    await clearManagedCaches();
    window.location.reload();
}

function scheduleActivationFallback(runtime, registration, expectedWorker) {
    clearActivationFallbackTimer();

    activationFallbackTimer = window.setTimeout(() => {
        void (async () => {
            try {
                if (!reloadOnControllerChange) return;

                const currentRegistration = runtime.getActiveRegistration() || registration;
                if (!currentRegistration) {
                    window.location.reload();
                    return;
                }

                await currentRegistration.update().catch(() => { });
                if (currentRegistration.waiting === expectedWorker) {
                    await recoverStuckWaitingWorker(currentRegistration);
                    return;
                }

                window.location.reload();
            } catch (error) {
                window.location.reload();
            }
        })();
    }, SW_ACTIVATION_TIMEOUT_MS);
}

async function applyWaitingWorker(runtime) {
    const activeRegistration = runtime.getActiveRegistration();
    if (!activeRegistration) return;

    const targetWaitingWorker = await resolveWaitingWorker(runtime, activeRegistration);
    if (!targetWaitingWorker) {
        window.location.reload();
        return;
    }

    setUpdateReadyState(false);
    closeVersionMenu(getUsableVersionMenu());
    reloadOnControllerChange = true;
    scheduleActivationFallback(runtime, activeRegistration, targetWaitingWorker);

    try {
        targetWaitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
        await recoverStuckWaitingWorker(activeRegistration);
    }
}

async function handleEnableMode(runtime) {
    try {
        // updateViaCache=none 让浏览器检查 /sw.js 时绕过 HTTP 缓存，尽快发现新 worker。
        const registration = await navigator.serviceWorker.register(runtime.swUrl, {
            scope: runtime.swScope,
            updateViaCache: 'none'
        });
        runtime.setActiveRegistration(registration);

        const hasWaitingWorker = bindWaitingWorker(runtime, registration);
        if (hasWaitingWorker && isReloadNavigation()) {
            void applyWaitingWorker(runtime);
            return;
        }

        watchInstallingWorker(runtime, registration);
        registration.addEventListener('updatefound', () => {
            watchInstallingWorker(runtime, registration);
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            waitingWorker = null;
            clearActivationFallbackTimer();
            setUpdateReadyState(false);
            if (reloadOnControllerChange) window.location.reload();
        });

        scheduleRegistrationUpdates(runtime, registration);
        void warmCurrentPage(runtime);
        navigator.serviceWorker.ready.then((readyRegistration) => {
            if (readyRegistration?.active) runtime.setActiveRegistration(readyRegistration);
        }).catch(() => { });
    } catch (error) { }
}

function bindVersionMenuUi(runtime) {
    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const actionTarget = target.closest('[data-site-version-action]');
        if (actionTarget?.dataset.siteVersionAction === 'check') {
            const menuRoot = getVersionMenuRoot(actionTarget);
            if (!menuRoot) return;

            event.preventDefault();
            void checkForUpdatesFromMenu(runtime, menuRoot);
            return;
        }

        const trigger = target.closest('[data-site-version-trigger]');
        if (!trigger) return;

        const menuRoot = getVersionMenuRoot(trigger);
        if (!menuRoot || isVersionMenuOpen(menuRoot)) return;

        if (root.getAttribute(UPDATE_STATE_ATTR) === UPDATE_STATE_READY) {
            void renderVersionMenu(menuRoot, 'ready');
            return;
        }
        void checkForUpdatesFromMenu(runtime, menuRoot);
    }, true);
}

export function startEnableMode(runtime) {
    if (!runtime?.supportsServiceWorker() || enableModeStarted) return;

    enableModeStarted = true;
    activeRuntime = runtime;
    bindVersionMenuUi(runtime);

    if (document.readyState === 'complete') {
        void handleEnableMode(runtime);
        return;
    }

    window.addEventListener('load', () => {
        void handleEnableMode(runtime);
    }, { once: true });
}
