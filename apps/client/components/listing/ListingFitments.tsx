'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPartFitments } from '@/lib/api';
import type { FitmentResult } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';

interface ListingFitmentsProps {
  partId: string;
}

interface GroupedFitment {
  make: string;
  model: string;
  trim: string | null;
  body: string | null;
  engine: string | null;
  constraint: string | null;
  minYear: number;
  maxYear: number;
}

// Strip noise from NHTSA-style engine strings:
//   "3.6L 3604CC 220Cu. In. V6 FLEX DOHC Naturally Aspirated"
// becomes
//   "3.6L V6 FLEX DOHC"
// We keep displacement, cylinder layout, fuel and valvetrain — anything a body
// shop matches against — and drop the redundant cc / cu-in / aspiration noise.
function normalizeEngine(s: string | null): string | null {
  if (!s) return null;
  return s
    .replace(/\b\d+\s*CC\b/gi, '')
    .replace(/\b\d+(?:\.\d+)?\s*Cu\.?\s*In\.?/gi, '')
    .replace(/\bNaturally Aspirated\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim() || null;
}

// Pull body style + door count off the end of trim strings so we get a clean
// trim name plus a separate body column:
//   "Tradesman Crew Cab Pickup 4-Door" -> trim="Tradesman", body="Crew Cab Pickup 4-Door"
//   "EX Sedan 4-Door"                 -> trim="EX",        body="Sedan 4-Door"
const BODY_TOKEN_RE = /\b(?:Crew Cab|Extended Cab|Regular Cab|Quad Cab|Mega Cab|Standard Cab|King Cab|SuperCab|SuperCrew|Cab\s*Plus|Club Cab|Pickup|Hatchback|Convertible|Coupe|Sedan|Wagon|SUV|Sport Utility|Van|Minivan|Roadster|Cabriolet|Liftback|Fastback|Targa)\b/gi;
const DOOR_RE = /\b\d-Door\b/i;

function splitTrim(s: string | null): { trim: string | null; body: string | null } {
  if (!s) return { trim: null, body: null };
  const original = s.trim();
  const bodyTokens: string[] = [];
  let cleaned = original;

  const matches = original.match(BODY_TOKEN_RE);
  if (matches) {
    for (const m of matches) bodyTokens.push(m.trim());
    cleaned = cleaned.replace(BODY_TOKEN_RE, '').trim();
  }
  const doorMatch = cleaned.match(DOOR_RE);
  if (doorMatch) {
    bodyTokens.push(doorMatch[0]);
    cleaned = cleaned.replace(DOOR_RE, '').trim();
  }

  cleaned = cleaned.replace(/\s+/g, ' ').replace(/^,|,$/g, '').trim();
  const body = bodyTokens.length ? bodyTokens.join(' ') : null;
  return { trim: cleaned || null, body };
}

// Group raw fitment rows that share (make, model, trim, body, engine, constraint)
// after normalising the trim/engine strings, and coalesce their consecutive
// years into ranges. Each output row is a distinct (year range, make/model,
// trim, body, engine) vehicle fit.
function groupFitments(rows: FitmentResult[]): GroupedFitment[] {
  type Normalised = {
    make: string;
    model: string;
    trim: string | null;
    body: string | null;
    engine: string | null;
    constraint: string | null;
    year: number;
  };
  const normalised: Normalised[] = rows.map(r => {
    const { trim, body } = splitTrim(r.trim);
    return {
      make: r.make,
      model: r.model,
      trim,
      body,
      engine: normalizeEngine(r.engine),
      constraint: r.constraint,
      year: r.year,
    };
  });

  const buckets = new Map<string, Normalised[]>();
  for (const r of normalised) {
    const key = JSON.stringify([r.make, r.model, r.trim, r.body, r.engine, r.constraint]);
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }

  const out: GroupedFitment[] = [];
  for (const arr of buckets.values()) {
    const years = Array.from(new Set(arr.map(r => r.year))).sort((a, b) => a - b);
    if (years.length === 0) continue;
    const head = arr[0]!;
    let start = years[0]!;
    let prev = start;
    const push = (minYear: number, maxYear: number) => {
      out.push({
        make: head.make, model: head.model,
        trim: head.trim, body: head.body,
        engine: head.engine, constraint: head.constraint,
        minYear, maxYear,
      });
    };
    for (let i = 1; i < years.length; i++) {
      const y = years[i]!;
      if (y === prev + 1) { prev = y; } else { push(start, prev); start = y; prev = y; }
    }
    push(start, prev);
  }

  out.sort((a, b) =>
    b.maxYear - a.maxYear ||
    a.make.localeCompare(b.make) ||
    a.model.localeCompare(b.model) ||
    (a.trim ?? '').localeCompare(b.trim ?? '') ||
    (a.engine ?? '').localeCompare(b.engine ?? ''),
  );

  return out;
}

function formatConstraint(c: string | null): string | null {
  if (!c) return null;
  return c.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

export default function ListingFitments({ partId }: ListingFitmentsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['fitments', partId],
    queryFn: () => fetchPartFitments(partId),
    staleTime: 5 * 60_000,
  });
  const [filter, setFilter] = useState('');

  const rows = data?.fitments ?? [];
  const grouped = useMemo(() => groupFitments(rows), [rows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter(g => {
      const yearStr = g.minYear === g.maxYear ? String(g.minYear) : `${g.minYear}-${g.maxYear}`;
      const hay = [
        g.make, g.model, g.trim ?? '', g.body ?? '', g.engine ?? '',
        formatConstraint(g.constraint) ?? '', yearStr,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [grouped, filter]);

  const hasConstraint = grouped.some(g => g.constraint);
  const hasBody = grouped.some(g => g.body);

  return (
    <div>
      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-[14px] font-semibold text-[#0B1220]">Vehicle fitments</h3>
          {!isLoading && grouped.length > 0 && (
            <p className="text-[11px] text-[#94A3B8] mt-0.5">
              {grouped.length} distinct fit{grouped.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        {grouped.length > 6 && (
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Find by year, model, trim, engine…"
            className="h-8 text-[12px] w-[260px]"
          />
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 rounded-md" />)}
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-[13px] text-[#94A3B8]">No fitment data available.</p>
      ) : (
        <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#F7F8FA] border-b border-[#E5E7EB]">
                  <th className="text-left px-3 py-2 font-semibold text-[#94A3B8] uppercase tracking-wide text-[10px] w-[88px]">Year</th>
                  <th className="text-left px-3 py-2 font-semibold text-[#94A3B8] uppercase tracking-wide text-[10px]">Make / Model</th>
                  <th className="text-left px-3 py-2 font-semibold text-[#94A3B8] uppercase tracking-wide text-[10px]">Trim</th>
                  {hasBody && (
                    <th className="text-left px-3 py-2 font-semibold text-[#94A3B8] uppercase tracking-wide text-[10px]">Body</th>
                  )}
                  <th className="text-left px-3 py-2 font-semibold text-[#94A3B8] uppercase tracking-wide text-[10px]">Engine</th>
                  {hasConstraint && (
                    <th className="text-left px-3 py-2 font-semibold text-[#94A3B8] uppercase tracking-wide text-[10px]">Notes</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4 + (hasBody ? 1 : 0) + (hasConstraint ? 1 : 0)} className="px-3 py-6 text-center text-[12px] text-[#94A3B8]">
                      No fitments match &ldquo;{filter}&rdquo;.
                    </td>
                  </tr>
                ) : (
                  filtered.map((f, i) => (
                    <tr key={i} className={`border-b border-[#E5E7EB] last:border-0 ${i % 2 === 1 ? 'bg-[#F7F8FA]/50' : ''}`}>
                      <td className="px-3 py-2 num text-[#475569] whitespace-nowrap">
                        {f.minYear === f.maxYear ? f.minYear : `${f.minYear}–${f.maxYear}`}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#0B1220] whitespace-nowrap">{f.make} {f.model}</td>
                      <td className="px-3 py-2 text-[#475569]">
                        {f.trim ?? <span className="text-[#94A3B8]">Any</span>}
                      </td>
                      {hasBody && (
                        <td className="px-3 py-2 text-[#475569]">
                          {f.body ?? <span className="text-[#94A3B8]">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-[#475569]">
                        {f.engine ?? <span className="text-[#94A3B8]">Any</span>}
                      </td>
                      {hasConstraint && (
                        <td className="px-3 py-2 text-[#475569]">
                          {f.constraint ? formatConstraint(f.constraint) : <span className="text-[#94A3B8]">—</span>}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
