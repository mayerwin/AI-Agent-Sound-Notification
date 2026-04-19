/**
 * Generate the built-in WAV sound library.
 *
 * One-shot script — run with `node scripts/generate-sounds.js` to produce
 * resources/sounds/*.wav. The output WAVs are 16-bit PCM, 44.1 kHz, mono.
 *
 * Each sound uses additive synthesis with smooth envelopes designed to feel
 * pleasant, distinct, and inspiring rather than harsh.
 */
const fs = require('fs');
const path = require('path');

const SR = 44100;
const OUT_DIR = path.join(__dirname, '..', 'resources', 'sounds');

// ----- Helpers -----------------------------------------------------------

function makeBuffer(durationSec) {
    return new Float32Array(Math.round(durationSec * SR));
}

function addPartial(buf, startSec, freq, amp, decaySec, harmonics = [1]) {
    const start = Math.round(startSec * SR);
    const len = Math.round(decaySec * SR);
    for (let i = 0; i < len; i++) {
        const t = i / SR;
        const env = Math.exp(-t / (decaySec * 0.4));
        let s = 0;
        for (let h = 0; h < harmonics.length; h++) {
            const harmAmp = harmonics[h];
            s += harmAmp * Math.sin(2 * Math.PI * freq * (h + 1) * t);
        }
        const idx = start + i;
        if (idx >= 0 && idx < buf.length) buf[idx] += amp * env * s;
    }
}

function addSine(buf, startSec, freq, amp, durSec, attackSec = 0.01, releaseSec = 0.1) {
    const start = Math.round(startSec * SR);
    const len = Math.round(durSec * SR);
    const attackSamples = Math.round(attackSec * SR);
    const releaseSamples = Math.round(releaseSec * SR);
    for (let i = 0; i < len; i++) {
        const t = i / SR;
        let env = 1;
        if (i < attackSamples) env = i / attackSamples;
        else if (i > len - releaseSamples) env = Math.max(0, (len - i) / releaseSamples);
        const idx = start + i;
        if (idx >= 0 && idx < buf.length) {
            buf[idx] += amp * env * Math.sin(2 * Math.PI * freq * t);
        }
    }
}

function addBell(buf, startSec, freq, amp, decaySec) {
    // Bell-like inharmonic partials (struck-bar / tubular bell ratios).
    const partials = [
        { ratio: 1.0,  amp: 1.0,  decay: 1.0  },
        { ratio: 2.0,  amp: 0.6,  decay: 0.7  },
        { ratio: 3.01, amp: 0.4,  decay: 0.55 },
        { ratio: 4.2,  amp: 0.25, decay: 0.4  },
        { ratio: 5.43, amp: 0.15, decay: 0.3  },
        { ratio: 6.8,  amp: 0.1,  decay: 0.22 },
    ];
    for (const p of partials) {
        const dur = decaySec * p.decay;
        const len = Math.round(dur * SR);
        const start = Math.round(startSec * SR);
        const f = freq * p.ratio;
        for (let i = 0; i < len; i++) {
            const t = i / SR;
            const env = Math.exp(-3 * t / dur);
            const idx = start + i;
            if (idx >= 0 && idx < buf.length) {
                buf[idx] += amp * p.amp * env * Math.sin(2 * Math.PI * f * t);
            }
        }
    }
}

function addPluck(buf, startSec, freq, amp, decaySec) {
    // Karplus-Strong-ish: damped sine with a touch of harmonic.
    const start = Math.round(startSec * SR);
    const len = Math.round(decaySec * SR);
    for (let i = 0; i < len; i++) {
        const t = i / SR;
        const env = Math.exp(-3.5 * t / decaySec);
        const s =
            Math.sin(2 * Math.PI * freq * t) +
            0.35 * Math.sin(2 * Math.PI * freq * 2 * t) +
            0.12 * Math.sin(2 * Math.PI * freq * 3 * t);
        const idx = start + i;
        if (idx >= 0 && idx < buf.length) buf[idx] += amp * env * s;
    }
}

