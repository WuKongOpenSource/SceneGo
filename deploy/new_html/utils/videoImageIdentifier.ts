import type { UploadedImage } from '../services/videoTaskTypes';

function cleanRef(ref?: string): string {
    return (ref || '').trim().split('?')[0];
}

export function extractFileId(ref?: string): string | null {
    const value = cleanRef(ref);
    const match = value.match(/\/api\/files\/(file_[A-Za-z0-9_-]+)/);
    if (match) return match[1];
    if (/^file_[A-Za-z0-9_-]+$/.test(value)) return value;
    return null;
}

function isUsableTransferRef(ref?: string): boolean {
    const value = cleanRef(ref);
    if (!value) return false;
    if (value.startsWith('blob:') || value.startsWith('data:')) return false;
    return value.startsWith('http') || value.startsWith('/') || Boolean(extractFileId(value));
}

function isDisplayOnlyFilename(filename?: string): boolean {
    const value = cleanRef(filename);
    return /^storyboard_\d+\.[A-Za-z0-9]+$/i.test(value)
        || /^placeholder_\d+$/i.test(value)
        || value === '空卡片';
}

export function resolveVideoImageIdentifier(img: UploadedImage, isExternalAPI: boolean): string {
    const storageRef = cleanRef(img.storageUrl);
    const urlRef = cleanRef(img.url);

    if (isExternalAPI) {
        const fileId = extractFileId(storageRef) || extractFileId(urlRef);
        if (fileId) return fileId;
        if (isUsableTransferRef(storageRef)) return storageRef;
        if (isUsableTransferRef(urlRef)) return urlRef;
        if (isDisplayOnlyFilename(img.filename)) return '';
        return img.filename || '';
    }

    if (img.comfyuiFilename) return img.comfyuiFilename;
    if (isUsableTransferRef(storageRef)) return storageRef;
    if (isUsableTransferRef(urlRef)) return urlRef;
    if (isDisplayOnlyFilename(img.filename)) return '';
    return img.filename || urlRef.split('/').pop() || '';
}
