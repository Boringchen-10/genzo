import { useEffect, useState } from "react";
import { bookContentApi, type ReadingKind } from "../bookContent";
import { BookSourceContent } from "./BookSourceContent";
import { ErrorState } from "./common";
import { getErrorMessage } from "../utils";

export function BookWorkSource({ workId }: { workId: string }) {
  const [source, setSource] = useState<{ kind: ReadingKind; pathWord: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void bookContentApi.source(workId).then(value => { if (!cancelled) { setSource(value); setError(""); } })
      .catch(reason => { if (!cancelled) setError(getErrorMessage(reason)); });
    return () => { cancelled = true; };
  }, [workId, attempt]);
  return error ? <ErrorState message={error} retry={() => setAttempt(v => v + 1)} /> : source ? <BookSourceContent key={`${source.kind}:${source.pathWord}`} {...source} /> : null;
}
