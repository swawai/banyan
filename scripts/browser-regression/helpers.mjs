export function fail(message, details = null) {
    const error = new Error(message);
    if (details) error.details = details;
    throw error;
}

export function suppressLanguageSuggestDialogScript() {
    return () => {
        try {
            // Keep browser-regression deterministic: language recommendation dialogs
            // are covered by nav utilities, not by SW / breadcrumb scenarios.
            window.localStorage.setItem('lang-suggest-handled-v1', '1');
        } catch (error) { }
    };
}

export async function pollUntil(check, options = {}) {
    const timeoutMs = options.timeoutMs || 10000;
    const intervalMs = options.intervalMs || 250;
    const label = options.label || 'pollUntil';
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
        const result = await check();
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    fail(`${label} timed out after ${timeoutMs}ms.`);
}

export function recordLayoutShiftObserverScript() {
    return () => {
        window.__banyanLayoutShiftValue = 0;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) {
                        window.__banyanLayoutShiftValue += entry.value;
                    }
                }
            });
            observer.observe({ type: 'layout-shift', buffered: true });
        } catch (error) { }
    };
}

export function recordSecurityPolicyViolationScript() {
    return () => {
        window.__banyanSecurityPolicyViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
            try {
                window.__banyanSecurityPolicyViolations.push({
                    blockedURI: event.blockedURI || '',
                    disposition: event.disposition || '',
                    effectiveDirective: event.effectiveDirective || '',
                    originalPolicy: event.originalPolicy || '',
                    sample: event.sample || '',
                    sourceFile: event.sourceFile || '',
                    statusCode: Number(event.statusCode || 0)
                });
            } catch (error) { }
        });
    };
}

export async function gotoAndWait(page, url) {
    const response = await page.goto(url, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => { });
    return response;
}

export async function waitForBreadcrumbSettled(page, timeoutMs = 8000) {
    await page.waitForFunction(() => {
        const root = document.documentElement;
        return !root.hasAttribute('data-entry-breadcrumb-preview-pending')
            && !root.hasAttribute('data-entry-breadcrumb-runtime-pending')
            && !root.hasAttribute('data-entry-breadcrumb-meta-pending')
            && !root.hasAttribute('data-breadcrumb-sort-pending');
    }, { timeout: timeoutMs });
}

export async function getLayoutShiftValue(page) {
    return page.evaluate(() => Number(window.__banyanLayoutShiftValue || 0));
}

export async function getMainInlineStart(page) {
    const box = await page.locator('.slot-main').boundingBox();
    return box ? box.x : null;
}

export async function readFragmentRoot(page) {
    return page.evaluate(() => document.body?.dataset.fragmentRoot || '');
}

export async function readSecurityPolicyViolations(page) {
    return page.evaluate(() => {
        const violations = window.__banyanSecurityPolicyViolations;
        return Array.isArray(violations) ? violations.slice() : [];
    });
}

export async function waitForServiceWorkerActive(page, timeoutMs = 10000) {
    await page.waitForFunction(async () => {
        if (!('serviceWorker' in navigator)) return false;
        try {
            const registration = await navigator.serviceWorker.ready;
            return !!registration?.active;
        } catch (error) {
            return false;
        }
    }, { timeout: timeoutMs });
}

export async function forceServiceWorkerUpdate(page) {
    await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return;
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.update().catch(() => { })));
        } catch (error) { }
    });
}

export async function waitForUpdateReady(page, timeoutMs = 15000) {
    await page.waitForFunction(() => document.documentElement.getAttribute('data-site-update') === 'ready', {
        timeout: timeoutMs
    });
}

export async function countUsableVersionMenus(page) {
    return page.evaluate(() => {
        const menus = Array.from(document.querySelectorAll('[data-site-version-menu]'));
        return menus.filter((menu) => {
            if (!(menu instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(menu);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return menu.getClientRects().length > 0;
        }).length;
    });
}

export async function markFirstUsableVersionMenu(page) {
    const found = await page.evaluate(() => {
        const menus = Array.from(document.querySelectorAll('[data-site-version-menu]'));
        const usable = menus.find((menu) => {
            if (!(menu instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(menu);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return menu.getClientRects().length > 0;
        });
        if (!usable) return false;
        usable.setAttribute('data-browser-regression-target', 'true');
        return true;
    });

    if (!found) {
        fail('No usable data-site-version-menu was found on the page.');
    }
}

export async function markUsableVersionMenus(page) {
    return page.evaluate(() => {
        const menus = Array.from(document.querySelectorAll('[data-site-version-menu]'));
        const marked = [];
        let nextId = 0;
        menus.forEach((menu) => {
            if (!(menu instanceof HTMLElement)) return;
            const style = window.getComputedStyle(menu);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            if (menu.getClientRects().length === 0) return;

            const id = String(nextId);
            nextId += 1;
            menu.setAttribute('data-browser-regression-menu-id', id);
            marked.push({
                id,
                text: (menu.textContent || '').trim()
            });
        });
        return marked;
    });
}
