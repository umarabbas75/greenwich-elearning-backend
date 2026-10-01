import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errorMessage } from '../utils/error-message';
import { stripTrailingSlash } from '../utils/strip-trailing-slash';

export class ScormCloudHttpError extends HttpException {
  readonly cloudStatus: number;
  readonly cloudBody: string;

  constructor(status: number, body: string) {
    super(
      {
        status,
        error: `SCORM Cloud request failed (${status})`,
        detail: body.slice(0, 500),
      },
      status >= 400 && status < 600 ? status : HttpStatus.BAD_GATEWAY,
    );
    this.cloudStatus = status;
    this.cloudBody = body;
  }
}

/**
 * Cloud did not answer within the per-request budget. Distinct from
 * ScormCloudHttpError on purpose: callers branch on `cloudStatus` (404 = gone,
 * 409 = exists) and a timeout carries no Cloud status at all — reporting it
 * as one would make "slow" look like an answer.
 */
export class ScormCloudTimeoutError extends HttpException {
  readonly timeoutMs: number;

  constructor(what: string, timeoutMs: number) {
    super(
      `SCORM Cloud did not respond within ${Math.round(
        timeoutMs / 1000,
      )}s (${what})`,
      HttpStatus.GATEWAY_TIMEOUT,
    );
    this.timeoutMs = timeoutMs;
  }
}

/**
 * The request never got an HTTP answer (DNS, reset, TLS…). Same 502 and
 * message the client always threw; the subclass only lets callers tell
 * "Cloud unreachable, retry" from a definitive answer or a config error.
 */
export class ScormCloudNetworkError extends HttpException {
  constructor() {
    super('SCORM Cloud is unreachable', HttpStatus.BAD_GATEWAY);
  }
}

/**
 * Per-request budget (default; SCORM_CLOUD_TIMEOUT_MS overrides). Every request-path call runs inside a 60s serverless
 * invocation (vercel.json maxDuration) that may make several Cloud calls plus
 * DB writes, so one hung socket must not eat the whole budget — without a
 * signal, fetch waits for the OS TCP timeout and the function is killed
 * mid-write with no error recorded anywhere.
 */
export const SCORM_CLOUD_TIMEOUT_MS = 10_000;
/**
 * GetCourseAsset for Rise's runtime-data.js: a large body (the whole course's
 * text, often MBs) whose read the signal also covers, so 10s times out on a
 * slow-but-healthy Cloud and leaves the import PROCESSING. Still well inside
 * 60s with the job-status and configuration calls that precede it.
 */
export const SCORM_CLOUD_ASSET_TIMEOUT_MS = 25_000;
/**
 * Default for SCORM_CLOUD_UPLOAD_TIMEOUT_MS. The multipart upload streams the
 * whole zip, so it gets far longer — but it
 * runs in that same 60s invocation, so it stays under it with room left for
 * the FAILED write / course rollback in startPackageImport. A longer budget
 * would only mean Vercel kills the function before our catch can run. Raise it
 * only where the host's limit is longer (e.g. a long-running server).
 */
export const SCORM_CLOUD_UPLOAD_TIMEOUT_MS = 35_000;

function isAbortTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export type ScormCloudImportJobStatus = {
  status: string;
  message?: string;
};

export type ScormCloudRegistrationProgress = {
  id?: string;
  registrationCompletion?: string;
  registrationSuccess?: string;
  score?: { scaled?: number };
  totalSecondsTracked?: number;
  [key: string]: unknown;
};

export type ScormCloudConfigurationSetting = {
  settingId: string;
  value: string;
  explicit?: boolean;
};

/** Embedded iframe / same-tab launch — not NEW_WINDOW popup launcher. */
export const SCORM_EMBEDDED_LAUNCH_SETTINGS: ScormCloudConfigurationSetting[] =
  [
    { settingId: 'PlayerLaunchType', value: 'FRAMESET', explicit: true },
    { settingId: 'PlayerScoLaunchType', value: 'FRAMESET', explicit: true },
  ];

