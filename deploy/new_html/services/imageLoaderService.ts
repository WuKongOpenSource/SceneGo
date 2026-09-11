






import { apiBlob, apiJson, secureApiUrl } from './httpClient';
import { runWhenIdle } from '../utils/idleScheduler';


const imageCache: Map<string, Map<string, string>> = new Map();


const loadingPromises: Map<string, Promise<any>> = new Map();


const blobUrlCache: Map<string, string> = new Map();




export async function loadShotImages(
    projectId: string,
    shotId: string
): Promise<{ images: any[]; selectedImageId?: string }> {
    const cacheKey = `${projectId}:${shotId}`;


    if (imageCache.has(shotId)) {
        console.log(`📦 从缓存加载镜头 ${shotId} 的图片`);

    }


    if (loadingPromises.has(cacheKey)) {
        console.log(`⏳ 等待镜头 ${shotId} 的图片加载完成`);
        return await loadingPromises.get(cacheKey)!;
    }


    console.log(`🔄 开始加载镜头 ${shotId} 的完整图片数据`);
    const loadPromise = fetchShotImages(projectId, shotId);

    loadingPromises.set(cacheKey, loadPromise);

    try {
        const result = await loadPromise;


        if (result.images && result.images.length > 0) {
            const shotCache = new Map<string, string>();
            result.images.forEach((img: any) => {
                if (img.url) {
                    shotCache.set(img.id, img.url);
                }
            });
            imageCache.set(shotId, shotCache);
            console.log(`✅ 已缓存镜头 ${shotId} 的 ${result.images.length} 张图片`);
        }

        return result;
    } finally {
        loadingPromises.delete(cacheKey);
    }
}




async function fetchShotImages(
    projectId: string,
    shotId: string
): Promise<{ images: any[]; selectedImageId?: string }> {
    const data = await apiJson<any>(
        `/api/projects/${projectId}/images/${shotId}`,
        { method: 'GET' },
        '加载镜头图片'
    );


    const convertedImages = await convertImageUrlsToBlobUrls(data.images || []);

    return {
        images: convertedImages,
        selectedImageId: data.selectedImageId
    };
}





export async function getFullImageUrl(
    projectId: string,
    shotId: string,
    imageId: string
): Promise<{ displayUrl: string; originalUrl: string } | null> {

    const result = await loadShotImages(projectId, shotId);
    const img = result.images.find((i: any) => i.id === imageId);

    if (!img || !img.url) {
        return null;
    }

    return {
        displayUrl: img.url,
        originalUrl: img.originalUrl || img.url
    };
}




export function preloadShotImages(
    projectId: string,
    shotId: string
): void {
    runWhenIdle(() => {
        loadShotImages(projectId, shotId).catch(err => {
            console.warn(`预加载镜头 ${shotId} 失败:`, err);
        });
    }, { fallbackDelayMs: 100 });
}




export function clearImageCache(): void {

    blobUrlCache.forEach(blobUrl => {
        URL.revokeObjectURL(blobUrl);
    });
    blobUrlCache.clear();

    imageCache.clear();
    loadingPromises.clear();
    console.log('🧹 已清空图片缓存');
}




export function getCacheStats(): { shotCount: number; imageCount: number } {
    let imageCount = 0;
    imageCache.forEach(shotCache => {
        imageCount += shotCache.size;
    });

    return {
        shotCount: imageCache.size,
        imageCount
    };
}




export function getCachedBlobUrl(cacheKey: string): string | undefined {
    return blobUrlCache.get(cacheKey);
}




export function setCachedBlobUrl(cacheKey: string, blobUrl: string): void {
    blobUrlCache.set(cacheKey, blobUrl);
}




export function removeCachedBlobUrl(cacheKey: string): void {
    const blobUrl = blobUrlCache.get(cacheKey);
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrlCache.delete(cacheKey);
        console.log(`🗑️ 已清理Blob缓存: ${cacheKey}`);
    }
}






export function removeImageFromCache(shotId: string, imageId: string): void {

    if (imageCache.has(shotId)) {
        const shotCache = imageCache.get(shotId)!;
        if (shotCache.has(imageId)) {
            shotCache.delete(imageId);
            console.log(`🗑️ 已从镜头缓存中删除图片: ${shotId}/${imageId}`);
        }
    }


    const cacheKey = `${shotId}:${imageId}`;
    removeCachedBlobUrl(cacheKey);
}

function normalizeThumbnailSource(imageUrl: string): string | null {
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        return null;
    }

    let source = imageUrl;
    try {
        if (/^https?:\/\//i.test(imageUrl)) {
            if (typeof window === 'undefined') return null;
            const parsed = new URL(imageUrl, window.location.origin);
            if (parsed.origin !== window.location.origin) return null;
            source = `${parsed.pathname}${parsed.search}`;
        }
    } catch {
        return null;
    }

    const path = source.split('#')[0];
    if (path.startsWith('/api/thumbnail')) return null;
    if (
        path.startsWith('/api/files/') ||
        path.startsWith('/storage/') ||
        path.startsWith('/uploads/')
    ) {
        return path;
    }
    return null;
}




export function getImageThumbnailUrl(imageUrl: string, width = 320, height = 180): string {
    const source = normalizeThumbnailSource(imageUrl);
    if (!source) return imageUrl;

    const thumbUrl = `/api/thumbnail?url=${encodeURIComponent(source)}&width=${Math.max(1, Math.round(width))}&height=${Math.max(1, Math.round(height))}`;
    return secureApiUrl(thumbUrl, { requireAuth: false });
}




export function clearShotImageCache(shotId: string): void {

    if (imageCache.has(shotId)) {
        imageCache.delete(shotId);
        console.log(`🗑️ 已清理镜头 ${shotId} 的图片缓存`);
    }


    const keysToDelete: string[] = [];
    blobUrlCache.forEach((_, key) => {
        if (key.startsWith(`${shotId}:`)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => {
        const blobUrl = blobUrlCache.get(key);
        if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
        }
        blobUrlCache.delete(key);
    });

    if (keysToDelete.length > 0) {
        console.log(`🗑️ 已清理镜头 ${shotId} 的 ${keysToDelete.length} 个Blob缓存`);
    }
}





export async function getAuthenticatedImageUrl(imageUrl: string): Promise<string> {

    if (!imageUrl.startsWith('/api/files/') && !imageUrl.startsWith('http')) {
        return imageUrl;
    }


    if (blobUrlCache.has(imageUrl)) {
        return blobUrlCache.get(imageUrl)!;
    }

    try {

        const securedUrl = secureApiUrl(imageUrl, { absolute: imageUrl.startsWith('/') });
        const blob = await apiBlob(securedUrl, { method: 'GET' }, '下载图片', {
            requireAuth: false,
            includeContentType: false,
        });
        const blobUrl = URL.createObjectURL(blob);


        blobUrlCache.set(imageUrl, blobUrl);
        console.log(`✅ 已转换图片URL为Blob: ${imageUrl}`);

        return blobUrl;
    } catch (error) {
        console.error(`转换图片URL失败: ${imageUrl}`, error);
        return imageUrl;
    }
}




export async function convertImageUrlsToBlobUrls(images: any[]): Promise<any[]> {
    const results = await Promise.all(
        images.map(async (img) => {
            const converted = { ...img };

            if (img.url) {

                converted.originalUrl = img.url;

                converted.url = await getAuthenticatedImageUrl(img.url);
            }
            if (img.thumbnail) {
                converted.thumbnail = await getAuthenticatedImageUrl(img.thumbnail);
            }

            return converted;
        })
    );
    return results;
}
