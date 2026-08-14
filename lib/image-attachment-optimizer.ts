/** Browser-side optimisation for ordinary image attachments.
 *
 * Only the returned file is uploaded; the original is never persisted in
 * fileStorage or sent to JMAP. Animated/vector formats are deliberately left
 * untouched because drawing them to a canvas would flatten their content.
 */
export const IMAGE_ATTACHMENT_MAX_DIMENSION = 1200;
export const IMAGE_ATTACHMENT_WEBP_QUALITY = 0.78;
export const DEFAULT_IMAGE_ATTACHMENT_QUALITY = 78;
export type ImageAttachmentOutputFormat = 'webp' | 'jpeg' | 'preserve';

const OPTIMIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isOptimizableImageAttachment(file: Pick<File, 'type'>): boolean {
  return OPTIMIZABLE_TYPES.has(file.type.toLowerCase());
}

export function fitImageDimensions(width: number, height: number, maxDimension = IMAGE_ATTACHMENT_MAX_DIMENSION): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) return { width, height };
  const scale = maxDimension / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function optimizedImageName(name: string, outputType = 'image/webp'): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  const extension = outputType === 'image/jpeg' ? 'jpg' : outputType === 'image/png' ? 'png' : 'webp';
  return `${base}.${extension}`;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function optimizeImageAttachment(file: File, options: {
  quality?: number;
  maxDimension?: number;
  outputFormat?: ImageAttachmentOutputFormat;
} = {}): Promise<File> {
  if (!isOptimizableImageAttachment(file) || typeof createImageBitmap !== 'function') return file;

  const quality = Math.min(0.95, Math.max(0.4, (options.quality ?? DEFAULT_IMAGE_ATTACHMENT_QUALITY) / 100));
  const outputType = options.outputFormat === 'preserve'
    ? file.type
    : options.outputFormat === 'jpeg'
      ? 'image/jpeg'
      : 'image/webp';
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const target = fitImageDimensions(bitmap.width, bitmap.height, options.maxDimension ?? IMAGE_ATTACHMENT_MAX_DIMENSION);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const output = await canvasBlob(canvas, outputType, quality);
    // Keep an already better-compressed source rather than making it worse.
    if (!output || output.size >= file.size) return file;
    return new File([output], optimizedImageName(file.name, outputType), {
      type: outputType,
      lastModified: file.lastModified,
    });
  } catch {
    // Unsupported/corrupt images must not prevent sending the message.
    return file;
  } finally {
    bitmap?.close();
  }
}
