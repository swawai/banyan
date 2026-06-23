import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const siteRoot = process.cwd();
const defaultPublicDir = 'public';
const speculationHeaderName = 'Speculation-Rules';
const defaultHeaderRoute = '/*';
const speculationRulesAssetRoute = '/speculation-rules/*';
const manifestDirName = '__speculation-rules-manifests';
const rulesDirName = 'speculation-rules';

function parseCli(argv) {
    const options = {
        publicDir: defaultPublicDir,
    };

    for (const arg of argv) {
        if (!arg) {
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
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

function printHelp() {
    console.log(`Usage:
  bun themes/banyan/scripts/build/emit-speculation-rules-headers.mjs [publicDir]

Examples:
  bun themes/banyan/scripts/build/emit-speculation-rules-headers.mjs
  bun themes/banyan/scripts/build/emit-speculation-rules-headers.mjs temp_workspace/public/260504-speculation-rules

Notes:
  - This script consumes speculation document-rule manifest files generated
    during Hugo render, emits a shared external rules JSON file, and patches
    both _headers and edgeone.json in the target public directory.
  - It does not read runtime HTML payloads such as site-prefetch-data.
  - The temporary __speculation-rules-manifests directory is removed after the
    response headers and shared rules files have been generated.
`);
}

async function collectFiles(rootDir, currentDir = rootDir, extension = '.json') {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(rootDir, absolutePath, extension));
            continue;
        }
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) {
            files.push(absolutePath);
        }
    }

    return files;
}

function toContentHash(content) {
    return createHash('sha256').update(content).digest('hex');
}

function splitHeadersPreamble(body) {
    const normalized = body.replace(/\r\n/g, '\n').trimEnd();
    const lines = normalized.split('\n');
    let index = 0;

    while (index < lines.length) {
        const trimmed = lines[index].trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
            index += 1;
            continue;
        }
        break;
    }

    return {
        body: lines.slice(index).join('\n'),
        preamble: lines.slice(0, index).join('\n').trimEnd(),
    };
}

function parseHeadersBlocks(body) {
    const { body: headerBody } = splitHeadersPreamble(body);
    const blocks = headerBody.split(/\n{2,}/);
    return blocks.map((block) => {
        const lines = block.split('\n');
        const source = (lines[0] ?? '').trim();
        if (!source || source.startsWith('#')) {
            return null;
        }
        const headers = [];
        for (const line of lines.slice(1)) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            const separatorIndex = trimmed.indexOf(':');
            if (separatorIndex <= 0) {
                continue;
            }
            headers.push({
                key: trimmed.slice(0, separatorIndex).trim(),
                value: trimmed.slice(separatorIndex + 1).trim(),
            });
        }
        return { source, headers };
    }).filter((block) => block && block.source);
}

function renderHeadersBlocks(blocks, preamble = '') {
    const body = `${blocks.map((block) => {
        const lines = [block.source];
        for (const header of block.headers) {
            lines.push(`  ${header.key}: ${header.value}`);
        }
        return lines.join('\n');
    }).join('\n\n')}\n`;

    if (!preamble) {
        return body;
    }
    return `${preamble}\n\n${body}`;
}

function upsertHeader(headers, key, value) {
    const normalizedKey = key.toLowerCase();
    const filtered = headers.filter((header) => header.key.toLowerCase() !== normalizedKey);
    filtered.push({ key, value });
    return filtered;
}

function patchHeadersFile(body, rulesHeaderValue, hasRulesAssetRoute) {
    const { preamble } = splitHeadersPreamble(body);
    const blocks = parseHeadersBlocks(body);
    const filteredBlocks = blocks
        .map((block) => ({
            source: block.source,
            headers: block.headers.filter((header) => header.key.toLowerCase() !== speculationHeaderName.toLowerCase()),
        }))
        .filter((block) => block.source !== speculationRulesAssetRoute);

    const nextBlocks = filteredBlocks;
    if (hasRulesAssetRoute) {
        nextBlocks.push({
            source: speculationRulesAssetRoute,
            headers: [
                { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                { key: 'Content-Type', value: 'application/speculationrules+json' },
            ],
        });
    }

    if (rulesHeaderValue) {
        const existing = nextBlocks.find((block) => block.source === defaultHeaderRoute);
        if (existing) {
            existing.headers = upsertHeader(existing.headers, speculationHeaderName, rulesHeaderValue);
        } else {
            nextBlocks.unshift({
                source: defaultHeaderRoute,
                headers: [{ key: speculationHeaderName, value: rulesHeaderValue }],
            });
        }
    }

    return renderHeadersBlocks(nextBlocks, preamble);
}

function patchEdgeoneConfig(body, rulesHeaderValue, hasRulesAssetRoute) {
    const parsed = JSON.parse(body);
    const headerEntries = Array.isArray(parsed.headers) ? parsed.headers : [];
    const filteredEntries = headerEntries
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const source = `${entry.source ?? ''}`;
            const headers = Array.isArray(entry.headers)
                ? entry.headers.filter((header) => (
                    header && typeof header === 'object'
                    && `${header.key ?? ''}`.toLowerCase() !== speculationHeaderName.toLowerCase()
                ))
                : [];
            return { source, headers };
        })
        .filter((entry) => entry && entry.source && entry.source !== speculationRulesAssetRoute);

    if (hasRulesAssetRoute) {
        filteredEntries.push({
            source: speculationRulesAssetRoute,
            headers: [
                { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                { key: 'Content-Type', value: 'application/speculationrules+json' },
            ],
        });
    }

    if (rulesHeaderValue) {
        const existing = filteredEntries.find((entry) => entry.source === defaultHeaderRoute);
        if (existing) {
            const filteredHeaders = existing.headers.filter((header) => (
                `${header.key ?? ''}`.toLowerCase() !== speculationHeaderName.toLowerCase()
            ));
            filteredHeaders.push({ key: speculationHeaderName, value: rulesHeaderValue });
            existing.headers = filteredHeaders;
        } else {
            filteredEntries.unshift({
                source: defaultHeaderRoute,
                headers: [{ key: speculationHeaderName, value: rulesHeaderValue }],
            });
        }
    }

    parsed.headers = filteredEntries;
    return `${JSON.stringify(parsed, null, 2)}\n`;
}

