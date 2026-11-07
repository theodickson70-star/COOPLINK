import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Query } from './api';

/** Pakua data kutoka API; inapakia upya `deps` zikibadilika au reload() ikiitwa. */
export function useFetch<T>(path: string | null, query?: Query) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([path, query, tick]);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    api<T>(path, { query })
      .then((d) => {
        if (id === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Thamani inayosubiri mtumiaji aache kuandika (kwa utafutaji). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Kitendo cha kutuma (POST/PATCH) chenye hali ya busy na kosa. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
