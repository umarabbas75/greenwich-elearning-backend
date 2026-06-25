import { QuizService } from './quiz.service';
import { AssignQuizDto, CheckQuiz, ParamsDto, QuizDto, ResponseDto, UpdateQuizDto } from '../dto';
import { User } from '@prisma/client';
export declare class QuizController {
    private readonly appService;
    constructor(appService: QuizService);
    getQuiz(params: ParamsDto, user: User): Promise<ResponseDto>;
    getAllQuizzes(user: User): Promise<ResponseDto>;
    getAllAssignQuizzes(params: ParamsDto, user: User): Promise<ResponseDto>;
    getChapterQuizzesReport(params: any, user: User): Promise<ResponseDto>;
    getAllQuizReport(): Promise<ResponseDto>;
    createChapterQuizzesReport(body: any, user: User): Promise<ResponseDto>;
    retakeChapterQuiz(body: any, user: User): Promise<ResponseDto>;
    createQuiz(body: QuizDto): Promise<ResponseDto>;
    updateQuiz(body: UpdateQuizDto, params: ParamsDto): Promise<ResponseDto>;
    deleteQuiz(user: User, params: ParamsDto): Promise<ResponseDto>;
    assignQuiz(user: User, params: AssignQuizDto): Promise<ResponseDto>;
    unAssignQuiz(user: User, body: any): Promise<ResponseDto>;
    checkQuiz(body: CheckQuiz, user: User): Promise<ResponseDto>;
    getUserQuizAnswers(params: ParamsDto, user: User): Promise<ResponseDto>;
}
