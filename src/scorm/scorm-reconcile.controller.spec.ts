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
      Reflect.getMetadata(
        PATH_METADATA,
        ScormReconcileController.prototype.dailyGet,
      ),
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

  it('shares one invocation deadline across the SCORM sweeps and runs engagement first', async () => {
    const order: string[] = [];
    const track =
      (name: string, value: unknown = {}) =>
      async () => {
        order.push(name);
        return value;
      };
    const scorm = {
      processImportJobsCron: jest.fn(track('importJobs', { deferred: 3 })),
    };
    const runtime = {
      reconcileCron: jest.fn(track('reconcile')),
      pruneSupersededPackagesCron: jest.fn(track('prune')),
    };
    const engagement = { runSweep: jest.fn(track('engagement')) };
    const controller = new ScormReconcileController(
      scorm as never,
      runtime as never,
      engagement as never,
    );

    const before = Date.now();
    const result = await controller.dailyGet();

    expect(order).toEqual(['engagement', 'importJobs', 'reconcile', 'prune']);
    const deadline = (
      scorm.processImportJobsCron.mock.calls[0] as unknown[]
    )[0] as number;
    expect(deadline).toBeGreaterThan(before);
    expect(deadline - before).toBeLessThanOrEqual(50_000);
    expect(runtime.reconcileCron).toHaveBeenCalledWith(deadline);
    expect(runtime.pruneSupersededPackagesCron).toHaveBeenCalledWith(deadline);
    expect(result.data.importJobs).toEqual({ deferred: 3 });
  });
});
