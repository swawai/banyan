import { runBrowserRegression } from './run.mjs';
import { scenarios } from './scenarios.mjs';

const smokeScenarioIds = new Set([
    'home-shell-smoke',
    'breadcrumb-products-wide-stability',
    'breadcrumb-tags-wide-stability'
]);

await runBrowserRegression({
    headless: true,
    modeName: 'browser-smoke',
    scenarios: scenarios.filter((scenario) => smokeScenarioIds.has(scenario.id))
});
