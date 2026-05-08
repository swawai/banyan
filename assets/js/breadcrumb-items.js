import { SORT_VARIANTS, applySortTokenToUrl } from './sort-shared.js';
import {
    decodeItemsPayload,
    getItemsPayload,
    isCollectionRowKind,
    readRequestedSortToken,
    sortItemsRows,
    supportsItemsPayloadProvider,
} from './collection-items.js';
import {
    applyFromPathToUrl,
    applySortsTokensToUrl,
    buildCurrentPageSortsTokens,
    buildDescendantSortsTokens,
    normalizeFromPath,
    normalizePathname,
} from './nav-state.js';

export function normalizeBreadcrumbCollectionSource(source) {
    if (!source || typeof source !== 'object') {
        return null;
    }

    const logicalPath = normalizeFromPath(source.logical_path || source.logicalPath || '');
    const provider = typeof source.provider === 'string' ? source.provider.trim().toLowerCase() : '';
    const sortVariant = typeof (source.sort_variant || source.sortVariant) === 'string'
        ? (source.sort_variant || source.sortVariant).trim().toLowerCase()
        : '';
    const defaultSort = typeof (source.default_sort || source.defaultSort) === 'string'
        ? (source.default_sort || source.defaultSort).trim().toLowerCase()
        : '';

    if (!logicalPath && !provider && !sortVariant && !defaultSort) {
        return null;
    }

    const normalized = {};
    if (logicalPath) {
        normalized.logicalPath = logicalPath;
    }
    if (provider) {
        normalized.provider = provider;
    }
    if (sortVariant) {
        normalized.sortVariant = sortVariant;
    }
    if (defaultSort) {
        normalized.defaultSort = defaultSort;
    }

    return normalized;
}

export function getSourceSortVariant(source) {
    switch (source?.provider) {
    case 'all':
        return 'all';
    case 'products':
        return 'products';
    case 'section-d':
        return 'section';
    case 'taxonomy':
        return 'tree';
    default:
        return '';
    }
}

function toRelativeHref(url) {
    if (!(url instanceof URL)) {
        return '';
    }

    return url.origin === window.location.origin
        ? `${url.pathname}${url.search}${url.hash}`
        : url.toString();
}

function normalizeBreadcrumbItemKind(kind) {
    return typeof kind === 'string' ? kind.trim().toLowerCase() : '';
}

function readRequestedSortState(source, sortVariant, defaultSort = '') {
    const fallbackToken = defaultSort || SORT_VARIANTS[sortVariant]?.defaultToken || '';
    const sortToken = sortVariant ? readRequestedSortToken(sortVariant, source?.logicalPath || '', fallbackToken) : '';
    const sortsTokens = source?.logicalPath
        ? buildCurrentPageSortsTokens(source.logicalPath, sortToken)
        : [];

    return {
        sortToken,
        defaultSort: fallbackToken,
        sortsTokens,
    };
}

export function buildCollectionPageHref(href, logicalPath, sortVariant, defaultSort = '') {
    const rawHref = typeof href === 'string' ? href.trim() : '';
    if (!rawHref || !logicalPath || !sortVariant) {
        return rawHref;
    }

    try {
        const url = new URL(rawHref, window.location.origin);
        const sortToken = readRequestedSortToken(sortVariant, logicalPath, defaultSort);
        const sortsTokens = buildCurrentPageSortsTokens(logicalPath, sortToken);
        applySortTokenToUrl(url, sortToken, defaultSort);
        applySortsTokensToUrl(url, sortsTokens);
        return toRelativeHref(url);
    } catch (error) {
        return rawHref;
    }
}

function buildDescendantCollectionHref(href, collectionSource, sortToken = '', defaultSort = '') {
    const rawHref = typeof href === 'string' ? href.trim() : '';
    if (!rawHref || !collectionSource?.logicalPath) {
        return rawHref;
    }

    try {
        const url = new URL(rawHref, window.location.origin);
        applySortTokenToUrl(url, sortToken, defaultSort);
        applySortsTokensToUrl(url, buildDescendantSortsTokens(collectionSource.logicalPath, sortToken));
        return toRelativeHref(url);
    } catch (error) {
        return rawHref;
    }
}

