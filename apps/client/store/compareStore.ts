import { create } from 'zustand';
import type { ListingDTO } from '@/lib/types';

interface CompareStore {
  selected: ListingDTO[];
  add: (listing: ListingDTO) => void;
  remove: (id: string) => void;
  toggle: (listing: ListingDTO) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export const useCompareStore = create<CompareStore>((set, get) => ({
  selected: [],

  add: (listing) =>
    set(state => {
      if (state.selected.length >= 4) return state;
      if (state.selected.some(l => l.id === listing.id)) return state;
      return { selected: [...state.selected, listing] };
    }),

  remove: (id) =>
    set(state => ({ selected: state.selected.filter(l => l.id !== id) })),

  toggle: (listing) => {
    const { isSelected, add, remove } = get();
    if (isSelected(listing.id)) remove(listing.id);
    else add(listing);
  },

  clear: () => set({ selected: [] }),

  isSelected: (id) => get().selected.some(l => l.id === id),
}));
