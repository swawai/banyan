import { runBrowserRegression } from './run.mjs';
import { securityScenarios } from './scenarios.mjs';

await runBrowserRegression({
    headless: true,
    modeName: 'browser-security',
    scenarios: securityScenarios
});
