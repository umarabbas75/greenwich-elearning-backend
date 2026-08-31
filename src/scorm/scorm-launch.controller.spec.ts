import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ScormLaunchController } from './scorm-launch.controller';

describe('ScormLaunchController contract', () => {
  it('exposes POST /launch with HTTP 200 (not Nest POST 201, not a 302 redirect)', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, ScormLaunchController.prototype.launch),
    ).toBe('launch');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ScormLaunchController.prototype.launch,
      ),
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ScormLaunchController.prototype.launch,
      ),
    ).toBe(200);
    expect(
      Reflect.getMetadata(
        'redirect',
        ScormLaunchController.prototype.launch,
      ),
    ).toBeUndefined();
  });

  it('guards launch with a Nest guard (learner JWT)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ScormLaunchController.prototype.launch,
    );
    expect(Array.isArray(guards)).toBe(true);
    expect(guards.length).toBeGreaterThan(0);
  });

  it('returns { launchLink } from the runtime', async () => {
    const runtime = {
      launch: jest.fn().mockResolvedValue({
        launchLink: 'https://cloud.scorm.com/launch/abc',
      }),
    };
    const controller = new ScormLaunchController(runtime as any);
    const result = await controller.launch(
      { id: 'user-1', role: 'user' } as any,
      { courseId: 'course-1' },
    );
    expect(result).toEqual({
      launchLink: 'https://cloud.scorm.com/launch/abc',
    });
  });
});
