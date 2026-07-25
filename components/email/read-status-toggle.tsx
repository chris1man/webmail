"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface ReadStatusToggleProps {
  isUnread: boolean;
  onToggle: () => void;
}

/**
 * A compact read/unread control positioned inside an avatar wrapper.
 * The wrapper must have the `group/read-status` class for the read-state
 * outline to appear on hover.
 */
export function ReadStatusToggle({ isUnread, onToggle }: ReadStatusToggleProps) {
  const t = useTranslations("email_viewer");

  return (
    <button
      type="button"
      className={cn(
        "absolute start-1/2 top-[calc(100%+6px)] z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isUnread
          ? "opacity-100"
          : "opacity-0 transition-opacity group-hover/read-status:opacity-100 group-focus-within/read-status:opacity-100"
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={isUnread ? t("mark_read") : t("mark_unread")}
      title={isUnread ? t("mark_read") : t("mark_unread")}
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full",
          isUnread ? "bg-unread" : "border border-unread bg-background"
        )}
      />
    </button>
  );
}
