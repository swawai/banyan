function parseKeys(value) {
    if (typeof value !== "string" || value === "") {
        return [];
    }

    try {
        var parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
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

function start() {
try {
    var html = document.documentElement;
    var params = new URLSearchParams(window.location.search);
    var entryLineageKeys = parseKeys(html.dataset.entryLineageKeys);
    var activeSortKeys = parseKeys(html.dataset.activeSortKeys);
    var lineageSortsKeys = parseKeys(html.dataset.lineageSortsKeys);
    var from = readFirst(params, entryLineageKeys);
    var sort = readFirst(params, activeSortKeys).trim();
    var sorts = readFirst(params, lineageSortsKeys).trim();
    var segments = typeof from === "string" ? from.trim().split("/").filter(Boolean) : [];
    var canSortCollectionBreadcrumb = html.dataset.canSortCollectionBreadcrumb === "true";

    if (segments.length > 0) {
        html.setAttribute("data-entry-breadcrumb-preview-pending", "true");
        html.setAttribute("data-entry-breadcrumb-runtime-pending", "true");
        html.setAttribute("data-entry-breadcrumb-meta-pending", "true");
        return;
    }

    if (canSortCollectionBreadcrumb && (sort !== "" || sorts !== "")) {
        html.setAttribute("data-breadcrumb-sort-pending", "true");
    }
} catch (_) { }
}

start();
