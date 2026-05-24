import path from 'node:path';

import {
    countUsableVersionMenus,
    fail,
    forceServiceWorkerUpdate,
    getLayoutShiftValue,
    getMainInlineStart,
    gotoAndWait,
    markUsableVersionMenus,
    markFirstUsableVersionMenu,
    readFragmentRoot,
    readSecurityPolicyViolations,
    waitForBreadcrumbSettled,
    waitForServiceWorkerActive,
    waitForUpdateReady
} from './helpers.mjs';
import { relFromSite } from './paths.mjs';

const WIDE_VIEWPORT = { width: 1600, height: 1100 };
const EXPECTED_HOME_TITLE = process.env.BANYAN_BROWSER_HOME_TITLE || '';
const ARTICLE_PAGE_PATH = process.env.BANYAN_BROWSER_ARTICLE_PATH || '/about/';
const BREADCRUMB_PRODUCTS_PATH = process.env.BANYAN_BROWSER_BREADCRUMB_PRODUCTS_PATH || '/intent/explore/';
const BREADCRUMB_TAGS_PATH = process.env.BANYAN_BROWSER_BREADCRUMB_TAGS_PATH || '/intent/explore/';
const DESIGN_AUDIT_VIEWPORTS = [
    {
        id: 'mobile',
        title: 'Mobile',
        viewport: { width: 390, height: 844 }
    },
    {
        id: 'medium',
        title: 'Medium',
        viewport: { width: 1024, height: 960 }
    },
    {
        id: 'wide',
        title: 'Wide',
        viewport: { width: 1440, height: 1100 }
    }
];
const DESIGN_AUDIT_PAGES = [
    {
        id: 'home',
        path: '/',
        title: 'Home',
        waitForSelector: '.slot-main'
    },
    {
        id: 'products',
        path: '/products/first-party/',
        title: 'Products',
        waitForSelector: '.grid-list'
    },
    {
        id: 'article',
        path: ARTICLE_PAGE_PATH,
        title: 'Article',
        waitForSelector: '.article'
    }
];

function ensureTwoBuilds(upgradePair) {
    if (!upgradePair?.fromDir || !upgradePair?.toDir) {
        fail('SW upgrade scenarios require two built outputs under temp_workspace/public/.');
    }
}

async function readExpectedSiteVersionUpdateLabel(page, lang) {
    return page.evaluate(async (targetLang) => {
        const normalize = (value) => typeof value === 'string' ? value.toLowerCase() : '';
        const fallbackPrompt = 'click update';
        const manifestUrl = document.body?.dataset.assetManifestUrl || '';
        if (!manifestUrl) return fallbackPrompt;

        const manifestResponse = await fetch(manifestUrl, { credentials: 'same-origin' }).catch(() => null);
        const manifest = manifestResponse && manifestResponse.ok ? await manifestResponse.json().catch(() => ({})) : {};
        const i18nMap = manifest && typeof manifest.i18n === 'object' ? manifest.i18n : null;
        const fallbackMap = manifest && typeof manifest.i18nFallbacks === 'object' ? manifest.i18nFallbacks : null;
        if (!i18nMap) return fallbackPrompt;

        let current = normalize(targetLang);
        const visited = new Set();
        let resolvedUrl = '';
        while (current && !visited.has(current)) {
            visited.add(current);
            if (typeof i18nMap[current] === 'string' && i18nMap[current]) {
                resolvedUrl = i18nMap[current];
                break;
            }
            current = fallbackMap && typeof fallbackMap[current] === 'string'
                ? normalize(fallbackMap[current])
                : '';
        }

        if (!resolvedUrl) return fallbackPrompt;
        const i18nResponse = await fetch(resolvedUrl, { credentials: 'same-origin' }).catch(() => null);
        const messages = i18nResponse && i18nResponse.ok ? await i18nResponse.json().catch(() => ({})) : {};
        return typeof messages?.site_version_status_click_update === 'string' && messages.site_version_status_click_update
            ? messages.site_version_status_click_update
            : fallbackPrompt;
    }, lang);
}

async function clickMarkedVersionTrigger(page) {
    const target = page.locator('[data-browser-regression-target="true"]').first();
    const trigger = target.locator('[data-site-version-trigger]').first();
    if (await trigger.count()) {
        await trigger.click();
        return;
    }

    await target.click();
}

