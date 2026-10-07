# Local incremental backups

The existing scheduled task and D: backup location are retained. `backup-local-data.ps1` now defaults to content-addressed incremental snapshots. The accounting database, source libraries, document exports and authentication setup are unchanged.

The first run initializes `D:\UW FOREVER\Local Backups\_objects`. Every distinct file content is stored once under its SHA-256 hash, even when identical files appear in several source folders. Later runs add only new or changed content. A dated `UWAccounting-*` folder contains a complete manifest of file paths, hashes, lengths, original timestamps/attributes and directories. A rename or deletion changes the new manifest without recopying unchanged contents. Older manifests still recover their original files.

Each snapshot directly references the content store. Restoring does not require replaying a chain of daily backups. **Keep `_objects` together with the dated snapshot folders.** Copying a manifest folder alone is not a complete backup. New snapshots also include a SHA-256 checksum of the manifest itself, detecting damaged filename mappings as well as damaged file contents. Earlier full and incremental backups remain usable and can be verified/restored by the same script.

Files are read and hashed on every run, including files whose timestamps did not change. Existing referenced content is verified before reuse. This avoids relying on timestamps and detects corruption, but scanning a large external-drive archive can still take time. The manifest reports `newObjects` and `newBytes`, so transferred data can be distinguished from the logical snapshot size.

New objects are copied to temporary files, flushed and verified before publication. A snapshot is published only after its inventory and accounting JSON pass validation. Interrupted or failed runs do not replace earlier snapshots. Shared read handles allow the running app to atomically replace its ledger while a backup is reading; a file that changes during copying is rejected instead of publishing mismatched contents. A lock rejects overlapping incremental runs. DPAPI-encrypted configuration stays encrypted; the prior encrypted content is reused when the configuration is unchanged. The matching PowerShell encryption module is loaded explicitly, avoiding module-version mismatches in launchers.

Incremental mode retains all manifests and content versions. It does not automatically delete older full backups or shared objects. The existing `RetentionCount` option applies to explicit legacy `-FullBackup` runs; incremental history is retained because deleting shared content or its history automatically would defeat recovery. Storage grows with distinct changed content and small manifests, rather than a full copy every day.

Verify a snapshot:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\AppData\Local\UWAccountingSystem\scripts\backup-local-data.ps1" -VerifyPath "D:\UW FOREVER\Local Backups\UWAccounting-YYYYMMDD-HHMMSS-fff"
```

Restore into a **new** folder; the command refuses to overwrite an existing destination or the live system:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\AppData\Local\UWAccountingSystem\scripts\backup-local-data.ps1" -RestorePath "D:\UW FOREVER\Local Backups\UWAccounting-YYYYMMDD-HHMMSS-fff" -RestoreDestination "D:\UW FOREVER\Recovered Workspace"
```

The restored folder contains Application Files, Application Data, Saved Invoices, Saved Quotes, Source Library and encrypted local configuration. Recovery validates every restored file before publishing the destination. Credentials remain encrypted for the original Windows user. This command produces a verified recovery folder; it does not reconfigure or overwrite the installed application.

Validation: `npm run test:backup` covers legacy full-backup verification/restoration, incremental deduplication, zero-byte unchanged runs, changed files with preserved timestamps, deletion/rename history, empty folders, independent restores, encrypted configuration, concurrent-run rejection, invalid ledgers, corrupt objects and invalid manifest paths.

Live verification on 7 October 2026: the unchanged scheduled task completed two incremental runs with result 0. Snapshot `UWAccounting-20261007-093356-582` referenced 4,020 files / 2,360,746,789 logical bytes and passed a separate full integrity verification. The shared content store was approximately 1.48 GB. The next snapshot, `UWAccounting-20261007-094255-035`, referenced 4,020 files / 2,360,747,974 logical bytes but added only **4 objects / 49,995 bytes** for actual code changes. Its authoritative ledger matched the unchanged live ledger at revision 52. Existing full backups were retained. Recovery tests verify hidden attributes, original creation/modification dates and manifest corruption checks as well as file contents.
