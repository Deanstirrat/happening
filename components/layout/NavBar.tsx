"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useState } from "react";

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchVal, setSearchVal] = useState(searchParams.get("search") ?? "");
  const [searchFocused, setSearchFocused] = useState(false);

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
      <nav className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2 sm:gap-6">
        {/* Logo */}
        <Link
          href="/events"
          className="font-headline font-bold text-xl text-on-surface tracking-tight shrink-0"
        >
          happening
        </Link>

        {/* Nav links — hidden on mobile when search is focused */}
        <div className={`flex items-center shrink-0 transition-all duration-200 ${searchFocused ? "hidden sm:flex" : "flex"}`}>
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

        {/* Search — takes remaining space, expands on focus */}
        <form
          onSubmit={handleSearch}
          className="flex-1 min-w-0 sm:max-w-sm transition-all duration-200"
        >
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
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="w-full bg-surface-container-low text-on-surface text-base sm:text-sm pl-9 pr-4 py-2 rounded-full outline-none focus:bg-surface-container placeholder:text-on-surface-variant font-body transition-colors"
            />
          </div>
        </form>
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
      className={`font-body text-xs font-semibold uppercase tracking-widest px-2 sm:px-3 py-1.5 rounded-full transition-colors ${
        active
          ? "text-on-surface bg-surface-container"
          : "text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {children}
    </Link>
  );
}
