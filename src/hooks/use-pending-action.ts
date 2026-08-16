"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PendingStrategy = "exclusive" | "latest";

export type UsePendingActionOptions = {
  strategy?: PendingStrategy;
};

export function usePendingAction(options: UsePendingActionOptions = {}) {
  const strategy = options.strategy ?? "exclusive";
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const latestAction = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async <Result>(
      action: () => Result | Promise<Result>,
    ): Promise<Result | undefined> => {
      if (strategy === "exclusive" && active.current) return undefined;

      active.current = true;
      const actionId = ++latestAction.current;
      setPending(true);

      try {
        return await action();
      } finally {
        if (actionId === latestAction.current) {
          active.current = false;
          if (mounted.current) setPending(false);
        }
      }
    },
    [strategy],
  );

  return { pending, run };
}
