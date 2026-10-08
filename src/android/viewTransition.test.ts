import { afterEach, expect, test, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test("rapid navigation skips the previous snapshot and only the latest owns cleanup", async () => {
  const skip = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const remove = vi.fn();
  vi.stubGlobal("document", { querySelectorAll: () => [{style:{removeProperty:remove}}], startViewTransition: vi.fn(() => ({ finished: Promise.resolve(), skipTransition: skip })) });
  const { startAndroidTransition } = await import("./viewTransition");
  const first = startAndroidTransition(() => {});
  const second = startAndroidTransition(() => {});
  expect(skip).toHaveBeenCalledTimes(1);
  expect(first?.isCurrent()).toBe(false);
  expect(second?.isCurrent()).toBe(true);
  await second?.finished;
  expect(remove).toHaveBeenCalledTimes(1);
});

test("reduced motion returns control to the immediate page update", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const native = vi.fn(); vi.stubGlobal("document", { startViewTransition: native });
  const { startAndroidTransition } = await import("./viewTransition");
  expect(startAndroidTransition(() => {})).toBeNull();
  expect(native).not.toHaveBeenCalled();
});
