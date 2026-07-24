import { describe, expect, it } from 'vitest';
import { getOutgoingSubject } from '@/lib/outgoing-subject';

describe('getOutgoingSubject', () => {
  it('keeps an explicit subject unchanged', () => {
    expect(getOutgoingSubject({ subject: 'Invoice', text: 'Message text', attachmentNames: ['photo.jpg'] })).toBe('Invoice');
  });

  it('uses the attachment name when there is no text', () => {
    expect(getOutgoingSubject({ subject: '', text: '', attachmentNames: ['invoice.xlsx'] })).toBe('invoice.xlsx');
  });

  it('uses the first 60 text characters followed by an ellipsis when there is no attachment', () => {
    const text = 'A'.repeat(80);
    expect(getOutgoingSubject({ subject: '', text, attachmentNames: [] })).toBe(`${'A'.repeat(60)}...`);
  });

  it('combines the first 15 text characters and the attachment name', () => {
    expect(getOutgoingSubject({
      subject: '',
      text: 'Quarterly report for July',
      attachmentNames: ['report.pdf'],
    })).toBe('Quarterly repor... — report.pdf');
  });
});
