import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import {
    createOutputDir,
    describeBuildSelection,
    explicitPrimaryBuildEnv,
    explicitUpgradeFromEnv,
    explicitUpgradeToEnv,
    relFromRepo,
    resolvePrimaryBuild,
    resolveUpgradeBuildPair
} from './paths.mjs';
import { writeReportFiles } from './report.mjs';
import { createStaticSiteServer } from './server.mjs';
import { recordLayoutShiftObserverScript, recordSecurityPolicyViolationScript, suppressLanguageSuggestDialogScript } from './helpers.mjs';
import { scenarios } from './scenarios.mjs';

function readScenarioFilter() {
    const raw = process.env.BANYAN_BROWSER_ONLY || '';
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function withTimeout(promise, timeoutMs, label) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

function createDialogRecorder(page, policy, dialogs) {
    page.on('dialog', async (dialog) => {
        const entry = {
            message: dialog.message(),
            type: dialog.type()
        };
        dialogs.push(entry);

        if (policy === 'accept') {
            await dialog.accept().catch(() => { });
            return;
        }

        await dialog.dismiss().catch(() => { });
    });
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeScenarioOutcome(outcome) {
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
        return {
            artifacts: {},
            details: outcome || {},
            message: ''
        };
    }

    const hasEnvelope = Object.prototype.hasOwnProperty.call(outcome, 'artifacts')
        || Object.prototype.hasOwnProperty.call(outcome, 'details')
        || Object.prototype.hasOwnProperty.call(outcome, 'message');
    if (!hasEnvelope) {
        return {
            artifacts: {},
            details: outcome,
            message: ''
        };
    }

    return {
        artifacts: outcome.artifacts && typeof outcome.artifacts === 'object' ? outcome.artifacts : {},
        details: outcome.details && typeof outcome.details === 'object' ? outcome.details : {},
        message: typeof outcome.message === 'string' ? outcome.message : ''
    };
}

async function runScenario(scenario, runtime) {
    const startedAt = Date.now();
    const scenarioOutputDir = path.join(runtime.outputDir, scenario.id);
    fs.mkdirSync(scenarioOutputDir, { recursive: true });

    if (scenario.kind === 'upgrade' && !runtime.upgradePair) {
        return {
            id: scenario.id,
            kind: scenario.kind,
            status: 'skipped',
            durationMs: Date.now() - startedAt,
            message: 'Skipped because fewer than two temp_workspace/public build directories were available.',
            artifacts: {}
        };
    }

    if (scenario.kind === 'single') {
        runtime.server.setRoot(runtime.primaryBuildDir);
    } else if (runtime.upgradePair) {
        runtime.server.setRoot(runtime.upgradePair.fromDir);
    }

    const context = await runtime.browser.newContext({
        viewport: scenario.viewport || { width: 1440, height: 960 }
    });
    if (runtime.trace) {
        await context.tracing.start({
            screenshots: true,
            snapshots: true,
            sources: true
        });
    }

    const page = await context.newPage();
    await page.addInitScript(recordLayoutShiftObserverScript());
    await page.addInitScript(recordSecurityPolicyViolationScript());
    await page.addInitScript(suppressLanguageSuggestDialogScript());

    const dialogs = [];
    createDialogRecorder(page, scenario.dialogPolicy || 'dismiss', dialogs);

    const result = {
        id: scenario.id,
        kind: scenario.kind,
        status: 'passed',
        durationMs: 0,
        message: '',
        artifacts: {},
        details: null
    };

    try {
        console.log(`[RUN] ${scenario.id}`);
        const outcome = await withTimeout(scenario.run({
            artifactDir: scenarioOutputDir,
            baseUrl: runtime.server.getBaseUrl(),
            browser: runtime.browser,
            context,
            dialogs,
            outputDir: runtime.outputDir,
            page,
            primaryBuildDir: runtime.primaryBuildDir,
            server: runtime.server,
            upgradePair: runtime.upgradePair
        }), scenario.timeoutMs || 45000, scenario.id);
        const normalized = normalizeScenarioOutcome(outcome);
        result.details = normalized.details;
        result.artifacts = {
            ...result.artifacts,
            ...normalized.artifacts
        };
        result.message = normalized.message || 'Passed';
        console.log(`[PASS] ${scenario.id}`);
    } catch (error) {
        result.status = 'failed';
        result.message = error?.message || 'Unknown scenario failure.';
        if (error?.details) {
            result.details = error.details;
        }
        const screenshotPath = path.join(scenarioOutputDir, 'failure.png');
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
        result.artifacts.screenshot = relFromRepo(screenshotPath);
        console.log(`[FAIL] ${scenario.id}: ${result.message}`);
    } finally {
        if (runtime.trace) {
            const tracePath = path.join(scenarioOutputDir, 'trace.zip');
            await context.tracing.stop({ path: tracePath }).catch(() => { });
            result.artifacts.trace = relFromRepo(tracePath);
        }
        await context.close().catch(() => { });
        result.durationMs = Date.now() - startedAt;
    }

    return result;
}

export async function runBrowserRegression(options = {}) {
    const modeName = options.modeName || 'browser';
    const scenarioFilter = options.onlyScenarioIds || readScenarioFilter();
    const scenarioList = Array.isArray(options.scenarios) ? options.scenarios : scenarios;
    const primaryBuild = resolvePrimaryBuild();
    const primaryBuildDir = primaryBuild.dirPath;
    const upgradePair = resolveUpgradeBuildPair();
    if (options.requireUpgradePair === true && !upgradePair) {
        throw new Error('This browser-regression entry requires two temp builds under temp_workspace/public/, or explicit BANYAN_BROWSER_UPGRADE_FROM_DIR / BANYAN_BROWSER_UPGRADE_TO_DIR overrides.');
    }
    const outputDir = createOutputDir(modeName);
    const browser = await chromium.launch({
        headless: options.headless !== false
    });
    const server = await createStaticSiteServer({ rootDir: primaryBuildDir });
    await server.start();

    const report = {
        generatedAt: nowIso(),
        mode: modeName,
        outputDir: relFromRepo(outputDir),
        primaryBuildDir: relFromRepo(primaryBuildDir),
        primaryBuildSelection: describeBuildSelection(primaryBuild),
        primaryBuildSelectionEnv: process.env[explicitPrimaryBuildEnv] || '',
        upgradeFromDir: upgradePair ? relFromRepo(upgradePair.fromDir) : '',
        upgradeToDir: upgradePair ? relFromRepo(upgradePair.toDir) : '',
        upgradeBuildSelection: upgradePair
            ? `${describeBuildSelection({
                dirPath: upgradePair.fromDir,
                kind: upgradePair.fromKind,
                reason: `${upgradePair.reason}; from`
            })} -> ${describeBuildSelection({
                dirPath: upgradePair.toDir,
                kind: upgradePair.toKind,
                reason: `${upgradePair.reason}; to`
            })}`
            : '',
        upgradeBuildSelectionEnv: {
            from: process.env[explicitUpgradeFromEnv] || '',
            to: process.env[explicitUpgradeToEnv] || ''
        },
        scenarios: [],
        totals: {
            failed: 0,
            passed: 0,
            skipped: 0
        }
    };

    console.log(`Primary build selection: ${report.primaryBuildSelection}`);
    if (upgradePair) {
        console.log(`Upgrade build selection: ${report.upgradeBuildSelection}`);
    }

    try {
        const activeScenarios = scenarioFilter.length > 0
            ? scenarioList.filter((scenario) => scenarioFilter.includes(scenario.id))
            : scenarioList;
        for (const scenario of activeScenarios) {
            const result = await runScenario(scenario, {
                browser,
                outputDir,
                primaryBuildDir,
                server,
                trace: options.trace === true,
                upgradePair
            });
            report.scenarios.push(result);
            report.totals[result.status] += 1;
            writeReportFiles(report);
        }
    } finally {
        await browser.close().catch(() => { });
        await server.stop().catch(() => { });
    }

    const files = writeReportFiles(report);
    const summaryText = fs.readFileSync(files.summaryPath, 'utf8');
    console.log(summaryText);
    console.log('');
    console.log(`JSON report: ${relFromRepo(files.reportJsonPath)}`);

    if (report.totals.failed > 0) {
        process.exitCode = 1;
    }

    return report;
}
