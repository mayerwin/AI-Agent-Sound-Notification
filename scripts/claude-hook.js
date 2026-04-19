/**
 * Claude Code Hook Script
 *
 * Called by Claude Code when a permission is requested (or on Stop / UserPromptSubmit
 * to dismiss). Pings every active AI Agent Sound Notification server it can find.
 *
 * Usage: node claude-hook.js [--dismiss]
 *
 * Each port file under %APPDATA%/ai-agent-sound-notification/ is JSON:
 *   { "port": 12345, "token": "...", "pid": 9999 }
 *
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

function pingPort({ port, token }) {
    return new Promise((resolve) => {
        const url = `http://127.0.0.1:${port}${endpointPath}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
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

    await Promise.all(targets.map(pingPort));
    process.exit(0);
}

main().catch(() => process.exit(0));
