import * as fs from 'fs';
import * as path from 'path';

/**
 * Drift guard for the partial UNIQUE index that enforces "at most one
 * isLatest=true CourseVersion per course":
 *
 *   CREATE UNIQUE INDEX "course_versions_one_latest_per_course"
 *     ON "course_versions"("courseId") WHERE "isLatest" = true;
 *
 * Prisma cannot express partial-unique indexes, so it is NOT in schema.prisma —
 * it exists only as hand-written migration SQL. This test fails if a future
 * migration removes it (or if it's never created), which would re-open the
 * double-latest race that publishNewVersion's advisory lock + this index guard
 * against together.
 */
describe('course_versions_one_latest_per_course partial unique index', () => {
  const migrationsDir = path.resolve(__dirname, '../../prisma/migrations');
  const indexName = 'course_versions_one_latest_per_course';

  const migrationSql = (): string => {
    const dirs = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort(); // chronological (timestamp-prefixed)
    return dirs
      .map((d) => {
        const file = path.join(migrationsDir, d, 'migration.sql');
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      })
      .join('\n');
  };

  it('is created in the migrations as a partial unique index on isLatest', () => {
    const sql = migrationSql();
    const created =
      new RegExp(
        `CREATE\\s+UNIQUE\\s+INDEX\\s+"${indexName}"[\\s\\S]*?WHERE\\s+"isLatest"\\s*=\\s*true`,
        'i',
      ).test(sql);
    expect(created).toBe(true);
  });

  it('is never dropped by a later migration', () => {
    const sql = migrationSql();
    const dropped = new RegExp(`DROP\\s+INDEX[^;]*"${indexName}"`, 'i').test(sql);
    expect(dropped).toBe(false);
  });
});
