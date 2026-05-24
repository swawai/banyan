import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { createHugoEnv } from '../../build/hugo-env.mjs';

// EdgeOne adapter: runs Hugo behind a local proxy and mirrors generated
// public/edgeone.json to the site root for EdgeOne-style deployment workflows.
const siteRoot = path.resolve(process.cwd());
const publicEdgeonePath = path.join(siteRoot, 'public', 'edgeone.json');
const siteEdgeonePath = path.join(siteRoot, 'edgeone.json');
const localHugoBin = path.join(
    siteRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'hugo.cmd' : 'hugo'
);
const hugoCommand = existsSync(localHugoBin) ? localHugoBin : 'hugo';
const cliArgs = process.argv.slice(2);
const backendHost = '127.0.0.1';
const proxyOptions = readProxyOptions(cliArgs, process.env);
const publicBind = proxyOptions.bind || '127.0.0.1';
const publicPort = normalizePort(proxyOptions.port);

function consumeOptionValue(args, names) {
    const remaining = [];
    let value = '';

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        let matchedName = '';

        for (const name of names) {
            if (!name) {
                continue;
            }
            if (arg === name || arg.startsWith(`${name}=`)) {
                matchedName = name;
                break;
            }
        }

        if (!matchedName) {
            remaining.push(arg);
            continue;
        }

        if (arg === matchedName) {
            const nextArg = args[index + 1];
            value = nextArg && !nextArg.startsWith('-') ? nextArg : 'true';
            if (nextArg && !nextArg.startsWith('-')) {
                index += 1;
            }
            continue;
        }

        value = arg.slice(matchedName.length + 1);
    }

    return { value, args: remaining };
}

function readEnvOption(env, names) {
    for (const name of names) {
        const value = env[name];
        if (typeof value === 'string' && value.trim() && value !== 'true') {
            return value.trim();
        }
    }

    return '';
}

function isPlainArg(arg) {
    return Boolean(arg) && arg !== '--' && !arg.startsWith('-');
}

function looksLikePort(value) {
    const parsed = Number.parseInt(value ?? '', 10);
    return String(parsed) === String(value) && parsed > 0 && parsed < 65536;
}

function looksLikeBindHost(value) {
    if (!value || looksLikePort(value)) {
        return false;
    }

    return value === 'localhost'
        || value === '0.0.0.0'
        || value === '::'
        || value.includes('.')
        || value.includes(':');
}

function removeFirstPlainValue(args, value) {
    if (!value) {
        return args;
    }

    let removed = false;
    return args.filter((arg) => {
        if (!removed && isPlainArg(arg) && arg === value) {
            removed = true;
            return false;
        }
        return true;
    });
}

function consumePositionalProxyArgs(args, bind, port) {
    const consumedIndexes = new Set();
    const plainArgs = args
        .map((arg, index) => ({ arg, index }))
        .filter(({ arg }) => isPlainArg(arg));

    if (!port) {
        const portCandidate = [...plainArgs].reverse().find(({ arg }) => looksLikePort(arg));
        if (portCandidate) {
            port = portCandidate.arg;
            consumedIndexes.add(portCandidate.index);
        }
    }

    if (!bind) {
        const bindCandidate = plainArgs.find(({ arg, index }) =>
            !consumedIndexes.has(index) && looksLikeBindHost(arg)
        );
        if (bindCandidate) {
            bind = bindCandidate.arg;
            consumedIndexes.add(bindCandidate.index);
        }
    }

    return {
        bind,
        port,
        args: args.filter((arg, index) => arg !== '--' && !consumedIndexes.has(index))
    };
}

function readProxyOptions(args, env) {
    let parsed = consumeOptionValue(args, ['--bind', '-b']);
    let bind = parsed.value;
    parsed = consumeOptionValue(parsed.args, ['--port', '-p']);
    let port = parsed.value;
    let hugoArgs = parsed.args;

    if (!bind) {
        bind = readEnvOption(env, ['BANYAN_DEV_BIND', 'HUGO_DEV_BIND', 'npm_config_bind']);
        hugoArgs = removeFirstPlainValue(hugoArgs, bind);
    }

    if (!port) {
        port = readEnvOption(env, ['BANYAN_DEV_PORT', 'HUGO_DEV_PORT', 'npm_config_port']);
        hugoArgs = removeFirstPlainValue(hugoArgs, port);
    }

    const positional = consumePositionalProxyArgs(hugoArgs, bind, port);
    return {
        bind: positional.bind,
        port: positional.port,
        hugoArgs: positional.args
    };
}

