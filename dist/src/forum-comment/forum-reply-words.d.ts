export declare const FORUM_REPLY_MAX_WORDS = 300;
export declare function forumReplyPlainText(html: string): string;
export declare function countForumReplyWords(html: string | null | undefined): number;
export declare function assertForumReplyWordLimit(html: string): void;
