function fail(id, message) {
    throw new Error(`Resource ${id} ${message}`);
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    }
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${bytes} B`;
}

function parseSizeLimit(value, id, spec) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i);
    if (!match) {
        fail(id, `uses invalid size validator ${spec}. Use values such as 32KiB or 1MB.`);
    }

    const amount = Number.parseFloat(match[1]);
    const unit = (match[2] || 'b').toLowerCase();
    const multipliers = {
        b: 1,
        kb: 1000,
        kib: 1024,
        mb: 1000 ** 2,
        mib: 1024 ** 2,
        gb: 1000 ** 3,
        gib: 1024 ** 3
    };

    return Math.floor(amount * multipliers[unit]);
}

function readJson(ctx) {
    if (ctx.jsonParsed) {
        return ctx.jsonValue;
    }

    const text = ctx.bytes.toString('utf8').replace(/^\uFEFF/, '');
    if (!text.trim()) {
        fail(ctx.id, 'is empty.');
    }

    try {
        ctx.jsonValue = JSON.parse(text);
        ctx.jsonParsed = true;
        return ctx.jsonValue;
    } catch (error) {
        fail(ctx.id, `is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function hasJsonPath(value, pathSpec) {
    if (!pathSpec) {
        return true;
    }

    let current = value;
    for (const segment of pathSpec.split('.').filter(Boolean)) {
        if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
            return false;
        }
        current = current[segment];
    }

    return true;
}

function validateJsonPath(ctx, pathSpec, spec) {
    const parsed = readJson(ctx);
    if (!hasJsonPath(parsed, pathSpec)) {
        fail(ctx.id, `is missing JSON path ${pathSpec || '<root>'} required by ${spec}.`);
    }

    return pathSpec ? `json path ${pathSpec} present` : 'valid JSON';
}

function validateMaxSize(ctx, limitSpec, spec) {
    const limit = parseSizeLimit(limitSpec, ctx.id, spec);
    if (ctx.bytes.length > limit) {
        fail(ctx.id, `is ${formatBytes(ctx.bytes.length)}, exceeding ${limitSpec} required by ${spec}.`);
    }

    return `size ${formatBytes(ctx.bytes.length)} <= ${limitSpec}`;
}

function validateMinSize(ctx, limitSpec, spec) {
    const limit = parseSizeLimit(limitSpec, ctx.id, spec);
    if (ctx.bytes.length < limit) {
        fail(ctx.id, `is ${formatBytes(ctx.bytes.length)}, below ${limitSpec} required by ${spec}.`);
    }

    return `size ${formatBytes(ctx.bytes.length)} >= ${limitSpec}`;
}

function runValidator(ctx, spec) {
    if (typeof spec !== 'string' || !spec.trim()) {
        fail(ctx.id, 'has an empty validator entry.');
    }

    const normalized = spec.trim();
    if (normalized === 'json') {
        return validateJsonPath(ctx, '', normalized);
    }
    if (normalized.startsWith('json:')) {
        return validateJsonPath(ctx, normalized.slice('json:'.length), normalized);
    }
    if (normalized.startsWith('json.')) {
        return validateJsonPath(ctx, normalized.slice('json.'.length), normalized);
    }
    if (normalized.startsWith('max-size:')) {
        return validateMaxSize(ctx, normalized.slice('max-size:'.length), normalized);
    }
    if (normalized.startsWith('min-size:')) {
        return validateMinSize(ctx, normalized.slice('min-size:'.length), normalized);
    }

    fail(ctx.id, `uses unsupported validator: ${normalized}`);
}

function normalizeValidators(entry) {
    if (Object.hasOwn(entry, 'validator')) {
        fail(entry.id, 'uses deprecated "validator"; use "validators" instead.');
    }

    const validators = entry.validators;
    if (validators === undefined || validators === null) {
        return [];
    }
    if (!Array.isArray(validators)) {
        fail(entry.id, 'validators must be a list.');
    }

    return validators;
}

export function validateResource(bytes, entry) {
    if (bytes.length === 0) {
        fail(entry.id, 'is empty.');
    }

    const ctx = {
        bytes,
        id: entry.id,
        jsonParsed: false,
        jsonValue: undefined
    };
    const summaries = normalizeValidators(entry).map((spec) => runValidator(ctx, spec));

    if (summaries.length === 0) {
        return `${formatBytes(bytes.length)}`;
    }

    return summaries.join('; ');
}
