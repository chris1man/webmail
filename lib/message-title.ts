import type { Email } from "@/lib/jmap/types";

const EMPTY_MESSAGE_TITLE = "(Empty message)";
const TEXT_TITLE_LENGTH = 60;

/**
 * Returns the single, user-facing title for a message when its Subject is
 * absent.  The list API provides `preview`, while the full message also has
 * text body values, so both are considered without making callers know which
 * version of an Email they received.
 */
export function getMessageTitle(message: Email): string {
  const subject = message.subject?.trim();
  if (subject) return subject;

  const attachments = message.attachments ?? [];
  if (attachments.length > 0) {
    const firstName = attachments[0].name?.trim() || "Attachment";
    const remaining = attachments.length - 1;
    return remaining > 0 ? `${firstName} (+${remaining})` : firstName;
  }

  const textPart = message.textBody?.find((part) => message.bodyValues?.[part.partId]?.value);
  const text = textPart
    ? message.bodyValues?.[textPart.partId]?.value
    : message.preview;
  const normalizedText = text?.replace(/\s+/g, " ").trim();

  if (normalizedText) return normalizedText.slice(0, TEXT_TITLE_LENGTH);
  return EMPTY_MESSAGE_TITLE;
}

export { EMPTY_MESSAGE_TITLE, TEXT_TITLE_LENGTH };
