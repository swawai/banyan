import { normalizePathname } from './nav-state.js';

const BREADCRUMB_PREFETCH_SLOT = 'crumb';

function createCrumbText(text, { withCaret = false } = {}) {
    const span = document.createElement('span');
    span.className = 'crumb-text';
    span.textContent = text;
    if (withCaret) {
        const caret = document.createElement('span');
        caret.className = 'ui-dropdown-caret breadcrumb-menu-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.textContent = '▾';
        span.appendChild(caret);
    }
    return span;
}

function normalizeBreadcrumbItemKind(item) {
    const kind = item && typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
    return kind || '';
}

function applyBreadcrumbKind(element, item) {
    if (!(element instanceof Element)) {
        return;
    }

    const kind = normalizeBreadcrumbItemKind(item);
    if (kind) {
        element.dataset.breadcrumbKind = kind;
    }
}

function applyBreadcrumbPrefetchSlot(element) {
    if (element instanceof Element) {
        element.dataset.prefetchSlot = BREADCRUMB_PREFETCH_SLOT;
    }
}

function buildMenuPanel(menuItems) {
    const panel = document.createElement('span');
    panel.className = 'ui-dropdown-panel breadcrumb-menu-panel';
    panel.hidden = true;
    panel.dataset.uiDropdownPanel = 'true';
    panel.dataset.breadcrumbMenuPanel = 'true';

    menuItems.forEach((menuItem) => {
        const option = document.createElement('a');
        option.href = menuItem.href;
        option.className = menuItem.current
            ? 'ui-dropdown-option breadcrumb-menu-option is-current'
            : 'ui-dropdown-option breadcrumb-menu-option';
        applyBreadcrumbPrefetchSlot(option);
        applyBreadcrumbKind(option, menuItem);
        if (menuItem.current) {
            option.dataset.siteUpdateAnchor = 'true';
            option.setAttribute('aria-current', 'page');
        }
        option.textContent = menuItem.text;
        panel.appendChild(option);
    });

    return panel;
}

function applyBreadcrumbLinkState(link, item, menuItems) {
    if (!(link instanceof Element)) {
        return;
    }

    if (item.current) {
        link.dataset.breadcrumbModeToggle = 'true';
    }

    if (Array.isArray(menuItems) && menuItems.length > 0) {
        link.classList.add('ui-dropdown-trigger', 'breadcrumb-menu-link');
        link.dataset.uiDropdownTrigger = 'true';
        link.dataset.breadcrumbMenuLink = 'true';
        link.setAttribute('aria-haspopup', 'true');
        link.setAttribute('aria-expanded', 'false');
    }
}

function buildTopBreadcrumbItem(item, index) {
    const isLead = index === 0;
    const linkClasses = ['breadcrumb-link'];
    if (isLead) {
        linkClasses.push('breadcrumb-link-lead');
    }
    if (item.current) {
        linkClasses.push('is-current');
    }

    const menuItems = Array.isArray(item.menu) ? item.menu.filter(Boolean) : [];
    const itemSpan = document.createElement('span');
    const collectionSource = item && typeof item === 'object'
        ? (item.collection_source || item.collectionSource)
        : null;
    const collectionHref = item && typeof item === 'object'
        ? (typeof (item.collection_href || item.collectionHref) === 'string'
            ? (item.collection_href || item.collectionHref).trim()
            : '')
        : '';

    itemSpan.className = menuItems.length > 0
        ? 'breadcrumb-item ui-dropdown breadcrumb-item-menu'
        : 'breadcrumb-item';
    if (menuItems.length > 0) {
        itemSpan.dataset.uiDropdown = 'true';
        itemSpan.dataset.breadcrumbMenu = 'true';
        if (collectionHref) {
            itemSpan.dataset.breadcrumbCollectionHref = collectionHref;
        }
        if (collectionSource && typeof collectionSource === 'object') {
            itemSpan.dataset.breadcrumbCollectionSource = JSON.stringify(collectionSource);
        }
    }
    if (item.redundant_with_root_menu === true) {
        itemSpan.dataset.breadcrumbRedundantRoot = 'true';
    }

    const link = document.createElement('a');
    link.href = item.href;
    link.className = linkClasses.join(' ');
    applyBreadcrumbPrefetchSlot(link);
    applyBreadcrumbKind(link, item);
    if (item.current) {
        link.dataset.siteUpdateAnchor = 'true';
        link.setAttribute('aria-current', 'page');
    }
    if (item.title) {
        link.title = item.title;
    }
    applyBreadcrumbLinkState(link, item, menuItems);
    link.appendChild(createCrumbText(item.text, { withCaret: item.current || menuItems.length > 0 }));
    itemSpan.appendChild(link);
    if (menuItems.length > 0) {
        itemSpan.appendChild(buildMenuPanel(menuItems));
    }

    return itemSpan;
}

export function renderTopBreadcrumb(items) {
    const container = document.querySelector('.slot-breadcrumb');
    if (!container || !Array.isArray(items) || items.length === 0) {
        return;
    }

    const nav = document.createElement('nav');
    nav.className = 'breadcrumb-nav';
    nav.setAttribute('aria-label', 'Breadcrumb');

    items.forEach((item, index) => {
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.setAttribute('aria-hidden', 'true');
            sep.textContent = '﹥';
            nav.appendChild(sep);
        }

        nav.appendChild(buildTopBreadcrumbItem(item, index));
    });

    container.replaceChildren(nav);
}

function markMenuState(items, predicate) {
    return items.map((item) => ({
        ...item,
        current: predicate(item),
    }));
}

