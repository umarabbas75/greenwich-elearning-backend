import { CourseService } from './course.service';
import { AssignCourseDto, CourseDto, GetUpdateLastSeen, ModuleDto, ParamsDto, ParamsDto1, ResponseDto, UpdateCourseDto } from '../dto';
import { User } from '@prisma/client';
export declare class CourseController {
    private readonly appService;
    constructor(appService: CourseService);
    getAllPublicCourses(): Promise<ResponseDto>;
    getCourseDetailPublic(params: any): Promise<any>;
    getCourseReport(params: any): Promise<any>;
    getCourseDates(params: any): Promise<any>;
    createPostComment(params: any, user: User, body: any): Promise<any>;
    getPostComments(params: any): Promise<any>;
    updatePostComment(params: any, body: any): Promise<any>;
    deletePostComment(params: any): Promise<any>;
    getPost(id: string): Promise<any>;
    getAllPosts(params: any): Promise<ResponseDto>;
    createPost(params: any, user: User, body: any): Promise<any>;
    createPolicies(user: User, body: any): Promise<any>;
    deletePolicies(): Promise<any>;
    getUserPolicies(user: User): Promise<any>;
    updatePost(body: any, id: string): Promise<any>;
    deletePost(id: string): Promise<any>;
    getCourse(params: any): Promise<any>;
    getModule(params: ParamsDto): Promise<ResponseDto>;
    getChapter(params: ParamsDto): Promise<ResponseDto>;
    getSection(params: ParamsDto): Promise<ResponseDto>;
    getAllCourses(): Promise<ResponseDto>;
    getAllModules(params: ParamsDto): Promise<ResponseDto>;
    getAllUserModules(params: ParamsDto, user: User): Promise<ResponseDto>;
    getAllChapters(params: ParamsDto): Promise<ResponseDto>;
    getAllSections(params: ParamsDto): Promise<ResponseDto>;
    getAllUserSections(params: ParamsDto1, user: User): Promise<ResponseDto>;
    createCourse(body: CourseDto): Promise<ResponseDto>;
    updateCourse(body: CourseDto, params: ParamsDto): Promise<ResponseDto>;
    updateModule(body: UpdateCourseDto, params: ParamsDto): Promise<ResponseDto>;
    updateChapter(body: UpdateCourseDto, params: ParamsDto): Promise<ResponseDto>;
    updateSection(body: any, params: ParamsDto): Promise<ResponseDto>;
    assignCourse(params: AssignCourseDto): Promise<ResponseDto>;
    assignCoursePublic(params: any): Promise<ResponseDto>;
    unAssignCourse(body: any): Promise<ResponseDto>;
    toggleCourseStatus(body: any): Promise<ResponseDto>;
    toggleCoursePaymentStatus(body: any): Promise<ResponseDto>;
    getAllAssignedCourses(params: ParamsDto, user: User): Promise<ResponseDto>;
    getAllAssignedCoursesPublic(params: ParamsDto): Promise<ResponseDto>;
    createModule(body: ModuleDto): Promise<ResponseDto>;
    createChapter(body: ModuleDto): Promise<ResponseDto>;
    createSection(body: any): Promise<ResponseDto>;
    deleteCourse(params: ParamsDto): Promise<ResponseDto>;
    deleteModule(params: ParamsDto): Promise<ResponseDto>;
    deleteChapter(params: ParamsDto): Promise<ResponseDto>;
    deleteSection(params: ParamsDto): Promise<ResponseDto>;
    updateUserChapterProgress(body: any, user: User): Promise<ResponseDto>;
    getUserChapterProgress(params: AssignCourseDto): Promise<ResponseDto>;
    getLastSeen(param: GetUpdateLastSeen): Promise<ResponseDto>;
    updateLastSeen(body: any, user: User): Promise<ResponseDto>;
}
