import { spawn } from 'node:child_process';

import { createHugoEnv } from './hugo-env.mjs';

const siteRoot = process.cwd();

const child = spawn(process.execPath, ['x', 'hugo', ...process.argv.slice(2)], {
    cwd: siteRoot,
    env: createHugoEnv({ cwd: siteRoot }),
    shell: false,
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
