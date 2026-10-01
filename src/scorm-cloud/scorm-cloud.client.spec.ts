import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SCORM_CLOUD_ASSET_TIMEOUT_MS,
  SCORM_CLOUD_TIMEOUT_MS,
  SCORM_CLOUD_UPLOAD_TIMEOUT_MS,
  ScormCloudClient,
  ScormCloudHttpError,
  ScormCloudNetworkError,
  ScormCloudTimeoutError,
} from './scorm-cloud.client';

describe('ScormCloudClient — timeouts', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let client: ScormCloudClient;

  const makeClient = (env: Record<string, string> = {}) =>
    new ScormCloudClient({
      get: (key: string) =>
        ({
          SCORM_CLOUD_APP_ID: 'app',
          SCORM_CLOUD_SECRET_KEY: 'secret',
          ...env,
        })[key],
    } as unknown as ConfigService);

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = makeClient();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const timeoutError = () =>
    Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });

  it('passes an abort signal on every JSON request', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'RUNNING' }), { status: 200 }),
    );
    await client.getImportJobStatus('job-1');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a timed-out request as ScormCloudTimeoutError (504), not "unreachable"', async () => {
    fetchMock.mockRejectedValue(timeoutError());
    const err = await client.getImportJobStatus('job-1').catch((e) => e);
    expect(err).toBeInstanceOf(ScormCloudTimeoutError);
    // Not a Cloud answer: callers branching on cloudStatus must not match it.
    expect(err).not.toBeInstanceOf(ScormCloudHttpError);
    expect(err.getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
    expect(err.timeoutMs).toBe(SCORM_CLOUD_TIMEOUT_MS);
  });

  it('treats a stalled body read as a timeout too', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.reject(timeoutError()),
    });
    await expect(client.getCourseAsset('c', 'x.js')).rejects.toBeInstanceOf(
      ScormCloudTimeoutError,
    );
  });

  it('keeps a plain network failure as a 502 "unreachable"', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const err = await client.getImportJobStatus('job-1').catch((e) => e);
    expect(err).not.toBeInstanceOf(ScormCloudTimeoutError);
    expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    // Typed so the course destroy can treat it as retryable.
    expect(err).toBeInstanceOf(ScormCloudNetworkError);
    expect(err.message).toBe('SCORM Cloud is unreachable');
  });

  it('gives the upload import its own longer budget, still under the 60s function limit', async () => {
    expect(SCORM_CLOUD_UPLOAD_TIMEOUT_MS).toBeGreaterThan(
      SCORM_CLOUD_TIMEOUT_MS,
    );
    expect(SCORM_CLOUD_UPLOAD_TIMEOUT_MS).toBeLessThan(60_000);

    fetchMock.mockRejectedValue(timeoutError());
    const err = await client
      .createUploadAndImportCourseJob({
        courseId: 'c',
        file: Buffer.from('zip'),
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ScormCloudTimeoutError);
    expect(err.timeoutMs).toBe(SCORM_CLOUD_UPLOAD_TIMEOUT_MS);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it('gives GetCourseAsset (large runtime-data.js) a longer per-call budget', async () => {
    fetchMock.mockRejectedValue(timeoutError());
    const err = await client.getCourseAsset('c', 'x.js').catch((e) => e);
    expect(err).toBeInstanceOf(ScormCloudTimeoutError);
    expect(err.timeoutMs).toBe(SCORM_CLOUD_ASSET_TIMEOUT_MS);
    expect(SCORM_CLOUD_ASSET_TIMEOUT_MS).toBeGreaterThan(
      SCORM_CLOUD_TIMEOUT_MS,
    );
  });

  it('lets deleteCourse take a short per-call budget', async () => {
    fetchMock.mockRejectedValue(timeoutError());
    const err = await client
      .deleteCourse('c', { timeoutMs: 5000 })
      .catch((e) => e);
    expect(err.timeoutMs).toBe(5000);
  });

  describe('env overrides', () => {
    it('uses SCORM_CLOUD_TIMEOUT_MS / SCORM_CLOUD_UPLOAD_TIMEOUT_MS when set', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
      fetchMock.mockRejectedValue(timeoutError());
      const tuned = makeClient({
        SCORM_CLOUD_TIMEOUT_MS: '2500',
        SCORM_CLOUD_UPLOAD_TIMEOUT_MS: '90000',
      });

      const err = await tuned.getImportJobStatus('job-1').catch((e) => e);
      expect(err.timeoutMs).toBe(2500);
      expect(timeoutSpy).toHaveBeenLastCalledWith(2500);

      const upErr = await tuned
        .createUploadAndImportCourseJob({
          courseId: 'c',
          file: Buffer.from('z'),
        })
        .catch((e) => e);
      expect(upErr.timeoutMs).toBe(90_000);
      expect(timeoutSpy).toHaveBeenLastCalledWith(90_000);
      timeoutSpy.mockRestore();
    });

    it('falls back to the defaults on an invalid value', async () => {
      fetchMock.mockRejectedValue(timeoutError());
      const bad = makeClient({
        SCORM_CLOUD_TIMEOUT_MS: 'soon',
        SCORM_CLOUD_UPLOAD_TIMEOUT_MS: '0',
      });
      const err = await bad.getImportJobStatus('job-1').catch((e) => e);
      expect(err.timeoutMs).toBe(SCORM_CLOUD_TIMEOUT_MS);
      const upErr = await bad
        .createUploadAndImportCourseJob({
          courseId: 'c',
          file: Buffer.from('z'),
        })
        .catch((e) => e);
      expect(upErr.timeoutMs).toBe(SCORM_CLOUD_UPLOAD_TIMEOUT_MS);
    });
  });
});
