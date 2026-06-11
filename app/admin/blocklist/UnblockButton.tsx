"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UnblockButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUnblock() {
    if (!window.confirm("Remove this entry from the blocklist? Future scrapes may re-import this event.")) return;
    setLoading(true);
    await fetch(`/api/admin/blocklist/${id}`, {
      method: "DELETE",
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleUnblock}
      disabled={loading}
      className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
    >
      Unblock
    </button>
  );
}
