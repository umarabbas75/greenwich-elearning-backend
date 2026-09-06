import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ScormReconcileController } from './scorm-reconcile.controller';

describe('ScormReconcileController daily cron', () => {
  it('exposes GET /daily with HTTP 200 for Vercel Hobby (once per day)', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, ScormReconcileController.prototype.dailyGet),
    ).toBe('daily');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ScormReconcileController.prototype.dailyGet,
      ),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ScormReconcileController.prototype.dailyGet,
      ),
    ).toBe(200);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ScormReconcileController.prototype.dailyGet,
      ),
    ).toEqual(expect.any(Array));
  });

  it('runs every sweep and continues if one fails', async () => {
    const scorm = {
      processImportJobsCron: jest.fn().mockResolvedValue({ processed: 1 }),
    };
    const runtime = {
      reconcileCron: jest.fn().mockRejectedValue(new Error('cloud down')),
      pruneSupersededPackagesCron: jest.fn().mockResolvedValue({ pruned: 0 }),
    };
    const engagement = {
      runSweep: jest.fn().mockResolvedValue({ sent: 2 }),
    };
    const controller = new ScormReconcileController(
      scorm as never,
      runtime as never,
      engagement as never,
    );

    const result = await controller.dailyGet();

    expect(result).toMatchObject({
      statusCode: 200,
      data: {
        engagement: { sent: 2 },
        importJobs: { processed: 1 },
        reconcile: { error: 'cloud down' },
        pruneSuperseded: { pruned: 0 },
      },
    });
  });
});
