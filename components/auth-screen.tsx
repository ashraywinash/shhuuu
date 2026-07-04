"use client";

import { useState } from "react";
import { createAccount, signIn, type UnlockedAccount } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Icon } from "./icons";

type Props = {
  onAuthenticated: (account: UnlockedAccount) => void;
  onDemo: (username?: string) => void;
};

export function AuthScreen({ onAuthenticated, onDemo }: Props) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (mode === "signup" && password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (!isSupabaseConfigured) { onDemo(username || undefined); return; }
    setBusy(true);
    try {
      const account = mode === "signup" ? await createAccount(username, password) : await signIn(username, password);
      onAuthenticated(account);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand"><span className="brand-mark"><Icon name="brand" /></span><span>shhuuu</span></div>
        <div className="story-copy">
          <span className="eyebrow"><Icon name="lock" /> Private by design</span>
          <h1>Messages that move.<br /><em>Privacy that stays.</em></h1>
          <p>Fast, direct conversations—encrypted before they ever leave your device.</p>
        </div>
        <div className="privacy-points">
          <span><b>01</b> No phone number</span>
          <span><b>02</b> No real name</span>
          <span><b>03</b> No readable server copies</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-heading">
            <span className="mobile-brand"><span className="brand-mark"><Icon name="brand" /></span> shhuuu</span>
            <h2>{mode === "signin" ? "Welcome back" : "Choose your pseudonym"}</h2>
            <p>{mode === "signin" ? "Unlock your private conversations." : "No email, phone number, or real name required."}</p>
          </div>

          <div className="auth-tabs" role="tablist">
            <button className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(null); }} role="tab">Sign in</button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(null); }} role="tab">Create account</button>
          </div>

          <form onSubmit={submit}>
            <label><span>Pseudonym</span><div className="field"><b>@</b><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} minLength={3} maxLength={24} required placeholder="quietpine" /></div><small>3–24 lowercase letters, numbers, or underscores</small></label>
            <label><span>Password</span><div className="field"><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required placeholder="At least 12 characters" /></div></label>
            {mode === "signup" && <label><span>Confirm password</span><div className="field"><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} required placeholder="Repeat your password" /></div></label>}
            {mode === "signup" && <div className="recovery-warning"><Icon name="info" /><span><strong>There is no password reset.</strong> Your password protects your private key. If you lose it, nobody—including the admin—can recover your chats.</span></div>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="auth-submit" disabled={busy}>{busy ? <span className="spinner" /> : <>{mode === "signin" ? "Unlock shhuuu" : "Create private account"}<Icon name="arrow" /></>}</button>
          </form>

          {!isSupabaseConfigured && <button className="demo-link" onClick={() => onDemo(username || undefined)}>Supabase isn’t connected · <strong>Explore the demo</strong></button>}
          <p className="terms">By continuing, you accept that your pseudonym is publicly searchable by signed-in people.</p>
        </div>
      </section>
    </main>
  );
}
