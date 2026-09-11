












export async function generateThumbnail(
  dataUrl: string,
  maxSize: number = 1024,
  quality: number = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {

      const { width, height } = img;
      let newWidth = width;
      let newHeight = height;

      if (width > height) {

        if (width > maxSize) {
          newWidth = maxSize;
          newHeight = Math.round(height * (maxSize / width));
        }
      } else {

        if (height > maxSize) {
          newHeight = maxSize;
          newWidth = Math.round(width * (maxSize / height));
        }
      }


      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取canvas上下文'));
        return;
      }


      ctx.drawImage(img, 0, 0, newWidth, newHeight);


      const thumbnail = canvas.toDataURL('image/webp', quality);
      resolve(thumbnail);
    };

    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };

    img.src = dataUrl;
  });
}








export async function compressImage(
  dataUrl: string,
  maxSize: number | null = null,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      let { width, height } = img;


      if (maxSize && (width > maxSize || height > maxSize)) {
        const scale = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }


      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取canvas上下文'));
        return;
      }


      ctx.drawImage(img, 0, 0, width, height);


      const compressed = canvas.toDataURL('image/webp', quality);
      resolve(compressed);
    };

    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };

    img.src = dataUrl;
  });
}




export function estimateDataUrlSize(dataUrl: string): number {

  const base64Data = dataUrl.split(',')[1] || dataUrl;
  return Math.ceil(base64Data.length * 0.75);
}




export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}




export async function batchGenerateThumbnails(
  dataUrls: string[],
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const thumbnails: string[] = [];

  for (let i = 0; i < dataUrls.length; i++) {
    try {
      const thumbnail = await generateThumbnail(dataUrls[i]);
      thumbnails.push(thumbnail);

      if (onProgress) {
        onProgress(i + 1, dataUrls.length);
      }
    } catch (error) {
      console.error(`生成缩略图失败 (${i + 1}/${dataUrls.length}):`, error);

      thumbnails.push(dataUrls[i]);
    }
  }

  return thumbnails;
}
