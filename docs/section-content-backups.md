# Section content backups (local)

Course lesson bodies live in `sections.description` (TipTap JSON). Before editing in admin, export a snapshot to `backups/section-content/` (gitignored — stays on your machine only).

## Why Health and Safety Matters (baseline)

| Field | Value |
|-------|--------|
| Section id | `420216c7-aa99-4d5b-a9c2-2e73abe5ba06` |
| Chapter | `885fd782-7630-42ae-8805-f1365e745680` — 1.1: Why Health and Safety Matters |
| Backup file | `backups/section-content/420216c7-aa99-4d5b-a9c2-2e73abe5ba06_why-health-and-safety-matters_2026-10-03.json` |
| Exported | 2026-10-03 (from production DB) |

## Commands

Re-export after further DB changes:

```bash
SECTION_ID=420216c7-aa99-4d5b-a9c2-2e73abe5ba06 yarn script:section-export-backup
```

Preview restore (no writes):

```bash
yarn script:section-restore -- --dry-run
```

Restore TipTap `description` and related section fields from the default backup file:

```bash
yarn script:section-restore -- --restore
```

Use another file:

```bash
SECTION_BACKUP_FILE=backups/section-content/my-copy.json yarn script:section-restore -- --restore
```
