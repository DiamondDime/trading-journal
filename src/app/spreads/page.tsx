import { getCurrentProfile } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';

export default async function SpreadsPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: spreads } = await supabase
    .from('spread_pnl')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(50);

  const { data: candidates } = await supabase
    .from('spread_candidates')
    .select('id, suggested_type, match_confidence, primary_base, earliest_fill_at')
    .eq('state', 'pending')
    .order('match_confidence', { ascending: false })
    .limit(10);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#e8e8e8] font-mono p-6">
      <div className="border-b border-[#2a2a2a] pb-3 mb-6 flex justify-between items-center">
        <h1 className="text-lg">Crypto Spread Journal</h1>
        <div className="text-xs text-[#888]">{profile?.email}</div>
      </div>

      {candidates && candidates.length > 0 && (
        <section className="mb-8 border border-[#00ff88]/40 p-4">
          <h2 className="text-sm uppercase tracking-wider text-[#00ff88] mb-3">
            Pending spread candidates ({candidates.length})
          </h2>
          <ul className="space-y-2 text-xs">
            {candidates.map((c) => (
              <li key={c.id} className="flex gap-4">
                <span className="w-16 text-[#888]">{(c.match_confidence * 100).toFixed(0)}%</span>
                <span className="w-48">{c.suggested_type}</span>
                <span className="w-24">{c.primary_base}</span>
                <span className="text-[#666]">{new Date(c.earliest_fill_at).toISOString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm uppercase tracking-wider text-[#888] mb-3">
          Spreads ({spreads?.length ?? 0})
        </h2>
        {!spreads || spreads.length === 0 ? (
          <p className="text-xs text-[#666]">No spreads yet. Connect an exchange to start.</p>
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
                <tr key={s.spread_id} className="border-b border-[#1a1a1a] hover:bg-[#141414]">
                  <td className="py-2">{s.name}</td>
                  <td>{s.spread_type}</td>
                  <td>
                    <span
                      className={
                        s.status === 'open' ? 'text-[#00ff88]' : 'text-[#888]'
                      }
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    <span className={Number(s.net_pnl_quote) >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b30]'}>
                      {Number(s.net_pnl_quote).toFixed(2)}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {s.apr_computed != null ? `${(Number(s.apr_computed) * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="text-right tabular-nums">
                    {s.days_held != null ? Number(s.days_held).toFixed(1) : '—'}
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
