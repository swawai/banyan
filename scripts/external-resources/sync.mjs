import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { validateResource } from './validators.mjs';

const registryRelativePath = 'data/external-resources.yaml';
const timeoutMs = 20_000;

const siteRoot = path.resolve(process.cwd());
const registryPath = path.join(siteRoot, registryRelativePath);

function fail(message) {
    throw new Error(`[external-resources] ${message}`);
}

async function readRegistry() {
    let parsed;
    try {
        parsed = parseYaml(await fs.readFile(registryPath, 'utf8'));
    } catch (error) {
        fail(`Cannot read ${registryRelativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!Array.isArray(parsed?.resources)) {
        fail(`${registryRelativePath} must contain a resources list.`);
    }

    return parsed.resources;
}

function resolveTargetPath(target, id) {
    if (!target || typeof target !== 'string') {
        fail(`Resource ${id} is missing target.`);
    }
    if (path.isAbsolute(target)) {
        fail(`Resource ${id} target must be relative to the site root.`);
    }

    const targetPath = path.resolve(siteRoot, target);
    const relative = path.relative(siteRoot, targetPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        fail(`Resource ${id} target escapes the site root: ${target}`);
    }
    if (relative.split(path.sep).includes('public')) {
        fail(`Resource ${id} target must not be written under public/: ${target}`);
    }

    return targetPath;
}

async function fetchBytes(source, id) {
    if (!source || typeof source !== 'string') {
        fail(`Resource ${id} is missing source.`);
    }
    if (typeof fetch !== 'function') {
        fail('Node.js global fetch is unavailable. Use Node.js 18 or newer.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(source, {
            signal: controller.signal,
            headers: {
                accept: '*/*',
                'user-agent': 'banyan-external-resource-sync'
            }
        });

        if (!response.ok) {
            fail(`Resource ${id} fetch failed with HTTP ${response.status} ${response.statusText}: ${source}`);
        }

        return Buffer.from(await response.arrayBuffer());
    } catch (error) {
        if (error?.name === 'AbortError') {
            fail(`Resource ${id} fetch timed out after ${timeoutMs}ms: ${source}`);
        }
        fail(`Resource ${id} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        clearTimeout(timeout);
    }
}

async function readExistingFile(filePath) {
    try {
        return await fs.readFile(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return Buffer.alloc(0);
        }
        throw error;
    }
}

function selectResources(resources, requestedIds) {
    if (requestedIds.length === 0) {
        return resources;
    }

    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    const missing = requestedIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
        fail(`Unknown resource id(s): ${missing.join(', ')}`);
    }

    return requestedIds.map((id) => byId.get(id));
}

async function syncResource(entry) {
    if (!entry.id || typeof entry.id !== 'string') {
        fail('Every resource must declare a string id.');
    }

    const targetPath = resolveTargetPath(entry.target, entry.id);
    const bytes = await fetchBytes(entry.source, entry.id);
    const validationSummary = validateResource(bytes, entry);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const existing = await readExistingFile(targetPath);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (Buffer.compare(existing, bytes) === 0) {
        console.log(`[external-resources] ${entry.id}: already up to date (${entry.target})`);
    } else {
        await fs.writeFile(targetPath, bytes);
        console.log(`[external-resources] ${entry.id}: synced ${entry.target}`);
    }

    console.log(`[external-resources] ${entry.id}: ${validationSummary}, sha256=${hash}`);
}

async function main() {
    const resources = await readRegistry();
    const requestedIds = process.argv.slice(2).filter(Boolean);
    const selected = selectResources(resources, requestedIds);

    for (const resource of selected) {
        await syncResource(resource);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
