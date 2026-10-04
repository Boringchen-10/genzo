import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/** Keep existing pages current after a real sync without resetting edits in the caller. */
export function useSyncRefresh(refresh: () => void) {
  const current = useRef(refresh);
  current.current = refresh;
  useEffect(() => {
    let disposed = false;
    const subscription = listen("sync-library-updated", () => { if (!disposed) current.current(); });
    void subscription.catch(() => {});
    return () => { disposed = true; void subscription.then(fn => fn()).catch(() => {}); };
  }, []);
}
