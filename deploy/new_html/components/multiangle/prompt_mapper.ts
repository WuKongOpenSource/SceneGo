





export const AZIMUTH_SNAPS = [
    { angle: 0, text: 'front view' },
    { angle: 45, text: 'front-right quarter view' },
    { angle: 90, text: 'right side view' },
    { angle: 135, text: 'back-right quarter view' },
    { angle: 180, text: 'back view' },
    { angle: 225, text: 'back-left quarter view' },
    { angle: 270, text: 'left side view' },
    { angle: 315, text: 'front-left quarter view' },
] as const;


export const ELEVATION_SNAPS = [
    { angle: -30, text: 'low-angle shot' },
    { angle: 0, text: 'eye-level shot' },
    { angle: 30, text: 'elevated shot' },
    { angle: 60, text: 'high-angle shot' },
] as const;


export const DISTANCE_SNAPS = [
    { min: 0, max: 3, text: 'close-up' },
    { min: 3, max: 6, text: 'medium shot' },
    { min: 6, max: 10, text: 'wide shot' },
] as const;

export interface SnappedValues {
    azimuth: number;
    elevation: number;
    distance: string;
    azimuthText: string;
    elevationText: string;
    distanceText: string;
}

export interface RawValues {
    horizontal: number;
    vertical: number;
    zoom: number;
}

export interface PromptOutput {
    anglePhraseUI: string;
    anglePromptSks: string;
    angleDebug: string;
    snapped: SnappedValues;
    raw: RawValues;
}




function snapToNearest(value: number, snaps: readonly { angle: number }[]): number {
    let closest = snaps[0].angle;
    let minDiff = Math.abs(value - closest);

    for (const snap of snaps) {

        let diff = Math.abs(value - snap.angle);

        if (snap.angle === 0 && value > 270) {
            diff = Math.abs(value - 360);
        }
        if (diff < minDiff) {
            minDiff = diff;
            closest = snap.angle;
        }
    }

    return closest;
}




export function snapAzimuth(rawAngle: number): { angle: number; text: string } {

    let normalized = ((rawAngle % 360) + 360) % 360;

    const snappedAngle = snapToNearest(normalized, AZIMUTH_SNAPS);
    const snap = AZIMUTH_SNAPS.find(s => s.angle === snappedAngle);

    return {
        angle: snappedAngle,
        text: snap?.text || 'front view'
    };
}




export function snapElevation(rawAngle: number): { angle: number; text: string } {

    const clamped = Math.max(-30, Math.min(90, rawAngle));

    const snappedAngle = snapToNearest(clamped, ELEVATION_SNAPS);
    const snap = ELEVATION_SNAPS.find(s => s.angle === snappedAngle);

    return {
        angle: snappedAngle,
        text: snap?.text || 'eye-level shot'
    };
}




export function snapDistance(zoom: number): { text: string; category: string } {
    const clamped = Math.max(0, Math.min(10, zoom));

    for (const snap of DISTANCE_SNAPS) {
        if (clamped >= snap.min && clamped < snap.max) {
            return { text: snap.text, category: snap.text };
        }
    }


    return { text: 'wide shot', category: 'wide shot' };
}




export function mapAnglesToPrompt(horizontal: number, vertical: number, zoom: number): PromptOutput {
    const azimuthSnap = snapAzimuth(horizontal);
    const elevationSnap = snapElevation(vertical);
    const distanceSnap = snapDistance(zoom);

    const snapped: SnappedValues = {
        azimuth: azimuthSnap.angle,
        elevation: elevationSnap.angle,
        distance: distanceSnap.category,
        azimuthText: azimuthSnap.text,
        elevationText: elevationSnap.text,
        distanceText: distanceSnap.text,
    };

    const raw: RawValues = {
        horizontal: Math.round(horizontal * 10) / 10,
        vertical: Math.round(vertical * 10) / 10,
        zoom: Math.round(zoom * 10) / 10,
    };


    const anglePhraseUI = `${snapped.azimuthText}, ${snapped.elevationText}, ${snapped.distanceText}`;
    const anglePromptSks = `<sks> ${snapped.azimuthText} ${snapped.elevationText} ${snapped.distanceText}`;
    const angleDebug = `${anglePhraseUI} (horizontal: ${raw.horizontal}°, vertical: ${raw.vertical}°, zoom: ${raw.zoom} | snapped: ${snapped.azimuth}°, ${snapped.elevation}°, ${snapped.distance})`;

    return {
        anglePhraseUI,
        anglePromptSks,
        angleDebug,
        snapped,
        raw,
    };
}
