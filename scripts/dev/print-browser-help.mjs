import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const docPath = path.join(repoRoot, 'themes', 'banyan', 'docs', 'browser-workflows.md');

const body = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
console.log(body);
