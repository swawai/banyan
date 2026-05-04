import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const repoRoot = process.cwd();
const defaultPublicDir = 'public';
const cspHeaderName = 'Content-Security-Policy-Report-Only';
const executableScriptTypes = new Set([
    '',
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
    'module',
]);

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
  node themes/banyan/scripts/patch-csp-report-only.mjs [publicDir]

Examples:
  npm run csp:report-only
  node themes/banyan/scripts/patch-csp-report-only.mjs temp_workspace/public/260504-csp-report-only

Notes:
  - This script scans final built HTML and hashes the executable inline scripts
    exactly as they appear after Hugo minification.
  - It patches both _headers and edgeone.json in the target public directory.
`);
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
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.html') {
            files.push(absolutePath);
        }
    }

    return files;
}

function extractAttribute(attributes, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = attributes.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, 'i'));
    if (!match) {
        return '';
    }
    return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

function isExecutableInlineScript(attributes) {
    if (/\bsrc\s*=/i.test(attributes)) {
        return false;
    }

    const typeValue = extractAttribute(attributes, 'type').toLowerCase();
    return executableScriptTypes.has(typeValue);
}

function extractExecutableInlineScripts(html) {
    const scripts = [];
    const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

    for (const match of html.matchAll(pattern)) {
        const attributes = match[1] ?? '';
        const body = match[2] ?? '';
        if (!isExecutableInlineScript(attributes) || body.trim() === '') {
            continue;
        }
        scripts.push(body);
    }

    return scripts;
}

function toCspHash(scriptBody) {
    return `sha256-${createHash('sha256').update(scriptBody).digest('base64')}`;
}

function buildReportOnlyValue(hashes) {
    const scriptHashes = [...hashes].sort().map((hash) => `'${hash}'`);
    const directives = [
        "default-src 'self'",
        `script-src 'self' 'report-sample'${scriptHashes.length > 0 ? ` ${scriptHashes.join(' ')}` : ''}`,
        "style-src 'self' 'report-sample'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "form-action 'self'",
    ];
    return directives.join('; ');
}

function patchHeadersFile(body, cspValue) {
    const normalized = body.replace(/\r\n/g, '\n').trimEnd();
    const blocks = normalized.split(/\n{2,}/);
    let foundDefaultRoute = false;

    const patchedBlocks = blocks.map((block) => {
        const lines = block.split('\n');
        if ((lines[0] ?? '').trim() !== '/*') {
            return block;
        }

        foundDefaultRoute = true;
        const headerLines = lines
            .slice(1)
            .filter((line) => !line.trimStart().toLowerCase().startsWith(`${cspHeaderName.toLowerCase()}:`));

        headerLines.push(`  ${cspHeaderName}: ${cspValue}`);
        return [lines[0], ...headerLines].join('\n');
    });

    if (!foundDefaultRoute) {
        throw new Error(`Missing default route "/*" in _headers.`);
    }

    return `${patchedBlocks.join('\n\n')}\n`;
}

function patchEdgeoneConfig(body, cspValue) {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed.headers)) {
        throw new Error('Invalid edgeone.json: missing headers array.');
    }

    const defaultRoute = parsed.headers.find((entry) => entry && entry.source === '/*');
    if (!defaultRoute) {
        throw new Error('Invalid edgeone.json: missing default route "/*".');
    }

    const headerEntries = Array.isArray(defaultRoute.headers) ? defaultRoute.headers : [];
    defaultRoute.headers = headerEntries.filter((entry) => {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        return `${entry.key ?? ''}`.toLowerCase() !== cspHeaderName.toLowerCase();
    });
    defaultRoute.headers.push({ key: cspHeaderName, value: cspValue });

    return `${JSON.stringify(parsed, null, 2)}\n`;
}

function sorted(values) {
    return [...values].sort();
}

function verifyHeadersFile(body, expectedHashes) {
    const headerMatch = body.match(new RegExp(`${cspHeaderName}: ([^\\n]+)`));
    if (!headerMatch) {
        throw new Error(`Patched _headers is missing ${cspHeaderName}.`);
    }

    const declaredHashes = sorted(
        [...headerMatch[1].matchAll(/'sha256-[^']+'/g)].map((match) => match[0].slice(1, -1))
    );
    const expected = sorted(expectedHashes);
    const isMatch = declaredHashes.length === expected.length
        && declaredHashes.every((value, index) => value === expected[index]);

    if (!isMatch) {
        throw new Error('Patched _headers CSP hashes do not match the computed inline script hashes.');
    }
}

function verifyEdgeoneConfig(body, expectedValue) {
    const parsed = JSON.parse(body);
    const defaultRoute = Array.isArray(parsed.headers)
        ? parsed.headers.find((entry) => entry && entry.source === '/*')
        : null;
    if (!defaultRoute || !Array.isArray(defaultRoute.headers)) {
        throw new Error('Patched edgeone.json is missing the default route headers.');
    }

    const cspHeader = defaultRoute.headers.find((entry) => {
        return entry && typeof entry === 'object'
            && `${entry.key ?? ''}`.toLowerCase() === cspHeaderName.toLowerCase();
    });

    if (!cspHeader || cspHeader.value !== expectedValue) {
        throw new Error('Patched edgeone.json CSP header does not match the computed report-only policy.');
    }
}

async function main() {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const publicRoot = path.resolve(repoRoot, options.publicDir);
    const headersPath = path.join(publicRoot, '_headers');
    const edgeonePath = path.join(publicRoot, 'edgeone.json');
    await Promise.all([fs.access(publicRoot), fs.access(headersPath), fs.access(edgeonePath)]);

    const htmlPaths = await collectHtmlFiles(publicRoot);
    if (htmlPaths.length === 0) {
        throw new Error(`No HTML files found under: ${publicRoot}`);
    }

    const hashes = new Set();
    let inlineScriptCount = 0;

    for (const htmlPath of htmlPaths) {
        const html = await fs.readFile(htmlPath, 'utf8');
        const scripts = extractExecutableInlineScripts(html);
        inlineScriptCount += scripts.length;
        for (const scriptBody of scripts) {
            hashes.add(toCspHash(scriptBody));
        }
    }

    const cspValue = buildReportOnlyValue(hashes);
    const [headersBody, edgeoneBody] = await Promise.all([
        fs.readFile(headersPath, 'utf8'),
        fs.readFile(edgeonePath, 'utf8'),
    ]);
    const patchedHeadersBody = patchHeadersFile(headersBody, cspValue);
    const patchedEdgeoneBody = patchEdgeoneConfig(edgeoneBody, cspValue);

    verifyHeadersFile(patchedHeadersBody, hashes);
    verifyEdgeoneConfig(patchedEdgeoneBody, cspValue);

    await Promise.all([
        fs.writeFile(headersPath, patchedHeadersBody, 'utf8'),
        fs.writeFile(edgeonePath, patchedEdgeoneBody, 'utf8'),
    ]);

    console.log(
        `Patched ${cspHeaderName} using ${hashes.size} unique executable inline script hashes from ${inlineScriptCount} inline script instances across ${htmlPaths.length} HTML files.`
    );
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
