import { useEffect, useMemo, useReducer } from "react";
import {
  CHECK_IDS,
  isScoredCheck,
  type CheckId,
  type CheckResultView,
  type PassView,
  type ReplacementView,
  type RunEvent,
  type RunStatus as TerminalOrRunningStatus,
  type RunView,
} from "@ai-director/contract";
import type { RunClient } from "../data/RunClient.js";

/** `"idle"` before a run id is given; `"streaming"` from the moment the client subscribes to the
 *  moment a terminal event lands; then whichever status the server settled on. */
export type RunStatus = "idle" | "streaming" | TerminalOrRunningStatus;

export type UseRunStreamResult = {
  run: RunView | null;
  status: RunStatus;
  events: RunEvent[];
  error: string | null;
};

type RunMeta = {
  runId: string;
  rubricVersion: string;
  model: string;
  startedAt: string;
  originalDescription: string;
};

type InProgressPass = {
  pass: number;
  description: string;
  results: Map<CheckId, CheckResultView>;
  replacements: ReplacementView[];
  repairedDescription?: string;
  failing?: CheckId[];
};

type State = {
  /** Set only once the stream reaches a terminal event; `null` the entire time it is streaming. */
  terminalStatus: TerminalOrRunningStatus | "failed" | null;
  meta: RunMeta | null;
  passes: PassView[];
  current: InProgressPass | null;
  finalRun: RunView | null;
  events: RunEvent[];
  error: string | null;
};

const ZERO_COST = { inputTokens: 0, outputTokens: 0, usd: 0, latencyMs: 0 };

function initialState(): State {
  return {
    terminalStatus: null,
    meta: null,
    passes: [],
    current: null,
    finalRun: null,
    events: [],
    error: null,
  };
}

function sortByRubricOrder(results: CheckResultView[]): CheckResultView[] {
  const byId = new Map(results.map((r) => [r.checkId, r]));
  const ordered: CheckResultView[] = [];
  for (const id of CHECK_IDS) {
    const r = byId.get(id);
    if (r) ordered.push(r);
  }
  return ordered;
}

function currentPassView(cp: InProgressPass): PassView {
  const results = sortByRubricOrder([...cp.results.values()]);
  return {
    pass: cp.pass,
    description: cp.description,
    results,
    failing: cp.failing ?? results.filter(isScoredCheck).filter((r) => !r.passed).map((r) => r.checkId),
    replacements: cp.replacements,
    repairedDescription: cp.repairedDescription,
  };
}

type Action = RunEvent | { name: "reset" };

function reduce(state: State, event: Action): State {
  switch (event.name) {
    case "reset":
      return initialState();
    case "run.started": {
      return {
        ...state,
        meta: {
          runId: event.runId,
          rubricVersion: event.rubricVersion,
          model: event.model,
          startedAt: event.at,
          originalDescription: event.description,
        },
      };
    }
    case "pass.started": {
      return {
        ...state,
        current: {
          pass: event.pass,
          description: event.description,
          results: new Map(),
          replacements: [],
        },
      };
    }
    case "evaluator.group.completed": {
      if (!state.current) return state;
      // Reduce, never replace: merge only this group's results into the map so a group that
      // already arrived is never discarded by one that arrives later, regardless of order.
      const results = new Map(state.current.results);
      for (const r of event.results) results.set(r.checkId, r);
      return { ...state, current: { ...state.current, results } };
    }
    case "repairer.completed": {
      if (!state.current) return state;
      return { ...state, current: { ...state.current, replacements: event.replacements } };
    }
    case "pass.completed": {
      if (!state.current) return state;
      const finished: InProgressPass = {
        ...state.current,
        repairedDescription: event.repairedDescription,
        failing: event.failing as CheckId[],
      };
      return {
        ...state,
        passes: [...state.passes, currentPassView(finished)],
        current: null,
      };
    }
    case "run.completed": {
      return { ...state, terminalStatus: event.status, finalRun: event.run };
    }
    case "run.failed": {
      return { ...state, terminalStatus: "failed", error: event.error };
    }
    default:
      return state;
  }
}

function reducer(state: State, action: Action): State {
  if (action.name === "reset") return reduce(state, action);
  return { ...reduce(state, action), events: [...state.events, action] };
}

/**
 * Subscribes to one run's event stream and reduces it into the same `RunView` shape a snapshot
 * fetch would return, so every screen can render mid-stream and post-terminal data identically.
 * Groups are merged by check id (never replaced wholesale), which is what makes out-of-order group
 * arrival safe — see the reducer's `evaluator.group.completed` case.
 */
export function useRunStream(client: RunClient, runId: string | null): UseRunStreamResult {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    if (runId === null) return;
    // A new run id starts from a clean slate — a previous run's checks must never bleed into the
    // next one's rows.
    dispatch({ name: "reset" });
    const unsubscribe = client.subscribe(runId, undefined, dispatch);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, runId]);

  const run = useMemo<RunView | null>(() => {
    if (state.finalRun) return state.finalRun;
    if (!state.meta) return null;
    const passes = state.current ? [...state.passes, currentPassView(state.current)] : state.passes;
    return {
      runId: state.meta.runId,
      rubricVersion: state.meta.rubricVersion,
      model: state.meta.model,
      status: "running",
      startedAt: state.meta.startedAt,
      originalDescription: state.meta.originalDescription,
      finalDescription: passes.at(-1)?.repairedDescription ?? state.meta.originalDescription,
      passes,
      cost: ZERO_COST,
    };
  }, [state]);

  const status: RunStatus =
    runId === null ? "idle" : state.terminalStatus !== null ? state.terminalStatus : "streaming";

  return { run, status, events: state.events, error: state.error };
}
