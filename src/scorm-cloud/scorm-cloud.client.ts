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
      message:
        typeof json?.message === 'string' ? json.message : undefined,
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
      `/courses/${encodeURIComponent(scormCloudCourseId)}/asset?${qs.toString()}`,
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

  async getRegistrationProgress(
    registrationId: string,
  ): Promise<ScormCloudRegistrationProgress> {
    return this.request<ScormCloudRegistrationProgress>(
      'GET',
      `/registrations/${encodeURIComponent(registrationId)}`,
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

  async deleteCourse(scormCloudCourseId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/courses/${encodeURIComponent(scormCloudCourseId)}`,
      undefined,
      { acceptEmpty: true },
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
      `/learner/${encodeURIComponent(learnerId)}/delete-information?${qs.toString()}`,
      undefined,
      { acceptEmpty: true },
    );
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
    options?: { acceptEmpty?: boolean },
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
    options?: { acceptEmpty?: boolean },
  ): Promise<string> {
    const url = `${this.apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: 'application/json, text/plain, */*',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      this.logger.error(
        `SCORM Cloud ${method} ${path} network error: ${errorMessage(err)}`,
      );
      throw new HttpException(
        'SCORM Cloud is unreachable',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const text = await response.text();
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
