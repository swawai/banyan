import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const siteRoot = process.cwd();
const defaultPublicDir = 'public';
const defaultTop = 8;

// These guardrails intentionally target minified production output.
// Run the script without --check when you only want an exploratory report.
const productionGuardrails = [
    {
        label: 'home',
        relativePath: 'index.html',
        maxRawBytes: 20_000,
        maxGzipBytes: 7_000,
        maxBreadcrumbPayloadBytes: 16,
        maxBreadcrumbSourceCount: 0
    },
    {
        label: 'all',
        relativePath: 'all/index.html',
        maxRawBytes: 42_000,
        maxGzipBytes: 12_000,
        maxBreadcrumbPayloadBytes: 2_500,
        maxBreadcrumbSourceCount: 1
    },
    {
        label: 'products',
        relativePath: 'products/first-party/index.html',
        maxRawBytes: 42_000,
        maxGzipBytes: 12_000,
        maxBreadcrumbPayloadBytes: 2_500,
        maxBreadcrumbSourceCount: 1
    }
];

function printHelp() {
    console.log(`Usage:
  bun themes/banyan/scripts/checks/check-public-html.mjs [publicDir] [--check] [--top N]

Examples:
  bun run check:public
  bun run check:public:prod
  bun themes/banyan/scripts/checks/check-public-html.mjs temp_workspace/public/2605010948-page-local-compact-min --check

Notes:
  - Default mode prints a report only.
  - --check enables production guardrails and exits non-zero on regressions.
  - Guardrails are calibrated for minified production HTML, not hugo server output.
`);
}

function parseCli(argv) {
    const options = {
        publicDir: defaultPublicDir,
        check: false,
        top: defaultTop
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--check') {
            options.check = true;
            continue;
        }
        if (arg === '--top') {
            const nextArg = argv[index + 1];
            const parsed = Number.parseInt(nextArg ?? '', 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error(`Invalid value for --top: ${nextArg ?? '<missing>'}`);
            }
            options.top = parsed;
            index += 1;
            continue;
        }
        if (arg.startsWith('--top=')) {
            const parsed = Number.parseInt(arg.slice('--top='.length), 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error(`Invalid value for --top: ${arg.slice('--top='.length)}`);
            }
            options.top = parsed;
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`Unsupported option: ${arg}`);
        }
        if (options.publicDir !== defaultPublicDir) {
            throw new Error(`Only one publicDir can be provided, got extra argument: ${arg}`);
        }
        options.publicDir = arg;
    }

    return options;
}

async function collectHtmlFiles(rootDir, currentDir = rootDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectHtmlFiles(rootDir, absolutePath));
            continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.html') {
            continue;
        }
        files.push(absolutePath);
    }

    return files;
}

async function collectFilesByExtension(rootDir, extension, currentDir = rootDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFilesByExtension(rootDir, extension, absolutePath));
            continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== extension) {
            continue;
        }
        files.push(absolutePath);
    }

    return files;
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const kib = bytes / 1024;
    if (kib < 1024) {
        return `${kib.toFixed(1)} KiB`;
    }
    return `${(kib / 1024).toFixed(2)} MiB`;
}

function formatByteMetric(bytes, { includeExactBytes = true } = {}) {
    const readable = formatBytes(bytes);
    if (!includeExactBytes || readable === `${bytes} B`) {
        return readable;
    }
    return `${readable} (${bytes} B)`;
}

function decodeHtmlAttribute(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function normalizeAssetPath(relativePath) {
    const normalized = `${relativePath ?? ''}`.trim().replace(/\\/g, '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function extractAttribute(text, attributeName) {
    const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedName}=(?:"([^"]*)"|'([^']*)')`);
    const match = text.match(pattern);
    if (!match) {
        return '';
    }
    return match[1] ?? match[2] ?? '';
}

function extractTagAttribute(tagText, attributeName) {
    const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, 'i');
    const match = tagText.match(pattern);
    if (!match) {
        return '';
    }
    return decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? '');
}

function extractStartTags(text, tagName) {
    const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...text.matchAll(new RegExp(`<${escapedTagName}\\b[^>]*>`, 'gi'))].map((match) => match[0]);
}

const breadcrumbPrefetchAnchorClasses = new Set([
    'breadcrumb-link',
    'breadcrumb-root-link',
    'breadcrumb-menu-option'
]);

function hasBreadcrumbPrefetchAnchorClass(className) {
    return className
        .split(/\s+/)
        .some((classPart) => breadcrumbPrefetchAnchorClasses.has(classPart));
}

