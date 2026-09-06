import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScormPostbackGuard } from './scorm-postback.guard';

function contextWithAuth(header: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: header ? { authorization: header } : {},
      }),
    }),
  } as ExecutionContext;
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('ScormPostbackGuard', () => {
  const config = {
    get: jest.fn(),
  };
  let guard: ScormPostbackGuard;

  beforeEach(() => {
    config.get.mockReset();
    guard = new ScormPostbackGuard(config as unknown as ConfigService);
  });

  it('fails closed when credentials are unset', () => {
    config.get.mockReturnValue(undefined);
    expect(() => guard.canActivate(contextWithAuth(basic('a', 'b')))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects missing Basic Auth', () => {
    config.get.mockImplementation((key: string) =>
      key.includes('USER') ? 'cloud' : 'secret',
    );
    expect(() => guard.canActivate(contextWithAuth(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects invalid Basic Auth', () => {
    config.get.mockImplementation((key: string) =>
      key.includes('USER') ? 'cloud' : 'secret',
    );
    expect(() =>
      guard.canActivate(contextWithAuth(basic('cloud', 'wrong'))),
    ).toThrow(UnauthorizedException);
  });

  it('does not throw on unequal-length secrets', () => {
    config.get.mockImplementation((key: string) =>
      key.includes('USER') ? 'cloud' : 'secret',
    );
    expect(() =>
      guard.canActivate(contextWithAuth(basic('cloud', 'x'))),
    ).toThrow(UnauthorizedException);
  });

  it('accepts matching credentials', () => {
    config.get.mockImplementation((key: string) =>
      key.includes('USER') ? 'cloud' : 'secret',
    );
    expect(guard.canActivate(contextWithAuth(basic('cloud', 'secret')))).toBe(
      true,
    );
  });
});