function normalizeMenuState(rootItem, rootMenuItems) {
    const menuItems = Array.isArray(rootMenuItems)
        ? rootMenuItems.filter(Boolean).map((item) => ({ ...item }))
        : [];
    if (menuItems.some((item) => item.highlighted === true)) {
        return markMenuState(menuItems, (item) => item.highlighted === true);
    }
    if (menuItems.some((item) => item.current === true)) {
        return markMenuState(menuItems, (item) => item.current === true);
    }
    if (menuItems.some((item) => item.selected === true)) {
        return markMenuState(menuItems, (item) => item.selected === true);
    }

    let selectedPathname = '';
    try {
        selectedPathname = normalizePathname(new URL(rootItem.href, window.location.origin).pathname);
    } catch (error) {
        selectedPathname = '';
    }

    return markMenuState(menuItems, (item) => {
        try {
            return normalizePathname(new URL(item.href, window.location.origin).pathname) === selectedPathname;
        } catch (error) {
            return false;
        }
    });
}

function buildRootStageNav(rootItem, rootMenuItems, rootMenuLabel) {
    const nav = document.createElement('nav');
    nav.className = 'breadcrumb-root-nav breadcrumb-root-nav-stage';
    nav.setAttribute('aria-label', rootMenuLabel || rootItem.text || 'Breadcrumb root');

    const menuItems = normalizeMenuState(rootItem, rootMenuItems);
    const visibleItem = {
        text: rootItem.text,
        href: rootItem.href,
        current: false,
        menu: menuItems,
        menu_button_label: rootMenuLabel || rootItem.text || 'Breadcrumb root',
    };
    if (rootItem.title) {
        visibleItem.title = rootItem.title;
    }

    nav.appendChild(buildTopBreadcrumbItem(visibleItem, 0));
    return nav;
}

function buildRootRailNav(rootItem, rootMenuItems, rootMenuLabel) {
    const nav = document.createElement('nav');
    nav.className = 'breadcrumb-root-nav breadcrumb-root-nav-list';
    nav.setAttribute('aria-label', rootMenuLabel || rootItem.text || 'Breadcrumb root');

    const menuItems = normalizeMenuState(rootItem, rootMenuItems);
    if (menuItems.length <= 1) {
        const link = document.createElement('a');
        link.href = rootItem.href;
        link.className = 'breadcrumb-root-link';
        applyBreadcrumbPrefetchSlot(link);
        applyBreadcrumbKind(link, rootItem);
        link.textContent = rootItem.text;
        nav.appendChild(link);
        return nav;
    }

    const list = document.createElement('div');
    list.className = 'breadcrumb-root-list';
    list.setAttribute('role', 'list');

    menuItems.forEach((menuItem) => {
        const item = document.createElement('span');
        item.className = 'breadcrumb-root-list-item';
        item.setAttribute('role', 'listitem');

        const link = document.createElement('a');
        link.href = menuItem.href;
        link.className = menuItem.current
            ? 'breadcrumb-root-link is-current'
            : 'breadcrumb-root-link';
        applyBreadcrumbPrefetchSlot(link);
        applyBreadcrumbKind(link, menuItem);
        link.textContent = menuItem.text;
        if (menuItem.current) {
            link.dataset.siteUpdateAnchor = 'true';
            link.setAttribute('aria-current', 'page');
        }
        if (menuItem.title) {
            link.title = menuItem.title;
        }

        item.appendChild(link);
        list.appendChild(item);
    });

    nav.appendChild(list);
    return nav;
}

export function renderRootSelection(rootItem, rootMenuItems, rootMenuLabel) {
    if (
        !rootItem
        || typeof rootItem.text !== 'string'
        || rootItem.text === ''
        || typeof rootItem.href !== 'string'
        || rootItem.href === ''
    ) {
        return;
    }

    const stageContainer = document.querySelector('.slot-breadcrumb-root-stage');
    if (stageContainer) {
        stageContainer.replaceChildren(buildRootStageNav(rootItem, rootMenuItems, rootMenuLabel));
    }

    const railContainer = document.querySelector('.slot-breadcrumb-root-rail');
    if (railContainer) {
        railContainer.replaceChildren(buildRootRailNav(rootItem, rootMenuItems, rootMenuLabel));
    }
}

function ensureArticleMetaPathNav(metaLabel) {
    const existing = document.querySelector('.post-taxonomy-path');
    if (existing) {
        return existing;
    }

    const metaContainer = document.querySelector('.article-meta');
    if (!metaContainer) {
        return null;
    }

    const nav = document.createElement('nav');
    nav.className = 'post-taxonomy post-taxonomy-path';
    nav.setAttribute('aria-label', metaLabel || 'Path');
    metaContainer.prepend(nav);
    return nav;
}

export function renderArticleMetaPath(metaLabel, items) {
    const nav = ensureArticleMetaPathNav(metaLabel);
    if (!nav || !Array.isArray(items) || items.length === 0) {
        return;
    }

    nav.setAttribute('aria-label', metaLabel || 'Path');
    nav.replaceChildren();

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = metaLabel || 'Path';
    nav.appendChild(label);

    items.forEach((item, index) => {
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'sep';
            sep.setAttribute('aria-hidden', 'true');
            sep.textContent = '/';
            nav.appendChild(sep);
        }

        const link = document.createElement('a');
        link.href = item.href;
        link.textContent = item.text;
        if (item.current) {
            link.setAttribute('aria-current', 'page');
        }
        nav.appendChild(link);
    });
}
