"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Chip {
  id: number;
  name: string;
}

type SyncStatus = "syncing" | "complete" | "error";

export default function SpotifyConnectingPage() {
  const router = useRouter();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");
  const [totalFound, setTotalFound] = useState(0);
  const [chips, setChips] = useState<Chip[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const pendingQueue = useRef<string[]>([]);
  const chipId = useRef(0);
  const drainTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startDraining = useCallback(() => {
    if (drainTimer.current) return;
    drainTimer.current = setInterval(() => {
      const batch = pendingQueue.current.splice(0, 3);
      if (batch.length === 0) return;
      setChips((prev) => {
        const next = [...prev, ...batch.map((name) => ({ id: chipId.current++, name }))];
        return next.length > 60 ? next.slice(-60) : next;
      });
    }, 140);
  }, []);

  useEffect(() => {
    startDraining();

    const es = new EventSource("/api/spotify/sync");

    es.onmessage = (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as
        | { type: "artists"; names: string[] }
        | { type: "complete"; count: number }
        | { type: "error"; message: string };

      if (data.type === "artists") {
        pendingQueue.current.push(...data.names);
        setTotalFound((n) => n + data.names.length);
      } else if (data.type === "complete") {
        setTotalFound(data.count);
        setSyncStatus("complete");
        es.close();
      } else if (data.type === "error") {
        setErrorMsg(data.message);
        setSyncStatus("error");
        es.close();
      }
    };

    es.onerror = () => {
      setErrorMsg("Connection interrupted. Your library may still be syncing.");
      setSyncStatus("error");
      es.close();
    };

    return () => {
      es.close();
      if (drainTimer.current) clearInterval(drainTimer.current);
    };
  }, [startDraining]);

  useEffect(() => {
    if (syncStatus !== "complete") return;
    const t = setTimeout(() => router.push("/?forYou=true"), 2200);
    return () => clearTimeout(t);
  }, [syncStatus, router]);

  return (
    <>
      <style>{`
        @keyframes ring-pulse {
          0%   { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes chip-in {
          from { opacity: 0; transform: scale(0.75) translateY(6px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes count-pop {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        .ring { position: absolute; inset: 0; border-radius: 9999px; background: #1DB954; }
        .ring-1 { animation: ring-pulse 2s ease-out infinite; }
        .ring-2 { animation: ring-pulse 2s ease-out 0.65s infinite; }
        .ring-3 { animation: ring-pulse 2s ease-out 1.3s infinite; }
        .chip-enter { animation: chip-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .count-pop  { animation: count-pop 0.25s ease-out; }
      `}</style>

      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-16 select-none">
        {/* Pulsing Spotify logo */}
        <div className="relative w-20 h-20 flex items-center justify-center mb-10">
          <div className="ring ring-1" style={{ opacity: 0.3 }} />
          <div className="ring ring-2" style={{ opacity: 0.2 }} />
          <div className="ring ring-3" style={{ opacity: 0.1 }} />
          <div
            className="relative z-10 w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: "#1DB954", boxShadow: "0 0 32px #1DB95440" }}
          >
            <SpotifyIcon className="w-10 h-10 text-black" />
          </div>
        </div>

        {/* Heading */}
        <div className="text-center mb-1">
          {syncStatus === "syncing" && (
            <h1 className="text-2xl font-headline font-semibold text-on-surface tracking-tight">
              Scanning your library
              <Dots />
            </h1>
          )}
          {syncStatus === "complete" && (
            <h1 className="text-2xl font-headline font-semibold tracking-tight" style={{ color: "#1DB954" }}>
              Library connected
            </h1>
          )}
          {syncStatus === "error" && (
            <h1 className="text-2xl font-headline font-semibold text-red-400 tracking-tight">
              Something went wrong
            </h1>
          )}
        </div>

        {/* Subtitle / count */}
        <p className="text-on-surface-variant text-sm font-body mb-10 h-5">
          {syncStatus === "syncing" && totalFound > 0 &&
            `${totalFound.toLocaleString()} unique artists found so far`}
          {syncStatus === "complete" &&
            `Found ${totalFound.toLocaleString()} artists — heading to your events`}
          {syncStatus === "error" && errorMsg}
        </p>

        {syncStatus === "error" && (
          <a
            href="/?forYou=true"
            className="mb-8 text-sm font-body underline"
            style={{ color: "#1DB954" }}
          >
            Continue to events anyway
          </a>
        )}

        {/* Artist chips */}
        {chips.length > 0 && (
          <div className="max-w-xl w-full flex flex-wrap gap-2 justify-center">
            {chips.map((chip) => (
              <span
                key={chip.id}
                className="chip-enter px-3 py-1 rounded-full text-xs font-body border"
                style={{
                  background: "#1DB95414",
                  color: "#1DB954",
                  borderColor: "#1DB95430",
                }}
              >
                {chip.name}
              </span>
            ))}
          </div>
        )}

        {syncStatus === "syncing" && totalFound === 0 && (
          <div className="flex gap-1.5 mt-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: "#1DB954",
                  animation: `ring-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  opacity: 0.7,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Dots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const iv = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 420);
    return () => clearInterval(iv);
  }, []);
  return <span className="inline-block w-5 text-left">{dots}</span>;
}

function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}
