export interface OutgoingSubjectInput {
  subject: string;
  text: string;
  attachmentNames: string[];
}

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Builds a real RFC 5322 Subject only when the sender left it blank. */
export function getOutgoingSubject({ subject, text, attachmentNames }: OutgoingSubjectInput): string {
  const explicitSubject = subject.trim();
  if (explicitSubject) return explicitSubject;

  const messageText = normalizeText(text);
  const attachmentName = attachmentNames.find((name) => name.trim())?.trim();

  if (messageText && attachmentName) {
    return `${messageText.slice(0, 15)}... — ${attachmentName}`;
  }
  if (messageText) {
    return `${messageText.slice(0, 60)}...`;
  }
  return attachmentName ?? '';
}
