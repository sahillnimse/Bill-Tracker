import { useCallback, useEffect, useState } from "react";
import api from "../api/client";

export function useOverview(days = 30) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getOverview(days);
      setData(res);
      setLastSyncedAt(res.generated_at);
    } catch (err) {
      setError(err.message || "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, [days]);

  const syncAll = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.syncAll(days);
      await load();
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      setError(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [load, days]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, syncing, error, syncAll, reload: load, lastSyncedAt };
}

export function useProvider(providerKey, days = 30) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProvider(providerKey, days);
      setData(res);
    } catch (err) {
      setError(err.message || `Failed to load ${providerKey}`);
    } finally {
      setLoading(false);
    }
  }, [providerKey, days]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await api.syncProvider(providerKey, days);
      setData(res);
    } catch (err) {
      setError(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [providerKey, days]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, syncing, error, sync, reload: load };
}