async function waitForVersionDropdown(page) {
    await page.waitForSelector('[data-site-version-menu].is-open [data-nav-utility-panel]:not([hidden])');
}

async function readVersionDropdownText(page) {
    return (await page.locator('[data-site-version-menu] [data-nav-utility-panel]').first().textContent() || '').trim();
}

async function waitForVersionDropdownText(page, text) {
    await page.waitForFunction((expected) => {
        const panel = document.querySelector('[data-site-version-menu].is-open [data-nav-utility-panel]');
        return Boolean(panel?.textContent?.includes(expected));
    }, text);
}

async function settleDesignAuditPage(page) {
    await waitForBreadcrumbSettled(page).catch(() => { });
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function readDesignAuditMetrics(page, viewportId) {
    return page.evaluate((activeViewportId) => {
        const rect = (selector) => {
            const node = document.querySelector(selector);
            if (!(node instanceof HTMLElement)) return null;
            const box = node.getBoundingClientRect();
            return {
                height: box.height,
                width: box.width,
                x: box.x,
                y: box.y
            };
        };
        const navLabels = Array.from(document.querySelectorAll('.page-topbar a, .page-topbar button'))
            .map((node) => (node.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 16);
        return {
            documentHeight: document.documentElement.scrollHeight,
            hasRailContext: (() => {
                const node = document.querySelector('.page-rail-context');
                return node instanceof HTMLElement && getComputedStyle(node).display !== 'none';
            })(),
            main: rect('.slot-main'),
            page: rect('.page'),
            pathname: location.pathname,
            rail: rect('.page-rail'),
            stage: rect('.page-stage'),
            title: document.title,
            topbar: rect('.page-topbar'),
            topbarLabels: navLabels,
            viewportId: activeViewportId,
            visibleBreadcrumb: (() => {
                const node = document.querySelector('.slot-row-breadcrumb');
                if (!(node instanceof HTMLElement)) return false;
                const style = getComputedStyle(node);
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && node.getClientRects().length > 0;
            })()
        };
    }, viewportId);
}

function createDesignAuditScenario(pageConfig, viewportConfig) {
    return {
        id: `design-audit-${pageConfig.id}-${viewportConfig.id}`,
        kind: 'single',
        title: `Design Audit ${pageConfig.title} (${viewportConfig.title})`,
        viewport: viewportConfig.viewport,
        async run({ artifactDir, baseUrl, page }) {
            await gotoAndWait(page, `${baseUrl}${pageConfig.path}`);
            await page.waitForSelector(pageConfig.waitForSelector);
            await settleDesignAuditPage(page);

            const screenshotPath = path.join(artifactDir, 'capture.png');
            await page.screenshot({
                fullPage: true,
                path: screenshotPath
            });

            return {
                artifacts: {
                    screenshot: relFromSite(screenshotPath)
                },
                details: await readDesignAuditMetrics(page, viewportConfig.id),
                message: `Captured ${pageConfig.id} at ${viewportConfig.id}.`
            };
        }
    };
}

function readCspHeader(response) {
    return readResponseHeader(response, 'content-security-policy');
}

function readResponseHeader(response, headerName) {
    if (!response) {
        return '';
    }
    const headers = response.headers();
    return headers[headerName.toLowerCase()] || '';
}

function filterCspConsoleMessages(entries) {
    return entries.filter((entry) => {
        const text = `${entry.text || ''}`.toLowerCase();
        return text.includes('content security policy') || text.includes('csp');
    });
}

function filterPreloadCredentialConsoleMessages(entries) {
    return entries.filter((entry) => {
        const text = `${entry.text || ''}`.toLowerCase();
        return text.includes('preload')
            && text.includes('request credentials mode does not match');
    });
}

function createConsoleRecorder(page, entries) {
    page.on('console', (message) => {
        entries.push({
            text: message.text(),
            type: message.type()
        });
    });
}

function assertCspPolicy(headerValue, details = {}) {
    if (!headerValue) {
        fail('Response did not include Content-Security-Policy.', details);
    }
    if (!headerValue.includes("script-src 'self' 'report-sample'")) {
        fail('CSP is missing the expected script-src baseline.', {
            ...details,
            headerValue
        });
    }
}

function assertAdjacentSecurityHeaders(response, details = {}) {
    const permissionsPolicy = readResponseHeader(response, 'permissions-policy');
    if (!permissionsPolicy) {
        fail('Response did not include Permissions-Policy.', details);
    }
    for (const directive of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']) {
        if (!permissionsPolicy.includes(directive)) {
            fail('Permissions-Policy is missing an expected denied capability.', {
                ...details,
                directive,
                permissionsPolicy
            });
        }
    }

    const hsts = readResponseHeader(response, 'strict-transport-security');
    if (!hsts) {
        fail('Response did not include Strict-Transport-Security.', details);
    }
    if (!/^max-age=300(?:\s*;|$)/i.test(hsts.trim())) {
        fail('Strict-Transport-Security should remain in the initial ramp-up stage.', {
            ...details,
            hsts
        });
    }
    if (/includeSubDomains|preload/i.test(hsts)) {
        fail('Strict-Transport-Security should not enable includeSubDomains or preload during ramp-up.', {
            ...details,
            hsts
        });
    }

    return {
        hsts,
        permissionsPolicy
    };
}

async function assertServiceWorkerNavigationPreloadDisabled(page) {
    const result = await page.evaluate(async () => {
        const response = await fetch('/sw.js', {
            cache: 'no-store',
            credentials: 'same-origin'
        }).catch(() => null);
        if (!response) {
            return { ok: false, status: 0, text: '' };
        }
        return {
            ok: response.ok,
            status: response.status,
            text: await response.text().catch(() => '')
        };
    });

    if (!result.ok) {
        fail('Unable to read generated sw.js for navigation preload guardrail.', {
            status: result.status
        });
    }
    if (/navigationPreload\s*\.\s*enable\s*\(/.test(result.text)) {
        fail('sw.js should not enable navigation preload while navigation caching is cache-first.');
    }
    if (!/navigationPreload[\s\S]{0,200}\.\s*disable\s*\(/.test(result.text)) {
        fail('sw.js should explicitly disable navigation preload to clean up older active registrations.');
    }
}

async function collectSecurityOutcome(page, response, consoleEntries, extraDetails = {}) {
    const csp = readCspHeader(response);
    assertCspPolicy(csp, extraDetails);
    const adjacentHeaders = assertAdjacentSecurityHeaders(response, extraDetails);

    await page.waitForTimeout(250);
    const violations = await readSecurityPolicyViolations(page);
    const cspConsoleMessages = filterCspConsoleMessages(consoleEntries);
    const preloadCredentialConsoleMessages = filterPreloadCredentialConsoleMessages(consoleEntries);
    if (violations.length > 0) {
        fail('Page triggered SecurityPolicyViolationEvent entries under enforced CSP.', {
            ...extraDetails,
            csp,
            violations
        });
    }
    if (cspConsoleMessages.length > 0) {
        fail('Page emitted CSP-related console messages under enforced CSP.', {
            ...extraDetails,
            consoleMessages: cspConsoleMessages,
            csp
        });
    }
    if (preloadCredentialConsoleMessages.length > 0) {
        fail('Page emitted preload credential mismatch console messages.', {
            ...extraDetails,
            consoleMessages: preloadCredentialConsoleMessages
        });
    }

    return {
        consoleMessageCount: consoleEntries.length,
        cspConsoleMessages,
        csp,
        ...adjacentHeaders,
        preloadCredentialConsoleMessages,
        violations
    };
}

export const designAuditScenarios = DESIGN_AUDIT_PAGES.flatMap((pageConfig) => (
    DESIGN_AUDIT_VIEWPORTS.map((viewportConfig) => createDesignAuditScenario(pageConfig, viewportConfig))
));

export const securityScenarios = [
    {
        id: 'security-csp-enforce-home',
        kind: 'single',
        title: 'Security: CSP Enforce Home',
        viewport: { width: 1440, height: 960 },
        async run({ page, baseUrl }) {
            const consoleEntries = [];
            createConsoleRecorder(page, consoleEntries);
            const response = await gotoAndWait(page, `${baseUrl}/`);
            await page.waitForSelector('.slot-main');

            return collectSecurityOutcome(page, response, consoleEntries, {
                path: '/'
            });
        }
    },
    {
        id: 'security-sw-navigation-preload-disabled',
        kind: 'single',
        title: 'Security: SW Navigation Preload Disabled',
        viewport: { width: 1440, height: 960 },
        async run({ page, baseUrl }) {
            await gotoAndWait(page, `${baseUrl}/`);
            await assertServiceWorkerNavigationPreloadDisabled(page);

            return {
                message: 'sw.js disables navigation preload for cache-first navigations.'
            };
        }
    },
    {
        id: 'security-csp-enforce-breadcrumb-wide',
        kind: 'single',
        title: 'Security: CSP Enforce Breadcrumb Wide',
        viewport: WIDE_VIEWPORT,
        async run({ page, baseUrl }) {
            const consoleEntries = [];
            createConsoleRecorder(page, consoleEntries);
            const url = `${baseUrl}${BREADCRUMB_PRODUCTS_PATH}`;
            const response = await gotoAndWait(page, url);
            await page.waitForSelector('.slot-row-breadcrumb');
            await waitForBreadcrumbSettled(page);

            return collectSecurityOutcome(page, response, consoleEntries, {
                path: BREADCRUMB_PRODUCTS_PATH
            });
        }
    }
];

async function readBreadcrumbPrefetchSlotContract(page) {
    return page.evaluate(() => {
        const describeAnchor = (anchor) => ({
            className: anchor.getAttribute('class') || '',
            href: anchor.getAttribute('href') || '',
            slot: anchor.getAttribute('data-prefetch-slot') || '',
            text: (anchor.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
        });

        const breadcrumbAnchors = Array.from(document.querySelectorAll([
            'a.breadcrumb-link[href]',
            'a.breadcrumb-root-link[href]',
            'a.breadcrumb-menu-option[href]'
        ].join(',')));
        const slotRowAnchors = Array.from(document.querySelectorAll('.slot-row-breadcrumb a[href]'));
        const slotRowBreadcrumbMenuOptions = Array.from(document.querySelectorAll(
            '.slot-row-breadcrumb a.breadcrumb-menu-option[href]'
        ));

        const breadcrumbInvalidAnchors = breadcrumbAnchors
            .filter((anchor) => anchor.getAttribute('data-prefetch-slot') !== 'crumb')
            .map(describeAnchor);
        const slotRowNavAnchors = slotRowAnchors
            .filter((anchor) => anchor.getAttribute('data-prefetch-slot') === 'nav')
            .map(describeAnchor);
        const slotRowBreadcrumbMenuOptionsWithoutCrumb = slotRowBreadcrumbMenuOptions
            .filter((anchor) => anchor.getAttribute('data-prefetch-slot') !== 'crumb')
            .map(describeAnchor);

        return {
            breadcrumbAnchorCount: breadcrumbAnchors.length,
            breadcrumbCrumbAnchorCount: breadcrumbAnchors.filter((anchor) => (
                anchor.getAttribute('data-prefetch-slot') === 'crumb'
            )).length,
            breadcrumbInvalidAnchors,
            slotRowAnchorCount: slotRowAnchors.length,
            slotRowBreadcrumbMenuOptionCount: slotRowBreadcrumbMenuOptions.length,
            slotRowBreadcrumbMenuOptionsWithoutCrumb,
            slotRowNavAnchors
        };
    });
}

export const scenarios = [
    {
        id: 'home-shell-smoke',
        kind: 'single',
        title: 'Home Shell Smoke',
        viewport: { width: 1440, height: 960 },
        async run({ page, baseUrl }) {
            await gotoAndWait(page, `${baseUrl}/`);
            const title = await page.title();
            if (EXPECTED_HOME_TITLE && !title.includes(EXPECTED_HOME_TITLE)) {
                fail('Home page title did not contain the expected configured text.', {
                    expected: EXPECTED_HOME_TITLE,
                    title
                });
            }
            if (!EXPECTED_HOME_TITLE && !title) {
                fail('Home page title was empty.', { title });
            }
            const breadcrumbRuntimeCount = await page.locator('script[src*="breadcrumb-runtime"]').count();
            if (breadcrumbRuntimeCount !== 0) {
                fail('Home page should not load breadcrumb-runtime.', { breadcrumbRuntimeCount });
            }
            return {
                breadcrumbRuntimeCount,
                title
            };
        }
    },
    {
        id: 'breadcrumb-products-wide-stability',
        kind: 'single',
        title: 'Breadcrumb Wide Stability (Products)',
        viewport: WIDE_VIEWPORT,
        async run({ page, baseUrl }) {
            await gotoAndWait(page, `${baseUrl}${BREADCRUMB_PRODUCTS_PATH}`);
            await page.waitForSelector('.slot-row-breadcrumb');
            await waitForBreadcrumbSettled(page);
            const mainX1 = await getMainInlineStart(page);
            await page.waitForTimeout(800);
            const mainX2 = await getMainInlineStart(page);
            const cls = await getLayoutShiftValue(page);
            const delta = mainX1 !== null && mainX2 !== null ? Math.abs(mainX2 - mainX1) : null;
            if (delta !== null && delta > 1) {
                fail('Main column shifted after breadcrumb settled.', { mainX1, mainX2, delta });
            }
            if (cls > 0.1) {
                fail('Wide breadcrumb path caused excessive layout shift.', { cls });
            }
            return { cls, mainX1, mainX2, delta };
        }
    },
    {
        id: 'breadcrumb-prefetch-slot-contract',
        kind: 'single',
        title: 'Breadcrumb Prefetch Slot Contract',
        viewport: WIDE_VIEWPORT,
        async run({ page, baseUrl }) {
            await gotoAndWait(page, `${baseUrl}/d/products/?sort=name-asc`);
            await page.waitForSelector('.slot-row-breadcrumb');
            await waitForBreadcrumbSettled(page);

            const state = await readBreadcrumbPrefetchSlotContract(page);
            if (state.breadcrumbAnchorCount === 0) {
                fail('Breadcrumb prefetch contract scenario did not find any breadcrumb anchors.', state);
            }
            if (state.breadcrumbInvalidAnchors.length > 0) {
                fail('Breadcrumb anchors must use data-prefetch-slot="crumb".', state);
            }
            if (state.slotRowNavAnchors.length > 0) {
                fail('slot-row-breadcrumb must not contain nav prefetch anchors.', state);
            }
            if (state.slotRowBreadcrumbMenuOptionCount === 0) {
                fail('Sorted breadcrumb page did not expose rebuilt breadcrumb menu options.', state);
            }
            if (state.slotRowBreadcrumbMenuOptionsWithoutCrumb.length > 0) {
                fail('Runtime rebuilt breadcrumb menu options must keep data-prefetch-slot="crumb".', state);
            }

            return state;
        }
    },
    {
        id: 'breadcrumb-tags-wide-stability',
        kind: 'single',
        title: 'Breadcrumb Wide Stability (Tags)',
        viewport: WIDE_VIEWPORT,
        async run({ page, baseUrl }) {
            await gotoAndWait(page, `${baseUrl}${BREADCRUMB_TAGS_PATH}`);
            await page.waitForSelector('.slot-row-breadcrumb');
            await waitForBreadcrumbSettled(page);
            const mainX1 = await getMainInlineStart(page);
            await page.waitForTimeout(800);
            const mainX2 = await getMainInlineStart(page);
            const cls = await getLayoutShiftValue(page);
            const delta = mainX1 !== null && mainX2 !== null ? Math.abs(mainX2 - mainX1) : null;
            if (delta !== null && delta > 1) {
                fail('Main column shifted on tags-based breadcrumb path.', { mainX1, mainX2, delta });
            }
            if (cls > 0.1) {
                fail('Tags-based breadcrumb path caused excessive layout shift.', { cls });
            }
            return { cls, mainX1, mainX2, delta };
        }
    },
    {
        id: 'sw-home-register',
        kind: 'single',
        title: 'SW Register Smoke (Home)',
        viewport: { width: 1440, height: 960 },
        async run({ page, baseUrl }) {
            await gotoAndWait(page, `${baseUrl}/`);
            await waitForServiceWorkerActive(page);
            const state = await page.evaluate(async () => {
                const registration = await navigator.serviceWorker.getRegistration('/');
                return {
                    active: !!registration?.active,
                    installing: !!registration?.installing,
                    waiting: !!registration?.waiting
                };
            });
            if (!state.active) {
                fail('Home page did not get an active service worker registration.', state);
            }
            return state;
        }
    },
    {
        id: 'sw-update-version-dropdown',
        kind: 'upgrade',
        title: 'SW Upgrade Version Dropdown',
        viewport: WIDE_VIEWPORT,
        dialogPolicy: 'dismiss',
        async run({ page, baseUrl, dialogs, server, upgradePair }) {
            ensureTwoBuilds(upgradePair);
            server.setRoot(upgradePair.fromDir);
            await gotoAndWait(page, `${baseUrl}/all/`);
            const fragmentRootBefore = await readFragmentRoot(page);
            await waitForServiceWorkerActive(page);

            server.setRoot(upgradePair.toDir);
            await gotoAndWait(page, `${baseUrl}/all/`);
            await forceServiceWorkerUpdate(page);
            await waitForUpdateReady(page);

            const usableMenus = await countUsableVersionMenus(page);
            if (usableMenus < 1) {
                fail('Update-ready page had no usable version menu.', { usableMenus });
            }

            await markFirstUsableVersionMenu(page);
            await clickMarkedVersionTrigger(page);
            await waitForVersionDropdown(page);
            await page.waitForTimeout(250);

            if (dialogs.length > 0) {
                fail('Version menu page should not fall back to dialog when a usable menu exists.', { dialogs });
            }

            const fragmentRootAfter = await readFragmentRoot(page);
            return {
                fragmentRootBefore,
                fragmentRootAfter,
                usableMenus,
                dialogs: dialogs.slice()
            };
        }
    },
    {
        id: 'sw-update-home-version-dropdown',
        kind: 'upgrade',
        title: 'SW Upgrade Home Version Dropdown',
        viewport: { width: 1440, height: 960 },
        dialogPolicy: 'dismiss',
        async run({ page, baseUrl, dialogs, server, upgradePair }) {
            ensureTwoBuilds(upgradePair);
            server.setRoot(upgradePair.fromDir);
            await gotoAndWait(page, `${baseUrl}/`);
            const fragmentRootBefore = await readFragmentRoot(page);
            await waitForServiceWorkerActive(page);

            server.setRoot(upgradePair.toDir);
            await gotoAndWait(page, `${baseUrl}/`);
            await forceServiceWorkerUpdate(page);
            await waitForUpdateReady(page);

            const usableMenus = await countUsableVersionMenus(page);
            if (usableMenus !== 1) {
                fail('Home page should expose exactly one usable version menu.', { usableMenus });
            }

            await markFirstUsableVersionMenu(page);
            await clickMarkedVersionTrigger(page);
            await waitForVersionDropdown(page);

            if (dialogs.length > 0) {
                fail('Home page should use the version dropdown instead of fallback dialog.', { dialogs });
            }

            const dropdownText = await readVersionDropdownText(page);
            const fragmentRootAfter = await readFragmentRoot(page);
            return {
                dropdownText,
                fragmentRootBefore,
                fragmentRootAfter,
                usableMenus
            };
        }
    },
    {
        id: 'sw-update-version-menu-single-target',
        kind: 'single',
        title: 'SW Update Version Menu Single-target',
        viewport: WIDE_VIEWPORT,
        dialogPolicy: 'dismiss',
        async run({ page, baseUrl, dialogs }) {
            await gotoAndWait(page, `${baseUrl}/intent/explore/`);
            await page.waitForSelector('[data-site-version-menu]');
            await waitForServiceWorkerActive(page);
            const menus = await markUsableVersionMenus(page);
            if (menus.length !== 1) {
                fail('Expected exactly one usable version menu on the page.', { menus });
            }

            await page.evaluate(() => {
                document.documentElement.setAttribute('data-site-update', 'ready');
            });

            const clickedMenus = [];
            for (const menu of menus) {
                const locator = page.locator(`[data-browser-regression-menu-id="${menu.id}"]`).first();
                const trigger = locator.locator('[data-site-version-trigger]').first();
                if (await trigger.count()) {
                    await trigger.click();
                } else {
                    await locator.click();
                }
                await waitForVersionDropdown(page);

                const dropdownText = await readVersionDropdownText(page);
                if (!dropdownText) {
                    fail('Update dropdown opened without usable text.', { menu, menus, dialogs });
                }
                if (dialogs.length > 0) {
                    fail('Version menu matrix should not fall back to dialog.', { menu, menus, dialogs });
                }

                clickedMenus.push({
                    id: menu.id,
                    text: menu.text,
                    dropdownText
                });

                await page.keyboard.press('Escape');
                await page.waitForSelector('.site-nav-version-menu.is-open', { state: 'detached' }).catch(async () => {
                    await page.waitForFunction(() => !document.querySelector('.site-nav-version-menu.is-open'));
                });
            }

            return {
                menuCount: menus.length,
                clickedMenus,
                dialogs: dialogs.slice()
            };
        }
    },
    {
        id: 'sw-update-version-dropdown-zh-hk',
        kind: 'upgrade',
        title: 'SW Update Version Dropdown zh-hk -> zh-tw',
        viewport: { width: 1440, height: 960 },
        dialogPolicy: 'dismiss',
        async run({ page, baseUrl, dialogs, server, upgradePair }) {
            ensureTwoBuilds(upgradePair);
            server.setRoot(upgradePair.fromDir);
            await gotoAndWait(page, `${baseUrl}/`);
            await waitForServiceWorkerActive(page);

            server.setRoot(upgradePair.toDir);
            await gotoAndWait(page, `${baseUrl}/`);
            const expectedDropdownMessage = await readExpectedSiteVersionUpdateLabel(page, 'zh-hk');
            await page.evaluate(() => {
                document.documentElement.lang = 'zh-hk';
            });
            await forceServiceWorkerUpdate(page);
            await waitForUpdateReady(page);

            await markFirstUsableVersionMenu(page);
            await clickMarkedVersionTrigger(page);
            await waitForVersionDropdown(page);
            await waitForVersionDropdownText(page, expectedDropdownMessage);

            if (dialogs.length > 0) {
                fail('zh-hk update flow should use the version dropdown instead of dialog.', { dialogs, expectedDropdownMessage });
            }

            const actualDropdownText = await readVersionDropdownText(page);
            if (!actualDropdownText.includes(expectedDropdownMessage)) {
                fail('zh-hk version dropdown did not resolve to the expected localized copy.', {
                    actualDropdownText,
                    dialogs,
                    expectedDropdownMessage
                });
            }

            return {
                actualDropdownText,
                expectedDropdownMessage
            };
        }
    },
    {
        id: 'sw-update-version-dropdown-zh-mo',
        kind: 'upgrade',
        title: 'SW Update Version Dropdown zh-mo -> zh-tw',
        viewport: { width: 1440, height: 960 },
        dialogPolicy: 'dismiss',
        async run({ page, baseUrl, dialogs, server, upgradePair }) {
            ensureTwoBuilds(upgradePair);
            server.setRoot(upgradePair.fromDir);
            await gotoAndWait(page, `${baseUrl}/`);
            await waitForServiceWorkerActive(page);

            server.setRoot(upgradePair.toDir);
            await gotoAndWait(page, `${baseUrl}/`);
            const expectedDropdownMessage = await readExpectedSiteVersionUpdateLabel(page, 'zh-mo');
            await page.evaluate(() => {
                document.documentElement.lang = 'zh-mo';
            });
            await forceServiceWorkerUpdate(page);
            await waitForUpdateReady(page);

            await markFirstUsableVersionMenu(page);
            await clickMarkedVersionTrigger(page);
            await waitForVersionDropdown(page);
            await waitForVersionDropdownText(page, expectedDropdownMessage);

            if (dialogs.length > 0) {
                fail('zh-mo update flow should use the version dropdown instead of dialog.', { dialogs, expectedDropdownMessage });
            }

            const actualDropdownText = await readVersionDropdownText(page);
            if (!actualDropdownText.includes(expectedDropdownMessage)) {
                fail('zh-mo version dropdown did not resolve to the expected localized copy.', {
                    actualDropdownText,
                    dialogs,
                    expectedDropdownMessage
                });
            }

            return {
                actualDropdownText,
                expectedDropdownMessage
            };
        }
    }
];

export const upgradeScenarios = scenarios.filter((scenario) => scenario.kind === 'upgrade');
