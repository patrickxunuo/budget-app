import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePendingAction } from "./use-pending-action";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

describe("GH-33 shared pending action", () => {
  it("FE-001 runs an exclusive action once in the same turn and settles pending after resolve", async () => {
    const request = deferred<string>();
    const action = vi.fn(() => request.promise);
    const { result } = renderHook(() => usePendingAction());
    let first!: Promise<string | undefined>;
    let ignored!: Promise<string | undefined>;

    act(() => {
      first = result.current.run(action);
      ignored = result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    await expect(ignored).resolves.toBeUndefined();

    await act(async () => {
      request.resolve("saved");
      await expect(first).resolves.toBe("saved");
    });
    expect(result.current.pending).toBe(false);
  });

  it("FE-001 propagates rejection and always restores the exclusive action", async () => {
    const request = deferred<never>();
    const failure = new TypeError("response body was not valid JSON");
    const action = vi.fn(() => request.promise);
    const { result } = renderHook(() => usePendingAction());
    let run!: Promise<never | undefined>;

    act(() => {
      run = result.current.run(action);
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      request.reject(failure);
      await expect(run).rejects.toBe(failure);
    });
    expect(result.current.pending).toBe(false);

    await act(async () => {
      await expect(result.current.run(async () => "retry")).resolves.toBe(
        "retry",
      );
    });
    expect(result.current.pending).toBe(false);
  });

  it("FE-007 keeps latest-strategy pending true when a superseded request settles first", async () => {
    const older = deferred<string>();
    const latest = deferred<string>();
    const { result } = renderHook(() =>
      usePendingAction({ strategy: "latest" }),
    );
    let olderRun!: Promise<string | undefined>;
    let latestRun!: Promise<string | undefined>;

    act(() => {
      olderRun = result.current.run(() => older.promise);
      latestRun = result.current.run(() => latest.promise);
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      older.resolve("stale");
      await expect(olderRun).resolves.toBe("stale");
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      latest.resolve("current");
      await expect(latestRun).resolves.toBe("current");
    });
    expect(result.current.pending).toBe(false);
  });
});
