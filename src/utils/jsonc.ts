/**
 * Tolerant JSON-with-comments parser and atomic file writer.
 *
 * Used for reading/writing ~/.claude/settings.json, where users sometimes hand-edit
 * with comments and trailing commas, and where two windows starting concurrently
 * could otherwise race-write a corrupted file.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Strip BOM, line/block comments, and trailing commas from a JSON-with-comments
 * string while preserving the contents of string literals.
 *
 * Implemented as a minimal state machine — does not pretend to be a full JSONC
 * parser, but is correct for `//`/`/* * /` comments and trailing commas in
 * objects/arrays without mangling text inside `"..."`.
 */
export function stripJsonc(input: string): string {
    let s = input.replace(/^\uFEFF/, '');

    let out = '';
    let i = 0;
    const n = s.length;

    let inString = false;
    let stringQuote = '';
    let escape = false;

    while (i < n) {
        const ch = s[i];
        const next = i + 1 < n ? s[i + 1] : '';

        if (inString) {
            out += ch;
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === stringQuote) {
                inString = false;
            }
            i++;
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringQuote = ch;
            out += ch;
            i++;
            continue;
        }

        if (ch === '/' && next === '/') {
            // Line comment — skip to end of line (keep the newline)
            i += 2;
            while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            // Block comment — skip until matching */
            i += 2;
            while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
            if (i < n) i += 2;
            continue;
        }

        out += ch;
        i++;
    }

    // Strip trailing commas: ",]" or ",}" possibly with whitespace between.
    // Done after comments are removed, on the comment-free string.
    out = out.replace(/,(\s*[\]}])/g, '$1');
    return out;
}

/**
 * Parse a JSON-with-comments string. Returns `{}` for empty/whitespace input.
 * Throws on invalid JSON after stripping comments and trailing commas.
 */
export function parseJsonc<T = unknown>(raw: string): T {
    const cleaned = stripJsonc(raw);
    if (!cleaned.trim()) return {} as T;
    return JSON.parse(cleaned) as T;
}

/**
 * Atomically write JSON to a file: write to a sibling temp path, then rename.
 * Rename is atomic on POSIX and (within the same volume) on Windows since Vista.
 *
 * The temp file uses the current PID to keep concurrent writers from clobbering
 * each other's temp files. If renaming fails, the temp file is removed.
 */
export function atomicWriteJsonFile(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
    const payload = JSON.stringify(data, null, 2);

    try {
        fs.writeFileSync(tmp, payload, 'utf-8');
        fs.renameSync(tmp, filePath);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw err;
    }
}
