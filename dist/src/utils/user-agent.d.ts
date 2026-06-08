export interface ParsedUserAgent {
    browser: string;
    os: string;
    deviceType: 'mobile' | 'tablet' | 'desktop';
    label: string;
}
export declare function parseUserAgent(ua: string | null | undefined): ParsedUserAgent | null;