async function ensureRulesFile(publicRoot, content, contentToPath) {
    const contentHash = toContentHash(content).slice(0, 16);
    const relativePath = contentToPath.get(contentHash) || `${rulesDirName}/document.${contentHash}.json`;
    const absolutePath = path.join(publicRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${content}\n`, 'utf8');
    contentToPath.set(contentHash, relativePath);
    return `/${relativePath.split(path.sep).join('/')}`;
}

async function readSpeculationManifestEntries(publicRoot) {
    const manifestRoot = path.join(publicRoot, manifestDirName);
    try {
        await fs.access(manifestRoot);
    } catch (error) {
        return [];
    }

    const manifestPaths = await collectFiles(manifestRoot, manifestRoot, '.json');
    const manifestEntries = [];

    for (const manifestPath of manifestPaths) {
        const body = await fs.readFile(manifestPath, 'utf8');
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch (error) {
            throw new Error(`Invalid speculation manifest JSON: ${manifestPath}`);
        }
        const route = typeof parsed?.route === 'string' ? parsed.route.trim() : '';
        const rules = parsed?.rules && typeof parsed.rules === 'object' && !Array.isArray(parsed.rules)
            ? parsed.rules
            : null;
        const overlapWarnings = Array.isArray(parsed?.overlap_warnings)
            ? parsed.overlap_warnings.filter((item) => typeof item === 'string' && item.trim())
            : [];
        if (!route || !rules || Object.keys(rules).length === 0) {
            continue;
        }
        manifestEntries.push({ overlapWarnings, route, rules });
    }

    return manifestEntries;
}

async function main() {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const publicRoot = path.resolve(siteRoot, options.publicDir);
    const headersPath = path.join(publicRoot, '_headers');
    const edgeonePath = path.join(publicRoot, 'edgeone.json');
    const manifestRoot = path.join(publicRoot, manifestDirName);
    const rulesRoot = path.join(publicRoot, rulesDirName);
    await Promise.all([fs.access(publicRoot), fs.access(headersPath), fs.access(edgeonePath)]);

    const manifestEntries = await readSpeculationManifestEntries(publicRoot);
    const rulesBodiesByHash = new Map();
    const contentToPath = new Map();
    await fs.rm(rulesRoot, { recursive: true, force: true });

    for (const manifestEntry of manifestEntries) {
        const content = JSON.stringify(manifestEntry.rules, null, 2);
        rulesBodiesByHash.set(toContentHash(content), content);
        if (manifestEntry.overlapWarnings.length > 0) {
            const envKeys = [];
            const uniqueSlots = new Set();
            for (const summary of manifestEntry.overlapWarnings) {
                const separatorIndex = summary.indexOf('=');
                if (separatorIndex > 0) {
                    envKeys.push(summary.slice(0, separatorIndex));
                }
                const urlsMatch = summary.match(/\[(.*)\]/);
                if (!urlsMatch || !urlsMatch[1]) {
                    continue;
                }
                for (const slot of urlsMatch[1].split(',').map((item) => item.trim()).filter(Boolean)) {
                    uniqueSlots.add(slot);
                }
            }
            console.warn(
                `Speculation overlap warning for ${manifestEntry.route}: ${uniqueSlots.size} overlapping slot(s) across runtime env(s) ${envKeys.join(', ')}.`
            );
        }
    }

    if (rulesBodiesByHash.size > 1) {
        throw new Error(
            `Expected one global speculation document-rules payload, got ${rulesBodiesByHash.size}.`
        );
    }

    let rulesHeaderValue = '';
    if (rulesBodiesByHash.size === 1) {
        const content = Array.from(rulesBodiesByHash.values())[0];
        const rulesPath = await ensureRulesFile(publicRoot, content, contentToPath);
        rulesHeaderValue = `"${rulesPath}"`;
    }

    const [headersBody, edgeoneBody] = await Promise.all([
        fs.readFile(headersPath, 'utf8'),
        fs.readFile(edgeonePath, 'utf8'),
    ]);

    const patchedHeadersBody = patchHeadersFile(headersBody, rulesHeaderValue, contentToPath.size > 0);
    const patchedEdgeoneBody = patchEdgeoneConfig(edgeoneBody, rulesHeaderValue, contentToPath.size > 0);

    await Promise.all([
        fs.writeFile(headersPath, patchedHeadersBody, 'utf8'),
        fs.writeFile(edgeonePath, patchedEdgeoneBody, 'utf8'),
        fs.rm(manifestRoot, { recursive: true, force: true }),
    ]);

    console.log(
        `Emitted ${contentToPath.size} global speculation document rules file(s) and patched the default route.`
    );
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
