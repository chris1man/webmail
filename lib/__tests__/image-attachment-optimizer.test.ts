import { describe, expect, it } from 'vitest';
import { fitImageDimensions, isOptimizableImageAttachment, optimizedImageName } from '../image-attachment-optimizer';

describe('image attachment optimizer', () => {
  it('limits the longest side to 1200px and preserves proportions', () => {
    expect(fitImageDimensions(4000, 3000)).toEqual({ width: 1200, height: 900 });
    expect(fitImageDimensions(800, 2400)).toEqual({ width: 400, height: 1200 });
  });

  it('does not upscale small images', () => {
    expect(fitImageDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('only optimizes safe static raster formats', () => {
    expect(isOptimizableImageAttachment({ type: 'image/jpeg' })).toBe(true);
    expect(isOptimizableImageAttachment({ type: 'image/gif' })).toBe(false);
    expect(isOptimizableImageAttachment({ type: 'image/svg+xml' })).toBe(false);
  });

  it('uses a filename matching the chosen output format', () => {
    expect(optimizedImageName('scan.JPG')).toBe('scan.webp');
    expect(optimizedImageName('scan.png', 'image/jpeg')).toBe('scan.jpg');
    expect(optimizedImageName('scan.jpg', 'image/png')).toBe('scan.png');
  });
});
