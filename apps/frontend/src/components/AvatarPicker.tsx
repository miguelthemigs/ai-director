import { avatarImageUrl, type AvatarRecord } from "../data/avatarApi.js";

/**
 * Whose face is being tested, picked by looking at faces.
 *
 * The first version of this was a row of buttons labelled with UUIDs, which is a picker
 * only in the sense that it has options: `eaa18108-4b38…` tells you nothing about who it
 * is, and this screen's entire subject is whether a rendered person still looks like a
 * particular someone. The sheet is the identifier.
 *
 * An avatar with no description yet is shown and disabled rather than hidden. Hiding it
 * would read as "that avatar is gone"; disabled with a reason reads as "that avatar is not
 * ready", which is what is actually true and tells you what to do about it.
 */
export function AvatarPicker({
  avatars,
  selectedId,
  onSelect,
  disabled,
}: {
  avatars: AvatarRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  if (avatars.length === 0) {
    return (
      <p className="compare-empty">
        No stored avatars. Generate one on the Run screen's Pipeline tab, and it will appear
        here.
      </p>
    );
  }

  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Avatar">
      {avatars.map((avatar) => {
        const ready = Boolean(avatar.description);
        const selected = avatar.id === selectedId;
        return (
          <button
            key={avatar.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={avatar.id}
            className="avatar-card"
            data-selected={selected || undefined}
            disabled={disabled || !ready}
            onClick={() => onSelect(avatar.id)}
          >
            <img
              className="avatar-card__sheet"
              src={avatarImageUrl(avatar.id)}
              alt={`Character sheet for ${avatar.id}`}
              loading="lazy"
            />
            <span className="avatar-card__meta">
              <span className="avatar-card__id">{avatar.id.slice(0, 8)}</span>
              <span className="avatar-card__state">
                {ready ? avatar.source : "not described yet"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
