import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.ico', 'image/x-icon'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['.xml', 'application/xml; charset=utf-8']
]);

function parseHeadersFile(rootDir) {
    const headersPath = path.join(rootDir, '_headers');
    if (!fs.existsSync(headersPath)) {
        return [];
    }

    const body = fs.readFileSync(headersPath, 'utf8').replace(/\r\n/g, '\n');
    const blocks = body.split(/\n{2,}/);
    const rules = [];

    for (const block of blocks) {
        const lines = block.split('\n').map((line) => line.trimEnd());
        const source = (lines[0] || '').trim();
        if (!source) {
            continue;
        }

        const headers = {};
        for (const line of lines.slice(1)) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            const separatorIndex = trimmed.indexOf(':');
            if (separatorIndex <= 0) {
                continue;
            }
            const key = trimmed.slice(0, separatorIndex).trim();
            const value = trimmed.slice(separatorIndex + 1).trim();
            if (key && value) {
                headers[key] = value;
            }
        }

        rules.push({ source, headers });
    }

    return rules;
}

function pathMatchesRule(pathname, source) {
    if (!source) {
        return false;
    }
    if (source === pathname) {
        return true;
    }
    if (source.includes('*')) {
        const pattern = source
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*');
        return new RegExp(`^${pattern}$`).test(pathname);
    }
    return false;
}

function resolveRouteHeaders(pathname, rules) {
    const resolved = {};
    for (const rule of rules) {
        if (!pathMatchesRule(pathname, rule.source)) {
            continue;
        }
        Object.assign(resolved, rule.headers);
    }
    return resolved;
}

function normalizeRequestPath(urlPathname) {
    let pathname = decodeURIComponent(urlPathname || '/');
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    return pathname;
}

function resolveRequestFile(rootDir, pathname) {
    const safePathname = normalizeRequestPath(pathname);
    const rawPath = safePathname.endsWith('/')
        ? `${safePathname}index.html`
        : safePathname;
    const absPath = path.normalize(path.join(rootDir, rawPath));
    if (!absPath.startsWith(path.normalize(rootDir))) return '';

    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        return absPath;
    }

    if (!path.extname(absPath)) {
        const nestedIndex = path.join(absPath, 'index.html');
        if (fs.existsSync(nestedIndex) && fs.statSync(nestedIndex).isFile()) {
            return nestedIndex;
        }
    }

    return '';
}

function getContentType(filePath) {
    return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function getCacheControl(filePath) {
    const fileName = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    if (fileName === 'sw.js') {
        return 'no-cache, max-age=0, must-revalidate';
    }
    if (ext === '.html' || ext === '.json' || ext === '.webmanifest' || ext === '.xml' || ext === '.txt') {
        return 'no-cache, max-age=0, must-revalidate';
    }
    return 'public, max-age=31536000, immutable';
}

export async function createStaticSiteServer(options = {}) {
    let rootDir = options.rootDir;
    if (!rootDir) {
        throw new Error('createStaticSiteServer requires rootDir.');
    }

    let server = null;
    let port = null;
    let routeHeaders = parseHeadersFile(rootDir);

    function setRoot(nextRootDir) {
        rootDir = nextRootDir;
        routeHeaders = parseHeadersFile(rootDir);
    }

    function getBaseUrl() {
        if (!port) {
            throw new Error('Static site server has not started yet.');
        }
        return `http://127.0.0.1:${port}`;
    }

    async function start() {
        if (server) return api;

        server = http.createServer((req, res) => {
            const url = new URL(req.url || '/', 'http://127.0.0.1');
            const filePath = resolveRequestFile(rootDir, url.pathname);
            if (!filePath) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
                return;
            }

            try {
                const body = fs.readFileSync(filePath);
                const routeHeaderValues = resolveRouteHeaders(url.pathname, routeHeaders);
                res.writeHead(200, {
                    'Cache-Control': getCacheControl(filePath),
                    'Content-Type': getContentType(filePath),
                    ...routeHeaderValues
                });
                res.end(body);
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Internal Server Error');
            }
        });

        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                port = address && typeof address === 'object' ? address.port : null;
                resolve();
            });
        });

        return api;
    }

    async function stop() {
        if (!server) return;
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        server = null;
        port = null;
    }

    const api = {
        getBaseUrl,
        setRoot,
        start,
        stop
    };

    return api;
}
