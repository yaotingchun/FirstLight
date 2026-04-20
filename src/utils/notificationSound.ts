type NotificationKind = 'survivor' | 'event';

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;

const MIN_PLAY_INTERVAL_MS = 180;

const getAudioContext = (): AudioContext | null => {
    if (typeof window === 'undefined') return null;

    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!audioContext) {
        audioContext = new AudioCtx();
    }

    return audioContext;
};

const scheduleTone = (ctx: AudioContext, startAt: number, frequency: number, duration: number, gainAmount: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainAmount, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
};

export const playDuoNotificationTone = async (kind: NotificationKind = 'event') => {
    const now = Date.now();
    if (now - lastPlayedAt < MIN_PLAY_INTERVAL_MS) {
        return;
    }

    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch {
            return;
        }
    }

    const baseTime = ctx.currentTime + 0.01;
    const firstFrequency = kind === 'survivor' ? 640 : 560;
    const secondFrequency = kind === 'survivor' ? 760 : 680;

    scheduleTone(ctx, baseTime, firstFrequency, 0.11, 0.16);
    scheduleTone(ctx, baseTime + 0.14, secondFrequency, 0.12, 0.15);

    lastPlayedAt = now;
};
