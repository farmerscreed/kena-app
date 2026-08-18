// POST a single reading to the /sync Edge Function. Per
// docs/01-data-model.md: "/sync ... runs with the service_role key
// and bypasses RLS by design — every other path goes through
// user-context RLS." So inserts to public.readings happen via this
// function; the app cannot insert directly.
//
// Idempotency: the readings_dedupe unique index on (device_id,
// measured_at) means a re-POST of the same reading returns the SAME
// reading id with `duplicate: true`. Callers treat duplicate as
// success.
//
// Failure modes the caller must handle:
// - Network unavailable / 5xx → throws, caller leaves the row in
//   the MMKV pending buffer for the next connectivity event.
// - 401 → user JWT expired; sync layer re-hydrates auth and retries.
// - 4xx other than 401/409 → schema mismatch or missing pair; surface
//   to the user via the syncError string in the readings store.
//
// Sprint 6 ships a single-reading endpoint. Sprint 9+ may move to
// batched POSTs once trends backfill exists.

import { getOrCreateClientDeviceId } from '../storage';
import { supabase } from '../supabase';
import { SYNC_UPLOAD_TIMEOUT_MS, withTimeout } from './withTimeout';
import type { LocalReading } from '../../state/readings';

export interface PostReadingResponse {
  readingId: string;
  deviceId: string;
  duplicate: boolean;
}

export interface DeviceMeta {
  bleId: string;
  macSuffix: string;
  name: string | null;
  model: 'U16H' | 'U19M';
  // Stable per-install identity (getOrCreateClientDeviceId). The server
  // dedupes device rows on this instead of the rotating BLE MAC, so a
  // reconnect/re-pair no longer creates a duplicate device.
  clientDeviceId: string;
}

interface SyncRequestBody {
  device: DeviceMeta;
  reading: {
    measuredAtSec: number;
    systolic: number;
    diastolic: number;
    pulse: number | null;
    source: 'watch' | 'manual';
  };
}

export function inferModel(name: string | null): 'U16H' | 'U19M' {
  if (name?.startsWith('U19')) return 'U19M';
  return 'U16H';
}

// Dependency-injected lookup for paired device meta. The readings
// store calls this at sync time to resolve the device metadata for a
// reading. The default returns null (no meta); the app wires the real
// pairing-store-backed provider in RootNavigator on hydrate. Keeping
// the lookup as a setter avoids a transitive import of the pairing
// store (which imports react-native's Platform), so the readings
// store + sync helpers stay loadable in pure-project tests without
// pulling RN into the dependency graph.
type DeviceMetaProvider = (bleIdHint: string | null) => DeviceMeta | null;
let _deviceMetaProvider: DeviceMetaProvider = () => null;
export function setDeviceMetaProvider(provider: DeviceMetaProvider): void {
  _deviceMetaProvider = provider;
}
export function getDeviceMeta(bleIdHint: string | null): DeviceMeta | null {
  return _deviceMetaProvider(bleIdHint);
}

export async function postReading(
  row: LocalReading,
  deviceMeta?: DeviceMeta | null,
): Promise<PostReadingResponse> {
  const meta = deviceMeta ?? getDeviceMeta(row.deviceBleId);
  if (row.source === 'watch' && !meta) {
    throw new Error('postReading: no paired device on file for a watch reading');
  }

  const body: SyncRequestBody = {
    device: meta ?? {
      bleId: row.deviceBleId ?? 'manual',
      macSuffix: 'man0',
      name: 'manual entry',
      model: 'U16H',
      clientDeviceId: getOrCreateClientDeviceId(),
    },
    reading: {
      measuredAtSec: row.measuredAtSec,
      systolic: row.systolic,
      diastolic: row.diastolic,
      pulse: row.pulse,
      source: row.source,
      ...(row.contextTags && row.contextTags.length > 0
        ? { contextTags: row.contextTags }
        : {}),
    },
  };

  // Bounded for the same reason as postMultiVitals: invoke() has no
  // timeout, and a stalled upload here blocks the whole sync run.
  const { data, error } = await withTimeout(
    supabase.functions.invoke<PostReadingResponse>('sync', { body }),
    SYNC_UPLOAD_TIMEOUT_MS,
    '/sync reading upload',
  );
  if (error) throw new Error(`/sync invoke failed: ${error.message}`);
  if (!data) throw new Error('/sync returned no body');
  return data;
}
