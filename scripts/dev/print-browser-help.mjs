import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const themeRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const docPath = path.join(themeRoot, 'docs', 'browser-workflows.md');

const body = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
console.log(body);
