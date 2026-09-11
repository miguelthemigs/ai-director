export type LiveAnnouncerProps = {
  politeness: "polite" | "assertive";
  message: string;
};

/**
 * One visually-hidden live region. `RunScreen` mounts exactly one of each politeness — one
 * `role="status"`, one `role="alert"` — because nine competing regions would flood the buffer
 * (design doc §7 "Live announcements while a run streams"). Nothing else in the app is a live
 * region.
 */
export function LiveAnnouncer({ politeness, message }: LiveAnnouncerProps): React.JSX.Element {
  return (
    <div
      className="live-announcer sr-only"
      role={politeness === "polite" ? "status" : "alert"}
      aria-live={politeness}
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
