"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product } from "@/types/products";

interface UseSearchState {
  data: Product[] | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Client-side debounced product search. Uses the browser Supabase client so
 * RLS still enforces "only active products are returned".
 */
export function useSearch(query: string, debounceMs = 300) {
  const [state, setState] = useState<UseSearchState>({
    data: null,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setState({ data: null, isLoading: false, error: null });
      return;
    }

    const handle = setTimeout(async () => {
      setState((s) => ({ ...s, isLoading: true, error: null }));

      const supabase = createClient();
      const term = `%${query.trim().replace(/[%_]/g, "\\$&")}%`;
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .or(`name.ilike.${term},description.ilike.${term},brand.ilike.${term}`)
        .limit(20);

      if (error) {
        setState({ data: null, isLoading: false, error: error.message });
        return;
      }
      setState({ data: (data ?? []) as Product[], isLoading: false, error: null });
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [query, debounceMs]);

  return state;
}
