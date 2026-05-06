const defaultBaseUrl = 'https://swaw.com/';

function printHelp() {
    console.log(`Usage:
  node themes/banyan/scripts/checks/check-security-headers.mjs [baseUrl]

Examples:
  npm run check:security:headers
  node themes/banyan/scripts/checks/check-security-headers.mjs https://swaw.com/
  node themes/banyan/scripts/checks/check-security-headers.mjs http://127.0.0.1:8787/

Notes:
  - Checks the real response headers returned by the target server.
  - The home page must expose the browser security headers and Speculation-Rules.
  - /sw.js must remain no-cache so browsers can discover service worker updates.
`);
}

function parseCli(argv) {
    const options = {
        baseUrl: defaultBaseUrl,
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
        if (options.baseUrl !== defaultBaseUrl) {
            throw new Error(`Only one baseUrl can be provided, got extra argument: ${arg}`);
        }
        options.baseUrl = arg;
    }

    return options;
}

function resolveUrl(baseUrl, pathname) {
    return new URL(pathname, baseUrl).toString();
}

async function fetchHeaders(url, { method = 'HEAD' } = {}) {
    const response = await fetch(url, {
        method,
        redirect: 'follow',
    });
    return {
        headers: response.headers,
        ok: response.ok,
        status: response.status,
        url: response.url,
    };
}

function readHeader(headers, name) {
    return headers.get(name) || '';
}

function hasDirective(headerValue, directive) {
    return headerValue.toLowerCase().includes(directive.toLowerCase());
}

function assertHeader(checks, condition, message, details = {}) {
    checks.push({
        details,
        message,
        ok: Boolean(condition),
    });
}

function formatDetails(details) {
    const entries = Object.entries(details).filter(([, value]) => value !== undefined && value !== '');
    if (entries.length === 0) {
        return '';
    }
    return ` (${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ')})`;
}

function printChecks(title, checks) {
    console.log(`\n${title}`);
    for (const check of checks) {
        console.log(`${check.ok ? 'PASS' : 'FAIL'}\t${check.message}${formatDetails(check.details)}`);
    }
}

function buildHomeChecks(result) {
    const checks = [];
    const cspEnforce = readHeader(result.headers, 'content-security-policy');
    const permissionsPolicy = readHeader(result.headers, 'permissions-policy');
    const hsts = readHeader(result.headers, 'strict-transport-security');
    const speculationRules = readHeader(result.headers, 'speculation-rules');

    assertHeader(checks, result.ok, 'home response is OK', { status: result.status, url: result.url });
    assertHeader(checks, cspEnforce, 'home exposes enforced CSP');
    const csp = cspEnforce;
    assertHeader(checks, hasDirective(csp, "default-src 'self'"), 'CSP keeps default-src self');
    assertHeader(checks, hasDirective(csp, "object-src 'none'"), 'CSP blocks object embedding');
    assertHeader(checks, hasDirective(csp, "base-uri 'self'"), 'CSP restricts base URI');
    assertHeader(checks, hasDirective(csp, "frame-ancestors 'self'"), 'CSP restricts frame ancestors');
    assertHeader(checks, permissionsPolicy, 'home exposes Permissions-Policy');
    for (const directive of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']) {
        assertHeader(checks, hasDirective(permissionsPolicy, directive), `Permissions-Policy denies ${directive}`);
    }
    assertHeader(checks, /^max-age=\d+/i.test(hsts), 'home exposes HSTS max-age', { hsts });
    assertHeader(checks, !/includeSubDomains|preload/i.test(hsts), 'HSTS is still in ramp-up mode', { hsts });
    assertHeader(checks, speculationRules.startsWith('"/speculation-rules/'), 'home exposes generated Speculation-Rules document', {
        speculationRules,
    });
    assertHeader(checks, readHeader(result.headers, 'x-content-type-options').toLowerCase() === 'nosniff', 'home sends X-Content-Type-Options nosniff');
    assertHeader(checks, readHeader(result.headers, 'referrer-policy').toLowerCase() === 'strict-origin-when-cross-origin', 'home sends Referrer-Policy baseline');

    return checks;
}

function buildSwChecks(result) {
    const checks = [];
    const cacheControl = readHeader(result.headers, 'cache-control');
    assertHeader(checks, result.ok, 'sw.js response is OK', { status: result.status, url: result.url });
    for (const directive of ['no-cache', 'max-age=0', 'must-revalidate']) {
        assertHeader(checks, hasDirective(cacheControl, directive), `sw.js cache-control includes ${directive}`, {
            cacheControl,
        });
    }
    return checks;
}

async function main() {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const homeUrl = resolveUrl(options.baseUrl, '/');
    const swUrl = resolveUrl(options.baseUrl, '/sw.js');
    console.log('Security header check');
    console.log(`Base\t${options.baseUrl}`);

    const [homeResult, swResult] = await Promise.all([
        fetchHeaders(homeUrl),
        fetchHeaders(swUrl),
    ]);

    const homeChecks = buildHomeChecks(homeResult);
    const swChecks = buildSwChecks(swResult);
    printChecks('Home', homeChecks);
    printChecks('Service worker', swChecks);

    const failures = [...homeChecks, ...swChecks].filter((check) => !check.ok);
    if (failures.length > 0) {
        console.log(`\nSecurity header check failed: ${failures.length} issue(s).`);
        process.exit(1);
    }

    console.log('\nSecurity header check passed.');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
