import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createHugoEnv } from '../build/hugo-env.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const tempPublicRoot = path.join(repoRoot, 'temp_workspace', 'public');
const hugoBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'hugo.cmd' : 'hugo'
);

function parseCli(argv) {
    const options = {
        note: 'browser-regression'
    };

    for (const arg of argv) {
        if (!arg) continue;
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`Unsupported option: ${arg}`);
        }
        if (options.note !== 'browser-regression') {
            throw new Error(`Only one optional note can be provided, got extra argument: ${arg}`);
        }
        options.note = sanitizeNote(arg);
    }

    return options;
}

function printHelp() {
    console.log(`Usage:
  node themes/banyan/scripts/dev/build-browser-temp.mjs [note]

Examples:
  npm run build:browser:temp
  node themes/banyan/scripts/dev/build-browser-temp.mjs prefetch-debug

Notes:
  - Builds a minified Hugo output into temp_workspace/public/<timestamp>-<note>
  - Then patches CSP headers and Speculation-Rules headers in that temp build
  - Intended to pair with npm run check:browser:latest-temp or check:browser:speculation:latest-temp
`);
}

function sanitizeNote(rawNote) {
    const normalized = String(rawNote || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || 'browser-regression';
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function timestampId(date = new Date()) {
    return [
        String(date.getFullYear()).slice(-2),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes())
    ].join('');
}

function buildDestination(note) {
    fs.mkdirSync(tempPublicRoot, { recursive: true });
    const baseName = `${timestampId()}-${note}`;
    let candidate = baseName;
    let sequence = 2;

    while (fs.existsSync(path.join(tempPublicRoot, candidate))) {
        candidate = `${baseName}-${sequence}`;
        sequence += 1;
    }

    return path.join(tempPublicRoot, candidate);
}

function runProcess(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        env: options.env ?? process.env,
        shell: options.shell ?? false,
        stdio: 'inherit'
    });

    if (typeof result.status === 'number' && result.status !== 0) {
        process.exit(result.status);
    }
    if (result.error) {
        throw result.error;
    }
}

function relFromRepo(absPath) {
    return path.relative(repoRoot, absPath).replace(/\\/g, '/');
}

const options = parseCli(process.argv.slice(2));
if (options.help) {
    printHelp();
    process.exit(0);
}

const destinationDir = buildDestination(options.note);
const destinationRel = relFromRepo(destinationDir);
runProcess(
    hugoBin,
    ['--gc', '--cleanDestinationDir', '--minify', '--destination', destinationRel],
    {
        env: createHugoEnv({ cwd: repoRoot }),
        shell: process.platform === 'win32'
    }
);
runProcess(process.execPath, ['themes/banyan/scripts/build/patch-csp.mjs', destinationRel]);
runProcess(process.execPath, ['themes/banyan/scripts/build/emit-speculation-rules-headers.mjs', destinationRel]);

console.log('');
console.log(`Temp browser-regression build ready: ${destinationRel}`);
console.log('Recommended next steps:');
console.log('  npm run check:browser:latest-temp');
console.log('  npm run check:browser:speculation:latest-temp');
