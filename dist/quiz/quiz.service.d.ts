import { CheckQuiz, QuizDto, ResponseDto, UpdateQuizDto } from '../dto';
import { PrismaService } from '../prisma/prisma.service';
export declare class QuizService {
    private prisma;
    constructor(prisma: PrismaService);
    getQuiz(id: string, role: string): Promise<ResponseDto>;
    getAllQuizzes(role: string): Promise<ResponseDto>;
    getAllAssignQuizzes(chapterId: string, role: string, userId: string): Promise<ResponseDto>;
    createQuiz(body: QuizDto): Promise<ResponseDto>;
    assignQuiz(quizId: string, chapterId: string): Promise<ResponseDto>;
    unAssignQuiz(quizId: string, chapterId: string): Promise<ResponseDto>;
    updateQuiz(id: string, body: UpdateQuizDto): Promise<ResponseDto>;
    deleteQuiz(id: string): Promise<ResponseDto>;
    checkQuiz(userId: string, body: CheckQuiz): Promise<ResponseDto>;
    getUserQuizAnswers(userId: string, chapterId: string): Promise<ResponseDto>;
}
