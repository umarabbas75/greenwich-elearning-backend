"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promoteFormAddressToUserIfMissing = exports.userHasGlobalAddress = exports.extractUserAddressFromMetadata = void 0;
const ADDRESS_PART_KEYS = [
    'houseStreetNumber',
    'mainAddress',
    'city',
    'country',
];
function trimString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function extractUserAddressFromMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return null;
    }
    const obj = metadata;
    const direct = trimString(obj.address);
    if (direct) {
        return direct;
    }
    const parts = [];
    for (const key of ADDRESS_PART_KEYS) {
        const value = trimString(obj[key]);
        if (!value) {
            continue;
        }
        const duplicate = parts.some((part) => part.toLowerCase() === value.toLowerCase() ||
            part.toLowerCase().includes(value.toLowerCase()) ||
            value.toLowerCase().includes(part.toLowerCase()));
        if (!duplicate) {
            parts.push(value);
        }
    }
    return parts.length > 0 ? parts.join(', ') : null;
}
exports.extractUserAddressFromMetadata = extractUserAddressFromMetadata;
function userHasGlobalAddress(address) {
    return Boolean(address?.trim());
}
exports.userHasGlobalAddress = userHasGlobalAddress;
async function promoteFormAddressToUserIfMissing(prisma, userId, metadata) {
    const address = extractUserAddressFromMetadata(metadata);
    if (!address) {
        return { updated: false, address: null };
    }
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { address: true },
    });
    if (!user || userHasGlobalAddress(user.address)) {
        return { updated: false, address: null };
    }
    await prisma.user.update({
        where: { id: userId },
        data: { address },
    });
    return { updated: true, address };
}
exports.promoteFormAddressToUserIfMissing = promoteFormAddressToUserIfMissing;
//# sourceMappingURL=promote-form-address-to-user.js.map