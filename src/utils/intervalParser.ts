/**
 * Parses human-readable interval strings like "30s", "5m", "1h", "3h" into milliseconds.
 */

const UNITS: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
};

/**
 * Parse a single interval string into milliseconds.
 * Supports: "30s", "1m", "5m", "1h", "3h"
 * Also supports compound: "1m30s" => 90000ms
 * 
 * Enforces a minimum of 1 second to prevent high-frequency sound spam.
 */
export function parseInterval(input: string): number {
    const trimmed = input.trim().toLowerCase();

    // Try compound format: "1m30s", "2h15m"
    const parts = trimmed.match(/(\d+)\s*([smh])/g);
    let totalMs = 0;

    if (!parts || parts.length === 0) {
        // Try as plain number (assume seconds)
        const num = parseInt(trimmed, 10);
        if (!isNaN(num)) {
            totalMs = num * 1000;
        } else {
            throw new Error(`Invalid interval format: "${input}". Use formats like "30s", "5m", "1h".`);
        }
    } else {
        for (const part of parts) {
            const match = part.match(/^(\d+)\s*([smh])$/);
            if (match) {
                const value = parseInt(match[1], 10);
                const unit = match[2];
                totalMs += value * UNITS[unit];
            }
        }
    }

    // Enforce minimum 1s to prevent accidental infinite loops or sound spam
    return Math.max(1000, totalMs);
}

/**
 * Parse an array of interval strings into an array of milliseconds.
 */
export function parseIntervals(inputs: string[]): number[] {
    return (inputs || []).map(parseInterval);
}

/**
 * Format milliseconds back to a human-readable string for display.
 */
export function formatInterval(ms: number): string {
    if (ms < 1000) return "0s";
    
    if (ms < 60_000) {
        return `${Math.round(ms / 1000)}s`;
    }
    if (ms < 3_600_000) {
        const mins = Math.floor(ms / 60_000);
        const secs = Math.round((ms % 60_000) / 1000);
        return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
    }
    const hours = Math.floor(ms / 3_600_000);
    const mins = Math.round((ms % 3_600_000) / 60_000);
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}
