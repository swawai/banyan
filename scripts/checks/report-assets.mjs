import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const reportTarget = process.argv[2] ?? 'public';
const reportRoot = path.resolve(repoRoot, reportTarget);
const hashPattern = /\.[0-9a-f]{8,}(?:\.[0-9a-f]{8,})*\./i;

async function collectFiles(rootDir, currentDir = rootDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(rootDir, absolutePath));
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }

        const stat = await fs.stat(absolutePath);
        const relativePath = path.relative(rootDir, absolutePath);
        const ext = path.extname(entry.name).toLowerCase() || '<noext>';
        const topLevel = relativePath.includes(path.sep)
            ? relativePath.slice(0, relativePath.indexOf(path.sep))
            : '.';

        files.push({
            absolutePath,
            relativePath,
            ext,
            topLevel,
            hasHash: hashPattern.test(entry.name),
            bytes: stat.size
        });
    }

    return files;
}

function sortRows(rows) {
    return rows.sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        if (right.bytes !== left.bytes) return right.bytes - left.bytes;
        return String(left.key).localeCompare(String(right.key));
    });
}

function buildGroupRows(files, keyBuilder) {
    const map = new Map();

    for (const file of files) {
        const key = keyBuilder(file);
        const row = map.get(key) ?? { key, count: 0, bytes: 0 };
        row.count += 1;
        row.bytes += file.bytes;
        map.set(key, row);
    }

    return sortRows([...map.values()]);
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const kib = bytes / 1024;
    if (kib < 1024) return `${kib.toFixed(1)} KiB`;
    return `${(kib / 1024).toFixed(2)} MiB`;
}

function printSection(title, rows) {
    console.log(`\n${title}`);
    for (const row of rows) {
        console.log(`${row.key}\t${row.count}\t${row.bytes}\t${formatBytes(row.bytes)}`);
    }
}

async function main() {
    await fs.access(reportRoot);
    const files = await collectFiles(reportRoot);
    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

    console.log(`Asset report root\t${reportRoot}`);
    console.log(`Files\t${files.length}`);
    console.log(`Bytes\t${totalBytes}`);
    console.log(`Readable\t${formatBytes(totalBytes)}`);

    printSection(
        'By extension\tcount\tbytes\treadable',
        buildGroupRows(files, (file) => file.ext)
    );
    printSection(
        'By hash+extension\tcount\tbytes\treadable',
        buildGroupRows(files, (file) => `hasHash=${file.hasHash}\text=${file.ext}`)
    );
    printSection(
        'By top-level directory\tcount\tbytes\treadable',
        buildGroupRows(files, (file) => file.topLevel)
    );
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
