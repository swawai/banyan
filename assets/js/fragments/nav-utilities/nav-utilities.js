import { getRuntimeManifest } from '../../runtime-manifest.js';
import { initLanguageMenu } from './language-menu.js';
import { initNavUtilityMenus } from './menu-runtime.js';
import { initThemeMenu } from './theme-menu.js';

void getRuntimeManifest();

document.addEventListener('DOMContentLoaded', () => {
    const themeMenu = document.querySelector('[data-nav-utility-kind="theme"]');
    const langMenu = document.querySelector('[data-nav-utility-kind="language"]');
    const hasUtilityMenu = Boolean(document.querySelector('[data-nav-utility-menu]'));
    if (!hasUtilityMenu) return;
    if (!initNavUtilityMenus()) return;

    if (langMenu) {
        void initLanguageMenu(langMenu);
    }
    if (themeMenu) {
        initThemeMenu(themeMenu);
    }
});
