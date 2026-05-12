export function createServiceWorkerManagerRuntime(options = {}) {
    const swUrl = typeof options.swUrl === 'string' && options.swUrl ? options.swUrl : '/sw.js';
    const swScope = typeof options.swScope === 'string' && options.swScope ? options.swScope : '/';
    const updateCheckInterval = Number.isFinite(options.updateCheckInterval) && options.updateCheckInterval > 0
        ? options.updateCheckInterval
        : 15 * 60 * 1000;
    const updateVisibilityThrottle = Number.isFinite(options.updateVisibilityThrottle) && options.updateVisibilityThrottle > 0
        ? options.updateVisibilityThrottle
        : 3 * 60 * 1000;
    const existingRuntime = window.BanyanServiceWorkerManagerRuntime;
    if (
        existingRuntime
        && existingRuntime.swUrl === swUrl
        && existingRuntime.swScope === swScope
        && existingRuntime.updateCheckInterval === updateCheckInterval
        && existingRuntime.updateVisibilityThrottle === updateVisibilityThrottle
    ) {
        return existingRuntime;
    }

    let activeRegistration = null;

    function supportsServiceWorker() {
        return 'serviceWorker' in navigator;
    }

    function normalizeNavigationUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            if (!/^https?:$/.test(url.protocol)) return '';
            if (url.origin !== window.location.origin) return '';
            url.hash = '';
            return url.toString();
        } catch (error) {
            return '';
        }
    }

    function getActiveRegistration() {
        return activeRegistration;
    }

    function setActiveRegistration(registration) {
        activeRegistration = registration || null;
        return activeRegistration;
    }

    async function getActiveWorkerRegistration() {
        if (activeRegistration?.active) return activeRegistration;

        try {
            const registration = await navigator.serviceWorker.ready;
            if (registration?.active) {
                activeRegistration = registration;
                return registration;
            }
        } catch (error) { }

        return null;
    }

    const runtime = {
        getActiveRegistration,
        getActiveWorkerRegistration,
        normalizeNavigationUrl,
        setActiveRegistration,
        supportsServiceWorker,
        swScope,
        updateCheckInterval,
        updateVisibilityThrottle,
        swUrl
    };

    window.BanyanServiceWorkerManagerRuntime = runtime;
    return runtime;
}
