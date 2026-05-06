import fs from 'node:fs/promises';
import path from 'node:path';

import { runBrowserRegression } from './run.mjs';
import { fail, gotoAndWait, pollUntil, readSecurityPolicyViolations, waitForBreadcrumbSettled } from './helpers.mjs';

function recordRuntimePrefetchTraceScript() {
    return `
        (() => {
            const trace = {
                prefetchLinks: [],
                serviceWorkerMessages: []
            };
            window.__banyanPrefetchTrace = trace;

            const normalizeUrl = (rawUrl) => {
                try {
                    const url = new URL(rawUrl, window.location.href);
                    url.hash = '';
                    return url.toString();
                } catch (error) {
                    return '';
                }
            };

            const originalAppendChild = Node.prototype.appendChild;
            if (!Node.prototype.__banyanPrefetchTracePatched) {
                Node.prototype.appendChild = function(node) {
                    try {
                        if (
                            this === document.head
                            && node
                            && node.tagName === 'LINK'
                            && (node.getAttribute('rel') || '').toLowerCase() === 'prefetch'
                            && node.getAttribute('data-prefetch-link') === 'runtime'
                        ) {
                            const href = normalizeUrl(node.href || node.getAttribute('href') || '');
                            if (href) {
                                trace.prefetchLinks.push(href);
                            }
                        }
                    } catch (error) { }
                    return originalAppendChild.call(this, node);
                };
                Node.prototype.__banyanPrefetchTracePatched = true;
            }

            if (
                typeof ServiceWorker !== 'undefined'
                && ServiceWorker.prototype
                && typeof ServiceWorker.prototype.postMessage === 'function'
                && !ServiceWorker.prototype.__banyanPrefetchTracePatched
            ) {
                const originalPostMessage = ServiceWorker.prototype.postMessage;
                ServiceWorker.prototype.postMessage = function(message, ...rest) {
                    try {
                        if (message && message.type === 'WARM_NAV_BATCH' && Array.isArray(message.urls)) {
                            trace.serviceWorkerMessages.push({
                                type: message.type,
                                urls: message.urls.map((rawUrl) => normalizeUrl(rawUrl)).filter(Boolean)
                            });
                        }
                    } catch (error) { }
                    return originalPostMessage.call(this, message, ...rest);
                };
                ServiceWorker.prototype.__banyanPrefetchTracePatched = true;
            }
        })();
    `;
}

function createConsoleRecorder(page, entries) {
    page.on('console', (message) => {
        entries.push({
            text: message.text(),
            type: message.type()
        });
    });
}

function filterCspConsoleMessages(entries) {
    return entries.filter((entry) => {
        const text = `${entry.text || ''}`.toLowerCase();
        return text.includes('content security policy') || text.includes('csp');
    });
}

function readHeader(response, name) {
    if (!response) {
        return '';
    }
    const headers = response.headers();
    return headers[name.toLowerCase()] || '';
}