function addSingingBowl(buf, startSec, freq, amp, decaySec) {
    // Slowly-attacked, very long decay, gentle vibrato.
    const start = Math.round(startSec * SR);
    const len = Math.round(decaySec * SR);
    const attack = Math.round(0.25 * SR);
    for (let i = 0; i < len; i++) {
        const t = i / SR;
        let env = Math.exp(-1.5 * t / decaySec);
        if (i < attack) env *= i / attack;
        const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5 * t);
        const s =
            Math.sin(2 * Math.PI * freq * vib * t) +
            0.5  * Math.sin(2 * Math.PI * freq * 2.01 * vib * t) +
            0.25 * Math.sin(2 * Math.PI * freq * 3.04 * vib * t);
        const idx = start + i;
        if (idx >= 0 && idx < buf.length) buf[idx] += amp * env * s;
    }
}

function normalize(buf, peak = 0.85) {
    let max = 0;
    for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        if (a > max) max = a;
    }
    if (max === 0) return;
    const scale = peak / max;
    for (let i = 0; i < buf.length; i++) buf[i] *= scale;
}

function writeWav(buf, filename) {
    const numSamples = buf.length;
    const dataSize = numSamples * 2;
    const out = Buffer.alloc(44 + dataSize);

    out.write('RIFF', 0);
    out.writeUInt32LE(36 + dataSize, 4);
    out.write('WAVE', 8);
    out.write('fmt ', 12);
    out.writeUInt32LE(16, 16);          // PCM chunk size
    out.writeUInt16LE(1, 20);           // PCM format
    out.writeUInt16LE(1, 22);           // mono
    out.writeUInt32LE(SR, 24);
    out.writeUInt32LE(SR * 2, 28);      // byte rate
    out.writeUInt16LE(2, 32);           // block align
    out.writeUInt16LE(16, 34);          // bits per sample
    out.write('data', 36);
    out.writeUInt32LE(dataSize, 40);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, buf[i]));
        out.writeInt16LE(Math.round(s * 32767), offset);
        offset += 2;
    }

    fs.writeFileSync(path.join(OUT_DIR, filename), out);
    console.log(`wrote ${filename} (${(buf.length / SR).toFixed(2)}s)`);
}

// ----- Note frequencies (equal temperament, A4 = 440 Hz) -----------------

