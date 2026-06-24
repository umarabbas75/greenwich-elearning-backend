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