function parseSpeculationRulesHeaderValue(value) {
    const trimmed = `${value || ''}`.trim();
    if (!trimmed) {
        return '';
    }
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function toRequestTraceEntry(request) {
    return {
        headers: request.headers(),
        resourceType: request.resourceType(),
        url: request.url()
    };
}

function toResponseTraceEntry(response) {
    return {
        headers: response.headers(),
        status: response.status(),
        url: response.url()
    };
}

async function readRulesFile(primaryBuildDir, rulesPath) {
    const relativePath = rulesPath.replace(/^\/+/, '').split('/').join(path.sep);
    const absolutePath = path.join(primaryBuildDir, relativePath);
    const body = await fs.readFile(absolutePath, 'utf8');
    return JSON.parse(body);
}

async function collectSpeculationRulesOutcome({
    consoleEntries,
    expectedEagerSlots = [],
    page,
    pathLabel,
    primaryBuildDir,
    requestEntries,
    response,
    responseEntries
}) {
    const cspValue = readHeader(response, 'content-security-policy');
    if (!cspValue.includes("script-src 'self' 'report-sample'")) {
        fail('Page did not include the expected enforced CSP baseline.', {
            csp: cspValue,
            path: pathLabel
        });
    }

    const speculationRulesHeader = readHeader(response, 'speculation-rules');
    if (!speculationRulesHeader) {
        fail('Page did not include the Speculation-Rules response header.', {
            csp: cspValue,
            path: pathLabel
        });
    }

    const rulesPath = parseSpeculationRulesHeaderValue(speculationRulesHeader);
    if (!rulesPath.startsWith('/speculation-rules/')) {
        fail('Speculation-Rules header did not point at the expected generated rules directory.', {
            path: pathLabel,
            rulesPath,
            speculationRulesHeader
        });
    }

    const rulesResponse = await pollUntil(() => {
        return responseEntries.find((entry) => {
            try {
                return new URL(entry.url).pathname === rulesPath;
            } catch (error) {
                return false;
            }
        }) || null;
    }, {
        timeoutMs: 5000,
        label: `${pathLabel} speculation-rules response wait`
    });

    if (rulesResponse.status !== 200) {
        fail('Generated speculation rules asset did not return 200.', {
            path: pathLabel,
            rulesPath,
            rulesResponse
        });
    }

    const rulesContentType = `${rulesResponse.headers['content-type'] || ''}`;
    if (!rulesContentType.includes('application/speculationrules+json')) {
        fail('Generated speculation rules asset did not use application/speculationrules+json.', {
            path: pathLabel,
            rulesContentType,
            rulesPath
        });
    }

    const rulesRequestCount = requestEntries.filter((entry) => {
        try {
            return new URL(entry.url).pathname === rulesPath;
        } catch (error) {
            return false;
        }
    }).length;
    if (rulesRequestCount < 1) {
        fail('Browser did not request the generated speculation rules asset.', {
            path: pathLabel,
            requestEntries,
            rulesPath
        });
    }

    const inlineSpeculationScriptCount = await page.evaluate(() => {
        return document.querySelectorAll('script[type="speculationrules"]').length;
    });
    if (inlineSpeculationScriptCount !== 0) {
        fail('Current browser environment unexpectedly relied on inline speculationrules DOM injection.', {
            inlineSpeculationScriptCount,
            path: pathLabel,
            rulesPath
        });
    }

    const rulesPayload = await readRulesFile(primaryBuildDir, rulesPath);
    const prefetchEntries = Array.isArray(rulesPayload?.prefetch) ? rulesPayload.prefetch : [];
    if (prefetchEntries.length < 1) {
        fail('Generated speculation rules payload did not include any prefetch entries.', {
            path: pathLabel,
            rulesPath,
            rulesPayload
        });
    }

    for (const expectedSlot of expectedEagerSlots) {
        const expectedSelector = `a[data-prefetch-slot="${expectedSlot}"]`;
        const found = prefetchEntries.some((entry) => (
            entry
            && entry.source === 'document'
            && entry.eagerness === 'eager'
            && entry.where
            && entry.where.selector_matches === expectedSelector
        ));
        if (!found) {
            fail('Generated speculation document rules payload missed an expected eager slot.', {
                expectedSelector,
                expectedSlot,
                path: pathLabel,
                rulesPath,
                rulesPayload
            });
        }
    }

    const runtimeCoordination = await page.evaluate(() => {
        function supportsSpeculationRules() {
            try {
                return typeof HTMLScriptElement !== 'undefined'
                    && typeof HTMLScriptElement.supports === 'function'
                    && HTMLScriptElement.supports('speculationrules');
            } catch (error) {
                return false;
            }
        }

        function supportsLinkPrefetch() {
            try {
                const link = document.createElement('link');
                return !!(link.relList && typeof link.relList.supports === 'function' && link.relList.supports('prefetch'));
            } catch (error) {
                return false;
            }
        }

        function supportsServiceWorkerApi() {
            return 'serviceWorker' in navigator;
        }

        function normalizeUrl(rawUrl) {
            try {
                const url = new URL(rawUrl, window.location.href);
                url.hash = '';
                return url.toString();
            } catch (error) {
                return '';
            }
        }

        function readJsonScript(id) {
            const node = document.getElementById(id);
            if (!node) return null;
            try {
                const parsed = JSON.parse(node.textContent || '{}');
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch (error) {
                return null;
            }
        }

        function getEnvSequence() {
            return [
                supportsLinkPrefetch() ? 'T' : 'F',
                supportsServiceWorkerApi() ? 'T' : 'F'
            ].join('');
        }

        function pickConfig(payload, envSequence) {
            const entry = payload && typeof payload === 'object' ? payload[envSequence] || null : null;
            if (!entry) return null;
            if (typeof entry === 'string') {
                const target = payload[entry] || null;
                return target && typeof target === 'object' ? target : null;
            }
            return typeof entry === 'object' ? entry : null;
        }

        function parseRuntimeMode(rawValue) {
            const raw = String(rawValue || '').trim().toLowerCase();
            if (!raw || raw === 'off' || raw === '<nil>') return null;

            const normalized = raw.endsWith('_g') ? raw.slice(0, -2) : raw;
            const match = /^(link|sw)_([smx])f$/.exec(normalized);
            if (!match) return null;

            return {
                transport: match[1]
            };
        }

        function canWarmAnchor(anchor) {
            if (!(anchor instanceof HTMLAnchorElement)) return false;
            if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;
            if (anchor.hasAttribute('download')) return false;
            return true;
        }

        function collectSlotUrls(slot, seenUrls) {
            const urls = [];
            const currentUrl = normalizeUrl(window.location.href);
            const anchors = document.querySelectorAll('a[href][data-prefetch-slot]');
            for (let index = 0; index < anchors.length; index += 1) {
                const anchor = anchors[index];
                if (!(anchor instanceof HTMLAnchorElement)) continue;
                if (anchor.getAttribute('data-prefetch-slot') !== slot) continue;
                if (!canWarmAnchor(anchor)) continue;

                const href = normalizeUrl(anchor.href);
                if (!href || href === currentUrl || seenUrls.has(href)) continue;
                seenUrls.add(href);
                urls.push(href);
            }
            return urls;
        }

        function collectActionUrls(config, options = {}) {
            const urls = [];
            const seenUrls = new Set();
            const slotOrder = ['menu', 'nav', 'sort', 'desc', 'post'];
            const onlySlots = new Set(Array.isArray(options.onlySlots) ? options.onlySlots : []);
            const suppressed = new Set(Array.isArray(options.suppressedSlots) ? options.suppressedSlots : []);
            for (const slot of slotOrder) {
                if (onlySlots.size > 0 && !onlySlots.has(slot)) continue;
                if (suppressed.has(slot)) continue;
                if (!parseRuntimeMode(config && config[slot])) continue;
                urls.push(...collectSlotUrls(slot, seenUrls));
            }
            return urls;
        }

        const payload = readJsonScript('site-prefetch-data');
        const runtimeMeta = readJsonScript('site-prefetch-runtime-meta');
        const resolvedConfig = pickConfig(payload, getEnvSequence()) || {};
        const ownedSlots = Array.isArray(runtimeMeta?.owned_slots)
            ? runtimeMeta.owned_slots.filter((slot) => typeof slot === 'string' && slot)
            : [];
        const runtimeActionUrls = collectActionUrls(resolvedConfig);
        const ownedUrls = collectActionUrls(resolvedConfig, { onlySlots: ownedSlots });
        const ownedSet = new Set(ownedUrls);
        const trace = window.__banyanPrefetchTrace || { prefetchLinks: [], serviceWorkerMessages: [] };
        const recordedRuntimeUrls = [];

        for (const href of Array.isArray(trace.prefetchLinks) ? trace.prefetchLinks : []) {
            const normalized = normalizeUrl(href);
            if (normalized && !recordedRuntimeUrls.includes(normalized)) {
                recordedRuntimeUrls.push(normalized);
            }
        }

        for (const message of Array.isArray(trace.serviceWorkerMessages) ? trace.serviceWorkerMessages : []) {
            const urls = Array.isArray(message?.urls) ? message.urls : [];
            for (const href of urls) {
                const normalized = normalizeUrl(href);
                if (normalized && !recordedRuntimeUrls.includes(normalized)) {
                    recordedRuntimeUrls.push(normalized);
                }
            }
        }

        const recordedActionUrls = recordedRuntimeUrls.filter((href) => runtimeActionUrls.includes(href));
        const recordedNonActionUrls = recordedRuntimeUrls.filter((href) => !runtimeActionUrls.includes(href));

        return {
            coordinationMode: runtimeMeta?.coordination_mode || '',
            ownedUrls,
            ownedSlots,
            recordedActionUrls,
            recordedNonActionUrls,
            recordedRuntimeUrls,
            runtimeActionUrls,
            runtimeOverlapUrls: runtimeActionUrls.filter((href) => ownedSet.has(href)),
            supportsSpeculationRules: supportsSpeculationRules(),
            unownedRuntimeUrls: runtimeActionUrls.filter((href) => !ownedSet.has(href))
        };
    });

    if (
        runtimeCoordination.supportsSpeculationRules
        && runtimeCoordination.coordinationMode === 'preempt_runtime_when_supported'
    ) {
        const recordedOverlapUrls = runtimeCoordination.recordedActionUrls.filter((href) => (
            runtimeCoordination.ownedUrls.includes(href)
        ));
        if (recordedOverlapUrls.length > 0) {
            fail('Runtime prefetch still touched links from spec-owned slots under preempt coordination.', {
                path: pathLabel,
                recordedOverlapUrls,
                runtimeCoordination
            });
        }
        if (
            runtimeCoordination.runtimeActionUrls.length > 0
            && runtimeCoordination.unownedRuntimeUrls.length === 0
            && runtimeCoordination.recordedActionUrls.length > 0
        ) {
            fail('Runtime still executed prefetch actions even though all runtime URLs were spec-owned.', {
                path: pathLabel,
                runtimeCoordination
            });
        }
    }

    await page.waitForTimeout(250);
    const violations = await readSecurityPolicyViolations(page);
    const cspConsoleMessages = filterCspConsoleMessages(consoleEntries);
    if (violations.length > 0) {
        fail('Page triggered SecurityPolicyViolationEvent entries.', {
            csp: cspValue,
            path: pathLabel,
            rulesPath,
            violations
        });
    }
    if (cspConsoleMessages.length > 0) {
        fail('Page emitted CSP-related console noise.', {
            consoleMessages: cspConsoleMessages,
            csp: cspValue,
            path: pathLabel,
            rulesPath
        });
    }

    return {
        csp: cspValue,
        inlineSpeculationScriptCount,
        prefetchEntryCount: prefetchEntries.length,
        rulesContentType,
        rulesPath,
        rulesRequestCount,
        rulesResponseStatus: rulesResponse.status,
        speculationRulesHeader,
        runtimeCoordination,
        violations
    };
}

function parseDebugPanelJson(rawText, panelKey, pathLabel) {
    try {
        return JSON.parse(rawText);
    } catch (error) {
        fail('Prefetch debug panel did not contain valid JSON.', {
            error: String(error && error.message ? error.message : error),
            panelKey,
            path: pathLabel,
            rawText
        });
    }
}

async function readPrefetchDebugPanels(page, pathLabel) {
    const rawPanels = await pollUntil(async () => {
        return page.evaluate(() => {
            const panelIds = {
                support: 'prefetch-debug-support',
                env: 'prefetch-debug-env',
                actions: 'prefetch-debug-actions',
                specOwned: 'prefetch-debug-spec-owned',
                filtered: 'prefetch-debug-actions-filtered',
                payload: 'prefetch-debug-payload'
            };

            const result = {};
            for (const [key, id] of Object.entries(panelIds)) {
                const node = document.getElementById(id);
                if (!node) return null;

                const text = (node.textContent || '').trim();
                if (!text || text === 'Loading...' || text.includes('Loading...')) {
                    return null;
                }

                result[key] = text;
            }

            return result;
        });
    }, {
        timeoutMs: 6000,
        label: `${pathLabel} prefetch debug panels`
    });

    return {
        actions: parseDebugPanelJson(rawPanels.actions, 'actions', pathLabel),
        env: parseDebugPanelJson(rawPanels.env, 'env', pathLabel),
        filtered: parseDebugPanelJson(rawPanels.filtered, 'filtered', pathLabel),
        payload: parseDebugPanelJson(rawPanels.payload, 'payload', pathLabel),
        specOwned: parseDebugPanelJson(rawPanels.specOwned, 'specOwned', pathLabel),
        support: parseDebugPanelJson(rawPanels.support, 'support', pathLabel)
    };
}

async function collectPrefetchDebugObservation(page, pathLabel) {
    const panels = await readPrefetchDebugPanels(page, pathLabel);
    const filteredActions = panels.filtered && typeof panels.filtered === 'object' ? panels.filtered.filteredActions || {} : {};
    const suppressedActions = panels.filtered && typeof panels.filtered === 'object' ? panels.filtered.suppressedActions || {} : {};
    const ownedSlots = Array.isArray(panels.specOwned?.activeOwnedSlots) ? panels.specOwned.activeOwnedSlots : [];
    const declaredOwnedSlots = Array.isArray(panels.specOwned?.declaredOwnedSlots) ? panels.specOwned.declaredOwnedSlots : [];

    if (panels.support?.speculationRules !== true) {
        fail('Prefetch debug page did not detect Speculation Rules support in the test browser.', {
            path: pathLabel,
            support: panels.support
        });
    }

    if (panels.env?.runtimeCoordinationMode !== 'preempt_runtime_when_supported') {
        fail('Prefetch debug page did not report the expected runtime coordination mode.', {
            env: panels.env,
            path: pathLabel
        });
    }

    if (panels.env?.preemptionActive !== true) {
        fail('Prefetch debug page did not report active spec preemption under a spec-capable browser.', {
            env: panels.env,
            path: pathLabel,
            specOwned: panels.specOwned
        });
    }

    if (declaredOwnedSlots.length < 1 || ownedSlots.length < 1) {
        fail('Prefetch debug page did not expose any spec-owned slots.', {
            path: pathLabel,
            specOwned: panels.specOwned
        });
    }

    if (!panels.actions || typeof panels.actions !== 'object' || Array.isArray(panels.actions)) {
        fail('Prefetch debug page did not expose raw runtime actions as an object.', {
            actions: panels.actions,
            path: pathLabel
        });
    }

    if (Object.keys(filteredActions).length !== 0) {
        fail('Prefetch debug page still showed remaining runtime actions after spec preemption.', {
            filteredActions,
            path: pathLabel,
            specOwned: panels.specOwned
        });
    }

    if (Object.keys(suppressedActions).length === 0) {
        fail('Prefetch debug page did not show any suppressed runtime actions under spec preemption.', {
            filtered: panels.filtered,
            path: pathLabel
        });
    }

    if (!panels.payload || typeof panels.payload !== 'object') {
        fail('Prefetch debug page did not expose payload diagnostics.', {
            path: pathLabel,
            payload: panels.payload
        });
    }

    if (!panels.payload.runtimeMeta || !panels.payload.speculationRulesHeader) {
        fail('Prefetch debug page payload diagnostics missed runtime meta or speculation header details.', {
            path: pathLabel,
            payload: panels.payload
        });
    }

    return panels;
}

function createSpeculationHeaderScenario(config) {
    return {
        id: config.id,
        kind: 'single',
        title: config.title,
        viewport: config.viewport || { width: 1440, height: 960 },
        async run({ baseUrl, page, primaryBuildDir }) {
            const consoleEntries = [];
            const requestEntries = [];
            const responseEntries = [];

            await page.addInitScript(recordRuntimePrefetchTraceScript());
            createConsoleRecorder(page, consoleEntries);
            page.on('request', (request) => {
                try {
                    const pathname = new URL(request.url()).pathname;
                    if (pathname.startsWith('/speculation-rules/')) {
                        requestEntries.push(toRequestTraceEntry(request));
                    }
                } catch (error) { }
            });
            page.on('response', (currentResponse) => {
                try {
                    const pathname = new URL(currentResponse.url()).pathname;
                    if (pathname.startsWith('/speculation-rules/')) {
                        responseEntries.push(toResponseTraceEntry(currentResponse));
                    }
                } catch (error) { }
            });

            const response = await gotoAndWait(page, `${baseUrl}${config.path}`);
            await page.waitForSelector(config.waitForSelector);
            if (typeof config.afterLoad === 'function') {
                await config.afterLoad(page);
            }

            const outcome = await collectSpeculationRulesOutcome({
                consoleEntries,
                expectedEagerSlots: config.expectedEagerSlots || [],
                page,
                pathLabel: config.path,
                primaryBuildDir,
                requestEntries,
                response,
                responseEntries
            });

            if (typeof config.collectExtraDetails === 'function') {
                const extraDetails = await config.collectExtraDetails(page, config.path);
                return {
                    ...outcome,
                    debugObservation: extraDetails
                };
            }

            return outcome;
        }
    };
}

const speculationHeaderScenarios = [
    createSpeculationHeaderScenario({
        id: 'speculation-rules-header-all',
        path: '/all/',
        title: 'Speculation-Rules Header: All',
        waitForSelector: '.grid-list',
        expectedEagerSlots: ['nav']
    }),
    createSpeculationHeaderScenario({
        id: 'speculation-rules-header-xvenv',
        path: '/p/xvenv/?from=products/first-party/xvenv&sorts=_,name-asc',
        title: 'Speculation-Rules Header: Xvenv Breadcrumb Path',
        waitForSelector: '.slot-row-breadcrumb',
        expectedEagerSlots: ['nav', 'sort'],
        async afterLoad(page) {
            await waitForBreadcrumbSettled(page);
        }
    }),
    createSpeculationHeaderScenario({
        id: 'speculation-rules-header-prefetchdebug',
        path: '/prefetchdebug/',
        title: 'Speculation-Rules Header: Prefetch Debug Observation',
        waitForSelector: '#prefetch-debug-actions-filtered',
        collectExtraDetails: collectPrefetchDebugObservation
    })
];

await runBrowserRegression({
    headless: true,
    modeName: 'browser-speculation-rules',
    scenarios: speculationHeaderScenarios
});
