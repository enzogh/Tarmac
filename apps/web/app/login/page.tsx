'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@tarmac.local');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.login(email, password);
      localStorage.setItem('tarmac_token', result.access_token);
      router.push('/dashboard');
    } catch {
      setError('Connexion impossible');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container flex min-h-screen items-center justify-center">
      <div className="card w-full max-w-md">
        <div className="mb-6 space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-brand-300">Tarmac</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Connexion administrateur</h1>
          <p className="text-sm text-slate-400">
            Accédez au dashboard premium et à l'onboarding Node.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
          />
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
