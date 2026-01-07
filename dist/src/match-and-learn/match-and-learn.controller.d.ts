import { MatchAndLearnService } from './match-and-learn.service';
import { MatchAndLearnDto, UpdateMatchAndLearnDto, ResponseDto } from '../dto';
export declare class MatchAndLearnController {
    private readonly matchAndLearnService;
    constructor(matchAndLearnService: MatchAndLearnService);
    createMatchAndLearn(body: MatchAndLearnDto): Promise<ResponseDto>;
    getAllMatchAndLearn(chapterId?: string): Promise<ResponseDto>;
    getMatchAndLearnById(id: string): Promise<ResponseDto>;
    updateMatchAndLearn(id: string, body: UpdateMatchAndLearnDto): Promise<ResponseDto>;
    deleteMatchAndLearn(id: string): Promise<ResponseDto>;
    submitMatchAndLearnCompletion(matchAndLearnId: string, body: {
        userId: string;
        chapterId: string;
        userAnswers: Record<string, string>;
    }): Promise<ResponseDto>;
    getUserProgress(userId: string, chapterId?: string): Promise<ResponseDto>;
}
