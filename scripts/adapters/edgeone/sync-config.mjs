import fs from 'node:fs/promises';
import path from 'node:path';

// EdgeOne adapter: mirrors the generated public/edgeone.json to the site root
// for platforms that expect deployment config beside the root project files.
const siteRoot = path.resolve(process.cwd());
const publicEdgeonePath = path.join(siteRoot, 'public', 'edgeone.json');
const siteEdgeonePath = path.join(siteRoot, 'edgeone.json');

async function syncEdgeone() {
    const body = await fs.readFile(publicEdgeonePath, 'utf8');
    let previousBody = '';

    try {
        previousBody = await fs.readFile(siteEdgeonePath, 'utf8');
    } catch (error) {
        if (error && error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (body === previousBody) {
        console.log('edgeone.json already in sync');
        return;
    }

    await fs.writeFile(siteEdgeonePath, body, 'utf8');
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
