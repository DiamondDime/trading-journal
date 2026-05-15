import { getCurrentProfile } from '@/lib/auth/server';
import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

type SpreadRow = {
  spreadId: string;
  name: string;
  spreadType: string;
  status: string;
  netPnlQuote: string;
  aprComputed: string | null;
  daysHeld: string | null;
  primaryBase: string;
  openedAt: string | null;
};

type CandidateRow = {
  id: string;
  suggestedType: string;
  matchConfidence: string;
  primaryBase: string;
  earliestFillAt: string;
};

export default async function SpreadsPage() {
  const profile = await getCurrentProfile();

  const spreads = await sql<SpreadRow[]>`
    SELECT spread_id, name, spread_type, status,
           net_pnl_quote, apr_computed, days_held,
           primary_base, opened_at
    FROM public.spread_pnl
    ORDER BY opened_at DESC NULLS LAST
    LIMIT 50
  `;

  const candidates = await sql<CandidateRow[]>`
    SELECT id, suggested_type, match_confidence, primary_base, earliest_fill_at
    FROM public.spread_candidates
    WHERE state = 'pending'
    ORDER BY match_confidence DESC
    LIMIT 10
  `;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#e8e8e8] font-mono p-6">
      <div className="border-b border-[#2a2a2a] pb-3 mb-6 flex justify-between items-center">
        <h1 className="text-lg">Crypto Spread Journal</h1>
        <div className="text-xs text-[#888]">{profile?.email ?? 'no user'}</div>
      </div>

      {candidates.length > 0 && (
        <section className="mb-8 border border-[#00ff88]/40 p-4">
          <h2 className="text-sm uppercase tracking-wider text-[#00ff88] mb-3">
            Pending spread candidates ({candidates.length})
          </h2>
          <ul className="space-y-2 text-xs">
            {candidates.map((c) => (
              <li key={c.id} className="flex gap-4">
                <span className="w-16 text-[#888]">{(Number(c.matchConfidence) * 100).toFixed(0)}%</span>
                <span className="w-48">{c.suggestedType}</span>
                <span className="w-24">{c.primaryBase}</span>
                <span className="text-[#666]">{new Date(c.earliestFillAt).toISOString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm uppercase tracking-wider text-[#888] mb-3">
          Spreads ({spreads.length})
        </h2>
        {spreads.length === 0 ? (
          <p className="text-xs text-[#666]">
            No spreads yet. Connect an exchange via POST /api/exchanges, run the
            worker to ingest fills, accept candidates from the matcher.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[#888] uppercase tracking-wider">
              <tr className="border-b border-[#2a2a2a]">
                <th className="text-left py-2">Name</th>
                <th className="text-left">Type</th>
                <th className="text-left">Status</th>
                <th className="text-right">Net PnL</th>
                <th className="text-right">APR</th>
                <th className="text-right">Days held</th>
              </tr>
            </thead>
            <tbody>
              {spreads.map((s) => (
                <tr key={s.spreadId} className="border-b border-[#1a1a1a] hover:bg-[#141414]">
                  <td className="py-2">{s.name}</td>
                  <td>{s.spreadType}</td>
                  <td>
                    <span className={s.status === 'open' ? 'text-[#00ff88]' : 'text-[#888]'}>
                      {s.status}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    <span className={Number(s.netPnlQuote) >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b30]'}>
                      {Number(s.netPnlQuote).toFixed(2)}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {s.aprComputed != null ? `${(Number(s.aprComputed) * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="text-right tabular-nums">
                    {s.daysHeld != null ? Number(s.daysHeld).toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
