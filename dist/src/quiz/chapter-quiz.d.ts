import { Prisma } from '@prisma/client';
export declare const LIVE_PLACEMENT: {
    isArchived: false;
    quiz: {
        isArchived: false;
    };
};
export declare const VISIBLE_PLACEMENT: {
    isArchived: false;
    chapter: {
        isArchived: false;
        module: {
            isArchived: false;
        };
    };
};
export declare const HAS_LIVE_QUIZ: {
    quizPlacements: {
        some: {
            isArchived: false;
            quiz: {
                isArchived: false;
            };
        };
    };
};
export declare const PLACEMENT_ORDER: ({
    orderIndex: "asc";
    createdAt?: undefined;
    quizId?: undefined;
} | {
    createdAt: "asc";
    orderIndex?: undefined;
    quizId?: undefined;
} | {
    quizId: "asc";
    orderIndex?: undefined;
    createdAt?: undefined;
})[];
type Db = Pick<Prisma.TransactionClient, 'chapterQuiz'>;
export declare function findLiveChapterQuizIds(db: Db, chapterId: string): Promise<string[]>;
export declare function countLiveChapterQuizzes(db: Db, chapterId: string): Promise<number>;
export declare function nextPlacementOrderIndex(db: Db, chapterId: string, excludeQuizIds?: string[]): Promise<number>;
export declare function exposeQuizCount<T>(row: T): T;
export declare function quizzesOnlyInChapters(chapterIds: string[]): {
    placements: {
        some: {
            chapterId: {
                in: string[];
            };
        };
        every: {
            chapterId: {
                in: string[];
            };
        };
    };
    OR: ({
        isArchived: true;
        placements?: undefined;
    } | {
        placements: {
            some: {
                chapterId: {
                    in: string[];
                };
                isArchived: false;
            };
        };
        isArchived?: undefined;
    })[];
};
export declare function quizPlacementInCourse(courseId: string): {
    isArchived: false;
    chapter: {
        module: {
            courseId: string;
        };
    };
};
export declare function withoutLegacyQuizFields<T extends {
    legacyChapterId?: unknown;
    legacyOrderIndex?: unknown;
}>(quiz: T): Omit<T, 'legacyChapterId' | 'legacyOrderIndex'>;
export {};
