import { spawn } from 'node:child_process';
import path from 'node:path';

import { createHugoEnv } from './hugo-env.mjs';

const siteRoot = process.cwd();
const hugoBin = path.join(
    siteRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'hugo.cmd' : 'hugo'
);

const child = spawn(hugoBin, process.argv.slice(2), {
    cwd: siteRoot,
    env: createHugoEnv({ cwd: siteRoot }),
    shell: process.platform === 'win32',
    stdio: 'inherit'
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});

child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
