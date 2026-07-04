'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Lock, Mail, UserCog } from 'lucide-react';
import { AdminProfile, api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ProfilePage() {
  const router = useRouter();
  const token = useMemo(
    () => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null),
    [],
  );

  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }

    const loadProfile = async () => {
      try {
        const profileData = await api.profile.get(token);
        setProfile(profileData);
        setEmail(profileData.email);
      } catch {
        localStorage.removeItem('tarmac_token');
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    void loadProfile();
  }, [router, token]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);

    if (!token || !profile) {
      setNotice({ type: 'error', message: 'Session expirée, reconnectez-vous.' });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const wantsEmailChange = trimmedEmail !== profile.email;
    const wantsPasswordChange = newPassword.trim().length > 0;

    if (!wantsEmailChange && !wantsPasswordChange) {
      setNotice({ type: 'error', message: 'Aucune modification à enregistrer.' });
      return;
    }

    if (wantsPasswordChange) {
      if (!currentPassword) {
        setNotice({ type: 'error', message: 'Le mot de passe actuel est requis.' });
        return;
      }
      if (newPassword.length < 6) {
        setNotice({ type: 'error', message: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
        return;
      }
      if (newPassword !== confirmPassword) {
        setNotice({ type: 'error', message: 'La confirmation du mot de passe ne correspond pas.' });
        return;
      }
    }

    const payload: { email?: string; currentPassword?: string; newPassword?: string } = {};
    if (wantsEmailChange) payload.email = trimmedEmail;
    if (wantsPasswordChange) {
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    }

    try {
      setSaving(true);
      const updated = await api.profile.update(token, payload);
      setProfile(updated);
      setEmail(updated.email);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice({ type: 'success', message: 'Profil administrateur mis à jour.' });
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Impossible de mettre à jour le profil.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card className="border-violet-500/20 bg-violet-500/[0.07]">
          <CardContent className="flex items-start gap-3 p-4">
            <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
            <p className="text-sm text-violet-200/90">
              Modifiez l’email et le mot de passe du compte administrateur.
            </p>
          </CardContent>
        </Card>

        <Card className="max-w-2xl border-white/[0.08] bg-zinc-900/65">
          <CardHeader>
            <CardTitle>Profil administrateur</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Chargement du profil...</p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="admin-email"
                      type="email"
                      className="pl-9"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="current-password">Mot de passe actuel</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="current-password"
                      type="password"
                      className="pl-9"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder="Requis uniquement pour changer le mot de passe"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">Nouveau mot de passe</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="Minimum 6 caractères"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="Retapez le nouveau mot de passe"
                    />
                  </div>
                </div>

                {notice && (
                  <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
                    {notice.type === 'error' ? (
                      <AlertCircle className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    <AlertDescription>{notice.message}</AlertDescription>
                  </Alert>
                )}

                <Button type="submit" disabled={saving}>
                  {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
