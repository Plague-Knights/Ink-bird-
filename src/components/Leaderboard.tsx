"use client";

import { useEffect, useState } from "react";

type Row = { address: string; score: number };

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function Leaderboard({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scores", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setRows(data.scores ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <aside className="board">
      <h2>This week</h2>
      <ol className="leaderboard">
        {rows === null && <li className="empty">Loading…</li>}
        {rows?.length === 0 && <li className="empty">No scores yet</li>}
        {rows?.map((row, i) => (
          <li key={row.address + i} className={`rank-${i + 1}`}>
            <span className="name">{i + 1}. {shortAddr(row.address)}</span>
            <span className="score">{row.score}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
