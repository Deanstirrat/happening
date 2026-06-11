"use client";

import { useState } from "react";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";

type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
};

interface Props {
  users: User[];
}

export default function UserActions({ users: initial }: Props) {
  const [users, setUsers] = useState<User[]>(initial);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, name }),
    });

    if (res.ok) {
      const user = await res.json();
      setUsers((prev) => [user, ...prev.filter((u) => u.id !== user.id)]);
      setEmail("");
      setName("");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create user.");
    }
    setCreating(false);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
    }
    setDeletingId(null);
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Create form */}
      <form onSubmit={handleCreate} className="bg-surface-container rounded-xl p-5 flex flex-col gap-3">
        <p className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
          Grant access
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-[2] bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={creating}
            className="btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50 shrink-0"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add
          </button>
        </div>
        {error && <p className="text-xs font-body text-red-400">{error}</p>}
      </form>

      {/* User list */}
      {users.length === 0 ? (
        <p className="font-body text-sm text-on-surface-variant">No editor accounts yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between bg-surface-container rounded-xl px-4 py-3"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-body text-sm text-on-surface truncate">
                  {user.name ? `${user.name} — ` : ""}{user.email}
                </span>
                <span className="font-body text-[10px] text-on-surface-variant">
                  {user.role.toLowerCase()} · added {format(new Date(user.createdAt), "MMM d, yyyy")}
                </span>
              </div>
              <button
                onClick={() => handleDelete(user.id)}
                disabled={deletingId === user.id}
                className="ml-4 text-on-surface-variant hover:text-red-400 transition-colors disabled:opacity-50 shrink-0"
                title="Revoke access"
              >
                {deletingId === user.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
