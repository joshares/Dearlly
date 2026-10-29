"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Turnstile } from "@/components/Turnstile";
import { getMessages } from "@/i18n";
import { ApiError, api, type MyProfile } from "@/lib/api";

type Step = "email" | "code" | "signup";
type Method = "code" | "password";

const t = getMessages().login;

const input =
  "min-h-12 w-full rounded-md border-2 border-fg bg-surface px-3 text-base text-fg placeholder:text-muted";
const primary =
  "min-h-14 w-full rounded-lg bg-stamp px-5 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-50 disabled:shadow-none";
const label = "flex flex-col gap-1 text-left text-sm font-semibold";

function message(error: unknown): string {
  return error instanceof ApiError ? error.detail : "Something went wrong. Please try again.";
}

export function LoginFlow({ nonce }: { nonce?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [method, setMethod] = useState<Method>("code");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  // Turnstile tokens work once: remount the widget for a fresh check after each try.
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [availability, setAvailability] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onToken = useCallback((token: string | null) => setTurnstileToken(token), []);

  // Live username check while typing (after a short pause).
  useEffect(() => {
    if (step !== "signup" || username.trim().length < 3) return;
    const timer = setTimeout(async () => {
      try {
        const result = await api<{ available: boolean; reason: string | null }>(
          `/usernames/${encodeURIComponent(username.trim())}/availability`,
        );
        setAvailability({
          ok: result.available,
          text: result.available ? t.usernameAvailable : (result.reason ?? ""),
        });
      } catch {
        setAvailability(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [step, username]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
      setTurnstileToken(null);
      setTurnstileKey((key) => key + 1);
    } finally {
      setBusy(false);
    }
  }

  const submitEmailStep = (event: React.FormEvent) => {
    event.preventDefault();
    if (method === "password") {
      void run(async () => {
        await api("/auth/login", {
          method: "POST",
          body: { email, password, turnstile_token: turnstileToken },
        });
        router.push("/profile");
      });
      return;
    }
    void run(async () => {
      await api("/auth/start", {
        method: "POST",
        body: { email, turnstile_token: turnstileToken },
      });
      setCode("");
      setStep("code");
    });
  };

  const checkCode = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api<{ status: "logged_in" | "signup_required" }>("/auth/verify", {
        method: "POST",
        body: { email, code },
      });
      if (result.status === "logged_in") router.push("/profile");
      else setStep("signup");
    });
  };

  const createAccount = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api<MyProfile>("/auth/signup", {
        method: "POST",
        body: {
          username,
          display_name: displayName || null,
          is_adult: isAdult,
          password: newPassword || null,
        },
      });
      router.push("/profile");
    });
  };

  const startOver = () => {
    setStep("email");
    setTurnstileToken(null);
    setTurnstileKey((key) => key + 1);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-5">
      {step === "email" && (
        <form onSubmit={submitEmailStep} className="flex flex-col gap-4">
          <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
          <p className="text-muted">{t.lead}</p>
          <fieldset className="grid grid-cols-2 gap-1 rounded-lg border-2 border-fg p-1">
            <legend className="sr-only">{t.methodLabel}</legend>
            {(["code", "password"] as const).map((option) => (
              <label
                key={option}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md px-2 text-center text-sm font-bold ${
                  method === option ? "bg-fg text-bg" : "text-fg"
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={option}
                  checked={method === option}
                  onChange={() => setMethod(option)}
                  className="sr-only"
                />
                {option === "code" ? t.methodCode : t.methodPassword}
              </label>
            ))}
          </fieldset>
          <label className={label}>
            {t.emailLabel}
            <input
              className={input}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {method === "password" && (
            <>
              <label className={label}>
                {t.passwordLabel}
                <input
                  className={input}
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="-mt-2 self-start text-sm underline"
                onClick={() => setMethod("code")}
              >
                {t.forgotPassword}
              </button>
            </>
          )}
          <div className="flex flex-col gap-1 text-sm">
            <span>{t.humanCheck}</span>
            <Turnstile key={turnstileKey} nonce={nonce} onToken={onToken} />
          </div>
          <button
            type="submit"
            className={primary}
            disabled={busy || !email || !turnstileToken || (method === "password" && !password)}
          >
            {method === "password"
              ? busy
                ? t.loggingIn
                : t.logIn
              : busy
                ? t.sending
                : t.sendCode}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={checkCode} className="flex flex-col gap-4">
          <h1 className="text-4xl leading-tight md:text-5xl">{t.codeTitle}</h1>
          <p className="text-muted">{t.codeLead.replace("{email}", email)}</p>
          <label className={label}>
            {t.codeLabel}
            <input
              className={`${input} text-center text-2xl tracking-[0.5em]`}
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button type="submit" className={primary} disabled={busy || code.length !== 6}>
            {busy ? t.checking : t.checkCode}
          </button>
          <button type="button" className="min-h-12 text-sm underline" onClick={startOver}>
            {t.differentEmail}
          </button>
        </form>
      )}

      {step === "signup" && (
        <form onSubmit={createAccount} className="flex flex-col gap-4">
          <h1 className="text-4xl leading-tight md:text-5xl">{t.signupTitle}</h1>
          <p className="text-muted">{t.signupLead}</p>
          <div className="flex flex-col gap-1">
            <label className={label}>
              {t.usernameLabel}
              <input
                className={input}
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={20}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setAvailability(null);
                }}
                aria-describedby="username-hint"
              />
            </label>
            <span id="username-hint" aria-live="polite" className="text-sm text-muted">
              {availability ? availability.text : t.usernameHint}
            </span>
          </div>
          <label className={label}>
            {t.displayNameLabel}
            <input
              className={input}
              name="display_name"
              autoComplete="nickname"
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <label className={label}>
              {t.newPasswordLabel}
              <input
                className={input}
                type="password"
                name="new_password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-describedby="new-password-hint"
              />
            </label>
            <span id="new-password-hint" className="text-sm text-muted">
              {t.newPasswordHint}
            </span>
          </div>
          <label className="flex min-h-12 items-center gap-3 rounded-md border-2 border-line p-3 text-left">
            <input
              type="checkbox"
              name="is_adult"
              className="h-6 w-6 accent-[var(--color-stamp)]"
              checked={isAdult}
              onChange={(e) => setIsAdult(e.target.checked)}
              required
            />
            <span>
              <span className="block font-bold">{t.adultLabel}</span>
              <span className="block text-sm text-muted">{t.adultHint}</span>
            </span>
          </label>
          <button
            type="submit"
            className={primary}
            disabled={busy || !isAdult || username.trim().length < 3 || availability?.ok === false}
          >
            {busy ? t.creating : t.createAccount}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}
