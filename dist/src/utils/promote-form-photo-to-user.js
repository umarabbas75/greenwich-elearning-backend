"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promoteFormPhotoToUserIfMissing = exports.userHasGlobalPhoto = exports.extractUserPhotoFromMetadata = void 0;
function extractUserPhotoFromMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return null;
    }
    const raw = metadata.userPhoto;
    if (typeof raw !== 'string') {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}
exports.extractUserPhotoFromMetadata = extractUserPhotoFromMetadata;
function userHasGlobalPhoto(photo) {
    return Boolean(photo?.trim());
}
exports.userHasGlobalPhoto = userHasGlobalPhoto;
async function promoteFormPhotoToUserIfMissing(prisma, userId, metadata) {
    const photoUrl = extractUserPhotoFromMetadata(metadata);
    if (!photoUrl) {
        return { updated: false, photoUrl: null };
    }
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { photo: true },
    });
    if (!user || userHasGlobalPhoto(user.photo)) {
        return { updated: false, photoUrl: null };
    }
    await prisma.user.update({
        where: { id: userId },
        data: { photo: photoUrl },
    });
    return { updated: true, photoUrl };
}
exports.promoteFormPhotoToUserIfMissing = promoteFormPhotoToUserIfMissing;
//# sourceMappingURL=promote-form-photo-to-user.js.map