import { useCallback, useEffect, useMemo, useState } from "react";
import type { VersionCompare as VersionCompareData, VersionRow as VersionRowData } from "@ai-director/contract";
import type { RunClient } from "../data/RunClient.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { SkeletonRows } from "../components/SkeletonRows.js";
import { VersionCompare } from "../components/VersionCompare.js";
import { VersionTable } from "../components/VersionTable.js";
import "../styles/versions-screen.css";

export type VersionsScreenProps = {
  client: RunClient;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong reading the version store.";
}

/**
 * The rubric's history (design doc §4.3, §5, §6.4; spec §7, §9) — the screen that makes the
 * research method visible. Rubric and prompt files are append-only, so every row here is a real
 * sealed record with a required `why`, and the two-version compare makes "v2 beat v1" checkable
 * check by check instead of merely asserted.
 *
 * The gold set is not marked yet (PRODUCT.md), so every `kappa` this screen might show is `null`
 * today. Nothing here manufactures a number to fill that gap.
 */
export function VersionsScreen({ client }: VersionsScreenProps): React.JSX.Element {
  const [versions, setVersions] = useState<VersionRowData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<VersionCompareData | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .listVersions()
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    const [a, b] = selected;
    if (a === undefined || b === undefined) {
      setCompare(null);
      setCompareError(null);
      return;
    }
    let cancelled = false;
    client
      .compareVersions(a, b)
      .then((result) => {
        if (!cancelled) {
          setCompare(result);
          setCompareError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setCompareError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client, selected]);

  // Selection is capped at two (design doc §5): a third pick replaces the older of the current
  // two, never the newer.
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((existing) => existing !== id);
      if (prev.length < 2) return [...prev, id];
      const newer = prev[1];
      return newer === undefined ? [id] : [newer, id];
    });
  }, []);

  const handleSwap = useCallback(() => {
    setSelected((prev) => (prev.length === 2 ? [...prev].reverse() : prev));
  }, []);

  const handleCloseCompare = useCallback(() => setSelected([]), []);

  const statsLine = useMemo(() => {
    if (versions === null) return null;
    const count = versions.length;
    return `${count} version${count === 1 ? "" : "s"} · gold set not marked yet`;
  }, [versions]);

  return (
    <div className="versions">
      <h1 className="sr-only">Versions</h1>

      {loadError ? (
        <ErrorPanel
          title="Could not read the version store"
          detail={loadError}
          canResume={false}
        />
      ) : versions === null ? (
        <SkeletonRows rows={5} height={44} />
      ) : (
        <>
          {statsLine ? <p className="versions__stats tnum">{statsLine}</p> : null}
          <VersionTable versions={versions} selected={selected} onToggleSelect={toggleSelect} />
        </>
      )}

      {selected.length === 2 ? (
        compareError ? (
          <ErrorPanel title="Could not compare these versions" detail={compareError} canResume={false} />
        ) : compare ? (
          <VersionCompare compare={compare} onSwap={handleSwap} onClose={handleCloseCompare} />
        ) : (
          <SkeletonRows rows={2} height={120} />
        )
      ) : (
        <EmptyState title="Compare two versions" body="Select two versions to compare." />
      )}
    </div>
  );
}