function stripOptions(args, names) {
    const stripped = [];

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        let matchedName = '';

        for (const name of names) {
            if (!name) {
                continue;
            }
            if (arg === name || arg.startsWith(`${name}=`)) {
                matchedName = name;
                break;
            }
        }

        if (!matchedName) {
            stripped.push(arg);
            continue;
        }

        if (arg === matchedName) {
            const nextArg = args[index + 1];
            if (nextArg && !nextArg.startsWith('-')) {
                index += 1;
            }
        }
    }

    return stripped;
}

function normalizePort(portValue) {
    const parsed = Number.parseInt(portValue ?? '', 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
        return parsed;
    }

    return 1313;
}

async function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.once('error', reject);
        probe.listen(0, backendHost, () => {
            const address = probe.address();
            const port = address && typeof address === 'object' ? address.port : 0;
            probe.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

function cloneHeaders(headers) {
    return Object.fromEntries(
        Object.entries(headers).filter(([, value]) => value !== undefined)
    );
}

function firstHeaderValue(value) {
    if (Array.isArray(value)) {
        return value[0] ?? '';
    }

    return value ?? '';
}

function shouldPatchNotFoundContentType(statusCode, headers) {
    if (statusCode !== 404) {
        return false;
    }

    const hasHugoRedirect = Boolean(firstHeaderValue(headers['x-hugo-redirect']));
    const contentType = firstHeaderValue(headers['content-type']).toLowerCase();

    return hasHugoRedirect && contentType.startsWith('text/plain');
}

function pickLocalizedNotFoundPath(requestUrl) {
    const pathname = new URL(requestUrl || '/', 'http://localhost').pathname;

    if (pathname === '/zh' || pathname.startsWith('/zh/')) {
        return '/zh/404.html';
    }

    if (pathname === '/zh-tw' || pathname.startsWith('/zh-tw/')) {
        return '/zh-tw/404.html';
    }

    return '/404.html';
}

function requestBackendPage(backendPort, method, requestUrl, headers) {
    return new Promise((resolve, reject) => {
        const backendRequest = http.request(
            {
                hostname: backendHost,
                port: backendPort,
                method,
                path: requestUrl,
                headers
            },
            resolve
        );

        backendRequest.on('error', reject);
        backendRequest.end();
    });
}

function serializeUpgradeHeaders(headers) {
    const lines = [];

    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const entry of value) {
                lines.push(`${name}: ${entry}`);
            }
            continue;
        }

        lines.push(`${name}: ${value}`);
    }

    return lines.join('\r\n');
}

function formatPublicUrl(host, port) {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    if (displayHost.includes(':') && !displayHost.startsWith('[')) {
        return `http://[${displayHost}]:${port}/`;
    }

    return `http://${displayHost}:${port}/`;
}

