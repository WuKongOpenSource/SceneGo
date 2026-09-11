export async function urlToBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`素材下载失败 (HTTP ${response.status})`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('素材读取失败'));
    reader.readAsDataURL(blob);
  });
}
export async function extractLastFrame(videoSrc: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('无法读取视频末帧'));
    };
    video.onloadedmetadata = () => {
      video.currentTime = Math.max(0, video.duration - 0.08);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建视频帧画布');
        context.drawImage(video, 0, 0);
        const result = canvas.toDataURL('image/png');
        cleanup();
        resolve(result);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    video.src = videoSrc;
  });
}
