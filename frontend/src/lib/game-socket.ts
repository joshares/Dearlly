"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { API_URL, api } from "@/lib/api";

/** What the server shows this player (backend app/games/engine.py `view`). */
export type GamePlayer = { id: string; name: string; ready: boolean; online: boolean; skips_left: number };
export type GameRound = {
  number: number;
  format: string;
  format_name: string;
  answer: "choice" | "text" | "truth_dare";
  text: string | null;
  options: string[];
  subject: string | null;
  choice: "truth" | "dare" | null;
  can_answer: boolean;
  answered: string[];
  my_answer: string | null;
  my_choice: number | null;
  my_rating: "up" | "down" | null;
  revealed: boolean;
  answers: Record<string, string> | null;
  match: boolean | null;
  seconds_left: number | null;
};
export type GameSummary = {
  rounds: number;
  matched: number;
  scored: number;
  guesses: Record<string, number>;
  love_languages: Record<string, string | null>;
};
export type GameView = {
  version: number;
  status: "lobby" | "playing" | "ended";
  format: string;
  intensity: string;
  total: number;
  host: string;
  me: string;
  players: GamePlayer[];
  round: GameRound | null;
  summary: GameSummary | null;
};
export type ChatMessage = { id: string; from: string; name: string; text: string; at: string };
export type Move =
  | { t: "ready" }
  | { t: "answer"; value: number | string | null }
  | { t: "pick"; value: "truth" | "dare" }
  | { t: "rate"; value: "up" | "down" }
  | { t: "skip" }
  | { t: "next" }
  | { t: "end" }
  | { t: "chat"; text: string };

export type Connection = "connecting" | "open" | "reconnecting" | "gone" | "denied";

const KEEP_ALIVE_MS = 30_000;
const CLOSE_LOGIN = 4401;
const CLOSE_NOT_ALLOWED = 4403;
const CLOSE_NOT_FOUND = 4404;

export function liveUrl(code: string): string {
  return `${API_URL.replace(/^http/, "ws")}/games/${encodeURIComponent(code)}/live`;
}

/**
 * The live game: the latest view from the server, the chat, and a way to send moves.
 * If the network drops (common on mobile data), it reconnects by itself and picks up where the
 * game is; if the 15-minute login pass expired, it renews it first.
 */
export function useGame(code: string, enabled: boolean) {
  const [view, setView] = useState<GameView | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempts = 0;
    let retry: number | undefined;

    function connect() {
      const ws = new WebSocket(liveUrl(code));
      socket.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnection("open");
      };
      // Cloudflare closes connections that stay quiet for about 100 seconds (a long deep-talk
      // pause would do it), so say a tiny "still here" every 30 seconds.
      const alive = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping" }));
      }, KEEP_ALIVE_MS);
      ws.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        if (message.t === "state") setView(message.state as GameView);
        else if (message.t === "chat_history") setChat(message.messages as ChatMessage[]);
        else if (message.t === "chat") setChat((all) => [...all.slice(-99), message as unknown as ChatMessage]);
        else if (message.t === "error") setError(String(message.detail));
        else if (message.t === "gone") setConnection("gone");
      };
      ws.onclose = (event) => {
        window.clearInterval(alive);
        socket.current = null;
        if (stopped) return;
        if (event.code === CLOSE_LOGIN) {
          // The login pass expired: renew it, then come straight back.
          api("/auth/refresh", { method: "POST" })
            .then(connect)
            .catch(() => setConnection("denied"));
          return;
        }
        if (event.code === CLOSE_NOT_ALLOWED) return setConnection("denied");
        if (event.code === CLOSE_NOT_FOUND) return setConnection("gone");
        setConnection("reconnecting");
        attempts += 1;
        retry = window.setTimeout(connect, Math.min(10_000, 1000 * 2 ** Math.min(attempts - 1, 4)));
      };
    }

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket.current?.close(1000);
    };
  }, [code, enabled]);

  // Errors (a move that isn't allowed right now) show for a few seconds.
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(id);
  }, [error]);

  const send = useCallback((move: Move) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(move));
  }, []);

  return { view, chat, connection, error, send };
}
