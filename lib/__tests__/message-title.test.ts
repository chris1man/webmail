import { describe, expect, it } from 'vitest';
import { getMessageTitle } from '@/lib/message-title';
import { makeEmail } from '@/lib/__tests__/helpers/factories';

describe('getMessageTitle', () => {
  it('prefers a non-empty Subject', () => {
    expect(getMessageTitle(makeEmail({ subject: '  Quarterly report  ' }))).toBe('Quarterly report');
  });

  it('uses the first attachment name and count when Subject is empty', () => {
    expect(getMessageTitle(makeEmail({
      attachments: [
        { partId: '1', blobId: 'a', name: 'photo.jpg', size: 1, type: 'image/jpeg' },
        { partId: '2', blobId: 'b', name: 'invoice.pdf', size: 1, type: 'application/pdf' },
      ],
    }))).toBe('photo.jpg (+1)');
  });

  it('uses body text before the list preview and limits it to 60 characters', () => {
    const text = 'A'.repeat(61);
    expect(getMessageTitle(makeEmail({
      preview: 'Preview text',
      textBody: [{ partId: 'text', blobId: 'body', size: text.length, type: 'text/plain' }],
      bodyValues: { text: { value: text } },
    }))).toBe('A'.repeat(60));
  });

  it('uses the preview when only list data is available', () => {
    expect(getMessageTitle(makeEmail({ preview: '  A message from the list API.  ' }))).toBe('A message from the list API.');
  });

  it('returns the empty-message label when the message has no content', () => {
    expect(getMessageTitle(makeEmail())).toBe('(Empty message)');
  });
});
