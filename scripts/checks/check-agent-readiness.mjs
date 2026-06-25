import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const siteRoot = process.cwd();
const defaultPublicDir = 'public';
const assetLikeExtensionPattern = /\.(?:avif|bmp|csv|gif|ico|jpe?g|json|pdf|png|svg|txt|webp|xml|zip)(?:[?#]|$)/i;
const markdownMirrorHeaderRoute = '/*.md';
const expectedMarkdownRobotsTag = 'noindex';
const expectedMarkdownContentType = 'text/markdown';
const maxLocalShareImageBytes = 1_000_000;
const expectedRobotsAgentHints = [
    'ChatGPT-User',
    'OAI-SearchBot',
    'GPTBot',
    'Google-Extended'
];

function printHelp() {
    console.log(`Usage:
  bun themes/banyan/scripts/checks/check-agent-readiness.mjs [publicDir] [--check]

Examples:
  bun run check:agent
  bun run check:agent:prod
  bun themes/banyan/scripts/checks/check-agent-readiness.mjs temp_workspace/public/260603-agent-readiness --check

Notes:
  - Default mode prints a report and does not fail on readiness issues.
  - --check exits non-zero when the agent-facing publishing contract is broken.
`);
}

function parseCli(argv) {
    const options = {
        publicDir: defaultPublicDir,
        check: false,
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--check') {
            options.check = true;
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`Unsupported option: ${arg}`);
        }
        if (options.publicDir !== defaultPublicDir) {
            throw new Error(`Only one publicDir can be provided, got extra argument: ${arg}`);
        }
        options.publicDir = arg;
    }

    return options;
}

async function collectFiles(rootDir, predicate, currentDir = rootDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(rootDir, predicate, absolutePath));
            continue;
        }
        if (!entry.isFile() || !predicate(absolutePath, entry.name)) {
            continue;
        }
        files.push(absolutePath);
    }

    return files;
}

async function fileExists(absolutePath) {
    try {
        await fs.access(absolutePath);
        return true;
    } catch {
        return false;
    }
}

async function readUtf8IfExists(absolutePath) {
    try {
        return await fs.readFile(absolutePath, 'utf8');
    } catch {
        return '';
    }
}

function toPublicRelativePath(rootDir, absolutePath) {
    return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

function normalizePublicRelativePath(relativePath) {
    let normalized = `${relativePath ?? ''}`.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized === '') {
        return 'index.html';
    }
    if (normalized.endsWith('/')) {
        normalized += 'index.html';
    }
    return normalized;
}

function decodeHtmlAttribute(value) {
    return `${value ?? ''}`
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function extractTagAttribute(tagText, attributeName) {
    const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, 'i');
    const match = tagText.match(pattern);
    if (!match) {
        return '';
    }
    return decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? '');
}

function extractStartTags(text, tagName) {
    const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...text.matchAll(new RegExp(`<${escapedTagName}\\b[^>]*>`, 'gi'))].map((match) => match[0]);
}

function hasRelToken(tagText, relToken) {
    return extractTagAttribute(tagText, 'rel')
        .split(/\s+/)
        .some((token) => token.toLowerCase() === relToken.toLowerCase());
}

function isIgnoredHref(href) {
    return href === ''
        || href.startsWith('#')
        || /^(?:data|javascript|mailto|tel):/i.test(href);
}

