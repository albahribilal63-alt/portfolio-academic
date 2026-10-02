export const MAX_DATA_BODY_BYTES = 1_048_576;
export const MAX_LOGIN_BODY_BYTES = 16_384;
export const MAX_GITHUB_RESPONSE_BYTES = 2_097_152;
export const MAX_ASSET_FILE_BYTES = Math.floor((MAX_DATA_BODY_BYTES - 4_096) * 3 / 4);