function parseJson(value, fallback) {
    if (typeof value !== "string" || value === "") {
        return fallback;
    }

    try {
        var parsed = JSON.parse(value);
        return parsed == null ? fallback : parsed;
    } catch (_) {
        return fallback;
    }
}

function readFirst(params, keys) {
    if (!Array.isArray(keys)) {
        return "";
    }

    for (var index = 0; index < keys.length; index += 1) {
        var value = params.get(keys[index]);
        if (typeof value === "string") {
            return value;
        }
    }

    return "";
}

function normalizePath(value) {
    if (typeof value !== "string") {
        return "";
    }

    var decoded;
    try {
        decoded = decodeURIComponent(value.trim());
    } catch (_) {
        decoded = value.trim();
    }

    var segments = decoded.split("/").filter(Boolean);
    return segments.length === 0 ? "" : "/" + segments.join("/") + "/";
}

function countVisibleItems(items, hideRootDuplicates) {
    if (!Array.isArray(items) || items.length === 0) {
        return 0;
    }

    var total = 0;
    for (var index = 0; index < items.length; index += 1) {
        var item = items[index];
        if (!item || typeof item !== "object") {
            continue;
        }

        if (hideRootDuplicates && (item.redundant_with_root_menu === true || item.redundantWithRootMenu === true)) {
            continue;
        }

        total += 1;
    }

    return total;
}

function countTrailItems(source, hideRootDuplicates) {
    var levels = Array.isArray(source && source.levels) ? source.levels : [];
    if (levels.length > 0) {
        return countVisibleItems(levels.map(function (level) {
            return level && typeof level.item === "object" ? level.item : null;
        }).filter(Boolean), hideRootDuplicates);
    }

    var tailItems = Array.isArray(source && (source.tail_items || source.tailItems))
        ? (source.tail_items || source.tailItems)
        : [];

    return countVisibleItems(tailItems, hideRootDuplicates);
}

function findEntrySource(sources, logicalPath) {
    var normalizedPath = normalizePath(logicalPath);
    if (!normalizedPath) {
        return null;
    }

    var sortedSources = sources.slice().sort(function (left, right) {
        return normalizePath(right && (right.logical_path || right.logicalPath || "")).length
            - normalizePath(left && (left.logical_path || left.logicalPath || "")).length;
    });

    for (var index = 0; index < sortedSources.length; index += 1) {
        var source = sortedSources[index];
        if (!source || typeof source !== "object") {
            continue;
        }

        var sourcePath = normalizePath(source.logical_path || source.logicalPath || "");
        if (!sourcePath || normalizedPath.indexOf(sourcePath) !== 0) {
            continue;
        }

        var remainder = normalizedPath.slice(sourcePath.length).split("/").filter(Boolean);
        if (remainder.length !== 1) {
            continue;
        }

        var slug = remainder[0];
        if (!slug || slug === "." || slug === ".." || /[/?#]/.test(slug)) {
            return null;
        }

        return source;
    }

    return null;
}

function findCollectionSource(sources, logicalPath) {
    var normalizedPath = normalizePath(logicalPath);
    if (!normalizedPath) {
        return null;
    }

    for (var index = 0; index < sources.length; index += 1) {
        var source = sources[index];
        if (!source || typeof source !== "object") {
            continue;
        }

        var sourcePath = normalizePath(source.logical_path || source.logicalPath || "");
        if (sourcePath === normalizedPath) {
            return source;
        }
    }

    return null;
}

function start() {
try {
    var html = document.documentElement;
    var previewPending = html.getAttribute("data-entry-breadcrumb-preview-pending") === "true";
    var sortPending = html.getAttribute("data-breadcrumb-sort-pending") === "true";
    if (!previewPending && !sortPending) {
        return;
    }

    if (!(window.matchMedia && window.matchMedia("(min-width: 88rem)").matches)) {
        return;
    }

    var body = document.body;
    if (!body) {
        return;
    }

    var trailContainer = document.querySelector(".slot-row-breadcrumb .slot-breadcrumb");
    if (!trailContainer) {
        return;
    }

    var entryBreadcrumbSources = parseJson(body.dataset.entryBreadcrumbSources || "", []);
    if (!Array.isArray(entryBreadcrumbSources) || entryBreadcrumbSources.length === 0) {
        return;
    }

    var entryLineageKeys = parseJson(html.dataset.entryLineageKeys || "", []);
    var params = new URLSearchParams(window.location.search);
    var hideRootDuplicates = document.querySelector(".page-shell.page-shell--has-breadcrumb-root.page-shell--has-breadcrumb-tail") !== null;
    var placeholderCount = 0;

    if (previewPending) {
        var entrySource = findEntrySource(entryBreadcrumbSources, readFirst(params, entryLineageKeys) || "");
        if (entrySource) {
            placeholderCount = countTrailItems(entrySource, hideRootDuplicates);

            var currentPageTitle = body.dataset.currentPageTitle || document.title || "";
            var currentPageHref = window.location.pathname + window.location.search + window.location.hash;
            if (currentPageTitle && currentPageHref) {
                placeholderCount += 1;
            }
        }
    } else if (sortPending) {
        var pageCollectionSource = parseJson(body.dataset.pageCollectionSource || "{}", {});
        var collectionSource = findCollectionSource(entryBreadcrumbSources, pageCollectionSource.logical_path || pageCollectionSource.logicalPath || "");
        if (collectionSource) {
            var collectionLevels = Array.isArray(collectionSource.levels) ? collectionSource.levels : [];
            placeholderCount = countVisibleItems(collectionLevels.map(function (level) {
                return level && typeof level.item === "object" ? level.item : null;
            }).filter(Boolean), hideRootDuplicates);
        }
    }

    if (placeholderCount <= 0) {
        return;
    }

    var nav = document.createElement("nav");
    nav.className = "breadcrumb-nav";
    nav.setAttribute("aria-hidden", "true");

    for (var itemIndex = 0; itemIndex < placeholderCount; itemIndex += 1) {
        var placeholder = document.createElement("span");
        placeholder.className = "breadcrumb-item-menu";
        nav.appendChild(placeholder);
    }

    trailContainer.replaceChildren(nav);
} catch (_) { }
}

start();
