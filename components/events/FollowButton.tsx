"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Plus } from "lucide-react";

type FollowTargetType = "VENUE" | "CATEGORY" | "ARTIST";

interface FollowButtonProps {
  targetType: FollowTargetType;
  targetId: string;
  /** What's being followed, e.g. "Electronic" or "The Chapel" — used in the label. */
  label: string;
  isSignedIn: boolean;
  initialFollowing: boolean;
}

/**
 * Follow/unfollow a venue, category, or artist (issue #98). Signed-out visitors
 * are sent to /login (the follow only exists on an account). Optimistic toggle,
 * reconciled against the server's authoritative state.
 */
export default function FollowButton({
  targetType,
  targetId,
  label,
  isSignedIn,
  initialFollowing,
}: FollowButtonProps) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (!isSignedIn) {
      router.push("/login");
      return;
    }
    if (pending) return;

    const next = !following;
    setFollowing(next); // optimistic
    setPending(true);
    try {
      const res = await fetch("/api/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, following: next }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      if (typeof data.following === "boolean") setFollowing(data.following);
      else throw new Error("bad response");
    } catch {
      setFollowing(!next); // revert
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${label}` : `Follow ${label}`}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-body font-semibold uppercase tracking-wider transition-colors ${
        following
          ? "bg-primary/15 text-primary ring-1 ring-primary/40 hover:bg-primary/25"
          : "bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest"
      }`}
    >
      {following ? <Check size={11} className="shrink-0" /> : <Plus size={11} className="shrink-0" />}
      {following ? "following" : "follow"}
    </button>
  );
}
