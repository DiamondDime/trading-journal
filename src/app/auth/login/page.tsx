'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });

    // Always show "sent" to prevent enumeration of allowlist (server enforces real check)
    setStatus(error ? 'error' : 'sent');
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-[#e8e8e8] font-mono">
      <div className="w-full max-w-md border border-[#2a2a2a] p-8">
        <h1 className="text-xl mb-2">Crypto Spread Journal</h1>
        <p className="text-xs text-[#888] mb-6">Private. Invite-only.</p>

        {status === 'sent' ? (
          <div className="text-[#00ff88] text-sm">
            If your email is on the allowlist, a magic link is on the way. Check your inbox.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-xs uppercase tracking-wider text-[#888]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full bg-[#141414] border border-[#2a2a2a] px-3 py-2 text-sm focus:outline-none focus:border-[#00ff88]"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full bg-[#00ff88] text-black py-2 text-sm font-semibold disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending...' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
