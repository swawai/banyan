import {
    SORT_VARIANTS,
    applySortTokenToUrl,
    getNormalizedSortToken,
    parseSortToken,
    readCurrentSortToken,
    toggleSortOrder
} from './sort-shared.js';
import {
    applySortsTokensToUrl,
    buildCurrentPageSortsTokens,
    buildDescendantSortsTokens,
    getLogicalPathDepth,
    normalizeCollectionLogicalPathFromUrl as normalizeLogicalPathFromUrl,
    normalizeFromPath,
    normalizePathname,
    readSortTokenForPath,
} from './nav-state.js';
import { buildBreadcrumbMenuItems } from './breadcrumb-items.js';
import {
    ENTRY_LINEAGE_FIELD,
    hasFieldValue,
} from './navigation-state.contract.js';

const BREADCRUMB_SORT_PENDING_ATTR = 'data-breadcrumb-sort-pending';

function clearBreadcrumbSortPending() {
    document.documentElement?.removeAttribute(BREADCRUMB_SORT_PENDING_ATTR);
}

function normalizePageCollectionSource(source) {
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

    if (!logicalPath || !provider || !sortVariant) {
        return null;
    }

    return { logicalPath, provider, sortVariant, defaultSort };
}

function readPageCollectionSource() {
    const raw = document.body?.dataset.pageCollectionSource || '';
    if (!raw) {
        return null;
    }

    try {
        return normalizePageCollectionSource(JSON.parse(raw));
    } catch (error) {
        return null;
    }
}

function normalizeCollectionLogicalPathFromUrl(url, pageCollectionSource) {
    if (!(url instanceof URL) || !pageCollectionSource?.provider) {
        return '';
    }

    return normalizeLogicalPathFromUrl(url, document.body?.dataset.siteRoot || '/');
}

function buildSortHref(token, defaultToken, pageCollectionSource) {
    const url = new URL(window.location.href);
    applySortTokenToUrl(url, token, defaultToken);
    if (pageCollectionSource?.logicalPath) {
        applySortsTokensToUrl(url, buildCurrentPageSortsTokens(pageCollectionSource.logicalPath, token));
    }
    return `${url.pathname}${url.search}${url.hash}`;
}

