import { explicitPrimaryBuildEnv, relFromSite, resolveLatestTempBuild } from './paths.mjs';

function failUsage(message) {
    throw new Error(`${message}\nUsage: bun run-entry-with-build.mjs <public|latest-temp> <entry-module>`);
}

const [selectionRaw, entryModule] = process.argv.slice(2);
if (!selectionRaw || !entryModule) {
    failUsage('Missing build selection or entry module.');
}

const selection = String(selectionRaw).toLowerCase();
if (selection === 'public') {
    process.env[explicitPrimaryBuildEnv] = 'public';
} else if (selection === 'latest-temp') {
    const latestTempBuild = resolveLatestTempBuild();
    process.env[explicitPrimaryBuildEnv] = relFromSite(latestTempBuild.dirPath);
} else {
    failUsage(`Unsupported build selection ${JSON.stringify(selectionRaw)}.`);
}

await import(new URL(entryModule, import.meta.url));
