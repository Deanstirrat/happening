"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import {
  Calendar,
  Clock,
  Tag,
  MapPin,
  Rss,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Filter,
  Music,
  Music2,
} from "lucide-react";

import { CATEGORY_LABELS, MUSIC_CATEGORIES, SF_NEIGHBORHOODS } from "@/lib/types";

const MUSIC_CATEGORY_SET = new Set(MUSIC_CATEGORIES as readonly string[]);
const MUSIC_GENRE_ENTRIES = Object.entries(CATEGORY_LABELS).filter(([k]) => MUSIC_CATEGORY_SET.has(k)).sort(([, a], [, b]) => a.localeCompare(b));
const OTHER_CATEGORY_ENTRIES = Object.entries(CATEGORY_LABELS).filter(([k]) => !MUSIC_CATEGORY_SET.has(k)).sort(([, a], [, b]) => a.localeCompare(b));

interface Source {
  slug: string;
  name: string;
}

interface FilterSidebarProps {
  sources: Source[];
  spotifyConnected?: boolean;
  spotifyArtistCount?: number;
}

export default function FilterSidebar({ sources, spotifyConnected = false, spotifyArtistCount = 0 }: FilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const currentForYou = searchParams.get("forYou") === "true";
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/spotify/disconnect", { method: "POST" });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("forYou");
    router.push(`${pathname}?${params.toString()}`);
    router.refresh();
  }

  function toggleForYou() {
    const params = new URLSearchParams(searchParams.toString());
    if (currentForYou) {
      params.delete("forYou");
    } else {
      params.set("forYou", "true");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  // Read current filter state from URL
  const currentStartDate = searchParams.get("startDate") ?? "";
  const currentEndDate = searchParams.get("endDate") ?? "";
  const currentCategories = searchParams.getAll("category");
  const currentExcludedCategories = searchParams.getAll("excludeCategory");
  const currentNeighborhoods = searchParams.getAll("neighborhood");
  const currentSources = searchParams.getAll("source");
  const currentExcludedSources = searchParams.getAll("excludeSource");
  const currentFreeOnly = searchParams.get("isFree") === "true";
  const currentTimeOfDay = searchParams.get("timeOfDay") ?? "";

  // Local state (apply on button click)
  const [startDate, setStartDate] = useState(currentStartDate);
  const [endDate, setEndDate] = useState(currentEndDate);
  const [categories, setCategories] = useState<string[]>(currentCategories);
  const [excludedCategories, setExcludedCategories] = useState<string[]>(currentExcludedCategories);
  const [neighborhoods, setNeighborhoods] = useState<string[]>(currentNeighborhoods);
  const [selectedSources, setSelectedSources] = useState<string[]>(currentSources);
  const [excludedSources, setExcludedSources] = useState<string[]>(currentExcludedSources);
  const [freeOnly, setFreeOnly] = useState(currentFreeOnly);
  const [timeOfDay, setTimeOfDay] = useState(currentTimeOfDay);

  const [musicOpen, setMusicOpen] = useState(
    currentCategories.some((c) => MUSIC_CATEGORY_SET.has(c)) ||
    currentExcludedCategories.some((c) => MUSIC_CATEGORY_SET.has(c))
  );

  const [openSections, setOpenSections] = useState({
    date: true,
    timeOfDay: false,
    category: true,
    neighborhood: false,
    source: false,
    price: false,
  });

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleMulti = (
    value: string,
    list: string[],
    setList: (v: string[]) => void
  ) => {
    setList(
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    );
  };

  // Cycles: neutral → include → exclude → neutral
  const cycleFilter = (
    value: string,
    included: string[],
    excluded: string[],
    setIncluded: (v: string[]) => void,
    setExcluded: (v: string[]) => void
  ) => {
    if (included.includes(value)) {
      setIncluded(included.filter((v) => v !== value));
      setExcluded([...excluded, value]);
    } else if (excluded.includes(value)) {
      setExcluded(excluded.filter((v) => v !== value));
    } else {
      setIncluded([...included, value]);
    }
  };

  const filterItemClass = (value: string, included: string[], excluded: string[]) => {
    if (included.includes(value)) return "bg-secondary-container text-on-secondary-container";
    if (excluded.includes(value)) return "bg-error-container text-on-error-container line-through opacity-70";
    return "text-on-surface-variant hover:text-on-surface hover:bg-surface-container";
  };

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    categories.forEach((c) => params.append("category", c));
    excludedCategories.forEach((c) => params.append("excludeCategory", c));
    neighborhoods.forEach((n) => params.append("neighborhood", n));
    selectedSources.forEach((s) => params.append("source", s));
    excludedSources.forEach((s) => params.append("excludeSource", s));
    if (freeOnly) params.set("isFree", "true");
    if (timeOfDay) params.set("timeOfDay", timeOfDay);
    // preserve search and quick-toggle params (managed outside the filter tray)
    const search = searchParams.get("search");
    if (search) params.set("search", search);
    const hideMusic = searchParams.get("hideMusic");
    if (hideMusic) params.set("hideMusic", hideMusic);
    const hideRecurring = searchParams.get("hideRecurring");
    if (hideRecurring) params.set("hideRecurring", hideRecurring);
    const forYou = searchParams.get("forYou");
    if (forYou) params.set("forYou", forYou);
    router.push(`${pathname}?${params.toString()}`);
  }, [startDate, endDate, categories, excludedCategories, neighborhoods, selectedSources, excludedSources, freeOnly, timeOfDay, searchParams, router, pathname]);

  const applyToday = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    setStartDate(today);
    setEndDate(today);
    const params = new URLSearchParams();
    params.set("startDate", today);
    params.set("endDate", today);
    const search = searchParams.get("search");
    if (search) params.set("search", search);
    router.push(`${pathname}?${params.toString()}`);
  }, [searchParams, router, pathname]);

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setCategories([]);
    setExcludedCategories([]);
    setNeighborhoods([]);
    setSelectedSources([]);
    setExcludedSources([]);
    setFreeOnly(false);
    setTimeOfDay("");
    setMusicOpen(false);
    router.push(pathname);
  };

  const hasFilters =
    startDate || endDate || categories.length || excludedCategories.length || neighborhoods.length || selectedSources.length || excludedSources.length || freeOnly || timeOfDay;

  const activeFilterCount =
    (startDate ? 1 : 0) + (endDate ? 1 : 0) + categories.length + excludedCategories.length + neighborhoods.length + selectedSources.length + excludedSources.length + (freeOnly ? 1 : 0) + (timeOfDay ? 1 : 0);

  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="w-full">
      {/* Mobile toggle button */}
      <button
        className="lg:hidden w-full flex items-center justify-between px-3 py-2.5 bg-surface-container rounded-DEFAULT font-body text-xs mb-1"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <span className="flex items-center gap-2 font-semibold uppercase tracking-widest text-on-surface-variant">
          <Filter size={13} />
          Filters
          {activeFilterCount > 0 && (
            <span className="text-[0.6rem] font-semibold leading-none px-1.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container">
              {activeFilterCount}
            </span>
          )}
        </span>
        {mobileOpen ? (
          <ChevronUp size={12} className="text-on-surface-variant" />
        ) : (
          <ChevronDown size={12} className="text-on-surface-variant" />
        )}
      </button>

    <aside className={`flex flex-col gap-1 ${mobileOpen ? "" : "hidden"} lg:flex`}>
      {/* Scrollable filter sections — bounded height on mobile so button stays visible */}
      <div className="flex flex-col gap-1">
        <p className="font-body text-[0.6rem] font-semibold uppercase tracking-widest text-on-surface-variant mb-2 px-1 hidden lg:block">
          Filters
        </p>

        {/* Spotify */}
        <div className="rounded-DEFAULT overflow-hidden mb-1">
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-2 text-on-surface-variant font-body text-xs font-medium uppercase tracking-wider mb-2">
              <Music2 size={13} />
              For You
              <span className="text-[0.55rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant/60 normal-case">
                coming soon
              </span>
            </div>
            {spotifyConnected ? (
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={toggleForYou}
                  className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors w-full flex items-center justify-between ${
                    currentForYou
                      ? "bg-[#1DB954]/20 text-[#1DB954]"
                      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                  }`}
                >
                  <span>My artists</span>
                  {spotifyArtistCount > 0 && (
                    <span className="text-[0.6rem] font-semibold opacity-70">
                      {spotifyArtistCount.toLocaleString()}
                    </span>
                  )}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-left text-[0.65rem] px-2 py-0.5 font-body text-on-surface-variant/50 hover:text-on-surface-variant transition-colors"
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect Spotify"}
                </button>
              </div>
            ) : (
              <a
                href="/api/spotify/auth"
                className="flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-DEFAULT font-body font-semibold transition-colors bg-[#1DB954]/10 text-[#1DB954] hover:bg-[#1DB954]/20 w-full"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                Connect Spotify
              </a>
            )}
          </div>
        </div>

        {/* Date */}
        <Section
          icon={<Calendar size={13} />}
          label="Date"
          open={openSections.date}
          onToggle={() => toggleSection("date")}
          activeCount={(startDate ? 1 : 0) + (endDate ? 1 : 0)}
        >
          <button
            onClick={applyToday}
            className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors w-full mb-2 ${
              currentStartDate === new Date().toISOString().slice(0, 10) &&
              currentEndDate === new Date().toISOString().slice(0, 10)
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
            }`}
          >
            Today
          </button>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full bg-surface-container-low text-on-surface text-xs px-3 py-2 rounded-DEFAULT outline-none font-body mb-1"
            style={{ colorScheme: "dark" }}
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-surface-container-low text-on-surface text-xs px-3 py-2 rounded-DEFAULT outline-none font-body"
            style={{ colorScheme: "dark" }}
          />
        </Section>

        {/* Time of Day */}
        <Section
          icon={<Clock size={13} />}
          label="Time of Day"
          open={openSections.timeOfDay}
          onToggle={() => toggleSection("timeOfDay")}
          activeCount={timeOfDay ? 1 : 0}
        >
          <div className="flex flex-col gap-0.5">
            {(["morning", "afternoon", "evening", "night"] as const).map((bucket) => (
              <button
                key={bucket}
                onClick={() => setTimeOfDay(timeOfDay === bucket ? "" : bucket)}
                className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors capitalize ${
                  timeOfDay === bucket
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
                {bucket === "morning" && "Morning (6am–noon)"}
                {bucket === "afternoon" && "Afternoon (noon–6pm)"}
                {bucket === "evening" && "Evening (6pm–10pm)"}
                {bucket === "night" && "Night (10pm–6am)"}
              </button>
            ))}
          </div>
        </Section>

        {/* Category */}
        <Section
          icon={<Tag size={13} />}
          label="Category"
          open={openSections.category}
          onToggle={() => toggleSection("category")}
          activeCount={categories.length + excludedCategories.length}
        >
          <div className="flex flex-col gap-0.5">
            {OTHER_CATEGORY_ENTRIES.map(([value, label]) => (
              <button
                key={value}
                onClick={() => cycleFilter(value, categories, excludedCategories, setCategories, setExcludedCategories)}
                className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors ${filterItemClass(value, categories, excludedCategories)}`}
              >
                {label}
              </button>
            ))}
            {/* Music — expandable sub-category */}
            <div>
              <button
                onClick={() => setMusicOpen((v) => !v)}
                className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors w-full flex items-center justify-between ${
                  categories.some((c) => MUSIC_CATEGORY_SET.has(c))
                    ? "bg-secondary-container text-on-secondary-container"
                    : excludedCategories.some((c) => MUSIC_CATEGORY_SET.has(c))
                    ? "bg-error-container text-on-error-container opacity-70"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Music size={10} />
                  Music
                </span>
                <span className="flex items-center gap-1">
                  {categories.filter((c) => MUSIC_CATEGORY_SET.has(c)).length > 0 && (
                    <span className="text-[0.6rem] font-semibold leading-none px-1 py-0.5 rounded-full bg-secondary text-on-secondary">
                      {categories.filter((c) => MUSIC_CATEGORY_SET.has(c)).length}
                    </span>
                  )}
                  {excludedCategories.filter((c) => MUSIC_CATEGORY_SET.has(c)).length > 0 && (
                    <span className="text-[0.6rem] font-semibold leading-none px-1 py-0.5 rounded-full bg-error text-on-error">
                      -{excludedCategories.filter((c) => MUSIC_CATEGORY_SET.has(c)).length}
                    </span>
                  )}
                  {musicOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </span>
              </button>
              {musicOpen && (
                <div className="flex flex-col gap-0.5 pl-3 mt-0.5">
                  {MUSIC_GENRE_ENTRIES.map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => cycleFilter(value, categories, excludedCategories, setCategories, setExcludedCategories)}
                      className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors ${filterItemClass(value, categories, excludedCategories)}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* Neighborhood */}
        <Section
          icon={<MapPin size={13} />}
          label="Neighborhood"
          open={openSections.neighborhood}
          onToggle={() => toggleSection("neighborhood")}
          activeCount={neighborhoods.length}
        >
          <div className="flex flex-col gap-0.5">
            {SF_NEIGHBORHOODS.map((n) => (
              <button
                key={n}
                onClick={() => toggleMulti(n, neighborhoods, setNeighborhoods)}
                className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors ${
                  neighborhoods.includes(n)
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </Section>

        {/* Source */}
        <Section
          icon={<Rss size={13} />}
          label="Source"
          open={openSections.source}
          onToggle={() => toggleSection("source")}
          activeCount={selectedSources.length + excludedSources.length}
        >
          <div className="flex flex-col gap-0.5">
            {sources.map((s) => (
              <button
                key={s.slug}
                onClick={() => cycleFilter(s.slug, selectedSources, excludedSources, setSelectedSources, setExcludedSources)}
                className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors ${filterItemClass(s.slug, selectedSources, excludedSources)}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </Section>

        {/* Free only */}
        <Section
          icon={<DollarSign size={13} />}
          label="Price"
          open={openSections.price}
          onToggle={() => toggleSection("price")}
          activeCount={freeOnly ? 1 : 0}
        >
          <button
            onClick={() => setFreeOnly(!freeOnly)}
            className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors w-full ${
              freeOnly
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
            }`}
          >
            Free only
          </button>
        </Section>
      </div>

      {/* Actions — sticky to bottom of whichever scrolling container wraps this */}
      <div className="sticky bottom-0 mt-3 flex flex-col gap-2 bg-surface-container-low pb-1 shrink-0">
        <button
          onClick={() => { applyFilters(); setMobileOpen(false); }}
          className="btn-primary w-full text-xs py-2.5 font-semibold"
        >
          Apply Filters
        </button>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-on-surface-variant hover:text-on-surface text-xs font-body text-center transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
    </aside>
    </div>
  );
}

function Section({
  icon,
  label,
  open,
  onToggle,
  children,
  activeCount,
}: {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  activeCount?: number;
}) {
  return (
    <div className="rounded-DEFAULT overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-surface-container transition-colors"
      >
        <span className="flex items-center gap-2 text-on-surface-variant font-body text-xs font-medium uppercase tracking-wider">
          {icon}
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          {!open && !!activeCount && (
            <span className="text-[0.6rem] font-semibold leading-none px-1.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container">
              {activeCount}
            </span>
          )}
          {open ? (
            <ChevronUp size={12} className="text-on-surface-variant" />
          ) : (
            <ChevronDown size={12} className="text-on-surface-variant" />
          )}
        </span>
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}