function writeSortToken(token, defaultToken, pageCollectionSource) {
    const url = new URL(window.location.href);
    applySortTokenToUrl(url, token, defaultToken);
    if (pageCollectionSource?.logicalPath) {
        applySortsTokensToUrl(url, buildCurrentPageSortsTokens(pageCollectionSource.logicalPath, token));
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function buildRelativeHref(url) {
    if (!(url instanceof URL)) {
        return '';
    }

    return url.origin === window.location.origin
        ? `${url.pathname}${url.search}${url.hash}`
        : url.toString();
}

function readBreadcrumbCollectionSource(wrapper, pageCollectionSource) {
    if (!(wrapper instanceof HTMLElement) || !pageCollectionSource?.provider) {
        return null;
    }

    const rawSource = wrapper.dataset.breadcrumbCollectionSource || '';
    if (rawSource) {
        try {
            return normalizePageCollectionSource(JSON.parse(rawSource));
        } catch (error) {
            return null;
        }
    }

    const collectionHref = wrapper.dataset.breadcrumbCollectionHref || '';
    if (!collectionHref) {
        return null;
    }

    try {
        const logicalPath = normalizeLogicalPathFromUrl(new URL(collectionHref, window.location.origin), document.body?.dataset.siteRoot || '/');
        if (!logicalPath) {
            return null;
        }

        return {
            logicalPath,
            provider: pageCollectionSource.provider,
            sortVariant: pageCollectionSource.sortVariant,
            defaultSort: pageCollectionSource.defaultSort,
        };
    } catch (error) {
        return null;
    }
}

let breadcrumbTrailMenuRenderId = 0;

function normalizeBreadcrumbItemKind(item) {
    return item && typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
}

async function updateBreadcrumbTrailMenus(pageCollectionSource) {
    const fragmentRoot = document.body?.dataset.fragmentRoot || '';
    if (!fragmentRoot || !pageCollectionSource?.provider) {
        return;
    }

    const wrappers = Array.from(document.querySelectorAll('.slot-breadcrumb [data-breadcrumb-menu]'));
    if (wrappers.length === 0) {
        return;
    }

    const renderId = ++breadcrumbTrailMenuRenderId;

    await Promise.all(wrappers.map(async (wrapper) => {
        const collectionSource = readBreadcrumbCollectionSource(wrapper, pageCollectionSource);
        if (!collectionSource?.logicalPath) {
            return;
        }

        const link = wrapper.querySelector('a.breadcrumb-menu-link[href]');
        const panel = wrapper.querySelector('[data-breadcrumb-menu-panel]');
        if (!(link instanceof HTMLAnchorElement) || !(panel instanceof HTMLElement)) {
            return;
        }

        const selectedPathname = normalizePathname(new URL(link.href, window.location.origin).pathname);
        const menuItems = await buildBreadcrumbMenuItems(fragmentRoot, collectionSource, { selectedPathname });
        if (renderId !== breadcrumbTrailMenuRenderId) {
            return;
        }

        if (menuItems.length === 0) {
            return;
        }

        if (selectedPathname) {
            const coversCurrentPage = menuItems.some((menuItem) => {
                try {
                    return normalizePathname(new URL(menuItem.href, window.location.origin).pathname) === selectedPathname;
                } catch (error) {
                    return false;
                }
            });

            if (!coversCurrentPage) {
                return;
            }
        }

        const fragment = document.createDocumentFragment();

        menuItems.forEach((menuItem) => {
            const option = document.createElement('a');
            option.href = menuItem.href;
            option.className = 'ui-dropdown-option breadcrumb-menu-option';
            option.dataset.prefetchSlot = 'crumb';
            const kind = normalizeBreadcrumbItemKind(menuItem);
            if (kind) {
                option.dataset.breadcrumbKind = kind;
            }
            option.textContent = menuItem.text;
            if (menuItem.current) {
                option.classList.add('is-current');
                option.setAttribute('aria-current', 'page');
            }

            fragment.appendChild(option);
        });

        if (renderId !== breadcrumbTrailMenuRenderId) {
            return;
        }

        panel.replaceChildren(fragment);
    }));
}

function updateGridTitleLinks(grid, variantName, currentToken, pageCollectionSource) {
    const variant = SORT_VARIANTS[variantName];
    if (!variant) return;

    const currentSorts = pageCollectionSource?.logicalPath
        ? buildCurrentPageSortsTokens(pageCollectionSource.logicalPath, currentToken)
        : [];
    const descendantSorts = pageCollectionSource?.logicalPath
        ? buildDescendantSortsTokens(pageCollectionSource.logicalPath, currentToken)
        : [];

    grid.querySelectorAll('.cell-title .title-link[href]').forEach((link) => {
        const rawHref = link.getAttribute('href') || '';
        if (!rawHref) return;

        let url;
        try {
            url = new URL(rawHref, window.location.origin);
        } catch (error) {
            return;
        }

        if (url.origin !== window.location.origin) {
            return;
        }

        applySortTokenToUrl(url, currentToken, variant.defaultToken);
        if (pageCollectionSource?.logicalPath) {
            const isEntryLink = hasFieldValue(url.search, ENTRY_LINEAGE_FIELD);
            applySortsTokensToUrl(url, isEntryLink ? currentSorts : descendantSorts);
        }
        link.href = buildRelativeHref(url);
    });
}

function updateBreadcrumbTrailLinks(variantName, currentToken, pageCollectionSource) {
    const variant = SORT_VARIANTS[variantName];
    if (!variant) return;

    const currentSorts = pageCollectionSource?.logicalPath
        ? buildCurrentPageSortsTokens(pageCollectionSource.logicalPath, currentToken)
        : [];
    const currentDepth = pageCollectionSource?.logicalPath
        ? getLogicalPathDepth(pageCollectionSource.logicalPath)
        : 0;

    document.querySelectorAll('.slot-breadcrumb a[href]').forEach((link) => {
        const rawHref = link.getAttribute('href') || '';
        if (!rawHref) return;

        let url;
        try {
            url = new URL(rawHref, window.location.origin);
        } catch (error) {
            return;
        }

        if (url.origin !== window.location.origin) {
            return;
        }

        let targetToken = currentToken;
        let targetSorts = currentSorts;
        if (pageCollectionSource?.logicalPath) {
            const targetLogicalPath = normalizeCollectionLogicalPathFromUrl(url, pageCollectionSource);
            const targetDepth = getLogicalPathDepth(targetLogicalPath);
            if (targetDepth > 0 && targetDepth <= currentDepth) {
                targetSorts = currentSorts.slice(0, targetDepth);
                targetToken = targetSorts[targetSorts.length - 1] || '';
            }
            applySortsTokensToUrl(url, targetSorts);
        }

        applySortTokenToUrl(url, targetToken, variant.defaultToken);
        link.href = buildRelativeHref(url);
    });
}

function readRowValue(rowHead, fieldConfig) {
    if (!rowHead || !fieldConfig) return '';
    const raw = rowHead.dataset?.[fieldConfig.dataKey] ?? '';
    if (fieldConfig.type === 'number') {
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    return String(raw);
}

function readOriginalRowIndex(row) {
    const raw = row?.head?.dataset?.sortOriginalIndex ?? '';
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : row.index;
}

function compareRowValues(left, right, fieldConfig, order) {
    const leftValue = readRowValue(left.head, fieldConfig);
    const rightValue = readRowValue(right.head, fieldConfig);
    let result = 0;

    if (fieldConfig.type === 'number') {
        result = leftValue - rightValue;
    } else {
        result = String(leftValue).localeCompare(String(rightValue), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    if (result !== 0) return order === 'asc' ? result : -result;

    // Keep ties in the original SSR order so default descending sorts do not
    // reshuffle same-value rows on page load.
    return readOriginalRowIndex(left) - readOriginalRowIndex(right);
}

function isGridCell(node) {
    return !!node && node.nodeType === 1 && Array.from(node.classList || []).some((className) => className.startsWith('cell-'));
}

function collectSortableRows(grid, columnCount) {
    const rowCells = Array.from(grid.children).filter((child) => isGridCell(child) && !child.classList.contains('header'));
    const rows = [];

    for (let index = 0, offset = 0; offset + columnCount <= rowCells.length; index += 1, offset += columnCount) {
        const cells = rowCells.slice(offset, offset + columnCount);
        const head = cells[0];
        if (head?.dataset && head.dataset.sortOriginalIndex === undefined) {
            head.dataset.sortOriginalIndex = String(index);
        }
        rows.push({ index, head, cells });
    }

    return { rows, rowCells };
}

function updateSortControls(grid, variantName, currentToken, pageCollectionSource) {
    const variant = SORT_VARIANTS[variantName];
    const current = parseSortToken(currentToken);
    const controls = grid.querySelectorAll('a[data-sort-control="true"]');

    controls.forEach((control) => {
        const field = (control.dataset.sortField || '').toLowerCase();
        const defaultOrder = (control.dataset.sortDefaultOrder || 'asc').toLowerCase();
        const active = field === current.field;
        const nextOrder = active ? toggleSortOrder(current.order) : defaultOrder;
        const nextToken = `${field}-${nextOrder}`;
        const indicator = control.querySelector('.sort-indicator');
        const titleAsc = control.dataset.sortTitleAsc || '';
        const titleDesc = control.dataset.sortTitleDesc || '';
        const actionLabel = nextOrder === 'asc' ? titleAsc : titleDesc;

        control.href = buildSortHref(nextToken, variant.defaultToken, pageCollectionSource);
        control.dataset.sortActive = active ? 'true' : 'false';
        if (actionLabel) {
            control.title = actionLabel;
            control.setAttribute('aria-label', actionLabel);
        }

        if (indicator) {
            indicator.textContent = active ? (current.order === 'asc' ? '↑' : '↓') : '↨';
        }
    });
}

async function applySortableGrid(grid) {
    const variantName = (grid.dataset.sortVariant || '').toLowerCase();
    const variant = SORT_VARIANTS[variantName];
    const columnCount = Number(grid.dataset.sortColumns || 0);
    if (!variant || !columnCount) return;

    const pageCollectionSource = readPageCollectionSource();
    const queryToken = readCurrentSortToken(variantName, variant.defaultToken);
    const currentToken = pageCollectionSource?.logicalPath
        ? getNormalizedSortToken(
            readSortTokenForPath(pageCollectionSource.logicalPath, queryToken),
            variantName,
            variant.defaultToken
        )
        : queryToken;
    const current = parseSortToken(currentToken);
    const fieldConfig = variant.fields[current.field];
    if (!fieldConfig) return;

    const { rows, rowCells } = collectSortableRows(grid, columnCount);
    if (!rows.length) {
        updateSortControls(grid, variantName, currentToken, pageCollectionSource);
        updateGridTitleLinks(grid, variantName, currentToken, pageCollectionSource);
        updateBreadcrumbTrailLinks(variantName, currentToken, pageCollectionSource);
        await updateBreadcrumbTrailMenus(pageCollectionSource);
        return;
    }

    const sortedRows = rows.slice().sort((left, right) => {
        if (variant.grouped) {
            const leftGroup = Number(left.head?.dataset?.sortGroup || 0);
            const rightGroup = Number(right.head?.dataset?.sortGroup || 0);
            if (leftGroup !== rightGroup) {
                return current.order === 'asc' ? leftGroup - rightGroup : rightGroup - leftGroup;
            }
        }

        return compareRowValues(left, right, fieldConfig, current.order);
    });

    const nextCells = [];
    sortedRows.forEach((row) => {
        row.cells.forEach((cell) => nextCells.push(cell));
    });

    const orderChanged = nextCells.length !== rowCells.length || nextCells.some((cell, index) => cell !== rowCells[index]);
    if (orderChanged) {
        const fragment = document.createDocumentFragment();
        nextCells.forEach((cell) => fragment.appendChild(cell));
        grid.appendChild(fragment);
    }

    updateSortControls(grid, variantName, currentToken, pageCollectionSource);
    updateGridTitleLinks(grid, variantName, currentToken, pageCollectionSource);
    updateBreadcrumbTrailLinks(variantName, currentToken, pageCollectionSource);
    await updateBreadcrumbTrailMenus(pageCollectionSource);
}

async function applySortableGrids() {
    const grids = Array.from(document.querySelectorAll('[data-sortable="true"][data-sort-variant]'));
    if (grids.length === 0) {
        clearBreadcrumbSortPending();
        return;
    }

    await Promise.all(grids.map((grid) => applySortableGrid(grid)));
    clearBreadcrumbSortPending();
}

async function initSortableGrids() {
    await applySortableGrids();

    document.addEventListener('click', (event) => {
        const control = event.target.closest('a[data-sort-control="true"]');
        if (!control) return;

        const grid = control.closest('[data-sortable="true"][data-sort-variant]');
        if (!grid) return;

        const variantName = (grid.dataset.sortVariant || '').toLowerCase();
        const variant = SORT_VARIANTS[variantName];
        const pageCollectionSource = readPageCollectionSource();
        const field = (control.dataset.sortField || '').toLowerCase();
        const defaultOrder = (control.dataset.sortDefaultOrder || 'asc').toLowerCase();
        const queryToken = readCurrentSortToken(variantName, variant?.defaultToken || '');
        const currentToken = pageCollectionSource?.logicalPath
            ? getNormalizedSortToken(
                readSortTokenForPath(pageCollectionSource.logicalPath, queryToken),
                variantName,
                variant?.defaultToken || ''
            )
            : queryToken;
        const current = parseSortToken(currentToken);
        const nextOrder = current.field === field ? toggleSortOrder(current.order) : defaultOrder;
        const nextToken = `${field}-${nextOrder}`;

        if (!variant || !variant.fields[field]) return;

        event.preventDefault();
        writeSortToken(nextToken, variant.defaultToken, pageCollectionSource);
        void applySortableGrids();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    void initSortableGrids();
});
