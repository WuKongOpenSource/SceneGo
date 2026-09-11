import { generateUUID } from '@runtime/videoTaskService';
import type { UploadedImage, TaskGroup } from '../services/videoTaskTypes';
import type { VideoModel } from '../services/videoModelService';













export function buildEmptyTaskGroup(model: VideoModel = 'Seedance15'): {
    image: UploadedImage;
    group: TaskGroup;
} {
    const imageId = generateUUID();
    const image: UploadedImage = {
        id: imageId,
        url: '',
        filename: '空卡片',
        uploadTime: Date.now(),
        isPlaceholder: true,
    };
    const group: TaskGroup = {
        uuid: generateUUID(),
        ids: [imageId],
        model,
        shotType: 'multi',
    };
    return { image, group };
}
