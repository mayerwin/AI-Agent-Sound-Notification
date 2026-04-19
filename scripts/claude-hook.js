/**
 * Claude Code Hook Script
 *
 * Called by Claude Code on PermissionRequest / Stop / UserPromptSubmit / PostToolUse.
 * Pings every active AI Agent Sound Notification server it can find.
 *
 * Usage: node claude-hook.js [--completed | --dismiss | --tooldone]
 *
 * Claude Code pipes a JSON payload on stdin. For /alert we forward the
 * session's transcript_path so the extension can tail it for user-denial
 * events (no hook fires on manual permission rejection — see docs).
 *
 * Each port file under %APPDATA%/ai-agent-sound-notification/ is JSON:
 *   { "port": 12345, "token": "...", "pid": 9999 }
 * Older installs may have written plain numeric ports — handled for compatibility.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT_FILE_PREFIX = 'port-';
const endpointPath = process.argv.includes('--completed')
    ? '/completed'
    : process.argv.includes('--dismiss')
        ? '/dismiss'
        : process.argv.includes('--tooldone')
            ? '/tooldone'
            : '/alert';

function getPortDir() {
    const appData =
        process.env.APPDATA ||
        process.env.LOCALAPPDATA ||
        path.join(os.homedir(), '.config');
    return path.join(appData, 'ai-agent-sound-notification');
}

function readStdinSync() {
    // Claude Code pipes a JSON payload on stdin to every hook.
    // fs.readFileSync(0) reads from fd 0 (stdin) synchronously; returns ''
    // if there's nothing to read (e.g., when invoked manually).
    try {
        return fs.readFileSync(0, 'utf-8');
    } catch {
        return '';
    }
}

function parseHookPayload() {
    const raw = readStdinSync();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function readPortFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8').trim();
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.port === 'number') {
                return { port: parsed.port, token: parsed.token || '' };
            }
        } catch {
            // Legacy format: bare numeric port
            const port = parseInt(raw, 10);
            if (!isNaN(port)) return { port, token: '' };
        }
    } catch { /* file vanished or unreadable */ }
    return null;
}

function pingPort({ port, token }, extraQuery) {
    return new Promise((resolve) => {
        const parts = [];
        if (token) parts.push(`token=${encodeURIComponent(token)}`);
        for (const [k, v] of Object.entries(extraQuery || {})) {
            if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
        }
        const qs = parts.length ? `?${parts.join('&')}` : '';
        const url = `http://127.0.0.1:${port}${endpointPath}${qs}`;
        const opts = {
            timeout: 2000,
            headers: token ? { 'x-aians-token': token } : {},
        };
        const req = http.get(url, opts, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
        });
        req.on('error', () => resolve());
        req.on('timeout', () => { req.destroy(); resolve(); });
    });
}

async function main() {
    const portDir = getPortDir();
    if (!fs.existsSync(portDir)) process.exit(0);

    let files = [];
    try {
        files = fs.readdirSync(portDir);
    } catch {
        process.exit(0);
    }

    const targets = [];
    for (const file of files) {
        if (!file.startsWith(PORT_FILE_PREFIX)) continue;
        const target = readPortFile(path.join(portDir, file));
        if (target) targets.push(target);
    }

    if (targets.length === 0) process.exit(0);

    // For /alert specifically, forward the transcript path so the extension
    // can detect user rejections (which fire no hook).
    const extraQuery = {};
    if (endpointPath === '/alert') {
        const payload = parseHookPayload();
        if (payload && typeof payload.transcript_path === 'string') {
            extraQuery.transcriptPath = payload.transcript_path;
        }
    }

    await Promise.all(targets.map((t) => pingPort(t, extraQuery)));
    process.exit(0);
}

main().catch(() => process.exit(0));
