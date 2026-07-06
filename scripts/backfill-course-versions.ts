/**
 * backfill-course-versions.ts
 *
 * DEPRECATED — use backfill-course-version-manifests.ts for manifest migration.
 *
 * This script previously created v1 full-content snapshots. The manifest model
 * stores structure only; run:
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-course-version-manifests.ts
 */

console.error(
  'This script is deprecated. Use scripts/backfill-course-version-manifests.ts instead.',
);
process.exit(1);
