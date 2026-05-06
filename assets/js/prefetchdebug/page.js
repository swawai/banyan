(function () {
    var slotOrder = ['menu', 'nav', 'sort', 'desc', 'post'];

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
            var link = document.createElement('link');
            return !!(link.relList && typeof link.relList.supports === 'function' && link.relList.supports('prefetch'));
        } catch (error) {
            return false;
        }
    }

    function supportsServiceWorkerApi() {
        return 'serviceWorker' in navigator;
    }

    function getRuntimeEnvSequence() {
        return [
            supportsLinkPrefetch() ? 'T' : 'F',
            supportsServiceWorkerApi() ? 'T' : 'F'
        ].join('');
    }

    function readPayload() {
        var dataNode = document.getElementById('site-prefetch-data');
        if (!dataNode) return null;

        try {
            return JSON.parse(dataNode.textContent || '{}');
        } catch (error) {
            return null;
        }
    }

    function readRuntimeMeta() {
        var dataNode = document.getElementById('site-prefetch-runtime-meta');
        if (!dataNode) return null;

        try {
            return JSON.parse(dataNode.textContent || '{}');
        } catch (error) {
            return null;
        }
    }

    function pickConfig(payload, envSequence) {
        var entry = payload && typeof payload === 'object' ? payload[envSequence] || null : null;
        if (!entry) return null;

        if (typeof entry === 'string') {
            var target = payload[entry] || null;
            return target && typeof target === 'object'
                ? { targetEnv: entry, config: target }
                : null;
        }

        return typeof entry === 'object'
            ? { targetEnv: envSequence, config: entry }
            : null;
    }

    function parseRuntimeMode(rawValue) {
        var raw = String(rawValue || '').trim().toLowerCase();
        if (!raw || raw === 'off' || raw === '<nil>') return null;

        var globalGate = raw.indexOf('_g', raw.length - 2) !== -1;
        var normalized = globalGate ? raw.slice(0, -2) : raw;
        var match = /^(link|sw)_([smx])f$/.exec(normalized);
        if (!match) return null;

        return {
            eagerness: match[2] === 's' ? 'conservative' : match[2] === 'm' ? 'moderate' : 'eager',
            globalGate: globalGate,
            transport: match[1]
        };
    }

    function normalizeNavigationUrl(rawUrl) {
        try {
            var url = new URL(rawUrl, window.location.href);
            url.hash = '';
            return url.toString();
        } catch (error) {
            return '';
        }
    }

    function canWarmAnchor(anchor) {
        if (!(anchor instanceof HTMLAnchorElement)) return false;
        if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;
        if (anchor.hasAttribute('download')) return false;
        return true;
    }

    function collectSlotUrls(slot, seenUrls) {
        var urls = [];
        var currentUrl = normalizeNavigationUrl(window.location.href);
        var anchors = document.querySelectorAll('a[href][data-prefetch-slot]');
        for (var index = 0; index < anchors.length; index += 1) {
            var anchor = anchors[index];
            if (!(anchor instanceof HTMLAnchorElement)) continue;
            if (anchor.getAttribute('data-prefetch-slot') !== slot) continue;
            if (!canWarmAnchor(anchor)) continue;

            var href = normalizeNavigationUrl(anchor.href);
            if (!href || href === currentUrl || seenUrls[href]) continue;
            seenUrls[href] = true;
            urls.push(href);
        }
        return urls;
    }

    function actionKeyForMode(mode) {
        if (!mode) return '';
        var transport = mode.transport === 'link' ? 'l' : mode.transport === 'sw' ? 'w' : '';
        if (!transport) return '';
        var eagerness = mode.eagerness === 'conservative' ? 's' : mode.eagerness === 'moderate' ? 'm' : 'x';
        return transport + eagerness + (mode.globalGate ? 'g' : '');
    }

    function buildActionsFromConfig(config, suppressedSlots) {
        if (!(config && typeof config === 'object')) return {};

        var actions = {};
        var seenUrls = Object.create(null);
        for (var index = 0; index < slotOrder.length; index += 1) {
            var slot = slotOrder[index];
            if (suppressedSlots && suppressedSlots[slot]) continue;

            var mode = parseRuntimeMode(config[slot]);
            if (!mode) continue;

            var urls = collectSlotUrls(slot, seenUrls);
            if (urls.length === 0) continue;

            var actionKey = actionKeyForMode(mode);
            if (!actionKey) continue;
            actions[actionKey] = (actions[actionKey] || []).concat(urls);
        }
        return actions;
    }

    function buildOwnedSlotDetails(runtimeMeta) {
        var declared = Array.isArray(runtimeMeta && runtimeMeta.owned_slots) ? runtimeMeta.owned_slots : [];
        var declaredSet = Object.create(null);
        var declaredSlots = [];

        for (var i = 0; i < declared.length; i += 1) {
            var slot = String(declared[i] || '').trim();
            if (!slot || declaredSet[slot]) continue;
            declaredSet[slot] = true;
            declaredSlots.push(slot);
        }

        var coordinationMode = runtimeMeta && runtimeMeta.coordination_mode
            ? String(runtimeMeta.coordination_mode)
            : 'independent';
        var browserSupportsSpec = supportsSpeculationRules();
        var preemptionActive = coordinationMode === 'preempt_runtime_when_supported' && browserSupportsSpec;
        return {
            activeOwnedSlots: preemptionActive ? declaredSlots : [],
            browserSupportsSpeculationRules: browserSupportsSpec,
            coordinationMode: coordinationMode,
            declaredOwnedSlots: declaredSlots,
            preemptionActive: preemptionActive
        };
    }

    function toSlotSet(slots) {
        var result = Object.create(null);
        if (!Array.isArray(slots)) return result;
        for (var i = 0; i < slots.length; i += 1) {
            result[slots[i]] = true;
        }
        return result;
    }

    function collectSuppressedActions(rawActions, filteredActions) {
        if (!(rawActions && typeof rawActions === 'object')) return {};

        var suppressed = {};
        Object.keys(rawActions).forEach(function (key) {
            var rawUrls = Array.isArray(rawActions[key]) ? rawActions[key] : [];
            var filteredUrls = filteredActions && Array.isArray(filteredActions[key]) ? filteredActions[key] : [];
            var filteredSet = Object.create(null);

            for (var i = 0; i < filteredUrls.length; i += 1) {
                var normalized = normalizeNavigationUrl(filteredUrls[i]);
                if (normalized) filteredSet[normalized] = true;
            }

            var removed = [];
            for (var j = 0; j < rawUrls.length; j += 1) {
                var candidate = rawUrls[j];
                var normalizedCandidate = normalizeNavigationUrl(candidate);
                if (normalizedCandidate && filteredSet[normalizedCandidate]) continue;
                removed.push(candidate);
            }

            if (removed.length > 0) {
                suppressed[key] = removed;
            }
        });
        return suppressed;
    }

    function writePre(id, value) {
        var node = document.getElementById(id);
        if (!node) return;
        node.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    function describeWorker(worker) {
        if (!worker) return null;
        return {
            scriptURL: worker.scriptURL || '',
            state: worker.state || '',
            type: worker.type || ''
        };
    }

    function inspectRuntime() {
        var speculationRulesCount = document.head.querySelectorAll('script[type="speculationrules"][data-prefetch-generated="runtime"]').length;
        var prefetchLinkCount = document.head.querySelectorAll('link[rel="prefetch"][data-prefetch-link="runtime"]').length;
        var serviceWorkerApi = supportsServiceWorkerApi();
        var container = serviceWorkerApi ? navigator.serviceWorker : null;
        var swState = {
            apiAvailable: serviceWorkerApi,
            secureContext: !!window.isSecureContext,
            protocol: window.location.protocol,
            controllerPresent: !!(container && container.controller),
            hasReadyPromise: !!(container && container.ready),
            hasGetRegistration: !!(container && typeof container.getRegistration === 'function'),
            hasGetRegistrations: !!(container && typeof container.getRegistrations === 'function'),
            controller: describeWorker(container && container.controller)
        };

        return {
            speculationRulesCount: speculationRulesCount,
            prefetchLinkCount: prefetchLinkCount,
            serviceWorker: swState
        };
    }

    function stripWrappedQuotes(value) {
        if (!value) return '';
        var trimmed = String(value).trim();
        if (
            (trimmed.charAt(0) === '"' && trimmed.charAt(trimmed.length - 1) === '"')
            || (trimmed.charAt(0) === '\'' && trimmed.charAt(trimmed.length - 1) === '\'')
        ) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    }

    async function readSpeculationRulesHeaderState() {
        var state = {
            contentType: '',
            header: '',
            responseOk: false,
            rulesPath: '',
            rulesPayload: null,
            rulesResponseOk: false
        };

        try {
            var response = await fetch(window.location.href, {
                cache: 'no-store',
                credentials: 'same-origin'
            });
            state.responseOk = !!response.ok;
            state.contentType = response.headers.get('content-type') || '';
            state.header = response.headers.get('Speculation-Rules') || '';
            state.rulesPath = stripWrappedQuotes(state.header);

            if (state.rulesPath) {
                var rulesResponse = await fetch(new URL(state.rulesPath, window.location.href).toString(), {
                    cache: 'no-store',
                    credentials: 'same-origin'
                });
                state.rulesResponseOk = !!rulesResponse.ok;
                state.rulesContentType = rulesResponse.headers.get('content-type') || '';
                if (rulesResponse.ok) {
                    state.rulesPayload = await rulesResponse.json().catch(function () { return null; });
                }
            }
        } catch (error) {
            state.error = String(error && error.message ? error.message : error);
        }

        return state;
    }

    async function refresh() {
        var payload = readPayload();
        var runtimeMeta = readRuntimeMeta();
        var runtimeEnvSequence = getRuntimeEnvSequence();
        var picked = pickConfig(payload, runtimeEnvSequence);
        var rawActions = picked ? buildActionsFromConfig(picked.config, null) : null;
        var ownedSlotDetails = buildOwnedSlotDetails(runtimeMeta);
        var filteredActions = picked
            ? buildActionsFromConfig(picked.config, toSlotSet(ownedSlotDetails.activeOwnedSlots))
            : null;
        var suppressedActions = collectSuppressedActions(rawActions, filteredActions);
        var runtimeState = inspectRuntime();
        var speculationHeaderState = await readSpeculationRulesHeaderState();
        runtimeState.speculationRulesHeader = speculationHeaderState;
        runtimeState.runtimeCoordination = runtimeMeta;

        if (runtimeState.serviceWorker.apiAvailable) {
            try {
                var registration = await navigator.serviceWorker.getRegistration();
                runtimeState.serviceWorker.getRegistrationResult = !!registration;
                runtimeState.serviceWorker.registration = registration ? {
                    scope: registration.scope || '',
                    updateViaCache: registration.updateViaCache || '',
                    installing: describeWorker(registration.installing),
                    waiting: describeWorker(registration.waiting),
                    active: describeWorker(registration.active)
                } : null;
            } catch (error) {
                runtimeState.serviceWorker.getRegistrationError = String(error && error.message ? error.message : error);
            }

            try {
                var readyRegistration = await navigator.serviceWorker.ready;
                runtimeState.serviceWorker.ready = readyRegistration ? {
                    scope: readyRegistration.scope || '',
                    installing: describeWorker(readyRegistration.installing),
                    waiting: describeWorker(readyRegistration.waiting),
                    active: describeWorker(readyRegistration.active)
                } : null;
            } catch (error) {
                runtimeState.serviceWorker.readyError = String(error && error.message ? error.message : error);
            }

            if (typeof navigator.serviceWorker.getRegistrations === 'function') {
                try {
                    var registrations = await navigator.serviceWorker.getRegistrations();
                    runtimeState.serviceWorker.registrationCount = Array.isArray(registrations) ? registrations.length : 0;
                    runtimeState.serviceWorker.registrations = Array.isArray(registrations)
                        ? registrations.map(function (item) {
                            return {
                                scope: item.scope || '',
                                installing: describeWorker(item.installing),
                                waiting: describeWorker(item.waiting),
                                active: describeWorker(item.active)
                            };
                        })
                        : [];
                } catch (error) {
                    runtimeState.serviceWorker.getRegistrationsError = String(error && error.message ? error.message : error);
                }
            }
        }

        writePre('prefetch-debug-support', {
            speculationRules: supportsSpeculationRules(),
            linkPrefetch: supportsLinkPrefetch(),
            serviceWorkerApi: supportsServiceWorkerApi(),
            secureContext: !!window.isSecureContext
        });
        writePre('prefetch-debug-env', {
            runtimeEnvSequence: runtimeEnvSequence,
            payloadEntry: payload && typeof payload === 'object' ? payload[runtimeEnvSequence] || null : null,
            resolvedEnv: picked ? picked.targetEnv : null,
            runtimeCoordinationMode: ownedSlotDetails.coordinationMode,
            preemptionActive: ownedSlotDetails.preemptionActive
        });
        writePre('prefetch-debug-actions', rawActions || 'No actions for current env');
        writePre('prefetch-debug-spec-owned', ownedSlotDetails);
        writePre('prefetch-debug-actions-filtered', rawActions ? {
            filteredActions: filteredActions,
            suppressedActions: suppressedActions
        } : 'No actions for current env');
        writePre('prefetch-debug-runtime', runtimeState);
        writePre('prefetch-debug-payload', {
            runtimePayload: payload || 'No site-prefetch-data found',
            runtimeMeta: runtimeMeta || null,
            speculationRulesHeader: speculationHeaderState.header || '',
            speculationRulesPayload: speculationHeaderState.rulesPayload || null
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        void refresh();
        window.setTimeout(function () { void refresh(); }, 250);
        window.setTimeout(function () { void refresh(); }, 1200);
    });
}());
