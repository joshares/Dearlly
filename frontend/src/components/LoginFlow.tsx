"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Turnstile } from "@/components/Turnstile";
import { getMessages } from "@/i18n";
import { API_URL, ApiError, api, forgetRemembered, type MyProfile } from "@/lib/api";

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

/**
 * `from` is where Google sent the browser back: "signup" for new people (Google proved the
 * email; they still pick a username and tick 18+), "google-error" when it failed.
 */
export function LoginFlow({
  nonce,
  from,
  next = "/profile",
  checking = false,
}: {
  nonce?: string;
  /** The browser says it's probably logged in: confirm quietly before showing the form. */
  checking?: boolean;
  from?: "signup" | "google-error";
  /** Where to go once logged in (already checked with safeNext). */
  next?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(from === "signup" ? "signup" : "email");
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
  const [error, setError] = useState<string | null>(
    from === "google-error" ? t.googleFailed : null,
  );

  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [confirming, setConfirming] = useState(checking);

  // Logged in (as anyone): drop what this tab remembered, and go on without leaving
  // the login page in the back-button history.
  const done = useCallback(() => {
    forgetRemembered();
    router.replace(next);
    router.refresh();
  }, [router, next]);

  // Already logged in? Renewing the session answers it, and also sets the "logged in" hint
  // for sessions started before the hint existed.
  useEffect(() => {
    if (from === "signup") return;
    api("/auth/refresh", { method: "POST" })
      .then(done)
      .catch(() => setConfirming(false));
  }, [from, done]);

  const onToken = useCallback((token: string | null) => setTurnstileToken(token), []);

  // Show "Continue with Google" only when the server has it switched on.
  useEffect(() => {
    api<{ google: boolean }>("/auth/providers")
      .then((providers) => setGoogleEnabled(providers.google))
      .catch(() => setGoogleEnabled(false));
  }, []);

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
        done();
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
      if (result.status === "logged_in") done();
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
      done();
    });
  };

  const startOver = () => {
    setStep("email");
    setTurnstileToken(null);
    setTurnstileKey((key) => key + 1);
    setError(null);
  };

  if (confirming) {
    return (
      <p role="status" className="font-hand py-10 text-center text-lg text-muted">
        {t.checking}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {step === "email" && (
        <form onSubmit={submitEmailStep} className="flex flex-col gap-4">
          <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
          <p className="text-muted">{t.lead}</p>
          {googleEnabled && (
            <>
              <a
                href={`${API_URL}/auth/google/start`}
                className="flex min-h-14 items-center justify-center gap-3 rounded-lg border-2 border-fg bg-white px-4 text-base font-bold whitespace-nowrap text-[#1F1F1F] sm:text-lg"
              >
                <GoogleMark />
                {t.google}
              </a>
              <p className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                {t.or}
                <span className="h-px flex-1 bg-line" />
              </p>
            </>
          )}
          <fieldset className="grid grid-cols-2 gap-1 rounded-lg border-2 border-fg p-1">
            <legend className="sr-only">{t.methodLabel}</legend>
            {(["code", "password"] as const).map((option) => (
              <label
                key={option}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md px-1 text-center text-[13px] font-bold whitespace-nowrap sm:text-sm ${
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

/** Google's "G" mark, as their sign-in branding guidelines ask. */
function GoogleMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.6 28.5c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
