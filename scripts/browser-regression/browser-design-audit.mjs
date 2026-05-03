import { runBrowserRegression } from './run.mjs';
import { designAuditScenarios } from './scenarios.mjs';

await runBrowserRegression({
    headless: true,
    modeName: 'browser-design-audit',
    scenarios: designAuditScenarios
});
