import type { SeedanceMediaInput } from '../services/videoModelService';

// A client hint only. Submission probes original bytes on the server again.
export function seedanceAudioError(media: SeedanceMediaInput[], policy: 'preserve' | 'trim_to_15' = 'preserve'): string | null {
    const audio = media.filter(item => item.kind === 'audio');
    if (audio.length > 3) return '最多使用 3 段参考配音，合计不超过 15 秒。';
    const known = audio.map(item => item.duration_seconds).filter(
        (duration): duration is number => typeof duration === 'number' && Number.isFinite(duration) && duration > 0,
    );
    const total = known.reduce((sum, duration) => sum + duration, 0);
    if (known.some(duration => duration < 2)) return '每段参考配音至少需要 2 秒，请更换过短片段；不会自动补齐或变速。';
    if (policy !== 'trim_to_15' && (known.some(duration => duration > 15) || total > 15)) {
        return `参考配音已知时长合计 ${total.toFixed(3)} 秒；每段需为 2–15 秒，合计不超过 15 秒。可勾选“仅裁剪参考副本至 15 秒内”，原始完整配音不变。`;
    }
    return null;
}

export function seedanceAudioBudget(durations: number[]): number[] | null {
    if (!durations.length || durations.length > 3 || durations.some(d => !Number.isFinite(d) || d < 2)) return null;
    if (durations.reduce((sum, d) => sum + d, 0) <= 15) return [...durations];
    let remaining = 15;
    let pending = durations.map((_, index) => index);
    const result = durations.map(() => 0);
    while (pending.length) {
        const weight = pending.reduce((sum, i) => sum + durations[i], 0);
        const short = pending.filter(i => remaining * durations[i] / weight < 2);
        if (!short.length) {
            pending.forEach(i => { result[i] = Math.floor(remaining * durations[i] / weight * 1000) / 1000; });
            break;
        }
        short.forEach(i => { result[i] = 2; remaining -= 2; });
        pending = pending.filter(i => !short.includes(i));
    }
    return result;
}

export function audioDurationLabel(duration?: number): string {
    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? `${duration.toFixed(3)} 秒` : '时长待服务器校验';
}

export function probeUploadedAudioDuration(file: File): Promise<number | undefined> {
    return new Promise(resolve => {
        const element = document.createElement('audio');
        const url = URL.createObjectURL(file);
        const done = (duration?: number) => {
            clearTimeout(timer);
            element.onloadedmetadata = null;
            element.onerror = null;
            element.removeAttribute('src');
            URL.revokeObjectURL(url);
            resolve(duration);
        };
        const timer = setTimeout(() => done(), 5000);
        element.onloadedmetadata = () => done(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined);
        element.onerror = () => done();
        element.preload = 'metadata';
        element.src = url;
    });
}
