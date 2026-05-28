'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RecentSearch, RecentPartSearch, RecentFitmentSearch } from './types';

const PART_KEY = 'ps:recent-parts';
const FITMENT_KEY = 'ps:recent-fitments';
const MAX_PART = 8;
const MAX_FITMENT = 5;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage quota — ignore
  }
}

export function useRecentSearches() {
  const [partSearches, setPartSearches] = useState<RecentPartSearch[]>([]);
  const [fitmentSearches, setFitmentSearches] = useState<RecentFitmentSearch[]>([]);

  useEffect(() => {
    setPartSearches(readJson<RecentPartSearch[]>(PART_KEY, []));
    setFitmentSearches(readJson<RecentFitmentSearch[]>(FITMENT_KEY, []));
  }, []);

  const addPartSearch = useCallback((query: string, vinTag?: string) => {
    setPartSearches(prev => {
      const entry: RecentPartSearch = {
        type: 'part',
        query: query.trim().toUpperCase(),
        vinTag,
        searchedAt: new Date().toISOString(),
      };
      const deduped = prev.filter(p => p.query !== entry.query);
      const next = [entry, ...deduped].slice(0, MAX_PART);
      writeJson(PART_KEY, next);
      return next;
    });
  }, []);

  const addFitmentSearch = useCallback((
    params: { make: string; model: string; year: string; category?: string; vinTag?: string },
  ) => {
    setFitmentSearches(prev => {
      const entry: RecentFitmentSearch = {
        type: 'fitment',
        ...params,
        searchedAt: new Date().toISOString(),
      };
      const deduped = prev.filter(
        p => !(p.make === entry.make && p.model === entry.model && p.year === entry.year),
      );
      const next = [entry, ...deduped].slice(0, MAX_FITMENT);
      writeJson(FITMENT_KEY, next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    writeJson(PART_KEY, []);
    writeJson(FITMENT_KEY, []);
    setPartSearches([]);
    setFitmentSearches([]);
  }, []);

  return { partSearches, fitmentSearches, addPartSearch, addFitmentSearch, clearAll };
}