function inspectBreadcrumbPrefetchContract(text) {
    const issues = [];
    let breadcrumbAnchorCount = 0;
    let breadcrumbCrumbAnchorCount = 0;

    for (const tag of extractStartTags(text, 'a')) {
        const className = extractTagAttribute(tag, 'class');
        if (!hasBreadcrumbPrefetchAnchorClass(className)) {
            continue;
        }

        breadcrumbAnchorCount += 1;
        const slot = extractTagAttribute(tag, 'data-prefetch-slot');
        if (slot === 'crumb') {
            breadcrumbCrumbAnchorCount += 1;
            continue;
        }

        issues.push({
            className,
            href: extractTagAttribute(tag, 'href'),
            slot: slot || '<missing>'
        });
    }

    return {
        breadcrumbAnchorCount,
        breadcrumbCrumbAnchorCount,
        breadcrumbPrefetchIssues: issues
    };
}

function extractExternalScriptSrcs(text) {
    const matches = text.matchAll(/<script\b[^>]*\bsrc=(?:"([^"]*)"|'([^']*)'|([^"' >]+))/gi);
    const refs = [];
    for (const match of matches) {
        const raw = match[1] ?? match[2] ?? match[3] ?? '';
        if (raw) {
            refs.push(raw.trim());
        }
    }
    return refs;
}

function extractInlineScriptTextById(text, scriptId) {
    const escapedId = scriptId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(
        new RegExp(`<script\\b[^>]*\\bid=(?:"${escapedId}"|'${escapedId}'|${escapedId})[^>]*>([\\s\\S]*?)<\\/script>`, 'i')
    );
    if (!match) {
        return '';
    }
    return match[1] ?? '';
}

function hasCanonical(text) {
    return /<link\b[^>]*\brel=(?:"canonical"|'canonical'|canonical(?:\s|>|\/))/i.test(text);
}