export type CreateRegistrationInput = {
  courseId: string;
  registrationId: string;
  learner: { id: string; firstName: string; lastName: string };
  postBack: {
    url: string;
    authType: 'HTTPBASIC';
    userName: string;
    password: string;
    resultsFormat: 'COURSE';
  };
};

/**
 * Leaf HTTP client for SCORM Cloud V2. No Nest controllers. Prisma is not
 * required here — ConfigModule only — so UserModule can import this for GDPR
 * without pulling ScormModule.
 */
@Injectable()
export class ScormCloudClient {
  private readonly logger = new Logger(ScormCloudClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * CreateFetchAndImportCourseJob. Body is `{ url }` (not contentUrl).
   * Persist `response.result` as cloudImportJobId (StringResultSchema).
   * Always `mayCreateNewVersion=false`.
   */
  async createFetchAndImportCourseJob(args: {
    courseId: string;
    url: string;
  }): Promise<string> {
    const qs = new URLSearchParams({
      courseId: args.courseId,
      mayCreateNewVersion: 'false',
    });
    const json = await this.request<{ result?: string }>(
      'POST',
      `/courses/importJobs?${qs.toString()}`,
      { url: args.url },
    );
    return this.parseImportJobId(json);
  }

  /**
   * CreateUploadAndImportCourseJob — multipart zip upload (no public URL).
   * Use when the package exceeds third-party host limits (e.g. Cloudinary 10MB).
   */
  async createUploadAndImportCourseJob(args: {
    courseId: string;
    file: Buffer;
    filename?: string;
  }): Promise<string> {
    const qs = new URLSearchParams({
      courseId: args.courseId,
      mayCreateNewVersion: 'false',
    });
    const form = new FormData();
    const name = args.filename?.trim() || 'package.zip';
    form.append(
      'file',
      new Blob([args.file], { type: 'application/zip' }),
      name,
    );
    const url = `${this.apiBase()}/courses/importJobs/upload?${qs.toString()}`;
    // Built OUTSIDE the try, as requestText does. `authHeader()` throws when
    // the Cloud credentials are unset, and inside the try that config error
    // would be caught and reported as "SCORM Cloud is unreachable" — a 502 the
    // import path then writes into the package's failureReason, sending an
    // admin to check Cloud's status page over a missing env var.
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: 'application/json, text/plain, */*',
    };

    // One signal for the whole exchange: it also aborts the body read, so a
    // Cloud that sends headers then stalls cannot hang us either.
    const uploadTimeoutMs = this.timeoutMs(
      'SCORM_CLOUD_UPLOAD_TIMEOUT_MS',
      SCORM_CLOUD_UPLOAD_TIMEOUT_MS,
    );
    const signal = AbortSignal.timeout(uploadTimeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: form,
        signal,
      });
      text = await response.text();
    } catch (err) {
      if (isAbortTimeout(err)) {
        this.logger.error(
          `SCORM Cloud upload import timed out after ${uploadTimeoutMs}ms`,
        );
        throw new ScormCloudTimeoutError('upload import', uploadTimeoutMs);
      }
      this.logger.error(
        `SCORM Cloud upload import network error: ${errorMessage(err)}`,
      );
      throw new ScormCloudNetworkError();
    }
    if (!response.ok) {
      throw new ScormCloudHttpError(response.status, text);
    }
    let json: { result?: string };
    try {
      json = text ? (JSON.parse(text) as { result?: string }) : {};
    } catch {
      throw new HttpException(
        'SCORM Cloud upload import returned non-JSON',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return this.parseImportJobId(json);
  }

  private parseImportJobId(json: { result?: string } | undefined): string {
    const jobId = json && typeof json === 'object' ? json.result : undefined;
    if (!jobId || typeof jobId !== 'string') {
      throw new HttpException(
        'SCORM Cloud import job did not return a result id',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return jobId;
  }

  /**
   * SetCourseConfiguration — e.g. PlayerLaunchType / PlayerScoLaunchType for
   * embedded iframe launch (FRAMESET instead of default NEW_WINDOW popup).
   */
  async setCourseConfiguration(
    courseId: string,
    settings: ScormCloudConfigurationSetting[],
  ): Promise<void> {
    await this.request(
      'POST',
      `/courses/${encodeURIComponent(courseId)}/configuration`,
      { settings },
      { acceptEmpty: true },
    );
  }

  async getImportJobStatus(jobId: string): Promise<ScormCloudImportJobStatus> {
    const json = await this.request<ScormCloudImportJobStatus>(
      'GET',
      `/courses/importJobs/${encodeURIComponent(jobId)}`,
    );
    return {
      status: String(json?.status ?? ''),
      message: typeof json?.message === 'string' ? json.message : undefined,
    };
  }

  /**
   * GetCourseAsset — `relativePath` is a query param, not a path segment.
   * Used for Rise `scormcontent/runtime-data.js`.
   */
  async getCourseAsset(
    scormCloudCourseId: string,
    relativePath: string,
  ): Promise<string> {
    const qs = new URLSearchParams({ relativePath });
    return this.requestText(
      'GET',
      `/courses/${encodeURIComponent(
        scormCloudCourseId,
      )}/asset?${qs.toString()}`,
      undefined,
      {
        // Never below the general budget: an env raise for a slow network
        // must not leave the biggest read with the smallest budget.
        timeoutMs: Math.max(
          SCORM_CLOUD_ASSET_TIMEOUT_MS,
          this.timeoutMs('SCORM_CLOUD_TIMEOUT_MS', SCORM_CLOUD_TIMEOUT_MS),
        ),
      },
    );
  }

  async createRegistration(input: CreateRegistrationInput): Promise<void> {
    await this.request(
      'POST',
      '/registrations',
      {
        courseId: input.courseId,
        registrationId: input.registrationId,
        learner: input.learner,
        postBack: input.postBack,
      },
      { acceptEmpty: true },
    );
  }

  async buildRegistrationLaunchLink(args: {
    registrationId: string;
    redirectOnExitUrl: string;
    expiry?: number;
  }): Promise<string> {
    const expiry = clampExpiry(args.expiry ?? 120);
    const json = await this.request<{ launchLink?: string; result?: string }>(
      'POST',
      `/registrations/${encodeURIComponent(args.registrationId)}/launchLink`,
      {
        redirectOnExitUrl: args.redirectOnExitUrl,
        expiry,
      },
    );
    const link = json?.launchLink || json?.result;
    if (!link || typeof link !== 'string') {
      throw new HttpException(
        'SCORM Cloud launch link was empty',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return link;
  }

  /**
   * GetRegistrationProgress.
   *
   * `detail` selects how much of the record comes back, and the three levels
   * are exactly the three postback `resultsFormat` values:
   *
   *   'course'   → registration summary; `activityDetails.children` is empty
   *   'activity' → + child activities (attempts, suspended, completionAmount)
   *   'full'     → + per-SCO `runtime`, which is the ONLY place suspendData is
   *
   * Verified against the live API on 2026-09-21. Lesson-level progress is
   * decoded from suspendData, so anything that wants it must ask for 'full';
   * the default stays 'course' so existing callers keep their payload size.
   */
  async getRegistrationProgress(
    registrationId: string,
    detail: 'course' | 'activity' | 'full' = 'course',
  ): Promise<ScormCloudRegistrationProgress> {
    const qs = new URLSearchParams();
    if (detail === 'activity' || detail === 'full') {
      qs.set('includeChildResults', 'true');
    }
    if (detail === 'full') {
      qs.set('includeRuntime', 'true');
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<ScormCloudRegistrationProgress>(
      'GET',
      `/registrations/${encodeURIComponent(registrationId)}${suffix}`,
    );
  }

  async deleteRegistration(registrationId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/registrations/${encodeURIComponent(registrationId)}`,
      undefined,
      { acceptEmpty: true },
    );
  }

  /** `timeoutMs` overrides the default budget (see startPackageImport). */
  async deleteCourse(
    scormCloudCourseId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/courses/${encodeURIComponent(scormCloudCourseId)}`,
      undefined,
      { acceptEmpty: true, timeoutMs: options?.timeoutMs },
    );
  }

  /**
   * DeleteAllLearnerData — async on Cloud's side. Fire-and-forget.
   * Requires application deletes enabled and a Realm Owner email.
   */
  async deleteAllLearnerData(learnerId: string): Promise<void> {
    const ownerEmail = this.config.get<string>('SCORM_CLOUD_OWNER_EMAIL');
    if (!ownerEmail) {
      throw new Error('SCORM_CLOUD_OWNER_EMAIL is not configured');
    }
    const qs = new URLSearchParams({ userEmail: ownerEmail });
    await this.request(
      'DELETE',
      `/learner/${encodeURIComponent(
        learnerId,
      )}/delete-information?${qs.toString()}`,
      undefined,
      { acceptEmpty: true },
    );
  }

  /** Env override for a budget; anything not a positive number → default. */
  private timeoutMs(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms <= 0) {
      this.logger.warn(`Ignoring invalid ${key}="${raw}"; using ${fallback}ms`);
      return fallback;
    }
    return ms;
  }

  private apiBase(): string {
    const base =
      this.config.get<string>('SCORM_CLOUD_API_BASE') ||
      'https://cloud.scorm.com/api/v2';
    return stripTrailingSlash(base);
  }

  private authHeader(): string {
    const appId = this.config.get<string>('SCORM_CLOUD_APP_ID');
    const secret = this.config.get<string>('SCORM_CLOUD_SECRET_KEY');
    if (!appId || !secret) {
      throw new HttpException(
        'SCORM Cloud credentials are not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { acceptEmpty?: boolean; timeoutMs?: number },
  ): Promise<T> {
    const text = await this.requestText(method, path, body, options);
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      if (options?.acceptEmpty) return undefined as T;
      this.logger.warn(`SCORM Cloud ${method} ${path} returned non-JSON`);
      throw new HttpException(
        'SCORM Cloud returned a non-JSON response',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private async requestText(
    method: string,
    path: string,
    body?: unknown,
    options?: { acceptEmpty?: boolean; timeoutMs?: number },
  ): Promise<string> {
    const url = `${this.apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
    // A per-call budget is a property of the call (a big body, a cleanup that
    // must fit what is left of the invocation), so it wins over the env default.
    const timeoutMs =
      options?.timeoutMs ??
      this.timeoutMs('SCORM_CLOUD_TIMEOUT_MS', SCORM_CLOUD_TIMEOUT_MS);
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: 'application/json, text/plain, */*',
    };
    const init: RequestInit = {
      method,
      headers,
      // Covers the body read below too, not just the headers.
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    let text: string;
    try {
      response = await fetch(url, init);
      text = await response.text();
    } catch (err) {
      if (isAbortTimeout(err)) {
        this.logger.error(
          `SCORM Cloud ${method} ${path} timed out after ${timeoutMs}ms`,
        );
        throw new ScormCloudTimeoutError(
          `${method} ${path.split('?')[0]}`,
          timeoutMs,
        );
      }
      this.logger.error(
        `SCORM Cloud ${method} ${path} network error: ${errorMessage(err)}`,
      );
      throw new ScormCloudNetworkError();
    }

    if (response.status === 204 || (options?.acceptEmpty && !text)) {
      if (!response.ok && response.status !== 204) {
        throw new ScormCloudHttpError(response.status, text);
      }
      return '';
    }
    if (!response.ok) {
      throw new ScormCloudHttpError(response.status, text);
    }
    return text;
  }
}

function clampExpiry(expiry: number): number {
  if (!Number.isFinite(expiry)) return 120;
  return Math.min(300, Math.max(10, Math.round(expiry)));
}
