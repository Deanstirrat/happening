"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import {
  Calendar,
  Tag,
  MapPin,
  Rss,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Filter,
  Music,
} from "lucide-react";

import { CATEGORY_LABELS, MUSIC_CATEGORIES, SF_NEIGHBORHOODS } from "@/lib/types";

const MUSIC_CATEGORY_SET = new Set(MUSIC_CATEGORIES as readonly string[]);
const MUSIC_GENRE_ENTRIES = Object.entries(CATEGORY_LABELS).filter(([k]) => MUSIC_CATEGORY_SET.has(k));
const OTHER_CATEGORY_ENTRIES = Object.entries(CATEGORY_LABELS).filter(([k]) => !MUSIC_CATEGORY_SET.has(k));

interface Source {
  slug: string;
  name: string;
}

interface FilterSidebarProps {
  sources: Source[];
}

export default function FilterSidebar({ sources }: FilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Read current filter state from URL
  const currentStartDate = searchParams.get("startDate") ?? "";
  const currentEndDate = searchParams.get("endDate") ?? "";
  const currentCategories = searchParams.getAll("category");
  const currentNeighborhoods = searchParams.getAll("neighborhood");
  const currentSources = searchParams.getAll("source");
  const currentFreeOnly = searchParams.get("isFree") === "true";

  // Local state (apply on button click)
  const [startDate, setStartDate] = useState(currentStartDate);
  const [endDate, setEndDate] = useState(currentEndDate);
  const [categories, setCategories] = useState<string[]>(currentCategories);
  const [neighborhoods, setNeighborhoods] = useState<string[]>(currentNeighborhoods);
  const [selectedSources, setSelectedSources] = useState<string[]>(currentSources);
  const [freeOnly, setFreeOnly] = useState(currentFreeOnly);

  const [musicOpen, setMusicOpen] = useState(
    currentCategories.some((c) => MUSIC_CATEGORY_SET.has(c))
  );

  const [openSections, setOpenSections] = useState({
    date: true,
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

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    categories.forEach((c) => params.append("category", c));
    neighborhoods.forEach((n) => params.append("neighborhood", n));
    selectedSources.forEach((s) => params.append("source", s));
    if (freeOnly) params.set("isFree", "true");
    // preserve search and hideMusic (managed outside the filter tray)
    const search = searchParams.get("search");
    if (search) params.set("search", search);
    const hideMusic = searchParams.get("hideMusic");
    if (hideMusic) params.set("hideMusic", hideMusic);
    router.push(`${pathname}?${params.toString()}`);
  }, [startDate, endDate, categories, neighborhoods, selectedSources, freeOnly, searchParams, router, pathname]);

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
    setNeighborhoods([]);
    setSelectedSources([]);
    setFreeOnly(false);
    setMusicOpen(false);
    router.push(pathname);
  };

  const hasFilters =
    startDate || endDate || categories.length || neighborhoods.length || selectedSources.length || freeOnly;

  const activeFilterCount =
    (startDate ? 1 : 0) + (endDate ? 1 : 0) + categories.length + neighborhoods.length + selectedSources.length + (freeOnly ? 1 : 0);

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

    <aside className={`flex flex-col ${mobileOpen ? "max-h-[70vh]" : "hidden"} lg:flex lg:max-h-none overflow-hidden`}>
      {/* Scrollable filter sections */}
      <div className="flex-1 overflow-y-auto lg:overflow-visible flex flex-col gap-1">
        <p className="font-body text-[0.6rem] font-semibold uppercase tracking-widest text-on-surface-variant mb-2 px-1 hidden lg:block">
          Filters
        </p>

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
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-surface-container-low text-on-surface text-xs px-3 py-2 rounded-DEFAULT outline-none font-body"
          />
        </Section>

        {/* Category */}
        <Section
          icon={<Tag size={13} />}
          label="Category"
          open={openSections.category}
          onToggle={() => toggleSection("category")}
          activeCount={categories.length}
        >
          <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto no-scrollbar">
            {OTHER_CATEGORY_ENTRIES.map(([value, label]) => (
              <button
                key={value}
                onClick={() => toggleMulti(value, categories, setCategories)}
                className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors ${
                  categories.includes(value)
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
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
                  {musicOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </span>
              </button>
              {musicOpen && (
                <div className="flex flex-col gap-0.5 pl-3 mt-0.5">
                  {MUSIC_GENRE_ENTRIES.map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => toggleMulti(value, categories, setCategories)}
                      className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors ${
                        categories.includes(value)
                          ? "bg-secondary-container text-on-secondary-container"
                          : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                      }`}
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
          <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto no-scrollbar">
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
          activeCount={selectedSources.length}
        >
          <div className="flex flex-col gap-0.5">
            {sources.map((s) => (
              <button
                key={s.slug}
                onClick={() => toggleMulti(s.slug, selectedSources, setSelectedSources)}
                className={`text-left text-xs px-2 py-1 rounded-DEFAULT font-body transition-colors ${
                  selectedSources.includes(s.slug)
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
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

      {/* Actions — pinned to bottom on mobile, normal flow on desktop */}
      <div className="mt-3 flex flex-col gap-2 bg-surface pb-1 shrink-0">
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
