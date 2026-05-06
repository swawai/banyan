import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const publicEdgeonePath = path.join(repoRoot, 'public', 'edgeone.json');
const repoEdgeonePath = path.join(repoRoot, 'edgeone.json');

async function syncEdgeone() {
    const body = await fs.readFile(publicEdgeonePath, 'utf8');
    let previousBody = '';

    try {
        previousBody = await fs.readFile(repoEdgeonePath, 'utf8');
    } catch (error) {
        if (error && error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (body === previousBody) {
        console.log('edgeone.json already in sync');
        return;
    }

    await fs.writeFile(repoEdgeonePath, body, 'utf8');
    console.log('Synced public/edgeone.json -> edgeone.json');
}

Promise.resolve()
    .then(syncEdgeone)
    .catch((error) => {
    if (error && error.code === 'ENOENT') {
        console.error('Missing public/edgeone.json. Run hugo build/server first so Hugo can render it.');
    } else {
        console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
    });
