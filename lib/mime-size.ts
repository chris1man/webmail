/**
 * Conservative client-side estimate of the bytes that will be handed to SMTP.
 * JMAP builds the actual MIME on the server, so this is intentionally an
 * estimate rather than a protocol limit. It includes base64 wrapping, MIME
 * part headers/boundaries and the plain-text + HTML alternatives.
 */
export const MEBIBYTE = 1024 * 1024;
export const DEFAULT_MIME_SIZE_WARNING_MB = 20;
export const DEFAULT_MIME_SIZE_BLOCK_MB = 25;

export type MimeSizeAttachment = { size: number };

export type MimeSizeEstimate = {
  attachmentBytes: number;
  encodedAttachmentBytes: number;
  bodyBytes: number;
  overheadBytes: number;
  totalBytes: number;
};

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Base64 output is folded at 76 characters, as required by MIME. */
export function estimateBase64MimeBytes(bytes: number): number {
  const sourceBytes = Math.max(0, Math.floor(bytes));
  if (sourceBytes === 0) return 0;
  const encodedCharacters = Math.ceil(sourceBytes / 3) * 4;
  return encodedCharacters + Math.ceil(encodedCharacters / 76) * 2;
}

export function estimateMimeSize(input: {
  attachments: MimeSizeAttachment[];
  textBody?: string;
  htmlBody?: string;
  recipientCount?: number;
  subject?: string;
}): MimeSizeEstimate {
  const attachmentBytes = input.attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.size || 0), 0);
  const encodedAttachmentBytes = input.attachments.reduce((sum, attachment) => sum + estimateBase64MimeBytes(attachment.size), 0);
  // Mail headers, multipart boundaries and per-attachment Content-* headers.
  // Keep a margin for long names/addresses and server-added fields.
  const overheadBytes = 2_048 + input.attachments.length * 768 + Math.max(0, input.recipientCount ?? 0) * 128 + utf8Length(input.subject ?? '');
  const bodyBytes = utf8Length(input.textBody ?? '') + utf8Length(input.htmlBody ?? '') + 512;
  return { attachmentBytes, encodedAttachmentBytes, bodyBytes, overheadBytes, totalBytes: encodedAttachmentBytes + bodyBytes + overheadBytes };
}

export function mimeSizeRisk(totalBytes: number, warningMb = DEFAULT_MIME_SIZE_WARNING_MB, blockMb = DEFAULT_MIME_SIZE_BLOCK_MB): 'ok' | 'warning' | 'blocked' {
  if (totalBytes >= blockMb * MEBIBYTE) return 'blocked';
  if (totalBytes >= warningMb * MEBIBYTE) return 'warning';
  return 'ok';
}

export function parseMimeSizeThreshold(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
