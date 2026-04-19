/**
 * Transcript Watcher
 *
 * Tails a Claude Code session transcript (JSONL) for signals that the turn
 * has ended without firing a Stop / PostToolUse hook — specifically, user
 * rejection of a permission prompt. Claude Code does not expose a hook for
 * that case (confirmed in https://code.claude.com/docs/en/hooks), so we fall
 * back to reading the transcript directly.
 *
 * We only start watching after a PermissionRequest fires, and stop as soon
 * as any dismissal path runs. Polling-based (250 ms) because fs.watch is
 * unreliable on Windows network/Dropbox paths.
 */
import * as fs from 'fs';
import { info, debug } from '../utils/logger';

const PREFIX = '[TranscriptWatcher]';
const logInfo  = (msg: string) => info(`${PREFIX} ${msg}`);
const logDebug = (msg: string) => debug(`${PREFIX} ${msg}`);

const POLL_MS = 250;
const DENIAL_MARKER = "doesn't want to proceed";

export class TranscriptWatcher {
    private timer: ReturnType<typeof setInterval> | null = null;
    private offset = 0;
    private carry = '';
    private stopped = false;

    constructor(
        private readonly filePath: string,
        private readonly onTurnEnd: (reason: string) => void,
    ) {}

    start(): void {
        if (this.timer) return;

        // Seed the offset at current file size so we only react to future appends.
        try {
            const stat = fs.statSync(this.filePath);
            this.offset = stat.size;
            logDebug(`watching ${this.filePath} from offset ${this.offset}`);
        } catch (err: any) {
            logDebug(`transcript not yet readable (${err?.code || err?.message || err}) — starting from 0`);
            this.offset = 0;
        }

        this.timer = setInterval(() => this.poll(), POLL_MS);
    }

    stop(): void {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private poll(): void {
        if (this.stopped) return;

        let stat: fs.Stats;
        try {
            stat = fs.statSync(this.filePath);
        } catch {
            // File may not exist yet (session just starting) — keep polling.
            return;
        }

        if (stat.size < this.offset) {
            // File was truncated/rotated. Reset.
            this.offset = 0;
            this.carry = '';
            return;
        }
        if (stat.size === this.offset) return;

        let chunk: Buffer;
        try {
            const fd = fs.openSync(this.filePath, 'r');
            try {
                const len = stat.size - this.offset;
                chunk = Buffer.alloc(len);
                fs.readSync(fd, chunk, 0, len, this.offset);
            } finally {
                fs.closeSync(fd);
            }
        } catch (err: any) {
            logDebug(`read failed: ${err?.message || err}`);
            return;
        }

        this.offset = stat.size;
        const text = this.carry + chunk.toString('utf-8');
        const lines = text.split('\n');
        this.carry = lines.pop() ?? '';

        for (const line of lines) {
            if (!line) continue;
            if (this.detectDenial(line)) {
                logInfo(`denial detected in transcript — firing turn-end`);
                this.stop();
                this.onTurnEnd('permission denied by user');
                return;
            }
        }
    }

    /**
     * Detect a tool_result entry indicating the user rejected a tool call.
     * Claude Code writes:
     *   {"type":"user","message":{"role":"user","content":[
     *     {"type":"tool_result","tool_use_id":"...",
     *      "content":"The user doesn't want to proceed with this tool use...",
     *      "is_error":true}]}}
     *
     * We match on the substring, but only inside a parsed tool_result — raw
     * substring match on the whole line would false-positive on narrative text
     * that happens to quote the denial message.
     */
    private detectDenial(line: string): boolean {
        let parsed: any;
        try {
            parsed = JSON.parse(line);
        } catch {
            return false;
        }

        const content = parsed?.message?.content;
        if (!Array.isArray(content)) return false;

        for (const item of content) {
            if (item?.type !== 'tool_result') continue;
            const c = item.content;
            const asText =
                typeof c === 'string'
                    ? c
                    : Array.isArray(c)
                        ? c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n')
                        : '';
            if (asText.includes(DENIAL_MARKER)) return true;
        }
        return false;
    }
}
