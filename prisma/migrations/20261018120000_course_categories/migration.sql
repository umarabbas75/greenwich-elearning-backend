-- Catalogue categories. Existing courses are grouped by awarding body
-- (title prefix) so the admin list is usable immediately. "test" and any
-- title that does not match stays uncategorised for an admin to assign.

CREATE TABLE "course_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_categories_name_key" ON "course_categories"("name");
CREATE UNIQUE INDEX "course_categories_slug_key" ON "course_categories"("slug");

ALTER TABLE "courses" ADD COLUMN "categoryId" TEXT;

CREATE INDEX "courses_categoryId_idx" ON "courses"("categoryId");

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "course_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "course_categories"
  ("id", "name", "slug", "description", "sortOrder")
VALUES
  ('c0a10000-0000-4000-8000-000000000001', 'NEBOSH', 'nebosh',
    'NEBOSH qualifications', 1),
  ('c0a10000-0000-4000-8000-000000000002', 'IOSH', 'iosh',
    'IOSH qualifications', 2),
  ('c0a10000-0000-4000-8000-000000000003', 'OSHA', 'osha',
    'OSHA qualifications', 3),
  ('c0a10000-0000-4000-8000-000000000004', 'OTHM', 'othm',
    'OTHM diplomas', 4),
  ('c0a10000-0000-4000-8000-000000000005', 'International Awards', 'international-awards',
    'Levelled international awards', 5),
  ('c0a10000-0000-4000-8000-000000000006', 'Short Courses', 'short-courses',
    'Standalone workplace safety courses', 6);

UPDATE "courses"
SET "categoryId" = 'c0a10000-0000-4000-8000-000000000001'
WHERE title ILIKE 'NEBOSH%';

UPDATE "courses"
SET "categoryId" = 'c0a10000-0000-4000-8000-000000000002'
WHERE title ILIKE 'IOSH%';

UPDATE "courses"
SET "categoryId" = 'c0a10000-0000-4000-8000-000000000003'
WHERE title ILIKE 'OSHA%';

UPDATE "courses"
SET "categoryId" = 'c0a10000-0000-4000-8000-000000000004'
WHERE title ILIKE 'OTHM%';

UPDATE "courses"
SET "categoryId" = 'c0a10000-0000-4000-8000-000000000005'
WHERE "categoryId" IS NULL
  AND title ILIKE '%International Award%';

UPDATE "courses"
SET "categoryId" = 'c0a10000-0000-4000-8000-000000000006'
WHERE title IN (
  'Confined Space Safety',
  'Work Permit Receiver: International Best Practice for Safe Work Control'
);
