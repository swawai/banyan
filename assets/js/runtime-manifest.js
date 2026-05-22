const runtimeJsonPromises = new Map();
const runtimeJsonCache = new Map();

export function readRuntimeManifestUrl() {
    return document.body?.dataset.assetManifestUrl || '';
}

export function fetchRuntimeJson(url) {
    const normalizedUrl = typeof url === 'string' ? url.trim() : '';
    if (!normalizedUrl) {
        return Promise.resolve(null);
    }
    if (runtimeJsonCache.has(normalizedUrl)) {
        return Promise.resolve(runtimeJsonCache.get(normalizedUrl));
    }

    let promise = runtimeJsonPromises.get(normalizedUrl);
    if (!promise) {
        promise = fetch(normalizedUrl, { credentials: 'same-origin' })
            .then((res) => (res && res.ok ? res.json() : null))
            .catch(() => null)
            .then((data) => {
                runtimeJsonCache.set(normalizedUrl, data);
                return data;
            });
        runtimeJsonPromises.set(normalizedUrl, promise);
    }

    return promise;
}

export function getRuntimeManifest() {
    const manifestUrl = readRuntimeManifestUrl();
    if (!manifestUrl) {
        return Promise.resolve({});
    }

    return fetchRuntimeJson(manifestUrl).then((manifest) => (
        manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : {}
    ));
}

export function getRuntimeLangListUrl(manifest) {
    return typeof manifest?.langList === 'string' && manifest.langList ? manifest.langList : '';
}

export function getRuntimeI18nUrl(manifest, lang) {
    const normalized = typeof lang === 'string' ? lang.toLowerCase() : '';
    const i18nMap = manifest && typeof manifest.i18n === 'object' ? manifest.i18n : null;
    const fallbackMap = manifest && typeof manifest.i18nFallbacks === 'object' ? manifest.i18nFallbacks : null;
    if (!i18nMap || !normalized) return '';

    if (typeof i18nMap[normalized] === 'string' && i18nMap[normalized]) {
        return i18nMap[normalized];
    }

    let current = normalized;
    const visited = new Set([current]);
    while (fallbackMap && typeof fallbackMap[current] === 'string' && fallbackMap[current]) {
        current = fallbackMap[current].toLowerCase();
        if (!current || visited.has(current)) break;
        visited.add(current);
        if (typeof i18nMap[current] === 'string' && i18nMap[current]) {
            return i18nMap[current];
        }
    }

    return '';
}

export function getRuntimeBuildVersion(manifest) {
    return typeof manifest?.buildVersion === 'string' && manifest.buildVersion
        ? manifest.buildVersion
        : '';
}

export function getRuntimeBuildTime(manifest) {
    return typeof manifest?.buildTime === 'string' && manifest.buildTime
        ? manifest.buildTime
        : '';
}

export async function getRuntimeFragmentRoot() {
    const manifest = await getRuntimeManifest();
    const buildVersion = getRuntimeBuildVersion(manifest);
    const lang = document.documentElement?.lang || '';
    if (!buildVersion || !lang) {
        return '';
    }
    return `/__fragments/${buildVersion}/${lang}/`;
}
