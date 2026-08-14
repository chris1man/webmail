import { describe, expect, it } from 'vitest';
import { estimateBase64MimeBytes, estimateMimeSize, mimeSizeRisk, MEBIBYTE } from '../mime-size';

describe('MIME size estimate', () => {
  it('accounts for base64 encoding and line folding', () => {
    expect(estimateBase64MimeBytes(3)).toBe(6); // four base64 bytes plus CRLF
    expect(estimateBase64MimeBytes(57)).toBe(78); // 76 encoded characters plus CRLF
  });

  it('includes attachments, headers and both body alternatives', () => {
    const estimate = estimateMimeSize({
      attachments: [{ size: 1024 }],
      textBody: 'Plain body',
      htmlBody: '<p>HTML body</p>',
      recipientCount: 2,
      subject: 'Invoice',
    });
    expect(estimate.attachmentBytes).toBe(1024);
    expect(estimate.encodedAttachmentBytes).toBeGreaterThan(1024);
    expect(estimate.totalBytes).toBeGreaterThan(estimate.encodedAttachmentBytes);
  });

  it('is safe below the warning threshold', () => {
    expect(mimeSizeRisk(19 * MEBIBYTE)).toBe('ok');
  });

  it('warns between the configured thresholds', () => {
    expect(mimeSizeRisk(22 * MEBIBYTE)).toBe('warning');
  });

  it('blocks direct sending at the configured block threshold', () => {
    expect(mimeSizeRisk(25 * MEBIBYTE)).toBe('blocked');
  });
});
