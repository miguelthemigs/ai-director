import { useCallback, useEffect, useRef } from "react";
import type { TerminalStatus } from "@ai-director/contract";
import { CueBadge } from "./CueBadge.js";
import { PassStep, type PassStepState } from "./PassStep.js";

export type PassStepperProps = {
  /** Passes that have actually run, each with the count of fragments it changed. Always rendered
   *  against three fixed slots — a run with only one pass still shows three take frames, the
   *  unreached ones marked `not yet run` (design doc §4.1). */
  /** `changedCount` is absent for a pass whose fragment record was never written to disk:
   *  a run from before the applied replacements were persisted repaired its description
   *  without leaving a count, and "0 changed" would state the opposite of what happened. */
  passes: ReadonlyArray<{ pass: number; changedCount?: number }>;
  /** Which pass's diff the rest of the screen is showing. */
  selected: number;
  onSelect: (pass: number) => void;
  /** Set once the run reaches a terminal status; `null` while still streaming. */
  terminal: TerminalStatus | null;
  /** True while the run is still producing passes — drives the in-flight step's `running` tag. */
  streaming: boolean;
  /** The latest SSE event id, shown as the rail's cue badge. */
  cueId?: string;
};

const SLOTS = [1, 2, 3] as const;

function stateFor(
  slot: number,
  passCount: number,
  terminal: TerminalStatus | null,
  streaming: boolean,
): PassStepState {
  if (slot > passCount) return "empty";
  const isLast = slot === passCount;
  if (isLast && terminal !== null && terminal !== "passed") return "terminated";
  if (isLast && streaming) return "running";
  return "done";
}

/**
 * Passes 1 to 3 as takes, one tab stop with arrow keys inside (design doc §7 "Focus order"). The
 * final frame takes the cross-bar terminator, never a closed frame, when the run's terminal status
 * is a failure (design doc §6.2).
 */
export function PassStepper({
  passes,
  selected,
  onSelect,
  terminal,
  streaming,
  cueId,
}: PassStepperProps): React.JSX.Element {
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());
  // Roving tabindex must move DOM focus when arrow keys move it, but never steal focus on mount.
  const shouldMoveFocus = useRef(false);

  useEffect(() => {
    if (shouldMoveFocus.current) buttonRefs.current.get(selected)?.focus();
  }, [selected]);

  const move = useCallback(
    (next: number) => {
      if (next < 1 || next > SLOTS.length) return;
      shouldMoveFocus.current = true;
      onSelect(next);
    },
    [onSelect],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          move(selected - 1);
          break;
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          move(selected + 1);
          break;
        case "Home":
          event.preventDefault();
          move(1);
          break;
        case "End":
          event.preventDefault();
          move(SLOTS.length);
          break;
        default:
          break;
      }
    },
    [move, selected],
  );

  return (
    <nav className="pass-stepper" aria-label="Repair passes" onKeyDown={onKeyDown}>
      <ol className="pass-stepper__list">
        {SLOTS.map((slot) => {
          const record = passes.find((p) => p.pass === slot);
          return (
            <li key={slot} className="pass-stepper__item">
              <PassStep
                pass={slot}
                state={stateFor(slot, passes.length, terminal, streaming)}
                changedCount={record?.changedCount}
                selected={slot === selected}
                active={slot === selected}
                onSelect={() => move(slot)}
                ref={(el) => {
                  if (el) buttonRefs.current.set(slot, el);
                  else buttonRefs.current.delete(slot);
                }}
              />
            </li>
          );
        })}
      </ol>
      {cueId ? (
        <div className="pass-stepper__cue">
          <span className="pass-stepper__cue-label">Cue</span>
          <CueBadge cueId={cueId} />
        </div>
      ) : null}
    </nav>
  );
}