export function buildEntrySourceHref(href, logicalPath, entryKey, sortToken = '', defaultSort = '', sortsTokens = []) {
    const rawHref = typeof href === 'string' ? href.trim() : '';
    if (!rawHref) {
        return '';
    }

    try {
        const url = new URL(rawHref, window.location.origin);
        if (logicalPath && entryKey) {
            applyFromPathToUrl(url, `${logicalPath}${entryKey}/`);
        }
        applySortTokenToUrl(url, sortToken, defaultSort);
        applySortsTokensToUrl(url, sortsTokens);
        return toRelativeHref(url);
    } catch (error) {
        return rawHref;
    }
}

export function buildBreadcrumbRowHref(row, collectionSource, sortState) {
    if (!row || typeof row.href !== 'string' || row.href.trim() === '' || !collectionSource?.logicalPath) {
        return '';
    }

    if (isCollectionRowKind(row.kind)) {
        return buildDescendantCollectionHref(
            row.href,
            collectionSource,
            sortState?.sortToken || '',
            sortState?.defaultSort || ''
        );
    }

    return buildEntrySourceHref(
        row.href,
        collectionSource.logicalPath,
        row.key,
        sortState?.sortToken || '',
        sortState?.defaultSort || '',
        sortState?.sortsTokens || []
    );
}

export function buildBreadcrumbMenuItemsFromDecodedRows(decoded, collectionSource, { selectedKey = '', selectedPathname = '' } = {}) {
    if (!decoded || !collectionSource?.logicalPath) {
        return [];
    }

    const sortVariant = decoded.sortVariant || collectionSource.sortVariant || getSourceSortVariant(collectionSource);
    const defaultSort = decoded.defaultSort || collectionSource.defaultSort || SORT_VARIANTS[sortVariant]?.defaultToken || '';
    const sortState = readRequestedSortState(collectionSource, sortVariant, defaultSort);
    const { rows } = sortItemsRows(
        decoded.rows,
        sortVariant,
        collectionSource.logicalPath,
        sortState.defaultSort
    );

    return rows
        .map((row) => {
            const href = buildBreadcrumbRowHref(row, collectionSource, sortState);
            if (!href) {
                return null;
            }

            let current = false;
            if (selectedKey && row?.key === selectedKey) {
                current = true;
            } else if (selectedPathname) {
                try {
                    current = normalizePathname(new URL(row.href, window.location.origin).pathname) === selectedPathname;
                } catch (error) {
                    current = false;
                }
            }

            const item = {
                text: typeof row.text === 'string' && row.text !== '' ? row.text : row.key,
                href,
                current,
            };
            const kind = normalizeBreadcrumbItemKind(row.kind);
            if (kind) {
                item.kind = kind;
            }

            return item;
        })
        .filter(Boolean);
}

export async function buildBreadcrumbMenuItems(fragmentRoot, collectionSource, selection = {}) {
    if (!fragmentRoot || !collectionSource?.logicalPath || !supportsItemsPayloadProvider(collectionSource.provider)) {
        return [];
    }

    const payload = await getItemsPayload(fragmentRoot, collectionSource.logicalPath);
    const decoded = decodeItemsPayload(payload);
    return buildBreadcrumbMenuItemsFromDecodedRows(decoded, collectionSource, selection);
}

export async function buildSelectedBreadcrumbItem(fragmentRoot, source, entryKey) {
    if (!fragmentRoot || !source?.logicalPath || !entryKey) {
        return null;
    }

    const collectionSource = normalizeBreadcrumbCollectionSource(source?.currentCollectionSource)
        || normalizeBreadcrumbCollectionSource(source);
    if (!collectionSource || !supportsItemsPayloadProvider(collectionSource.provider)) {
        return null;
    }

    const payload = await getItemsPayload(fragmentRoot, source.logicalPath);
    const decoded = decodeItemsPayload(payload);
    if (!decoded) {
        return null;
    }

    const selectedRow = decoded.rows.find((row) => row?.key === entryKey);
    if (!selectedRow) {
        return null;
    }

    const menu = buildBreadcrumbMenuItemsFromDecodedRows(decoded, collectionSource, { selectedKey: entryKey });
    const sortState = readRequestedSortState(collectionSource, decoded.sortVariant, decoded.defaultSort);
    const href = buildBreadcrumbRowHref(selectedRow, collectionSource, sortState);
    if (!href) {
        return null;
    }

    const item = {
        text: typeof selectedRow.text === 'string' && selectedRow.text !== '' ? selectedRow.text : entryKey,
        href,
        current: true,
        menu,
        collection_source: collectionSource,
    };
    const kind = normalizeBreadcrumbItemKind(selectedRow.kind);
    if (kind) {
        item.kind = kind;
    }

    return item;
}
