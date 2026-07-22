import { useCallback, useEffect, useState } from "react";
import api from "../api/client";

export function useOverview(days = 30) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncVersion, setSyncVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getOverview(days);
      setData(res);
      // Use data_as_of (real cache write time) so the Synced label reflects
      // when the data was actually fetched from providers, not when the API responded.
      setLastSyncedAt(res.data_as_of ?? res.generated_at);
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
      // Bump this so any provider page currently mounted knows a fresh
      // sync just landed in the cache and reloads itself.
      setSyncVersion((v) => v + 1);
    } catch (err) {
      setError(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [load, days]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, syncing, error, syncAll, reload: load, lastSyncedAt, syncVersion };
}

export function useProvider(providerKey, days = 30, refreshKey = 0) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  // Cached read - used for quick initial paint only.
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

  // On mount / days change: read from cache first
  useEffect(() => {
    load();
  }, [load]);

  // Whenever the app-level sync (Topbar) completes, refresh this page too -
  // this is what makes an already-open page pick up new data live instead
  // of sitting on whatever it rendered on mount.
  useEffect(() => {
    if (refreshKey > 0) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return { data, loading, syncing, error, sync, reload: load };
}