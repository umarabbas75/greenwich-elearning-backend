import { PrismaService } from '../prisma/prisma.service';
export declare function parseVoteValue(body: unknown): 0 | 1;
export declare function withVotedByMe<T extends {
    votes?: {
        id: string;
    }[];
}>(row: T): Omit<T, 'votes'> & {
    isVotedByMe: boolean;
};
export declare function toggleForumVote(prisma: PrismaService, args: {
    userId: string;
    threadId?: string;
    commentId?: string;
    value: 0 | 1;
}): Promise<{
    voteScore: number;
    isVotedByMe: boolean;
}>;