function isRelativeHref(href) {
    const trimmed = `${href ?? ''}`.trim();
    return trimmed !== ''
        && !trimmed.startsWith('/')
        && !trimmed.startsWith('#')
        && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function stripMarkdownTitle(rawTarget) {
    let target = `${rawTarget ?? ''}`.trim();
    if (target.startsWith('<')) {
        const closeIndex = target.indexOf('>');
        if (closeIndex >= 0) {
            return target.slice(1, closeIndex).trim();
        }
    }
    target = target.replace(/\s+["'][\s\S]*$/, '');
    return target.trim();
}

function extractMarkdownLinks(text) {
    const links = [];
    const pattern = /(!?)\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g;

    for (const match of text.matchAll(pattern)) {
        const target = stripMarkdownTitle(match[2] ?? '');
        if (!target) {
            continue;
        }
        links.push({
            isImage: match[1] === '!',
            target,
            raw: match[0]
        });
    }

    return links;
}

function extractCanonicalOrigin(llmsText) {
    const match = llmsText.match(/^Canonical site:\s*(\S+)/mi);
    if (!match) {
        return '';
    }

    try {
        return new URL(match[1]).origin;
    } catch {
        return '';
    }
}

function hasPerPageMirrorList(llmsText) {
    return /^\s*Mirrors:/m.test(llmsText);
}

function parseGeneratedHeaders(body) {
    const blocks = [];
    let currentBlock = null;

    for (const rawLine of `${body ?? ''}`.replace(/\r\n/g, '\n').split('\n')) {
        const line = rawLine.trimEnd();
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        if (!/^\s/.test(line)) {
            currentBlock = {
                headers: new Map(),
                source: trimmed
            };
            blocks.push(currentBlock);
            continue;
        }

        if (!currentBlock) {
            continue;
        }

        const separatorIndex = trimmed.indexOf(':');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        if (key) {
            currentBlock.headers.set(key.toLowerCase(), value);
        }
    }

    return blocks;
}

function toHeaderMap(headers) {
    const headerMap = new Map();
    if (!Array.isArray(headers)) {
        return headerMap;
    }

    for (const header of headers) {
        if (!header || typeof header !== 'object') {
            continue;
        }
        const key = `${header.key ?? ''}`.trim();
        const value = `${header.value ?? ''}`.trim();
        if (key) {
            headerMap.set(key.toLowerCase(), value);
        }
    }

    return headerMap;
}

function headerIncludesToken(value, token) {
    return `${value ?? ''}`
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .includes(token.toLowerCase());
}

function inspectMarkdownHeaderMap(headers, sourceLabel, issues) {
    const robotsTag = headers.get('x-robots-tag') ?? '';
    const contentType = headers.get('content-type') ?? '';

    if (!headerIncludesToken(robotsTag, expectedMarkdownRobotsTag)) {
        issues.push(`${sourceLabel} is missing X-Robots-Tag: ${expectedMarkdownRobotsTag}.`);
    }
    if (!contentType.toLowerCase().startsWith(expectedMarkdownContentType)) {
        issues.push(`${sourceLabel} should declare Content-Type: ${expectedMarkdownContentType}.`);
    }
}

function resolvePublicPathFromHref(href, { canonicalOrigin, currentRelativePath = '' }) {
    const trimmed = decodeHtmlAttribute(`${href ?? ''}`.trim());
    if (isIgnoredHref(trimmed)) {
        return { kind: 'ignored', relativePath: '' };
    }

    try {
        const basePath = currentRelativePath ? currentRelativePath : 'index.html';
        const url = new URL(trimmed, `https://agent-audit.local/${basePath}`);

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { kind: 'external', relativePath: '' };
        }
        if (url.origin !== 'https://agent-audit.local' && canonicalOrigin && url.origin !== canonicalOrigin) {
            return { kind: 'external', relativePath: '' };
        }
        if (url.origin !== 'https://agent-audit.local' && !canonicalOrigin) {
            return { kind: 'external', relativePath: '' };
        }

        return {
            kind: 'local',
            relativePath: normalizePublicRelativePath(decodeURIComponent(url.pathname))
        };
    } catch (error) {
        return {
            kind: 'invalid',
            relativePath: '',
            message: error instanceof Error ? error.message : String(error)
        };
    }
}

function markdownPathToHtmlPath(markdownPath) {
    if (!markdownPath.endsWith('/index.md') && markdownPath !== 'index.md') {
        return '';
    }
    return markdownPath.replace(/index\.md$/, 'index.html');
}

function extractFrontMatter(text) {
    text = `${text ?? ''}`.replace(/^\uFEFF/, '');
    if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
        const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
        return match?.[1] ?? '';
    }
    if (text.startsWith('+++\n') || text.startsWith('+++\r\n')) {
        const match = text.match(/^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n/);
        return match?.[1] ?? '';
    }
    return '';
}

function parseFrontMatterData(frontMatter, relativePath, issues) {
    if (!frontMatter.trim()) {
        return {};
    }
    try {
        const parsed = parseYaml(frontMatter);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        issues.push(`Content page front matter is not valid YAML: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
        return {};
    }
}

function extractFrontMatterOutputList(frontMatter) {
    const outputs = [];

    const addOutput = (name) => {
        const normalized = `${name ?? ''}`.trim().toUpperCase();
        if (normalized) {
            outputs.push(normalized);
        }
    };

    for (const match of frontMatter.matchAll(/^\s*outputs\s*[:=]\s*\[([^\]]*)\]/gmi)) {
        for (const name of match[1].matchAll(/["']?([A-Za-z0-9_-]+)["']?/g)) {
            addOutput(name[1]);
        }
    }

    const yamlBlockMatch = frontMatter.match(/^\s*outputs\s*:\s*\r?\n((?:\s+-\s*[^\r\n]+\r?\n?)+)/mi);
    if (yamlBlockMatch) {
        for (const line of yamlBlockMatch[1].split(/\r?\n/)) {
            const match = line.match(/^\s+-\s*["']?([A-Za-z0-9_-]+)["']?\s*$/);
            if (match) {
                addOutput(match[1]);
            }
        }
    }

    return outputs;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function isExternalShareImage(value) {
    return /^https?:\/\//i.test(value);
}

async function readSiteLanguageInfo() {
    const configText = await readUtf8IfExists(path.join(siteRoot, 'hugo.toml'));
    const defaultLanguage = configText.match(/^\s*defaultContentLanguage\s*=\s*["']([^"']+)["']/mi)?.[1] ?? 'en';
    const languages = new Set([defaultLanguage]);

    for (const match of configText.matchAll(/^\s*\[languages\.([^\]\s]+)\]\s*$/gmi)) {
        const language = match[1];
        if (!language.includes('.')) {
            languages.add(language);
        }
    }

    return {
        defaultLanguage,
        languages: [...languages].sort((a, b) => b.length - a.length)
    };
}

function parseContentIdentity(relativePath, languageInfo) {
    const contentRelativePath = relativePath.replace(/^content\//, '');
    const dirName = path.posix.dirname(contentRelativePath);
    const dir = dirName === '.' ? '' : dirName;
    const fileName = path.posix.basename(contentRelativePath);
    let stem = fileName.replace(/\.(?:md|markdown)$/i, '');
    let language = languageInfo.defaultLanguage;

    for (const candidate of languageInfo.languages) {
        const suffix = `.${candidate}`;
        if (stem.toLowerCase().endsWith(suffix.toLowerCase())) {
            language = candidate;
            stem = stem.slice(0, -suffix.length);
            break;
        }
    }

    return {
        contentRelativePath,
        dir,
        stem,
        language
    };
}

function contentRecordKey(dir, stem, language) {
    return `${dir}\u0000${stem}\u0000${language}`;
}

function parentContentDir(dir) {
    if (!dir) {
        return '';
    }
    const parent = path.posix.dirname(dir);
    return parent === '.' ? '' : parent;
}

function buildContentRecordIndex(records) {
    const byKey = new Map();
    for (const record of records) {
        byKey.set(contentRecordKey(record.identity.dir, record.identity.stem, record.identity.language), record);
    }
    return byKey;
}

function findSectionRecord(recordsByKey, dir, language) {
    return recordsByKey.get(contentRecordKey(dir, '_index', language)) ?? null;
}

function resolveShareImageRecord(record, recordsByKey, languageInfo) {
    const candidates = [record];
    let dir = record.identity.stem === '_index'
        ? parentContentDir(record.identity.dir)
        : record.identity.dir;

    while (dir) {
        const sectionRecord = findSectionRecord(recordsByKey, dir, record.identity.language);
        if (sectionRecord) {
            candidates.push(sectionRecord);
        }
        dir = parentContentDir(dir);
    }

    const homeRecord = findSectionRecord(recordsByKey, '', record.identity.language)
        ?? findSectionRecord(recordsByKey, '', languageInfo.defaultLanguage);
    if (homeRecord) {
        candidates.push(homeRecord);
    }

    for (const candidate of candidates) {
        if (hasOwn(candidate.frontMatterData, 'share_image')) {
            return candidate;
        }
    }

    return null;
}

async function inspectShareImageSetting({ record, recordsByKey, languageInfo, issues }) {
    if (hasOwn(record.frontMatterData, 'images')) {
        issues.push(`Content page uses legacy images front matter; use share_image instead: ${record.relativePath}`);
    }

    const ownerRecord = resolveShareImageRecord(record, recordsByKey, languageInfo);
    if (!ownerRecord) {
        issues.push(`Content page cannot resolve share_image from page, section, or language home: ${record.relativePath}`);
        return { configured: false, disabled: false, inherited: false };
    }

    const shareImage = ownerRecord.frontMatterData.share_image;
    const inherited = ownerRecord.relativePath !== record.relativePath;
    if (shareImage === false) {
        return { configured: false, disabled: true, inherited };
    }
    if (typeof shareImage !== 'string' || shareImage.trim() === '') {
        issues.push(`Content page share_image must be false or a non-empty string: ${ownerRecord.relativePath}`);
        return { configured: false, disabled: false, inherited };
    }

    const normalized = shareImage.trim();
    if (isExternalShareImage(normalized)) {
        return { configured: true, disabled: false, inherited };
    }

    const localPath = normalized.startsWith('/')
        ? path.join(siteRoot, 'static', normalized.replace(/^\/+/, ''))
        : path.resolve(path.dirname(ownerRecord.contentPath), normalized);
    if (!await fileExists(localPath)) {
        issues.push(`Content page share_image points to a missing local file: ${ownerRecord.relativePath} -> ${shareImage}`);
    } else {
        const stat = await fs.stat(localPath);
        if (stat.size > maxLocalShareImageBytes) {
            issues.push(`Content page share_image is too large (${stat.size} bytes > ${maxLocalShareImageBytes} bytes): ${ownerRecord.relativePath} -> ${shareImage}`);
        }
    }

    return { configured: true, disabled: false, inherited };
}

function extractMarkdownAlternates(htmlText) {
    const alternates = [];

    for (const tag of extractStartTags(htmlText, 'link')) {
        if (!hasRelToken(tag, 'alternate')) {
            continue;
        }
        if (extractTagAttribute(tag, 'type').toLowerCase() !== 'text/markdown') {
            continue;
        }
        const href = extractTagAttribute(tag, 'href');
        if (href) {
            alternates.push(href);
        }
    }

    return alternates;
}

async function inspectRobots(publicRoot, issues) {
    const robotsPath = path.join(publicRoot, 'robots.txt');
    const robotsText = await readUtf8IfExists(robotsPath);
    if (!robotsText) {
        issues.push('Missing robots.txt.');
        return {
            hasRobots: false,
            userAgentCount: 0,
            missingAgentHints: expectedRobotsAgentHints
        };
    }

    const userAgentCount = (robotsText.match(/^User-agent:/gim) ?? []).length;
    const missingAgentHints = expectedRobotsAgentHints.filter((agent) => !robotsText.includes(agent));
    if (!/^Sitemap:\s*\S+/im.test(robotsText)) {
        issues.push('robots.txt is missing a Sitemap directive.');
    }
    if (!/^User-agent:\s*\*/im.test(robotsText)) {
        issues.push('robots.txt is missing the wildcard User-agent block.');
    }
    if (missingAgentHints.length > 0) {
        issues.push(`robots.txt is missing expected AI crawler policy hints: ${missingAgentHints.join(', ')}.`);
    }

    return {
        hasRobots: true,
        userAgentCount,
        missingAgentHints
    };
}

async function inspectMarkdownMirrorHeaderPolicy(publicRoot, issues) {
    const headersPath = path.join(publicRoot, '_headers');
    const edgeonePath = path.join(publicRoot, 'edgeone.json');
    const headersText = await readUtf8IfExists(headersPath);
    const edgeoneText = await readUtf8IfExists(edgeonePath);
    let generatedHeadersRoute = false;
    let edgeoneRoute = false;

    if (!headersText) {
        issues.push('Missing generated _headers; Markdown mirror noindex headers cannot be verified.');
    } else {
        const route = parseGeneratedHeaders(headersText)
            .find((block) => block.source === markdownMirrorHeaderRoute);
        if (!route) {
            issues.push(`Generated _headers is missing the Markdown mirror route: ${markdownMirrorHeaderRoute}.`);
        } else {
            generatedHeadersRoute = true;
            inspectMarkdownHeaderMap(route.headers, `_headers ${markdownMirrorHeaderRoute}`, issues);
        }
    }

    if (!edgeoneText) {
        issues.push('Missing generated edgeone.json; Markdown mirror noindex headers cannot be verified.');
    } else {
        try {
            const parsed = JSON.parse(edgeoneText);
            const route = Array.isArray(parsed.headers)
                ? parsed.headers.find((entry) => entry && entry.source === markdownMirrorHeaderRoute)
                : null;
            if (!route) {
                issues.push(`edgeone.json is missing the Markdown mirror route: ${markdownMirrorHeaderRoute}.`);
            } else {
                edgeoneRoute = true;
                inspectMarkdownHeaderMap(toHeaderMap(route.headers), `edgeone.json ${markdownMirrorHeaderRoute}`, issues);
            }
        } catch {
            issues.push('Generated edgeone.json is not valid JSON.');
        }
    }

    return {
        edgeoneRoute,
        generatedHeadersRoute
    };
}

async function inspectSourceOutputSettings(issues) {
    const contentRoot = path.join(siteRoot, 'content');
    if (!await fileExists(contentRoot)) {
        return {
            contentFiles: 0,
            agentMarkdownOptIns: 0,
            markdownOnlyOptIns: 0,
            shareImageConfigured: 0,
            shareImageDisabled: 0,
            shareImageInherited: 0
        };
    }

    const languageInfo = await readSiteLanguageInfo();
    const contentFiles = await collectFiles(
        contentRoot,
        (_absolutePath, name) => /\.(?:md|markdown)$/i.test(name)
    );
    const records = [];
    let agentMarkdownOptIns = 0;
    let markdownOnlyOptIns = 0;
    let shareImageConfigured = 0;
    let shareImageDisabled = 0;
    let shareImageInherited = 0;

    for (const contentPath of contentFiles) {
        const relativePath = toPublicRelativePath(siteRoot, contentPath);
        const text = await fs.readFile(contentPath, 'utf8');
        const frontMatter = extractFrontMatter(text);
        const frontMatterData = parseFrontMatterData(frontMatter, relativePath, issues);
        const outputList = extractFrontMatterOutputList(frontMatter);
        const outputs = new Set(outputList);
        records.push({
            contentPath,
            relativePath,
            frontMatterData,
            outputList,
            outputs,
            identity: parseContentIdentity(relativePath, languageInfo)
        });
    }

    const recordsByKey = buildContentRecordIndex(records);

    for (const record of records) {
        const hasHtml = record.outputs.has('HTML');
        const hasMarkdown = record.outputs.has('MARKDOWN');
        const hasAgentMarkdown = record.outputs.has('AGENT_MARKDOWN');

        if (hasAgentMarkdown) {
            agentMarkdownOptIns += 1;
        }
        if (hasMarkdown && !hasAgentMarkdown) {
            markdownOnlyOptIns += 1;
        }
        if (hasMarkdown && hasAgentMarkdown) {
            issues.push(`Content page configures both MARKDOWN and AGENT_MARKDOWN outputs: ${record.relativePath}`);
        }
        if ((hasMarkdown || hasAgentMarkdown) && record.outputList[0] !== 'HTML') {
            issues.push(`Content page opts into a Markdown mirror without keeping HTML as the first output: ${record.relativePath}`);
        }

        if (hasHtml || hasMarkdown || hasAgentMarkdown) {
            const shareImage = await inspectShareImageSetting({
                record,
                recordsByKey,
                languageInfo,
                issues
            });
            if (shareImage.configured) {
                shareImageConfigured += 1;
            }
            if (shareImage.disabled) {
                shareImageDisabled += 1;
            }
            if (shareImage.inherited) {
                shareImageInherited += 1;
            }
        }
    }

    return {
        contentFiles: contentFiles.length,
        agentMarkdownOptIns,
        markdownOnlyOptIns,
        shareImageConfigured,
        shareImageDisabled,
        shareImageInherited
    };
}

async function inspectLlms(publicRoot, issues) {
    const llmsPath = path.join(publicRoot, 'llms.txt');
    const llmsText = await readUtf8IfExists(llmsPath);
    if (!llmsText) {
        issues.push('Missing root llms.txt.');
        return {
            hasLlms: false,
            canonicalOrigin: '',
            localLinkCount: 0,
            markdownLinks: new Set(),
            text: ''
        };
    }

    const canonicalOrigin = extractCanonicalOrigin(llmsText);
    if (!canonicalOrigin) {
        issues.push('llms.txt is missing a parseable Canonical site URL.');
    }
    if (!/^## Agent Notes\b/m.test(llmsText)) {
        issues.push('llms.txt is missing the Agent Notes section.');
    }
    if (hasPerPageMirrorList(llmsText)) {
        issues.push('llms.txt should not contain per-page Mirrors entries; use language indexes and sitemap hreflang for alternate-language discovery.');
    }
    if (!/^## Languages?\b/m.test(llmsText) && !/^## Key Content Pages\b/m.test(llmsText)) {
        issues.push('llms.txt is missing a Languages or Key Content Pages section.');
    }

    const localLinks = new Set();
    const markdownLinks = new Set();
    const links = extractMarkdownLinks(llmsText);
    for (const link of links) {
        const resolved = resolvePublicPathFromHref(link.target, { canonicalOrigin });
        if (resolved.kind === 'ignored' || resolved.kind === 'external') {
            continue;
        }
        if (resolved.kind === 'invalid') {
            issues.push(`llms.txt contains an invalid link target: ${link.target}`);
            continue;
        }

        localLinks.add(resolved.relativePath);
        if (!await fileExists(path.join(publicRoot, resolved.relativePath))) {
            issues.push(`llms.txt points to a missing local file: ${link.target} -> ${resolved.relativePath}`);
        }
        if (resolved.relativePath.endsWith('.md')) {
            markdownLinks.add(resolved.relativePath);
        }
    }

    const sitemapMatch = llmsText.match(/^Sitemap:\s*(\S+)/mi);
    if (!sitemapMatch) {
        issues.push('llms.txt is missing a Sitemap line.');
    } else {
        const resolved = resolvePublicPathFromHref(sitemapMatch[1], { canonicalOrigin });
        if (resolved.kind === 'local' && !await fileExists(path.join(publicRoot, resolved.relativePath))) {
            issues.push(`llms.txt Sitemap points to a missing local file: ${resolved.relativePath}`);
        }
    }

    return {
        hasLlms: true,
        canonicalOrigin,
        localLinkCount: localLinks.size,
        markdownLinks,
        text: llmsText
    };
}

async function inspectLanguageLlms(publicRoot, rootLlms, issues) {
    const llmsPaths = await collectFiles(
        publicRoot,
        (_absolutePath, name) => name.toLowerCase() === 'llms.txt'
    );
    const languageLlmsFiles = [];
    const markdownLinks = new Set();
    const localLinks = new Set();
    const rootText = `${rootLlms.text ?? ''}`.trim();
    const canonicalOrigin = rootLlms.canonicalOrigin;

    for (const llmsPath of llmsPaths) {
        const relativePath = toPublicRelativePath(publicRoot, llmsPath);
        if (relativePath === 'llms.txt') {
            continue;
        }

        languageLlmsFiles.push(relativePath);
        const llmsText = await fs.readFile(llmsPath, 'utf8');
        const trimmedText = llmsText.trim();
        if (rootText && trimmedText === rootText) {
            issues.push(`Language llms.txt duplicates the root llms.txt exactly: ${relativePath}`);
        }

        const fileCanonicalOrigin = extractCanonicalOrigin(llmsText);
        if (!fileCanonicalOrigin) {
            issues.push(`${relativePath} is missing a parseable Canonical site URL.`);
        } else if (canonicalOrigin && fileCanonicalOrigin !== canonicalOrigin) {
            issues.push(`${relativePath} Canonical site origin differs from root llms.txt: ${fileCanonicalOrigin}`);
        }
        if (!/^## Agent Notes\b/m.test(llmsText)) {
            issues.push(`${relativePath} is missing the Agent Notes section.`);
        }
        if (hasPerPageMirrorList(llmsText)) {
            issues.push(`${relativePath} should not contain per-page Mirrors entries; use language indexes and sitemap hreflang for alternate-language discovery.`);
        }
        if (!/^## Site Entry Points\b/m.test(llmsText)) {
            issues.push(`${relativePath} is missing the Site Entry Points section.`);
        }
        if (!/^## Key Content Pages\b/m.test(llmsText)) {
            issues.push(`${relativePath} is missing the Key Content Pages section.`);
        }

        const fileMarkdownLinks = new Set();
        for (const link of extractMarkdownLinks(llmsText)) {
            const resolved = resolvePublicPathFromHref(link.target, {
                canonicalOrigin,
                currentRelativePath: relativePath
            });
            if (resolved.kind === 'ignored' || resolved.kind === 'external') {
                continue;
            }
            if (resolved.kind === 'invalid') {
                issues.push(`${relativePath} contains an invalid link target: ${link.target}`);
                continue;
            }

            localLinks.add(resolved.relativePath);
            if (!await fileExists(path.join(publicRoot, resolved.relativePath))) {
                issues.push(`${relativePath} points to a missing local file: ${link.target} -> ${resolved.relativePath}`);
            }
            if (resolved.relativePath.endsWith('.md')) {
                markdownLinks.add(resolved.relativePath);
                fileMarkdownLinks.add(resolved.relativePath);
            }
        }

        const sitemapMatch = llmsText.match(/^Sitemap:\s*(\S+)/mi);
        if (!sitemapMatch) {
            issues.push(`${relativePath} is missing a Sitemap line.`);
        } else {
            const resolved = resolvePublicPathFromHref(sitemapMatch[1], {
                canonicalOrigin,
                currentRelativePath: relativePath
            });
            if (resolved.kind === 'local' && !await fileExists(path.join(publicRoot, resolved.relativePath))) {
                issues.push(`${relativePath} Sitemap points to a missing local file: ${resolved.relativePath}`);
            }
        }

        if (fileMarkdownLinks.size === 0) {
            issues.push(`${relativePath} does not link to any Markdown mirrors.`);
        }
    }

    return {
        fileCount: llmsPaths.length,
        languageFileCount: languageLlmsFiles.length,
        languageLlmsFiles: languageLlmsFiles.sort(),
        localLinkCount: localLinks.size,
        markdownLinks
    };
}

async function inspectHtmlAlternates(publicRoot, canonicalOrigin, issues) {
    const htmlPaths = await collectFiles(
        publicRoot,
        (_absolutePath, name) => path.extname(name).toLowerCase() === '.html'
    );
    const alternatesByMarkdownPath = new Map();

    for (const htmlPath of htmlPaths) {
        const htmlRelativePath = toPublicRelativePath(publicRoot, htmlPath);
        const htmlText = await fs.readFile(htmlPath, 'utf8');
        const alternateTargets = extractMarkdownAlternates(htmlText);

        for (const target of alternateTargets) {
            const resolved = resolvePublicPathFromHref(target, {
                canonicalOrigin,
                currentRelativePath: htmlRelativePath
            });
            if (resolved.kind === 'ignored') {
                continue;
            }
            if (resolved.kind === 'external') {
                issues.push(`Markdown alternate on ${htmlRelativePath} points outside the canonical site: ${target}`);
                continue;
            }
            if (resolved.kind === 'invalid') {
                issues.push(`Markdown alternate on ${htmlRelativePath} is invalid: ${target}`);
                continue;
            }
            if (!resolved.relativePath.endsWith('.md')) {
                issues.push(`Markdown alternate on ${htmlRelativePath} does not point to a .md file: ${target}`);
                continue;
            }
            if (!await fileExists(path.join(publicRoot, resolved.relativePath))) {
                issues.push(`Markdown alternate on ${htmlRelativePath} points to a missing file: ${resolved.relativePath}`);
                continue;
            }

            const existing = alternatesByMarkdownPath.get(resolved.relativePath) ?? [];
            existing.push(htmlRelativePath);
            alternatesByMarkdownPath.set(resolved.relativePath, existing);
        }
    }

    return {
        htmlCount: htmlPaths.length,
        alternatesByMarkdownPath
    };
}

async function inspectMarkdownMirror(publicRoot, markdownPath, canonicalOrigin, issues) {
    const markdownAbsolutePath = path.join(publicRoot, markdownPath);
    const markdownText = await fs.readFile(markdownAbsolutePath, 'utf8');

    if (!/^#\s+\S+/m.test(markdownText)) {
        issues.push(`Markdown mirror is missing a top-level title: ${markdownPath}`);
    }
    if (!/^- Canonical:\s+\S+/m.test(markdownText)) {
        issues.push(`Markdown mirror is missing Canonical metadata: ${markdownPath}`);
    }
    if (!/^>\s+\S+/m.test(markdownText)) {
        issues.push(`Advertised Markdown mirror is missing a description blockquote: ${markdownPath}`);
    }
    if (/{{[<%]/.test(markdownText)) {
        issues.push(`Markdown mirror still contains raw Hugo shortcode syntax: ${markdownPath}`);
    }

    for (const link of extractMarkdownLinks(markdownText)) {
        const target = link.target;
        const assetLike = link.isImage || assetLikeExtensionPattern.test(target);
        if (!assetLike || isIgnoredHref(target)) {
            continue;
        }

        if (isRelativeHref(target)) {
            issues.push(`Markdown mirror contains a context-dependent asset reference: ${markdownPath} -> ${target}`);
            continue;
        }

        const resolved = resolvePublicPathFromHref(target, {
            canonicalOrigin,
            currentRelativePath: markdownPath
        });
        if (resolved.kind === 'ignored' || resolved.kind === 'external') {
            continue;
        }
        if (resolved.kind === 'invalid') {
            issues.push(`Markdown mirror contains an invalid asset reference: ${markdownPath} -> ${target}`);
            continue;
        }
        if (!await fileExists(path.join(publicRoot, resolved.relativePath))) {
            issues.push(`Markdown mirror points to a missing local asset: ${markdownPath} -> ${target} -> ${resolved.relativePath}`);
        }
    }
}

async function main() {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const publicRoot = path.resolve(siteRoot, options.publicDir);
    await fs.access(publicRoot);

    const issues = [];
    const sourceOutputs = await inspectSourceOutputSettings(issues);
    const robots = await inspectRobots(publicRoot, issues);
    const markdownHeaderPolicy = await inspectMarkdownMirrorHeaderPolicy(publicRoot, issues);
    const llms = await inspectLlms(publicRoot, issues);
    const languageLlms = await inspectLanguageLlms(publicRoot, llms, issues);
    const htmlAlternates = await inspectHtmlAlternates(publicRoot, llms.canonicalOrigin, issues);
    const markdownPaths = await collectFiles(
        publicRoot,
        (_absolutePath, name) => name.toLowerCase() === 'index.md'
    );
    const allMarkdownMirrors = markdownPaths
        .map((markdownPath) => toPublicRelativePath(publicRoot, markdownPath))
        .sort();
    const llmsMarkdownLinks = new Set([
        ...llms.markdownLinks,
        ...languageLlms.markdownLinks
    ]);
    if (llmsMarkdownLinks.size === 0) {
        issues.push('No llms.txt file links to any Markdown mirrors.');
    }
    const advertisedMarkdownPaths = new Set([
        ...llmsMarkdownLinks,
        ...htmlAlternates.alternatesByMarkdownPath.keys()
    ]);

    for (const markdownPath of llmsMarkdownLinks) {
        const htmlPath = markdownPathToHtmlPath(markdownPath);
        if (!htmlPath) {
            issues.push(`llms.txt Markdown mirror does not use the expected index.md shape: ${markdownPath}`);
            continue;
        }
        const exposingHtmlPaths = htmlAlternates.alternatesByMarkdownPath.get(markdownPath) ?? [];
        if (!exposingHtmlPaths.includes(htmlPath)) {
            issues.push(`HTML page does not advertise its llms.txt Markdown mirror: ${htmlPath} -> ${markdownPath}`);
        }
    }

    for (const [markdownPath, exposingHtmlPaths] of htmlAlternates.alternatesByMarkdownPath) {
        if (!llmsMarkdownLinks.has(markdownPath)) {
            issues.push(`HTML page advertises a Markdown mirror that is not listed in any llms.txt file: ${exposingHtmlPaths[0]} -> ${markdownPath}`);
        }
    }

    for (const markdownPath of advertisedMarkdownPaths) {
        await inspectMarkdownMirror(publicRoot, markdownPath, llms.canonicalOrigin, issues);
    }

    const orphanMarkdownMirrors = allMarkdownMirrors.filter((markdownPath) => !advertisedMarkdownPaths.has(markdownPath));

    console.log('Agent readiness audit');
    console.log(`Root\t${publicRoot}`);
    console.log(`Mode\t${options.check ? 'report + check' : 'report only'}`);
    console.log(`robots.txt\t${robots.hasRobots ? 'yes' : 'no'}`);
    console.log(`robots user-agent blocks\t${robots.userAgentCount}`);
    console.log(`Markdown noindex route (_headers)\t${markdownHeaderPolicy.generatedHeadersRoute ? 'yes' : 'no'}`);
    console.log(`Markdown noindex route (edgeone.json)\t${markdownHeaderPolicy.edgeoneRoute ? 'yes' : 'no'}`);
    console.log(`content Markdown files\t${sourceOutputs.contentFiles}`);
    console.log(`AGENT_MARKDOWN opt-ins\t${sourceOutputs.agentMarkdownOptIns}`);
    console.log(`MARKDOWN-only opt-ins\t${sourceOutputs.markdownOnlyOptIns}`);
    console.log(`share_image configured\t${sourceOutputs.shareImageConfigured}`);
    console.log(`share_image inherited\t${sourceOutputs.shareImageInherited}`);
    console.log(`share_image disabled\t${sourceOutputs.shareImageDisabled}`);
    console.log(`llms.txt\t${llms.hasLlms ? 'yes' : 'no'}`);
    console.log(`llms.txt files\t${languageLlms.fileCount}`);
    console.log(`language llms.txt files\t${languageLlms.languageFileCount}`);
    if (languageLlms.languageLlmsFiles.length > 0) {
        console.log(`language llms.txt paths\t${languageLlms.languageLlmsFiles.join(', ')}`);
    }
    console.log(`Canonical origin\t${llms.canonicalOrigin || '<missing>'}`);
    console.log(`llms local links\t${llms.localLinkCount}`);
    console.log(`llms Markdown links\t${llms.markdownLinks.size}`);
    console.log(`all llms Markdown links\t${llmsMarkdownLinks.size}`);
    console.log(`HTML files\t${htmlAlternates.htmlCount}`);
    console.log(`Markdown mirrors\t${allMarkdownMirrors.length}`);
    console.log(`Advertised Markdown mirrors\t${advertisedMarkdownPaths.size}`);
    console.log(`Non-advertised Markdown mirrors\t${orphanMarkdownMirrors.length}`);
    if (orphanMarkdownMirrors.length > 0) {
        console.log(`Non-advertised sample\t${orphanMarkdownMirrors.slice(0, 8).join(', ')}`);
    }

    if (issues.length > 0) {
        console.log('\nAgent readiness issues');
        for (const issue of issues) {
            console.log(`- ${issue}`);
        }
        if (options.check) {
            process.exit(1);
        }
        return;
    }

    console.log('\nAgent readiness audit passed.');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
