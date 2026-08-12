import { Paperclip } from "lucide-react";
import type { Email } from "@/lib/jmap/types";
import { cn } from "@/lib/utils";

export function getAttachmentTypeLabel(name?: string | null, type?: string): string {
  const extension = name?.split('.').pop()?.trim().toLowerCase();
  if (extension) return extension.toUpperCase();
  if (type === 'application/pdf') return 'PDF';
  if (type?.startsWith('image/')) return 'IMG';
  if (type?.startsWith('audio/')) return 'AUDIO';
  if (type?.startsWith('video/')) return 'VIDEO';
  return 'FILE';
}

export function AttachmentTypeBadge({ name, type, className }: { name?: string | null; type?: string; className?: string }) {
  const label = getAttachmentTypeLabel(name, type);
  const tone = label === 'PDF'
    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
    : ['DOC', 'DOCX', 'ODT', 'RTF'].includes(label)
      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
      : ['XLS', 'XLSX', 'CSV', 'ODS'].includes(label)
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : ['PPT', 'PPTX', 'ODP'].includes(label)
          ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
          : 'bg-muted-foreground/10 text-muted-foreground';
  return <span className={cn('inline-flex min-w-9 justify-center rounded px-1.5 py-1 text-[10px] font-bold leading-none', tone, className)}>{label}</span>;
}

/** Compact attachment summary for every mail-list layout. */
export function EmailAttachmentTypeIndicator({ email, className }: { email: Email; className?: string }) {
  if (!email.hasAttachment) return null;
  const labels = Array.from(new Set((email.attachments || []).map((attachment) => getAttachmentTypeLabel(attachment.name, attachment.type))));
  if (labels.length === 0) return <Paperclip className={cn('h-3.5 w-3.5 text-muted-foreground', className)} />;
  const visible = labels.slice(0, 2);
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground', className)} title={labels.join(', ')}>
      <Paperclip className="h-3.5 w-3.5" />
      <span>{visible.join(' · ')}</span>
      {labels.length > visible.length && <span>+{labels.length - visible.length}</span>}
    </span>
  );
}
