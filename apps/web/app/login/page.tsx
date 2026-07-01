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
    <div className="container" style={{ maxWidth: 420, marginTop: 64 }}>
      <div className="card">
        <h1>Tarmac</h1>
        <p>Connexion administrateur</p>
        <form onSubmit={onSubmit} className="row" style={{ flexDirection: 'column' }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
          />
          <button disabled={loading}>{loading ? 'Connexion...' : 'Se connecter'}</button>
          {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
