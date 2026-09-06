export type NestableComment = {
    id: string;
    parentId?: string | null;
    createdAt?: Date | string;
    isAccepted?: boolean;
    voteScore?: number;
};
export declare function nestForumComments<T extends NestableComment>(comments: T[], sort?: string): (T & {
    replies: T[];
})[];
