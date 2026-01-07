import { PrismaService } from '../prisma/prisma.service';
import { MatchAndLearnDto, ResponseDto, UpdateMatchAndLearnDto } from '../dto';
export declare class MatchAndLearnService {
    private prisma;
    constructor(prisma: PrismaService);
    createMatchAndLearn(body: MatchAndLearnDto): Promise<ResponseDto>;
    getAllMatchAndLearn(chapterId?: string): Promise<ResponseDto>;
    getMatchAndLearnById(id: string): Promise<ResponseDto>;
    updateMatchAndLearn(id: string, body: UpdateMatchAndLearnDto): Promise<ResponseDto>;
    deleteMatchAndLearn(id: string): Promise<ResponseDto>;
    submitMatchAndLearnCompletion(userId: string, matchAndLearnId: string, chapterId: string, userAnswers: Record<string, string>): Promise<ResponseDto>;
    getUserProgress(userId: string, chapterId?: string): Promise<ResponseDto>;
}