function note(name) {
    // e.g. "C4", "F#5", "Bb3"
    const semitones = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
    const m = name.match(/^([A-G])([#b]?)(-?\d)$/);
    if (!m) throw new Error(`bad note: ${name}`);
    let n = semitones[m[1]];
    if (m[2] === '#') n += 1;
    else if (m[2] === 'b') n -= 1;
    const octave = parseInt(m[3], 10);
    const midi = 12 * (octave + 1) + n;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// ----- Sound designs -----------------------------------------------------

function chime() {
    // Gentle ascending major triad: C5 → E5 → G5
    const buf = makeBuffer(1.4);
    addBell(buf, 0.00, note('C5'), 0.55, 1.2);
    addBell(buf, 0.18, note('E5'), 0.55, 1.1);
    addBell(buf, 0.36, note('G5'), 0.55, 1.0);
    normalize(buf, 0.88);
    writeWav(buf, 'chime.wav');
}

function bell() {
    // Single rich bell strike: A4 fundamental, lush decay.
    const buf = makeBuffer(2.2);
    addBell(buf, 0.00, note('A4'), 0.9, 2.0);
    addBell(buf, 0.00, note('A5'), 0.25, 1.4);
    normalize(buf, 0.9);
    writeWav(buf, 'bell.wav');
}

function ding() {
    // Bright, short single ding — bell + crisp sine top.
    const buf = makeBuffer(1.0);
    addBell(buf, 0.00, note('E5'), 0.7, 0.9);
    addSine(buf, 0.00, note('E6'), 0.18, 0.35, 0.005, 0.3);
    normalize(buf, 0.9);
    writeWav(buf, 'ding.wav');
}

function harp() {
    // Quick C-major arpeggio (C4-E4-G4-C5-E5) — harp-like pluck.
    const buf = makeBuffer(1.6);
    const notes = ['C4', 'E4', 'G4', 'C5', 'E5'];
    notes.forEach((n, i) => addPluck(buf, i * 0.09, note(n), 0.6, 1.2));
    normalize(buf, 0.9);
    writeWav(buf, 'harp.wav');
}

function fanfare() {
    // Triumphant brass-style: G4-C5-E5-G5 with sustained final note.
    const buf = makeBuffer(1.8);
    const events = [
        { t: 0.00, n: 'G4', d: 0.18 },
        { t: 0.18, n: 'C5', d: 0.18 },
        { t: 0.36, n: 'E5', d: 0.18 },
        { t: 0.54, n: 'G5', d: 1.10 },
    ];
    for (const e of events) {
        const f = note(e.n);
        addSine(buf, e.t, f,         0.45, e.d, 0.015, 0.07);
        addSine(buf, e.t, f * 2,     0.18, e.d, 0.015, 0.07);
        addSine(buf, e.t, f * 3,     0.07, e.d, 0.015, 0.07);
    }
    normalize(buf, 0.88);
    writeWav(buf, 'fanfare.wav');
}

function success() {
    // "Level up" — ascending pentatonic C-D-E-G-A.
    const buf = makeBuffer(1.4);
    const notes = ['C5', 'D5', 'E5', 'G5', 'A5'];
    notes.forEach((n, i) => addPluck(buf, i * 0.07, note(n), 0.55, 0.9));
    // Sparkle on top
    addSine(buf, 0.34, note('C6'), 0.18, 0.6, 0.005, 0.3);
    normalize(buf, 0.9);
    writeWav(buf, 'success.wav');
}

function gentle() {
    // Soft sine pad — two notes a fifth apart, slow attack & release.
    const buf = makeBuffer(2.2);
    addSine(buf, 0.00, note('A4'),  0.42, 1.9, 0.25, 0.6);
    addSine(buf, 0.10, note('E5'),  0.32, 1.8, 0.30, 0.6);
    addSine(buf, 0.20, note('A5'),  0.16, 1.6, 0.30, 0.6);
    normalize(buf, 0.78);
    writeWav(buf, 'gentle.wav');
}

function zen() {
    // Singing-bowl style — long, meditative.
    const buf = makeBuffer(3.5);
    addSingingBowl(buf, 0.00, note('F4'), 0.9, 3.4);
    normalize(buf, 0.85);
    writeWav(buf, 'zen.wav');
}

function arpeggio() {
    // Fast bell arpeggio cascade — D major (D-F#-A-D).
    const buf = makeBuffer(1.6);
    const notes = ['D4', 'F#4', 'A4', 'D5', 'F#5', 'A5'];
    notes.forEach((n, i) => addBell(buf, i * 0.055, note(n), 0.45, 1.0));
    normalize(buf, 0.9);
    writeWav(buf, 'arpeggio.wav');
}

function alert() {
    // Replacement for the legacy alert.wav — clear, attention-grabbing
    // two-tone notification (high → low → high).
    const buf = makeBuffer(0.95);
    addSine(buf, 0.00, note('E5'), 0.55, 0.18, 0.005, 0.04);
    addSine(buf, 0.22, note('C5'), 0.55, 0.18, 0.005, 0.04);
    addSine(buf, 0.44, note('E5'), 0.55, 0.45, 0.005, 0.20);
    addSine(buf, 0.44, note('G5'), 0.30, 0.45, 0.010, 0.20);
    normalize(buf, 0.9);
    writeWav(buf, 'alert.wav');
}

// ----- Run ---------------------------------------------------------------

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

alert();
chime();
bell();
ding();
harp();
fanfare();
success();
gentle();
zen();
arpeggio();

console.log('Done.');
