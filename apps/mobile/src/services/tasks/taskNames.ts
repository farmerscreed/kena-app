// OS task names, in a module with NO imports.
//
// registerHeadlessTasks runs at app entry, before the MMKV key exists,
// so it cannot import anything that transitively pulls services/storage
// (see PostBootShell's header). The modules that own these tasks —
// services/sync/backgroundSync and services/notifications/remoteRefreshTask
// — are both storage-dependent, so the names live here where both sides
// can share one definition instead of duplicating string literals that
// would silently drift apart.

export const BACKGROUND_SYNC_TASK = 'leiko.sync.backgroundFetch';
export const REMOTE_REFRESH_TASK = 'leiko.notifications.remoteRefresh';
