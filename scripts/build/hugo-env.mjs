import { spawnSync } from 'node:child_process';

function readGitValue(cwd, args) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        windowsHide: true
    });

    if (result.error || result.status !== 0) {
        return '';
    }

    return String(result.stdout || '').trim();
}

function githubCommitHref(remoteUrl, revision) {
    if (!remoteUrl || !/^[0-9a-f]{7,40}$/i.test(revision)) {
        return '';
    }

    const normalized = remoteUrl.trim().replace(/\.git$/i, '');
    const sshMatch = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
    const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/i);
    const sshUrlMatch = normalized.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/i);
    const repoPath = sshMatch?.[1] || httpsMatch?.[1] || sshUrlMatch?.[1] || '';

    return repoPath ? `https://github.com/${repoPath}/commit/${revision}` : '';
}

export function createHugoEnv({ cwd = process.cwd(), env = process.env } = {}) {
    const nextEnv = { ...env };

    let revision = String(nextEnv.HUGO_PARAMS_BUILD_REVISION || '').trim();
    if (!nextEnv.HUGO_PARAMS_BUILD_REVISION) {
        revision = readGitValue(cwd, ['rev-parse', 'HEAD']);
        if (revision) {
            nextEnv.HUGO_PARAMS_BUILD_REVISION = revision;
        }
    }

    if (revision && !nextEnv.HUGO_PARAMS_BUILD_COMMIT_SHORT) {
        nextEnv.HUGO_PARAMS_BUILD_COMMIT_SHORT = revision.slice(0, 12);
    }

    if (revision && !nextEnv.HUGO_PARAMS_BUILD_COMMIT_HREF) {
        const remoteUrl = readGitValue(cwd, ['remote', 'get-url', 'origin']);
        const href = githubCommitHref(remoteUrl, revision);
        if (href) {
            nextEnv.HUGO_PARAMS_BUILD_COMMIT_HREF = href;
        }
    }

    return nextEnv;
}