function hasMainBundle(text) {
    return /\/js\/main(?:\.min)?\.[^"' >]+/i.test(text);
}

function hasPrefetchRuntimeBundle(text) {
    return /\/js\/prefetch\.runtime[^"' >]*\.js/i.test(text);
}

function isRedirectPage(text) {
    return /<meta\b[^>]*\bhttp-equiv=(?:"refresh"|'refresh'|refresh(?:\s|>|\/))/i.test(text);
}

function summarizeRows(rows, limit, selector) {
    return [...rows]
        .sort((left, right) => selector(right) - selector(left) || left.relativePath.localeCompare(right.relativePath))
        .slice(0, limit);
}

function printRankedRows(title, rows, valueSelector) {
    console.log(`\n${title}`);
    for (const row of rows) {
        console.log(
            `${row.relativePath}\traw=${formatByteMetric(row.rawBytes)}\tgzip=${formatByteMetric(row.gzipBytes)}\tbreadcrumb=${formatByteMetric(row.breadcrumbPayloadBytes)}\tsources=${row.breadcrumbSourceCount}\tkey=${formatByteMetric(valueSelector(row))}`
        );
    }
}

function printPrefetchRows(title, rows, valueSelector, { formatKey = (value) => formatByteMetric(value) } = {}) {
    console.log(`\n${title}`);
    for (const row of rows) {
        console.log(
            `${row.relativePath}\tprefetch=${formatByteMetric(row.prefetchPayloadBytes)}\tenvs=${row.prefetchEnvCount}\tcanonical_envs=${row.prefetchCanonicalEnvCount}\turls=${row.prefetchUniqueUrlCount}\tspec=${row.prefetchSpecUrlCount}\tlink=${row.prefetchLinkUrlCount}\tsw=${row.prefetchSwUrlCount}\tkey=${formatKey(valueSelector(row))}`
        );
    }
}

function printPageCostRows(title, rows, valueSelector) {
    console.log(`\n${title}`);
    for (const row of rows) {
        console.log(
            `${row.relativePath}\tgzip=${formatByteMetric(row.gzipBytes)}\tjs_gzip=${formatByteMetric(row.jsDependencyGzipBytes)}\tcold=${formatByteMetric(row.coldGzipBytes)}\tscripts=${row.scriptDependencyCount}\tkey=${formatByteMetric(valueSelector(row))}`
        );
    }
}

function printJsAssetRows(title, rows, valueSelector) {
    console.log(`\n${title}`);
    for (const row of rows) {
        console.log(
            `${row.relativePath}\traw=${formatByteMetric(row.rawBytes)}\tgzip=${formatByteMetric(row.gzipBytes)}\tpages=${row.pageReferenceCount}\tkey=${formatByteMetric(valueSelector(row))}`
        );
    }
}

function printJsReferenceRows(title, rows) {
    console.log(`\n${title}`);
    for (const row of rows) {
        console.log(
            `${row.relativePath}\traw=${formatByteMetric(row.rawBytes)}\tgzip=${formatByteMetric(row.gzipBytes)}\tpages=${row.pageReferenceCount}\tkey=${row.pageReferenceCount}`
        );
    }
}

function printVariantRows(title, rows) {
    console.log(`\n${title}`);
    for (const row of rows) {
        console.log(
            `${row.familyKey}\tvariants=${row.variantCount}\traw=${formatByteMetric(row.rawBytes)}\tgzip=${formatByteMetric(row.gzipBytes)}`
        );
        console.log(`  files=${row.files.join(', ')}`);
    }
}

function printSentinelRows(rows) {
    console.log('\nSentinel pages');
    for (const row of rows) {
        if (!row) {
            continue;
        }
        console.log(
            `${row.relativePath}\traw=${formatByteMetric(row.rawBytes)}\tgzip=${formatByteMetric(row.gzipBytes)}\tjs_gzip=${formatByteMetric(row.jsDependencyGzipBytes)}\tcold_gzip=${formatByteMetric(row.coldGzipBytes)}\tbreadcrumb=${formatByteMetric(row.breadcrumbPayloadBytes)}\tsources=${row.breadcrumbSourceCount}\tprefetch=${formatByteMetric(row.prefetchPayloadBytes)}\tprefetch_urls=${row.prefetchUniqueUrlCount}\tscripts=${row.scriptDependencyCount}`
        );
        if (row.breadcrumbSourcePaths.length > 0) {
            console.log(`  source_paths=${row.breadcrumbSourcePaths.join(', ')}`);
        }
        if (row.prefetchUniqueUrls.length > 0) {
            console.log(`  prefetch_targets=${row.prefetchUniqueUrls.join(', ')}`);
        }
        if (row.scriptDependencyPaths.length > 0) {
            console.log(`  script_deps=${row.scriptDependencyPaths.join(', ')}`);
        }
    }
}

function normalizeJsAssetFamilyKey(relativePath) {
    let normalized = `${relativePath ?? ''}`.replace(/\\/g, '/');
    normalized = normalized.replace(/\.([0-9a-f]{16,})(?=\.[^.]+$)/i, '');
    normalized = normalized.replace(/\.min\.min(?=\.[^.]+$)/i, '.min');
    return normalized;
}

function toAssetContentHash(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function normalizeScriptReference(ref, pageRelativePath) {
    const trimmed = `${ref ?? ''}`.trim();
    if (!trimmed) {
        return '';
    }

    try {
        const pageBase = `https://audit.local/${pageRelativePath}`;
        const url = new URL(trimmed, pageBase);
        if (url.origin !== 'https://audit.local') {
            return '';
        }
        return normalizeAssetPath(url.pathname);
    } catch (error) {
        return '';
    }
}

function shouldIgnoreScriptReference(ref) {
    return ref === '/livereload.js';
}

function parsePrefetchPayload(scriptText) {
    const empty = {
        prefetchPayloadBytes: 0,
        prefetchEnvCount: 0,
        prefetchCanonicalEnvCount: 0,
        prefetchUniqueUrlCount: 0,
        prefetchUniqueUrls: [],
        prefetchSpecUrlCount: 0,
        prefetchLinkUrlCount: 0,
        prefetchSwUrlCount: 0,
        prefetchGlobalGateUrlCount: 0,
        prefetchParseError: '',
    };

    if (scriptText === '') {
        return empty;
    }

    const trimmed = scriptText.trim();
    const stats = {
        ...empty,
        prefetchPayloadBytes: Buffer.byteLength(trimmed),
    };

    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch (error) {
        stats.prefetchParseError = error instanceof Error ? error.message : String(error);
        return stats;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        stats.prefetchParseError = 'site-prefetch-data is not a JSON object';
        return stats;
    }

    stats.prefetchEnvCount = Object.keys(parsed).length;

    const uniqueUrls = new Set();
    const canonicalEntries = Object.values(parsed).filter((value) => value && typeof value === 'object' && !Array.isArray(value));
    stats.prefetchCanonicalEnvCount = canonicalEntries.length;

    for (const entry of canonicalEntries) {
        for (const [actionCode, actionValue] of Object.entries(entry)) {
            if (actionCode === 'sp' || actionCode === 'sg') {
                if (!actionValue || typeof actionValue !== 'object' || Array.isArray(actionValue)) {
                    continue;
                }
                for (const ruleKind of ['prefetch', 'prerender']) {
                    const rules = Array.isArray(actionValue[ruleKind]) ? actionValue[ruleKind] : [];
                    for (const rule of rules) {
                        const urls = Array.isArray(rule?.urls) ? rule.urls.filter((url) => typeof url === 'string' && url) : [];
                        stats.prefetchSpecUrlCount += urls.length;
                        if (actionCode === 'sg') {
                            stats.prefetchGlobalGateUrlCount += urls.length;
                        }
                        for (const url of urls) {
                            uniqueUrls.add(url);
                        }
                    }
                }
                continue;
            }

            if (!Array.isArray(actionValue)) {
                continue;
            }

            const urls = actionValue.filter((url) => typeof url === 'string' && url);
            if (actionCode.startsWith('l')) {
                stats.prefetchLinkUrlCount += urls.length;
            }
            if (actionCode.startsWith('w')) {
                stats.prefetchSwUrlCount += urls.length;
            }
            if (actionCode.endsWith('g')) {
                stats.prefetchGlobalGateUrlCount += urls.length;
            }
            for (const url of urls) {
                uniqueUrls.add(url);
            }
        }
    }

    stats.prefetchUniqueUrls = [...uniqueUrls];
    stats.prefetchUniqueUrlCount = stats.prefetchUniqueUrls.length;
    return stats;
}

async function inspectJsAsset(rootDir, absolutePath) {
    const buffer = await fs.readFile(absolutePath);
    const relativePath = normalizeAssetPath(
        path.relative(rootDir, absolutePath).split(path.sep).join('/')
    );

    return {
        absolutePath,
        relativePath,
        rawBytes: buffer.length,
        gzipBytes: gzipSync(buffer, { level: 9 }).length,
        familyKey: normalizeJsAssetFamilyKey(relativePath),
        contentHash: toAssetContentHash(buffer),
        pageReferenceCount: 0,
    };
}

async function inspectHtmlFile(rootDir, absolutePath) {
    const buffer = await fs.readFile(absolutePath);
    const text = buffer.toString('utf8');
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    const encodedBreadcrumbSources = extractAttribute(text, 'data-entry-breadcrumb-sources');
    const inlineStyleAttrCount = (text.match(/\sstyle\s*=/gi) ?? []).length;

    let breadcrumbPayloadBytes = 0;
    let breadcrumbSourceCount = 0;
    let breadcrumbSourcePaths = [];
    let breadcrumbParseError = '';
    const prefetchPayloadScript = extractInlineScriptTextById(text, 'site-prefetch-data');
    const prefetchStats = parsePrefetchPayload(prefetchPayloadScript);
    const breadcrumbPrefetchContract = inspectBreadcrumbPrefetchContract(text);

    if (encodedBreadcrumbSources !== '') {
        const decodedBreadcrumbSources = decodeHtmlAttribute(encodedBreadcrumbSources);
        breadcrumbPayloadBytes = Buffer.byteLength(decodedBreadcrumbSources);
        try {
            const parsed = JSON.parse(decodedBreadcrumbSources);
            if (!Array.isArray(parsed)) {
                breadcrumbParseError = 'data-entry-breadcrumb-sources is not a JSON array';
            } else {
                breadcrumbSourceCount = parsed.length;
                breadcrumbSourcePaths = parsed
                    .map((entry) => {
                        if (!entry || typeof entry !== 'object') {
                            return '';
                        }
                        const logicalPath = entry.logical_path;
                        return typeof logicalPath === 'string' ? logicalPath : '';
                    })
                    .filter(Boolean);
            }
        } catch (error) {
            breadcrumbParseError = error instanceof Error ? error.message : String(error);
        }
    }

    return {
        absolutePath,
        relativePath,
        rawBytes: buffer.length,
        gzipBytes: gzipSync(buffer, { level: 9 }).length,
        isRedirect: isRedirectPage(text),
        hasCanonical: hasCanonical(text),
        hasMainBundle: hasMainBundle(text),
        hasPrefetchRuntimeBundle: hasPrefetchRuntimeBundle(text),
        inlineStyleAttrCount,
        breadcrumbPayloadBytes,
        breadcrumbSourceCount,
        breadcrumbSourcePaths,
        breadcrumbParseError,
        ...breadcrumbPrefetchContract,
        ...prefetchStats,
        externalScriptRefs: extractExternalScriptSrcs(text),
    };
}

async function readUtf8IfExists(absolutePath) {
    try {
        return await fs.readFile(absolutePath, 'utf8');
    } catch {
        return '';
    }
}

async function collectAssetManifestPaths(rootDir) {
    const runtimeDir = path.join(rootDir, 'runtime');
    try {
        const entries = await fs.readdir(runtimeDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && /^asset-manifest\..+\.json$/i.test(entry.name))
            .map((entry) => path.join(runtimeDir, entry.name));
    } catch {
        return [];
    }
}

async function collectFragmentVersionDirs(rootDir) {
    const fragmentsDir = path.join(rootDir, '__fragments');
    try {
        const entries = await fs.readdir(fragmentsDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        return [];
    }
}

async function inspectBuildVersionContract(rootDir, rows) {
    const issues = [];
    let buildVersion = '';
    const manifestPaths = await collectAssetManifestPaths(rootDir);
    const fragmentVersionDirs = await collectFragmentVersionDirs(rootDir);

    if (manifestPaths.length !== 1) {
        issues.push(`Expected exactly one runtime asset manifest, found ${manifestPaths.length}.`);
    }

    if (manifestPaths.length > 0) {
        try {
            const manifestText = await fs.readFile(manifestPaths[0], 'utf8');
            const manifest = JSON.parse(manifestText);
            buildVersion = typeof manifest?.buildVersion === 'string' ? manifest.buildVersion : '';
            if (!buildVersion) {
                issues.push('runtime asset manifest is missing buildVersion.');
            }
        } catch (error) {
            issues.push(`Unable to parse runtime asset manifest: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const inlineFragmentRoots = [];
    const staticVersionDataAttrs = [];
    for (const row of rows) {
        const text = await fs.readFile(row.absolutePath, 'utf8');
        const bodyTag = text.match(/<body\b[^>]*>/i)?.[0] ?? '';
        const fragmentRoot = extractTagAttribute(bodyTag, 'data-fragment-root');

        if (fragmentRoot) {
            inlineFragmentRoots.push(`${row.relativePath}: ${fragmentRoot}`);
        }

        if (/\bdata-site-build-version\b/i.test(text)) {
            staticVersionDataAttrs.push(row.relativePath);
        }
    }

    if (inlineFragmentRoots.length > 0) {
        issues.push(`HTML must not inline versioned data-fragment-root; derive it from runtime asset manifest:\n  ${inlineFragmentRoots.slice(0, 10).join('\n  ')}`);
    }
    if (staticVersionDataAttrs.length > 0) {
        issues.push(`Version menu should not duplicate buildVersion in data-site-build-version:\n  ${staticVersionDataAttrs.slice(0, 10).join('\n  ')}`);
    }

    if (buildVersion) {
        const unexpectedFragmentDirs = fragmentVersionDirs.filter((entry) => entry !== buildVersion);
        if (fragmentVersionDirs.length !== 1 || unexpectedFragmentDirs.length > 0) {
            issues.push(
                `__fragments must contain exactly the manifest buildVersion directory ${buildVersion}; found ${fragmentVersionDirs.join(', ') || '<none>'}.`
            );
        }
    }

    const swText = await readUtf8IfExists(path.join(rootDir, 'sw.js'));
    if (buildVersion && swText) {
        const swVersions = [...new Set([...swText.matchAll(/\bv\d{14}\b/g)].map((match) => match[0]))].sort();
        const unexpectedSwVersions = swVersions.filter((entry) => entry !== buildVersion);
        if (!swText.includes('nav-html-') || !swText.includes('asset-versioned-') || !swVersions.includes(buildVersion)) {
            issues.push(`sw.js does not appear to use manifest buildVersion ${buildVersion}.`);
        }
        if (unexpectedSwVersions.length > 0) {
            issues.push(`sw.js contains buildVersion values outside manifest buildVersion ${buildVersion}: ${unexpectedSwVersions.join(', ')}.`);
        }
    }

    return {
        buildVersion,
        manifestCount: manifestPaths.length,
        fragmentVersionDirs,
        issues,
    };
}

function buildJsDependencyStats(pageRelativePath, externalScriptRefs, jsAssetsByPath) {
    const scriptDependencyPaths = [];
    const missingScriptRefs = [];
    const seen = new Set();

    for (const ref of externalScriptRefs) {
        const normalizedRef = normalizeScriptReference(ref, pageRelativePath);
        if (!normalizedRef || shouldIgnoreScriptReference(normalizedRef) || seen.has(normalizedRef)) {
            continue;
        }
        seen.add(normalizedRef);
        if (!jsAssetsByPath.has(normalizedRef)) {
            missingScriptRefs.push(normalizedRef);
            continue;
        }
        scriptDependencyPaths.push(normalizedRef);
    }

    return {
        scriptDependencyPaths,
        missingScriptRefs,
    };
}

function buildIntegrityIssues(rows) {
    const issues = [];

    for (const row of rows) {
        if (!row.hasCanonical) {
            issues.push(`Missing canonical link: ${row.relativePath}`);
        }
        if (!row.isRedirect && !row.hasMainBundle) {
            issues.push(`Missing main JS bundle on non-redirect page: ${row.relativePath}`);
        }
        if (row.breadcrumbParseError) {
            issues.push(`Invalid breadcrumb payload on ${row.relativePath}: ${row.breadcrumbParseError}`);
        }
        if (row.inlineStyleAttrCount > 0) {
            issues.push(`Inline style attributes violate production style-src on ${row.relativePath}: ${row.inlineStyleAttrCount}`);
        }
        for (const issue of row.breadcrumbPrefetchIssues || []) {
            issues.push(
                `Breadcrumb anchor must use data-prefetch-slot="crumb": ${row.relativePath} href=${issue.href || '<empty>'} slot=${issue.slot} class=${issue.className || '<none>'}`
            );
        }
        if (row.prefetchParseError) {
            issues.push(`Invalid prefetch payload on ${row.relativePath}: ${row.prefetchParseError}`);
        }
        if (row.prefetchPayloadBytes > 0 && !row.hasPrefetchRuntimeBundle) {
            issues.push(`Missing prefetch runtime bundle on page with prefetch payload: ${row.relativePath}`);
        }
        if (row.prefetchPayloadBytes === 0 && row.hasPrefetchRuntimeBundle) {
            issues.push(`Unexpected prefetch runtime bundle without payload: ${row.relativePath}`);
        }
        for (const missingScriptRef of row.missingScriptRefs || []) {
            issues.push(`Missing script asset ${missingScriptRef} referenced by ${row.relativePath}`);
        }
    }

    return issues;
}

function buildGuardrailIssues(rowsByPath) {
    const issues = [];

    for (const guardrail of productionGuardrails) {
        const row = rowsByPath.get(guardrail.relativePath);
        if (!row) {
            issues.push(`Missing sentinel page: ${guardrail.relativePath}`);
            continue;
        }
        if (row.rawBytes > guardrail.maxRawBytes) {
            issues.push(
                `${guardrail.label} raw HTML exceeded budget: ${formatByteMetric(row.rawBytes)} > ${formatByteMetric(guardrail.maxRawBytes)} (${guardrail.relativePath})`
            );
        }
        if (row.gzipBytes > guardrail.maxGzipBytes) {
            issues.push(
                `${guardrail.label} gzip HTML exceeded budget: ${formatByteMetric(row.gzipBytes)} > ${formatByteMetric(guardrail.maxGzipBytes)} (${guardrail.relativePath})`
            );
        }
        if (row.breadcrumbPayloadBytes > guardrail.maxBreadcrumbPayloadBytes) {
            issues.push(
                `${guardrail.label} breadcrumb payload exceeded budget: ${formatByteMetric(row.breadcrumbPayloadBytes)} > ${formatByteMetric(guardrail.maxBreadcrumbPayloadBytes)} (${guardrail.relativePath})`
            );
        }
        if (row.breadcrumbSourceCount > guardrail.maxBreadcrumbSourceCount) {
            issues.push(
                `${guardrail.label} breadcrumb source count exceeded budget: ${row.breadcrumbSourceCount} > ${guardrail.maxBreadcrumbSourceCount} (${guardrail.relativePath})`
            );
        }
    }

    return issues;
}

async function main() {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const publicRoot = path.resolve(siteRoot, options.publicDir);
    await fs.access(publicRoot);

    const htmlPaths = await collectHtmlFiles(publicRoot);
    if (htmlPaths.length === 0) {
        throw new Error(`No HTML files found under: ${publicRoot}`);
    }
    const jsPaths = await collectFilesByExtension(publicRoot, '.js');

    const rows = [];
    for (const htmlPath of htmlPaths) {
        rows.push(await inspectHtmlFile(publicRoot, htmlPath));
    }
    const jsAssets = [];
    for (const jsPath of jsPaths) {
        jsAssets.push(await inspectJsAsset(publicRoot, jsPath));
    }

    const jsAssetsByPath = new Map(jsAssets.map((asset) => [asset.relativePath, asset]));
    const jsAssetsByHash = new Map();
    for (const asset of jsAssets) {
        const existing = jsAssetsByHash.get(asset.contentHash) || [];
        existing.push(asset);
        jsAssetsByHash.set(asset.contentHash, existing);
    }

    const variantFamilies = new Map();
    for (const asset of jsAssets) {
        const row = variantFamilies.get(asset.familyKey) || {
            familyKey: asset.familyKey,
            variantCount: 0,
            rawBytes: 0,
            gzipBytes: 0,
            files: [],
        };
        row.variantCount += 1;
        row.rawBytes += asset.rawBytes;
        row.gzipBytes += asset.gzipBytes;
        row.files.push(asset.relativePath);
        variantFamilies.set(asset.familyKey, row);
    }

    for (const row of rows) {
        const jsDeps = buildJsDependencyStats(row.relativePath, row.externalScriptRefs, jsAssetsByPath);
        let jsDependencyRawBytes = 0;
        let jsDependencyGzipBytes = 0;

        for (const depPath of jsDeps.scriptDependencyPaths) {
            const asset = jsAssetsByPath.get(depPath);
            if (!asset) {
                continue;
            }
            jsDependencyRawBytes += asset.rawBytes;
            jsDependencyGzipBytes += asset.gzipBytes;
            asset.pageReferenceCount += 1;
        }

        row.scriptDependencyPaths = jsDeps.scriptDependencyPaths;
        row.missingScriptRefs = jsDeps.missingScriptRefs;
        row.scriptDependencyCount = jsDeps.scriptDependencyPaths.length;
        row.jsDependencyRawBytes = jsDependencyRawBytes;
        row.jsDependencyGzipBytes = jsDependencyGzipBytes;
        row.coldRawBytes = row.rawBytes + jsDependencyRawBytes;
        row.coldGzipBytes = row.gzipBytes + jsDependencyGzipBytes;
    }

    const rowsByPath = new Map(rows.map((row) => [row.relativePath, row]));
    const buildVersionContract = await inspectBuildVersionContract(publicRoot, rows);
    const rawTotal = rows.reduce((sum, row) => sum + row.rawBytes, 0);
    const gzipTotal = rows.reduce((sum, row) => sum + row.gzipBytes, 0);
    const breadcrumbTotal = rows.reduce((sum, row) => sum + row.breadcrumbPayloadBytes, 0);
    const breadcrumbAnchorTotal = rows.reduce((sum, row) => sum + row.breadcrumbAnchorCount, 0);
    const breadcrumbCrumbAnchorTotal = rows.reduce((sum, row) => sum + row.breadcrumbCrumbAnchorCount, 0);
    const breadcrumbPrefetchIssueTotal = rows.reduce((sum, row) => sum + row.breadcrumbPrefetchIssues.length, 0);
    const inlineStyleAttrTotal = rows.reduce((sum, row) => sum + row.inlineStyleAttrCount, 0);
    const prefetchTotal = rows.reduce((sum, row) => sum + row.prefetchPayloadBytes, 0);
    const prefetchPages = rows.filter((row) => row.prefetchPayloadBytes > 0);
    const prefetchEnvTotal = rows.reduce((sum, row) => sum + row.prefetchEnvCount, 0);
    const prefetchCanonicalEnvTotal = rows.reduce((sum, row) => sum + row.prefetchCanonicalEnvCount, 0);
    const prefetchPageLocalUrlTotal = rows.reduce((sum, row) => sum + row.prefetchUniqueUrlCount, 0);
    const prefetchGlobalUniqueUrls = new Set(rows.flatMap((row) => row.prefetchUniqueUrls));
    const redirectCount = rows.filter((row) => row.isRedirect).length;
    const jsRawTotal = jsAssets.reduce((sum, asset) => sum + asset.rawBytes, 0);
    const jsGzipTotal = jsAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
    const referencedJsAssets = jsAssets.filter((asset) => asset.pageReferenceCount > 0);
    const duplicateContentAssets = [...jsAssetsByHash.values()].filter((group) => group.length > 1);
    const multiVariantFamilies = [...variantFamilies.values()]
        .filter((group) => group.variantCount > 1)
        .sort((left, right) => right.rawBytes - left.rawBytes || left.familyKey.localeCompare(right.familyKey));

    console.log('Public HTML audit');
    console.log(`Root\t${publicRoot}`);
    console.log(`Mode\t${options.check ? 'report + check' : 'report only'}`);
    console.log(`HTML files\t${rows.length}`);
    console.log(`Build version\t${buildVersionContract.buildVersion || '<missing>'}`);
    console.log(`Asset manifests\t${buildVersionContract.manifestCount}`);
    console.log(`Fragment version dirs\t${buildVersionContract.fragmentVersionDirs.join(', ') || '<none>'}`);
    console.log(`Redirect pages\t${redirectCount}`);
    console.log(`Raw total\t${rawTotal}\t${formatBytes(rawTotal)}`);
    console.log(`Gzip total\t${gzipTotal}\t${formatBytes(gzipTotal)}`);
    console.log(`Breadcrumb payload total\t${breadcrumbTotal}\t${formatBytes(breadcrumbTotal)}`);
    console.log(`Breadcrumb prefetch anchors\t${breadcrumbAnchorTotal}`);
    console.log(`Breadcrumb crumb anchors\t${breadcrumbCrumbAnchorTotal}`);
    console.log(`Breadcrumb prefetch issues\t${breadcrumbPrefetchIssueTotal}`);
    console.log(`Inline style attributes\t${inlineStyleAttrTotal}`);
    console.log(`Prefetch payload total\t${prefetchTotal}\t${formatBytes(prefetchTotal)}`);
    console.log(`Prefetch pages\t${prefetchPages.length}`);
    console.log(`Prefetch env entries\t${prefetchEnvTotal}`);
    console.log(`Prefetch canonical env entries\t${prefetchCanonicalEnvTotal}`);
    console.log(`Prefetch page-local URLs\t${prefetchPageLocalUrlTotal}`);
    console.log(`Prefetch global unique URLs\t${prefetchGlobalUniqueUrls.size}`);
    console.log(`Raw average\t${Math.round(rawTotal / rows.length)}\t${formatBytes(rawTotal / rows.length)}`);
    console.log(`Gzip average\t${Math.round(gzipTotal / rows.length)}\t${formatBytes(gzipTotal / rows.length)}`);
    if (prefetchPages.length > 0) {
        const prefetchAverage = Math.round(prefetchTotal / prefetchPages.length);
        console.log(`Prefetch average\t${prefetchAverage}\t${formatBytes(prefetchAverage)}`);
    }
    console.log(`JS assets\t${jsAssets.length}`);
    console.log(`JS raw total\t${jsRawTotal}\t${formatBytes(jsRawTotal)}`);
    console.log(`JS gzip total\t${jsGzipTotal}\t${formatBytes(jsGzipTotal)}`);
    console.log(`Referenced JS assets\t${referencedJsAssets.length}`);
    console.log(`Duplicate JS content groups\t${duplicateContentAssets.length}`);

    printRankedRows(
        `\nLargest raw HTML pages (top ${options.top})`,
        summarizeRows(rows, options.top, (row) => row.rawBytes),
        (row) => row.rawBytes
    );
    printRankedRows(
        `Largest gzip HTML pages (top ${options.top})`,
        summarizeRows(rows, options.top, (row) => row.gzipBytes),
        (row) => row.gzipBytes
    );
    printRankedRows(
        `Largest breadcrumb payload pages (top ${options.top})`,
        summarizeRows(rows, options.top, (row) => row.breadcrumbPayloadBytes),
        (row) => row.breadcrumbPayloadBytes
    );
    printPrefetchRows(
        `Largest prefetch payload pages (top ${options.top})`,
        summarizeRows(rows, options.top, (row) => row.prefetchPayloadBytes),
        (row) => row.prefetchPayloadBytes
    );
    printPrefetchRows(
        `Most prefetch target URLs (top ${options.top})`,
        summarizeRows(rows, options.top, (row) => row.prefetchUniqueUrlCount),
        (row) => row.prefetchUniqueUrlCount,
        { formatKey: (value) => `${value}` }
    );
    printPageCostRows(
        `Largest cold page cost (HTML + JS gzip, top ${options.top})`,
        summarizeRows(rows, options.top, (row) => row.coldGzipBytes),
        (row) => row.coldGzipBytes
    );
    printJsAssetRows(
        `Largest JS assets (top ${options.top})`,
        summarizeRows(jsAssets, options.top, (row) => row.rawBytes),
        (row) => row.rawBytes
    );
    printJsReferenceRows(
        `Most referenced JS assets (top ${options.top})`,
        [...jsAssets]
            .sort((left, right) => right.pageReferenceCount - left.pageReferenceCount || left.relativePath.localeCompare(right.relativePath))
            .slice(0, options.top)
    );
    if (multiVariantFamilies.length > 0) {
        printVariantRows(
            `JS asset families with multiple emitted variants (top ${Math.min(options.top, multiVariantFamilies.length)})`,
            multiVariantFamilies.slice(0, options.top)
        );
    }

    printSentinelRows(
        productionGuardrails.map((guardrail) => rowsByPath.get(guardrail.relativePath))
    );

    const integrityIssues = [
        ...buildIntegrityIssues(rows),
        ...buildVersionContract.issues,
    ];
    const guardrailIssues = options.check ? buildGuardrailIssues(rowsByPath) : [];

    if (integrityIssues.length > 0) {
        console.log('\nIntegrity issues');
        for (const issue of integrityIssues) {
            console.log(`- ${issue}`);
        }
    }

    if (guardrailIssues.length > 0) {
        console.log('\nGuardrail issues');
        for (const issue of guardrailIssues) {
            console.log(`- ${issue}`);
        }
    }

    if (integrityIssues.length > 0 || guardrailIssues.length > 0) {
        process.exit(1);
    }

    console.log('\nPublic HTML audit passed.');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
