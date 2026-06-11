"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!window.confirm("Delete this event? This cannot be undone.")) return;
    setLoading(true);
    await fetch(`/api/admin/events/${id}`, {
      method: "DELETE",
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 transition-colors disabled:opacity-50"
    >
      Delete
    </button>
  );
}
