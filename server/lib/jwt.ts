
export function verifyAppToken(token: string) {
  // Simplified JWT verification for development
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return { userId: payload.userId || 'user_' + Date.now() };
  } catch {
    return { userId: 'user_' + Date.now() };
  }
}

export function isPhantom(userId: string, tetherSig?: string): boolean {
  return false; // Simplified for development
}
