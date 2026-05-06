import { runBrowserRegression } from './run.mjs';
import { upgradeScenarios } from './scenarios.mjs';

await runBrowserRegression({
    headless: true,
    modeName: 'browser-upgrade',
    requireUpgradePair: true,
    scenarios: upgradeScenarios
});
