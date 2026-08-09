import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionController } from './course-version.controller';
import { CourseVersionService } from './course-version.service';

describe('CourseVersionController', () => {
  let controller: CourseVersionController;
  const service = {
    publishNewVersion: jest.fn(),
    listVersions: jest.fn(),
    archiveVersion: jest.fn(),
    migrateLearnerToVersion: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourseVersionController],
      providers: [{ provide: CourseVersionService, useValue: service }],
    }).compile();

    controller = module.get(CourseVersionController);
    jest.clearAllMocks();
  });

  // Route-ordering guard. NestJS matches in DECLARATION order, so a literal
  // segment declared after `:versionId` is swallowed by it and 404s. `/diff`
  // hit this once; `/drift` hit it again and shipped dead. This asserts the
  // ordering directly off the metadata so a third occurrence fails here
  // rather than in production.
  it('registers literal /versions/* routes before the generic /:versionId', () => {
    const proto = CourseVersionController.prototype as any;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (k) => k !== 'constructor' && typeof proto[k] === 'function',
    );
    const pathOf = (name: string) =>
      Reflect.getMetadata('path', proto[name]) as string | undefined;

    const ordered = handlers
      .map((name) => ({ name, path: pathOf(name) }))
      .filter((h): h is { name: string; path: string } => !!h.path)
      .filter((h) => h.path.includes(':courseId/versions/'));

    const genericIdx = ordered.findIndex((h) => h.path.endsWith('/:versionId'));
    expect(genericIdx).toBeGreaterThan(-1);

    // Every literal (non-param) sibling must come first.
    ordered.forEach((h, i) => {
      const last = h.path.split('/').pop()!;
      if (!last.startsWith(':')) {
        expect({ route: h.path, index: i }).toEqual({
          route: h.path,
          index: i,
        });
        expect(i).toBeLessThan(genericIdx);
      }
    });
  });

  it('publishVersion delegates to service', () => {
    service.publishNewVersion.mockReturnValue({ statusCode: 200 });
    const admin = { id: 'admin-1' } as any;

    controller.publishVersion(admin, 'course-1', { changeNotes: 'notes' });

    expect(service.publishNewVersion).toHaveBeenCalledWith(
      'admin-1',
      'course-1',
      'notes',
    );
  });

  it('listVersions delegates to service', () => {
    service.listVersions.mockReturnValue({ statusCode: 200, data: [] });
    controller.listVersions('course-1');
    expect(service.listVersions).toHaveBeenCalledWith('course-1');
  });

  it('archiveVersion delegates to service', () => {
    service.archiveVersion.mockReturnValue({ statusCode: 200 });
    controller.archiveVersion({ id: 'admin-1' } as any, 'course-1', 'v1');
    expect(service.archiveVersion).toHaveBeenCalledWith(
      'admin-1',
      'course-1',
      'v1',
    );
  });

  it('migrateLearner delegates to service', () => {
    service.migrateLearnerToVersion.mockReturnValue({ statusCode: 200 });
    controller.migrateLearner({ id: 'admin-1' } as any, {
      userCourseId: 'uc-1',
      targetVersionId: 'v2',
    });
    expect(service.migrateLearnerToVersion).toHaveBeenCalledWith(
      'admin-1',
      'uc-1',
      'v2',
    );
  });
});
