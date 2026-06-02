"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";

interface DataPoint {
  hour: string; // ISO string for start of hour (hourly) or start of day (daily)
  visits: number;
  unique: number;
}

interface Props {
  data: DataPoint[];
  xLabelStep?: number;
  mode?: "hourly" | "daily";
}

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length === 1 ? `M ${pts[0][0]} ${pts[0][1]}` : "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cpx = (x0 + x1) / 2;
    d += ` C ${cpx} ${y0} ${cpx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

export default function VisitorLineChart({ data, xLabelStep = 6, mode = "hourly" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 160 });
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    point: DataPoint;
    idx: number;
  } | null>(null);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setDims({ w: rect.width, h: rect.height });
    });
    if (svgRef.current?.parentElement) obs.observe(svgRef.current.parentElement);
    return () => obs.disconnect();
  }, []);

  const PAD = { top: 16, right: 16, bottom: 32, left: 36 };
  const W = dims.w - PAD.left - PAD.right;
  const H = dims.h - PAD.top - PAD.bottom;

  const maxV = Math.max(...data.map((d) => d.visits), 1);
  const yTop = Math.ceil(maxV * 1.15);

  const toX = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * W;
  const toY = (v: number) => PAD.top + H - (v / yTop) * H;

  const pts: [number, number][] = data.map((d, i) => [toX(i), toY(d.visits)]);
  const linePath = smoothPath(pts);

  const baseY = PAD.top + H;
  const areaPath =
    linePath +
    (pts.length > 0
      ? ` L ${pts[pts.length - 1][0]} ${baseY} L ${pts[0][0]} ${baseY} Z`
      : "");

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) =>
    Math.round((yTop / yTickCount) * i)
  );

  const xLabels = mode === "daily"
    ? data.map((d, i) => ({ i, d })).filter(({ i }) => i % xLabelStep === 0)
    : data.map((d, i) => ({ i, d })).filter(({ d }) => new Date(d.hour).getHours() % xLabelStep === 0);

  const hoverRadius = W / Math.max(data.length, 1) / 2;

  function formatXLabel(iso: string): string {
    if (mode === "daily") return format(new Date(iso), "MMM d");
    return format(new Date(iso), "ha").toLowerCase();
  }

  function formatTooltipDate(iso: string): string {
    if (mode === "daily") return format(new Date(iso), "EEE, MMM d");
    return format(new Date(iso), "MMM d, ha").toLowerCase();
  }

  return (
    <div className="relative w-full" style={{ height: "200px" }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onMouseLeave={() => setTooltip(null)}
        onMouseMove={(e) => {
          const rect = svgRef.current!.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const d = Math.abs(pts[i][0] - mx);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
          if (bestDist < hoverRadius + 24) {
            setTooltip({ x: pts[best][0], y: pts[best][1], point: data[best], idx: best });
          } else {
            setTooltip(null);
          }
        }}
      >
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffb3b5" />
            <stop offset="100%" stopColor="#ff727c" />
          </linearGradient>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff727c" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#ff727c" stopOpacity="0.01" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left} x2={PAD.left + W}
              y1={toY(v)} y2={toY(v)}
              stroke="#353534" strokeWidth="1" strokeDasharray="4 4"
            />
            <text
              x={PAD.left - 6} y={toY(v)}
              textAnchor="end" dominantBaseline="middle"
              fill="#6b6a69" fontSize="10"
              fontFamily="Plus Jakarta Sans, sans-serif"
            >
              {v}
            </text>
          </g>
        ))}

        {xLabels.map(({ i, d }) => (
          <text
            key={i}
            x={toX(i)} y={PAD.top + H + 20}
            textAnchor="middle" fill="#6b6a69" fontSize="10"
            fontFamily="Plus Jakarta Sans, sans-serif"
          >
            {formatXLabel(d.hour)}
          </text>
        ))}

        {data.length > 1 && <path d={areaPath} fill="url(#areaGrad)" />}
        {data.length > 1 && (
          <path
            d={linePath} fill="none"
            stroke="url(#lineGrad)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            filter="url(#glow)"
          />
        )}

        {tooltip && (
          <line
            x1={tooltip.x} x2={tooltip.x}
            y1={PAD.top} y2={PAD.top + H}
            stroke="#ff727c" strokeWidth="1"
            strokeOpacity="0.4" strokeDasharray="3 3"
          />
        )}

        {tooltip && (
          <>
            <circle cx={tooltip.x} cy={tooltip.y} r="6" fill="#1c1b1b" stroke="#ff727c" strokeWidth="2" />
            <circle cx={tooltip.x} cy={tooltip.y} r="3" fill="#ff727c" />
          </>
        )}
      </svg>

      {tooltip && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: Math.min(tooltip.x + 12, dims.w - 140),
            top: Math.max(tooltip.y - 48, 4),
          }}
        >
          <div className="bg-surface-container-highest rounded-xl px-3 py-2 shadow-lg border border-outline-variant/30">
            <p className="font-headline font-bold text-sm text-on-surface">
              {tooltip.point.visits} visit{tooltip.point.visits !== 1 ? "s" : ""}
            </p>
            <p className="font-body text-[10px] text-on-surface-variant">
              {tooltip.point.unique} unique · {formatTooltipDate(tooltip.point.hour)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
