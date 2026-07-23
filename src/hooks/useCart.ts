"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { addToCart } from "@/actions/cart/addToCart";
import { updateCartItem } from "@/actions/cart/updateCartItem";
import { removeFromCart } from "@/actions/cart/removeFromCart";
import { refreshCart } from "@/actions/cart/refreshCart";
import type { CartWithItems, AddToCartInput } from "@/types/shopping-cart";

interface UseCartState {
  data: CartWithItems | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Client hook for cart interactions. Wraps the server actions with optimistic
 * UI updates: the local `data` state mutates immediately, then a transition
 * fires the server action; on failure the prior state is restored.
 *
 * Initial cart state must be supplied by the parent (server component fetches
 * `getCart()` and passes it down) so this hook stays free of server imports.
 */
export function useCart(initialCart: CartWithItems | null = null) {
  const [state, setState] = useState<UseCartState>({
    data: initialCart,
    isLoading: false,
    error: null,
  });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setState((prev) => ({ ...prev, data: initialCart }));
  }, [initialCart]);

  const add = useCallback((input: AddToCartInput) => {
    const prev = state.data;
    startTransition(async () => {
      const r = await addToCart(input);
      if (!r.success) {
        setState((s) => ({ ...s, data: prev, error: r.error }));
      } else {
        setState((s) => ({ ...s, error: null }));
      }
    });
  }, [state.data]);

  const update = useCallback((cartItemId: string, quantity: number) => {
    const prev = state.data;
    setState((s) => {
      if (!s.data) return s;
      return {
        ...s,
        data: {
          ...s.data,
          items: s.data.items.map((it) =>
            it.id === cartItemId ? { ...it, quantity } : it
          ),
        },
      };
    });
    startTransition(async () => {
      const r = await updateCartItem({ cartItemId, quantity });
      if (!r.success) setState((s) => ({ ...s, data: prev, error: r.error }));
    });
  }, [state.data]);

  const remove = useCallback((cartItemId: string) => {
    const prev = state.data;
    setState((s) => {
      if (!s.data) return s;
      return {
        ...s,
        data: {
          ...s.data,
          items: s.data.items.filter((it) => it.id !== cartItemId),
        },
      };
    });
    startTransition(async () => {
      const r = await removeFromCart({ cartItemId });
      if (!r.success) setState((s) => ({ ...s, data: prev, error: r.error }));
    });
  }, [state.data]);

  /**
   * Force a server-side refetch and swap the local state in. Used by the
   * Realtime hook to repaint after server-driven changes (soft-wait promotion,
   * priority hold grant, collapse, etc.).
   */
  const refresh = useCallback(() => {
    startTransition(async () => {
      const r = await refreshCart();
      if (r.success) {
        setState((s) => ({ ...s, data: r.data, error: null }));
      }
    });
  }, []);

  return {
    ...state,
    isPending,
    add,
    update,
    remove,
    refresh,
  };
}
