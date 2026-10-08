type Transition = { finished: Promise<void>; skipTransition(): void };
let active: Transition | null = null;
let generation = 0;

/** One snapshot animation at a time across the library and discovery views. */
export function startAndroidTransition(callback: () => void | Promise<void>) {
  const current = ++generation;
  active?.skipTransition();
  active = null;
  const doc = document as Document & { startViewTransition?: (update: () => void | Promise<void>) => Transition };
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  try {
    const transition = doc.startViewTransition(callback);
    active = transition;
    const release = () => {
      if (current !== generation) return;
      active = null;
      document.querySelectorAll<HTMLElement>("[data-cover-id], [data-explore-cover-id], .gz-scroll").forEach(node => node.style.removeProperty("view-transition-name"));
    };
    void transition.finished.then(release,release);
    return { finished: transition.finished, isCurrent: () => current === generation };
  } catch { return null; }
}
