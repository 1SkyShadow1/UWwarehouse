# Shared Brian and Evans workspace

Both operator profiles use the existing authenticated `/api/state` endpoint and the same configured workspace. No tables, credentials, permissions, security settings, storage paths or dependencies were changed.

The browser now waits for initial shared-state loading before displaying the signed-in workspace. A clean browser cache cannot overwrite server records merely because its timestamp is newer. A documents-only initial server snapshot is combined with the existing local ledger so the previously unsynchronized installation can publish its current accounting records.

Saved changes are queued immediately and normally uploaded after a 900 ms debounce. Active clients check the shared revision every five seconds and on focus/visibility changes. An unchanged revision returns HTTP 204 without transferring the entire ledger. Open document forms defer incoming changes until closed. Offline changes remain cached, marked pending and retried when the server returns.

A three-way merge combines independent record additions, deletions and edits against the last acknowledged version. Arrays with stable unique IDs or stock SKUs merge by record; unkeyed arrays such as document lines are treated as a whole to avoid mixing incompatible amounts. Overlapping edits and edit/delete races retain both versions in the existing Settings conflict workflow. Reopened offline changes without a safe common baseline also require review if the server revision has advanced. Nothing silently chooses a winner for these conflicts.

The server checks the expected revision inside its existing serialized write queue, preventing simultaneous clients from both overwriting the same revision. Existing authentication, CSRF validation, state validation, JSON backups and Supabase replication remain in effect.

Startup previously called `removeLegacyBulkScans`, which was mistakenly embedded in CSS and therefore undefined. That broken automatic call and the invalid CSS content were removed; existing source-reference filters remain. Sync no longer performs document cleanup at startup.

Run `node --test scripts/test-shared-profile-sync.js` for isolated merge/startup/poll/offline tests and a real local-server integration test with disposable Brian and Evans accounts. The integration test checks both directions, simultaneous additions, unchanged-revision responses, unauthenticated rejection and concurrent stale-write rejection. It does not use live credentials or modify live financial records. The tests also run through `npm test`.
