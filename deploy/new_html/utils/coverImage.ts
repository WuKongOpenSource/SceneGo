export const COVER_IMAGE_TARGET_WIDTH = 640;
export const COVER_IMAGE_TARGET_HEIGHT = 360;
export const COVER_IMAGE_MIME_TYPE = 'image/jpeg';
export const COVER_IMAGE_QUALITY = 0.82;

export interface CoverCropRect {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export function calculateCoverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = COVER_IMAGE_TARGET_WIDTH,
  targetHeight = COVER_IMAGE_TARGET_HEIGHT,
): CoverCropRect {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = safeSourceWidth / safeSourceHeight;

  let cropWidth = safeSourceWidth;
  let cropHeight = safeSourceHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    cropWidth = safeSourceHeight * targetRatio;
    sourceX = (safeSourceWidth - cropWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    cropHeight = safeSourceWidth / targetRatio;
    sourceY = (safeSourceHeight - cropHeight) / 2;
  }

  const scale = Math.min(1, targetWidth / cropWidth, targetHeight / cropHeight);

  return {
    sourceX,
    sourceY,
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
    outputWidth: Math.max(1, Math.round(cropWidth * scale)),
    outputHeight: Math.max(1, Math.round(cropHeight * scale)),
  };
}

function coverFileName(file: File, mimeType: string): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'cover';
  return `${baseName}-cover.${extension}`;
}

function imageDimensions(image: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if ('naturalWidth' in image && 'naturalHeight' in image) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  return { width: image.width, height: image.height };
}

async function loadImageSource(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('封面图片加载失败'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('封面图片裁剪失败'));
    }, mimeType, quality);
  });
}

export async function prepareCoverUploadFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file;
  }

  const image = await loadImageSource(file);
  try {
    const { width, height } = imageDimensions(image);
    const crop = calculateCoverCropRect(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = crop.outputWidth;
    canvas.height = crop.outputHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('浏览器不支持封面图片裁剪');
    }

    context.drawImage(
      image,
      crop.sourceX,
      crop.sourceY,
      crop.sourceWidth,
      crop.sourceHeight,
      0,
      0,
      crop.outputWidth,
      crop.outputHeight,
    );

    const blob = await canvasToBlob(canvas, COVER_IMAGE_MIME_TYPE, COVER_IMAGE_QUALITY);
    return new File([blob], coverFileName(file, COVER_IMAGE_MIME_TYPE), {
      type: blob.type || COVER_IMAGE_MIME_TYPE,
      lastModified: Date.now(),
    });
  } finally {
    if ('close' in image) image.close();
  }
}
