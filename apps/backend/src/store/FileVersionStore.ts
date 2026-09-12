import { readFile } from "node:fs/promises";
import path from "node:path";
import { CHECK_IDS, type Band, type Percent, type VersionCompare, type VersionRow } from "@ai-director/contract";
import { VersionsFileSchema, type VersionStore } from "./VersionStore.js";

const NOTES_FILE = "notes.json";

// Inverse of fixtures.ts's Band -> Percent map. Percent is a closed
// five-value enum, so this inverse is exhaustive and total -- there is no
// Percent value this can fail to resolve.
const BAND_FOR_PERCENT: Record<Percent, Band> = { 20: 1, 40: 2, 60: 3, 80: 4, 100: 5 };

export class FileVersionStore implements VersionStore {
  constructor(private readonly root: string) {}

  async list(): Promise<VersionRow[]> {
    const rows = await this.readAll();
    return [...rows].sort((a, b) => b.sealedAt.localeCompare(a.sealedAt));
  }

  async get(id: string): Promise<VersionRow> {
    const rows = await this.readAll();
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`version "${id}" not found`);
    return row;
  }

  async compare(a: string, b: string): Promise<VersionCompare> {
    const [rowA, rowB] = await Promise.all([this.get(a), this.get(b)]);

    const perCheck = CHECK_IDS.map((checkId) => {
      const kappaA = rowA.perCheckKappa?.[checkId] ?? null;
      const kappaB = rowB.perCheckKappa?.[checkId] ?? null;
      // Never coerce an unmeasured side to zero -- a delta is only ever
      // reported when both sides carry an actual measured kappa for this
      // check. One measured and one unmeasured is "not comparable", not "no
      // change".
      const deltaPercent = kappaA !== null && kappaB !== null ? (kappaB - kappaA) * 100 : null;

      return {
        checkId,
        deltaPercent,
        bandA: rowA.profile ? BAND_FOR_PERCENT[rowA.profile[checkId]] : null,
        bandB: rowB.profile ? BAND_FOR_PERCENT[rowB.profile[checkId]] : null,
      };
    });

    return {
      a: rowA,
      b: rowB,
      // KNOWN GAP (see task-19-report.md): no source of prompt/rubric text is
      // wired into VersionStore yet -- rubric JSON lives under
      // apps/backend/src/rubric/*.json and prompt builders under
      // apps/backend/src/agents/*/prompt.ts, neither read by this store. An
      // empty array is the honest "not computed", never a fabricated diff.
      promptDiff: [],
      perCheck,
    };
  }

  private async readAll(): Promise<VersionRow[]> {
    const file = path.join(this.root, NOTES_FILE);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      // Mirrors FileRunStore.listRuns: a root that was never initialised
      // reads the same as an empty store. Callers that care about the
      // distinction must check for the file/root themselves.
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`FileVersionStore: ${NOTES_FILE} is not valid JSON: ${reason}`);
    }

    // The whole file fails to load on one malformed row (e.g. a missing
    // `why`) rather than silently dropping it -- unlike FileRunStore's
    // listRuns, which skips a corrupt run so the rest stay visible. A
    // version history is an audit trail: hiding a bad row would be worse
    // than refusing to serve any of it.
    const result = VersionsFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`FileVersionStore: ${NOTES_FILE} is invalid: ${result.error.message}`);
    }
    return result.data.versions;
  }
}
