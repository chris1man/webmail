import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../settings-store';

describe('image attachment optimization settings migration', () => {
  it('adds safe defaults for existing users', () => {
    const migrated = migrateSettings({}, 7) as unknown as Record<string, unknown>;
    expect(migrated.imageAttachmentOptimizationEnabled).toBe(true);
    expect(migrated.imageAttachmentQuality).toBe(78);
    expect(migrated.imageAttachmentOutputFormat).toBe('webp');
    expect(migrated.imageAttachmentMaxDimension).toBe(1200);
  });
});
