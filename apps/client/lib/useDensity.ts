'use client';

import { useState, useEffect, useCallback } from 'react';

const KEY = 'ps:density';

export type Density = 'default' | 'compact';

export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensityState] = useState<Density>('default');

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Density | null;
    if (stored === 'compact' || stored === 'default') setDensityState(stored);
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    localStorage.setItem(KEY, d);
  }, []);

  return [density, setDensity];
}