async function syncEdgeone() {
    let publicBody = '';
    let repoBody = '';

    try {
        publicBody = await fs.readFile(publicEdgeonePath, 'utf8');
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
        return;
    }

    try {
        repoBody = await fs.readFile(siteEdgeonePath, 'utf8');
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (publicBody === repoBody) {
        return;
    }

    await fs.writeFile(siteEdgeonePath, publicBody, 'utf8');
    console.log('[edgeone-sync] Synced public/edgeone.json -> edgeone.json');
}

async function main() {
    const backendPort = await findAvailablePort();
    const publicBaseUrl = formatPublicUrl(publicBind, publicPort);
    let hugoArgs = proxyOptions.hugoArgs;
    hugoArgs = stripOptions(hugoArgs, ['--appendPort', '--baseURL', '--liveReloadPort']);
    hugoArgs = [
        'server',
        ...hugoArgs,
        '--bind',
        backendHost,
        '--port',
        String(backendPort),
        '--baseURL',
        publicBaseUrl,
        '--liveReloadPort',
        String(publicPort),
        '--appendPort=false'
    ];

    const child = spawn(hugoCommand, hugoArgs, {
        cwd: siteRoot,
        env: createHugoEnv({ cwd: siteRoot }),
        shell: process.platform === 'win32',
        stdio: 'inherit'
    });

    const fetchLocalizedNotFound = (method, requestUrl, headers) =>
        requestBackendPage(
            backendPort,
            method === 'HEAD' ? 'HEAD' : 'GET',
            pickLocalizedNotFoundPath(requestUrl),
            headers
        );

    const proxyServer = http.createServer((request, response) => {
        const proxyRequest = http.request(
            {
                hostname: backendHost,
                port: backendPort,
                method: request.method,
                path: request.url,
                headers: {
                    ...request.headers,
                    host: request.headers.host ?? `${backendHost}:${backendPort}`
                }
            },
            (proxyResponse) => {
                void (async () => {
                    const headers = cloneHeaders(proxyResponse.headers);

                    if (!shouldPatchNotFoundContentType(proxyResponse.statusCode ?? 0, headers)) {
                        response.writeHead(
                            proxyResponse.statusCode ?? 502,
                            proxyResponse.statusMessage ?? '',
                            headers
                        );
                        proxyResponse.pipe(response);
                        return;
                    }

                    proxyResponse.pause();

                    try {
                        const localizedResponse = await fetchLocalizedNotFound(
                            request.method,
                            request.url,
                            {
                                ...request.headers,
                                host: request.headers.host ?? `${backendHost}:${backendPort}`
                            }
                        );
                        const localizedHeaders = cloneHeaders(localizedResponse.headers);
                        localizedHeaders['content-type'] = 'text/html; charset=utf-8';
                        response.writeHead(404, localizedResponse.statusMessage ?? '', localizedHeaders);
                        proxyResponse.resume();
                        localizedResponse.pipe(response);
                    } catch (error) {
                        headers['content-type'] = 'text/html; charset=utf-8';
                        response.writeHead(
                            proxyResponse.statusCode ?? 502,
                            proxyResponse.statusMessage ?? '',
                            headers
                        );
                        proxyResponse.pipe(response);
                    }
                })();
            }
        );

        proxyRequest.on('error', (error) => {
            if (!response.headersSent) {
                response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
            }
            response.end(`Hugo backend unavailable: ${error.message}`);
        });

        request.on('aborted', () => {
            proxyRequest.destroy();
        });

        request.pipe(proxyRequest);
    });

    proxyServer.on('upgrade', (request, socket, head) => {
        const backendSocket = net.connect(backendPort, backendHost, () => {
            const requestLine = `${request.method} ${request.url} HTTP/${request.httpVersion}`;
            const headerBlock = serializeUpgradeHeaders({
                ...request.headers,
                host: request.headers.host ?? `${backendHost}:${backendPort}`
            });
            backendSocket.write(`${requestLine}\r\n${headerBlock}\r\n\r\n`);
            if (head.length > 0) {
                backendSocket.write(head);
            }
            socket.pipe(backendSocket).pipe(socket);
        });

        const closeSockets = () => {
            socket.destroy();
            backendSocket.destroy();
        };

        backendSocket.on('error', closeSockets);
        socket.on('error', closeSockets);
    });

    await new Promise((resolve, reject) => {
        proxyServer.once('error', reject);
        proxyServer.listen(publicPort, publicBind, resolve);
    });

    console.log(
        `[dev-proxy] Public ${formatPublicUrl(publicBind, publicPort)} -> Hugo http://${backendHost}:${backendPort}/`
    );

    let syncInFlight = false;
    let syncQueued = false;

    async function runSyncLoop() {
        if (syncInFlight) {
            syncQueued = true;
            return;
        }

        syncInFlight = true;
        try {
            await syncEdgeone();
        } catch (error) {
            console.error('[edgeone-sync]', error instanceof Error ? error.message : String(error));
        } finally {
            syncInFlight = false;
            if (syncQueued) {
                syncQueued = false;
                void runSyncLoop();
            }
        }
    }

    const interval = setInterval(() => {
        void runSyncLoop();
    }, 1000);

    const shutdown = (signal) => {
        clearInterval(interval);
        proxyServer.close(() => {
            if (!child.killed) {
                child.kill(signal);
            }
        });
        if (!child.killed) {
            child.kill(signal);
        }
    };

    child.on('exit', (code, signal) => {
        clearInterval(interval);
        proxyServer.close(() => {
            if (signal) {
                process.kill(process.pid, signal);
                return;
            }
            process.exit(code ?? 0);
        });
    });

    child.on('error', (error) => {
        clearInterval(interval);
        proxyServer.close(() => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        });
    });

    process.on('SIGINT', () => {
        shutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
        shutdown('SIGTERM');
    });

    void runSyncLoop();
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
