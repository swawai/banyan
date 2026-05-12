let dropdown = null;

function getMenuRoot(target) {
    return target instanceof Element ? target.closest('[data-nav-utility-menu]') : null;
}

function getMenuTrigger(menuRoot) {
    return menuRoot instanceof Element ? menuRoot.querySelector('[data-nav-utility-trigger]') : null;
}

function getMenuPanel(menuRoot) {
    return menuRoot instanceof Element ? menuRoot.querySelector('[data-nav-utility-panel]') : null;
}

export function getMenuOptions(menuRoot) {
    return menuRoot instanceof Element ? Array.from(menuRoot.querySelectorAll('[data-nav-utility-option]')) : [];
}

export function getMenuSelectedOption(menuRoot) {
    return getMenuOptions(menuRoot).find((option) => option.classList.contains('is-current')) || null;
}

function setTriggerState(menuRoot, selectedLabel = '') {
    const trigger = getMenuTrigger(menuRoot);
    if (!(menuRoot instanceof Element) || !(trigger instanceof Element)) {
        return;
    }

    const baseLabel = menuRoot.dataset.navUtilityLabel || trigger.getAttribute('aria-label') || '';
    const accessibleLabel = selectedLabel ? `${baseLabel}: ${selectedLabel}` : baseLabel;
    if (!accessibleLabel) {
        trigger.removeAttribute('title');
        return;
    }

    trigger.setAttribute('aria-label', accessibleLabel);
    trigger.title = accessibleLabel;
}

export function setMenuDisabled(menuRoot, disabled) {
    const trigger = getMenuTrigger(menuRoot);
    if (!(menuRoot instanceof Element) || !(trigger instanceof HTMLButtonElement)) {
        return;
    }

    menuRoot.classList.toggle('is-disabled', disabled);
    trigger.disabled = disabled;
    if (disabled && dropdown?.isOpen(menuRoot)) {
        dropdown.close();
    }
}

export function markCurrentOption(menuRoot, selectedValue = '') {
    let selectedLabel = '';

    getMenuOptions(menuRoot).forEach((option) => {
        const isCurrent = option.dataset.value === selectedValue;
        option.classList.toggle('is-current', isCurrent);
        option.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
        if (isCurrent) {
            selectedLabel = option.textContent?.trim() || '';
        }
    });

    setTriggerState(menuRoot, selectedLabel);
}

export function bindMenuOption(option, onSelect) {
    if (!(option instanceof HTMLButtonElement) || option.dataset.navUtilityBound === 'true') {
        return;
    }

    option.dataset.navUtilityBound = 'true';
    option.addEventListener('click', async () => {
        if (option.disabled) {
            return;
        }

        const menuRoot = getMenuRoot(option);
        const value = option.dataset.value || '';
        const shouldClose = await onSelect(value, option, menuRoot);
        if (shouldClose !== false) {
            dropdown?.close({ restoreFocus: true });
        }
    });
}

export function replaceMenuOptions(menuRoot, optionDefs, onSelect) {
    const panel = getMenuPanel(menuRoot);
    if (!(panel instanceof Element)) {
        return;
    }

    panel.replaceChildren();
    optionDefs.forEach((definition) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'ui-dropdown-option site-nav-utility-option';
        option.dataset.navUtilityOption = 'true';
        option.dataset.value = definition.value;
        option.textContent = definition.label;
        option.disabled = definition.disabled === true;
        if (definition.hasTrans === false) {
            option.dataset.hasTrans = 'false';
        }
        bindMenuOption(option, onSelect);
        panel.appendChild(option);
    });

    setMenuDisabled(menuRoot, panel.childElementCount === 0);
}

function closeOpenMenu({ restoreFocus = false } = {}) {
    dropdown?.close({ restoreFocus });
}

function closeMenuRoot(menuRoot, { restoreFocus = false } = {}) {
    if (!(menuRoot instanceof Element) || !dropdown?.isOpen(menuRoot)) {
        return false;
    }

    dropdown.close({ restoreFocus });
    return true;
}

function openMenu(menuRoot, { focusSelected = false } = {}) {
    if (!(menuRoot instanceof Element) || !dropdown) {
        return false;
    }

    return dropdown.open(menuRoot, {
        focusPanel: focusSelected,
        focusSelector: '.site-nav-utility-option.is-current:not(:disabled)',
        fallbackFocusSelector: '.site-nav-utility-option:not(:disabled)'
    });
}

function toggleMenu(menuRoot, options = {}) {
    if (!(menuRoot instanceof Element) || !dropdown) {
        return false;
    }

    if (dropdown.isOpen(menuRoot)) {
        dropdown.close();
        return false;
    }

    return openMenu(menuRoot, options);
}

function ensureDropdown() {
    if (dropdown) {
        return true;
    }

    const createDropdownController = window.__banyanUiDropdown?.createDropdownController;
    if (typeof createDropdownController !== 'function') {
        return false;
    }

    dropdown = createDropdownController({
        rootSelector: '[data-nav-utility-menu]',
        triggerSelector: '[data-nav-utility-trigger]',
        panelSelector: '[data-nav-utility-panel]',
        optionSelector: '.site-nav-utility-option:not(:disabled)'
    });

    return true;
}

function handleDocumentClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target ? target.closest('[data-nav-utility-trigger]') : null;
    if (trigger) {
        event.preventDefault();
        toggleMenu(getMenuRoot(trigger));
        return;
    }

    if (dropdown?.hasOpen() && (!target || !dropdown.contains(target))) {
        closeOpenMenu();
    }
}

function handleDocumentFocusIn(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (dropdown?.hasOpen() && (!target || !dropdown.contains(target))) {
        closeOpenMenu();
    }
}

function handleDocumentKeyDown(event) {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target ? target.closest('[data-nav-utility-trigger]') : null;

    if (event.key === 'Escape' && dropdown?.hasOpen()) {
        event.preventDefault();
        closeOpenMenu({ restoreFocus: true });
        return;
    }

    if (dropdown?.handlePanelKeyDown(event)) {
        return;
    }

    if (trigger && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'F4')) {
        event.preventDefault();
        toggleMenu(getMenuRoot(trigger), { focusSelected: true });
    }
}

export function initNavUtilityMenus() {
    if (!ensureDropdown()) {
        return false;
    }

    window.__banyanNavUtilityMenus = {
        closeRoot: closeMenuRoot
    };

    document.querySelectorAll('[data-nav-utility-menu]').forEach((menuRoot) => {
        const trigger = getMenuTrigger(menuRoot);
        if (!(trigger instanceof HTMLElement)) {
            return;
        }

        if (menuRoot.dataset.navUtilityInit !== 'true') {
            menuRoot.dataset.navUtilityInit = 'true';
        }

        const selectedOption = getMenuSelectedOption(menuRoot);
        setTriggerState(menuRoot, selectedOption?.textContent?.trim() || '');
        setMenuDisabled(menuRoot, getMenuOptions(menuRoot).length === 0);
    });

    dropdown.initTriggers();

    if (document.body.dataset.navUtilityEventsInit === 'true') {
        return true;
    }

    document.body.dataset.navUtilityEventsInit = 'true';

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('focusin', handleDocumentFocusIn);
    document.addEventListener('keydown', handleDocumentKeyDown);

    return true;
}
