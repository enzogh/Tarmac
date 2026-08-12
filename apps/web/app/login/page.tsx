'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Layers, ShieldCheck, ShieldX } from 'lucide-react';
import { AdminProfile, api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';

type ViewState =
  | { kind: 'checking' }
  | { kind: 'idle' }
  | { kind: 'welcome-back'; profile: AdminProfile }
  | { kind: 'forbidden' }
  | { kind: 'error'; reason: string | null };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Le SSO Authentik n'est pas configuré côté serveur.",
  discovery_failed: "Impossible de joindre le fournisseur d'identité Authentik.",
  callback_failed: 'La connexion via Authentik a échoué.',
  no_email_claim: "Le compte Authentik n'expose pas d'adresse email.",
  state_missing: 'Session de connexion expirée, réessayez.',
};

function initials(name?: string | null, email?: string) {
  const source = (name?.trim() || email || '').trim();
  if (!source) return '?';
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return letters.toUpperCase() || source[0].toUpperCase();
}

function firstName(name?: string | null, email?: string) {
  const source = name?.trim() || email?.split('@')[0] || '';
  return source.split(/\s+/)[0] || source;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ViewState>({ kind: 'checking' });
  const [entering, setEntering] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    const sso = searchParams.get('sso');

    if (!sso) {
      // Async, no-navigation check: do we already have a valid Tarmac
      // session (e.g. from earlier this browsing session)? If so, skip
      // Authentik entirely — no redirect needed. Only falls back to the
      // silent Authentik round-trip when that local session is absent/expired,
      // since checking an Authentik session from a different origin can't be
      // done without a real navigation (third-party cookies are blocked).
      api.profile
        .get()
        .then((profile) => {
          setAvatarFailed(false);
          setState({ kind: 'welcome-back', profile });
        })
        .catch(() => {
          window.location.href = api.sso.silentUrl();
        });
      return;
    }

    if (sso === 'ready') {
      api.profile
        .get()
        .then((profile) => {
          setAvatarFailed(false);
          setState({ kind: 'welcome-back', profile });
        })
        .catch(() => setState({ kind: 'idle' }));
      return;
    }

    if (sso === 'forbidden') {
      setState({ kind: 'forbidden' });
      return;
    }

    if (sso === 'error') {
      setState({ kind: 'error', reason: searchParams.get('reason') });
      return;
    }

    setState({ kind: 'idle' });
  }, [searchParams]);

  const enterDashboard = () => {
    setEntering(true);
    router.push('/workspaces');
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-glow">
            <Layers className="h-7 w-7 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">Tarmac</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              Connexion administrateur
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Accès réservé aux administrateurs, via Authentik.
            </p>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {state.kind === 'checking' && (
            <motion.div
              key="checking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 py-10"
            >
              <motion.div
                className="h-8 w-8 rounded-full border-2 border-violet-500/30 border-t-violet-400"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
              />
              <p className="text-sm text-muted-foreground">Vérification de votre session Authentik…</p>
            </motion.div>
          )}

          {state.kind === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <Card>
                <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
                    <ShieldCheck className="h-6 w-6 text-violet-400" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Authentifiez-vous avec votre compte Authentik pour piloter votre flotte de nœuds.
                  </p>
                  <a href={api.sso.loginUrl()} className="w-full">
                    <Button type="button" className="w-full">
                      Se connecter avec Authentik
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </a>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {state.kind === 'welcome-back' && (
            <motion.div
              key="welcome-back"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: entering ? 0 : 1, y: 0, scale: entering ? 0.97 : 1 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              <Card className="overflow-visible">
                <CardContent className="flex flex-col items-center gap-4 pt-8 text-center">
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
                    className="relative"
                  >
                    {state.profile.avatarUrl && !avatarFailed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={state.profile.avatarUrl}
                        alt=""
                        onError={() => setAvatarFailed(true)}
                        className="h-20 w-20 rounded-full border-2 border-violet-500/40 object-cover shadow-glow"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-violet-500/40 bg-gradient-to-br from-violet-600 to-indigo-600 text-2xl font-semibold text-white shadow-glow">
                        {initials(state.profile.name, state.profile.email)}
                      </div>
                    )}
                    <motion.span
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 16 }}
                      className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-emerald-500"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-white" />
                    </motion.span>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.3 }}
                  >
                    <p className="text-sm text-muted-foreground">
                      Bonjour, {firstName(state.profile.name, state.profile.email)} 👋
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {state.profile.name || state.profile.email}
                    </p>
                    <p className="text-sm text-muted-foreground">{state.profile.email}</p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25, duration: 0.3 }}
                    className="w-full space-y-3"
                  >
                    <Button type="button" className="w-full" onClick={enterDashboard} disabled={entering}>
                      {entering ? 'Ouverture…' : 'Entrer dans Tarmac'}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                    <a href={api.sso.loginUrl()} className="block text-xs text-muted-foreground hover:text-foreground">
                      Ce n&apos;est pas vous ? Changer de compte
                    </a>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {state.kind === 'forbidden' && (
            <motion.div
              key="forbidden"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <Card>
                <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
                    <ShieldX className="h-6 w-6 text-rose-400" />
                  </div>
                  <p className="text-sm text-rose-300">
                    Ce compte Authentik n&apos;a pas les droits administrateur nécessaires pour accéder à Tarmac.
                  </p>
                  <a href={api.sso.loginUrl()} className="w-full">
                    <Button type="button" variant="outline" className="w-full">
                      Essayer un autre compte
                    </Button>
                  </a>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {state.kind === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <Card>
                <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
                  <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2.5">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                    <p className="text-sm text-rose-300">
                      {(state.reason && ERROR_MESSAGES[state.reason]) ?? 'Une erreur est survenue pendant la connexion.'}
                    </p>
                  </div>
                  <a href={api.sso.loginUrl()} className="w-full">
                    <Button type="button" className="w-full">
                      Réessayer
                    </Button>
                  </a>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">← Accueil</Link>
          <span className="text-zinc-700">·</span>
          <Link href="/docs" className="hover:text-foreground">Documentation</Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
