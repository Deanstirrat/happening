"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Bell } from "lucide-react";
import { useState } from "react";

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchVal, setSearchVal] = useState(searchParams.get("search") ?? "");

  const isActive = (href: string) => pathname.startsWith(href);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (searchVal) {
      params.set("search", searchVal);
    } else {
      params.delete("search");
    }
    router.push(`/events?${params.toString()}`);
  }

  return (
    <header className="sticky top-0 z-50 glass">
      <nav className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-6">
        {/* Logo */}
        <Link
          href="/events"
          className="font-headline font-bold text-xl text-on-surface tracking-tight shrink-0"
        >
          happening
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          <NavLink href="/events" active={isActive("/events") && !isActive("/map") && !isActive("/submit")}>
            explore
          </NavLink>
          <NavLink href="/map" active={isActive("/map")}>
            map
          </NavLink>
          <NavLink href="/submit" active={isActive("/submit")}>
            submit
          </NavLink>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-sm">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              type="text"
              placeholder="Search events..."
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              className="w-full bg-surface-container-low text-on-surface text-sm pl-9 pr-4 py-2 rounded-full outline-none focus:bg-surface-container placeholder:text-on-surface-variant font-body transition-colors"
            />
          </div>
        </form>

        <div className="flex items-center gap-3 ml-auto">
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1">
            <Bell size={18} />
          </button>
        </div>
      </nav>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`font-body text-xs font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full transition-colors ${
        active
          ? "text-on-surface bg-surface-container"
          : "text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {children}
    </Link>
  );
}
