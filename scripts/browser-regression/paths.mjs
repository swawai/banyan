import fs from 'node:fs';
import path from 'node:path';

export const siteRoot = path.resolve(process.cwd());
export const publicDir = path.join(siteRoot, 'public');
export const tempPublicRoot = path.join(siteRoot, 'temp_workspace', 'public');
export const regressionRoot = path.join(siteRoot, 'temp_workspace', 'regression');
const explicitPrimaryBuildEnv = 'BANYAN_BROWSER_BUILD_DIR';
const explicitUpgradeFromEnv = 'BANYAN_BROWSER_UPGRADE_FROM_DIR';
const explicitUpgradeToEnv = 'BANYAN_BROWSER_UPGRADE_TO_DIR';

function hasIndexHtml(dirPath) {
    return fs.existsSync(path.join(dirPath, 'index.html'));
}

function listDirectories(rootDir) {
    if (!fs.existsSync(rootDir)) return [];
    return fs.readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(rootDir, entry.name));
}

function sortByMtimeDesc(paths) {
    return paths
        .map((dirPath) => ({
            dirPath,
            mtimeMs: fs.statSync(dirPath).mtimeMs
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map((item) => item.dirPath);
}

export function relFromSite(absPath) {
    return path.relative(siteRoot, absPath).replace(/\\/g, '/');
}

function toAbsoluteBuildDir(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '';
    return path.isAbsolute(rawPath)
        ? path.normalize(rawPath)
        : path.resolve(siteRoot, rawPath);
}

function buildCandidate(dirPath, kind) {
    return {
        dirPath,
        kind,
        mtimeMs: fs.statSync(dirPath).mtimeMs
    };
}

function listTempBuildCandidates() {
    return listDirectories(tempPublicRoot)
        .filter(hasIndexHtml)
        .map((dirPath) => buildCandidate(dirPath, 'temp'));
}

function describeBuildSelection(selection) {
    if (!selection) return '';
    const relPath = relFromSite(selection.dirPath);
    const kindLabel = selection.kind === 'public' ? 'site public/' : 'temp build';
    return `${kindLabel}: ${relPath} (${selection.reason})`;
}

export function resolvePrimaryBuild() {
    const explicitDir = toAbsoluteBuildDir(process.env[explicitPrimaryBuildEnv] || '');
    if (explicitDir) {
        if (!hasIndexHtml(explicitDir)) {
            throw new Error(`Explicit browser-regression build dir ${JSON.stringify(process.env[explicitPrimaryBuildEnv])} did not contain index.html.`);
        }
        return {
            dirPath: explicitDir,
            kind: explicitDir === publicDir ? 'public' : 'explicit',
            reason: `${explicitPrimaryBuildEnv} override`
        };
    }

    const candidates = listTempBuildCandidates();
    if (hasIndexHtml(publicDir)) {
        candidates.push(buildCandidate(publicDir, 'public'));
    }

    const latest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (latest) {
        return {
            dirPath: latest.dirPath,
            kind: latest.kind,
            reason: latest.kind === 'public'
                ? 'newest available build'
                : 'newest available temp build'
        };
    }

    throw new Error('No browser-regression build root found. Expected site public/index.html or site temp_workspace/public/<build>/index.html.');
}

export function resolvePrimaryBuildDir() {
    return resolvePrimaryBuild().dirPath;
}

export function resolveLatestTempBuild() {
    const latest = listTempBuildCandidates()
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!latest) {
        throw new Error('No temp browser-regression build root found. Expected site temp_workspace/public/<build>/index.html.');
    }
    return {
        dirPath: latest.dirPath,
        kind: latest.kind,
        reason: 'latest temp build'
    };
}

export function resolveUpgradeBuildPair() {
    const explicitFromDir = toAbsoluteBuildDir(process.env[explicitUpgradeFromEnv] || '');
    const explicitToDir = toAbsoluteBuildDir(process.env[explicitUpgradeToEnv] || '');

    if (explicitFromDir || explicitToDir) {
        if (!explicitFromDir || !explicitToDir) {
            throw new Error(`Explicit upgrade selection requires both ${explicitUpgradeFromEnv} and ${explicitUpgradeToEnv}.`);
        }
        if (!hasIndexHtml(explicitFromDir) || !hasIndexHtml(explicitToDir)) {
            throw new Error('Explicit upgrade build dirs must both contain index.html.');
        }
        return {
            fromDir: explicitFromDir,
            fromKind: explicitFromDir === publicDir ? 'public' : 'explicit',
            toDir: explicitToDir,
            toKind: explicitToDir === publicDir ? 'public' : 'explicit',
            reason: `${explicitUpgradeFromEnv}/${explicitUpgradeToEnv} override`
        };
    }

    const buildDirs = listTempBuildCandidates()
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (buildDirs.length < 2) return null;

    return {
        fromDir: buildDirs[1].dirPath,
        fromKind: buildDirs[1].kind,
        toDir: buildDirs[0].dirPath,
        toKind: buildDirs[0].kind,
        reason: 'latest two temp builds'
    };
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
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
}

export function createOutputDir(modeName) {
    const dirPath = path.join(regressionRoot, `${timestampId()}-${modeName}`);
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
}

export {
    describeBuildSelection,
    explicitPrimaryBuildEnv,
    explicitUpgradeFromEnv,
    explicitUpgradeToEnv
};
