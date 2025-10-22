import type { UUID } from "./types/ids";

const USER_ID_KEY = "vecto_user_id";
const DEVICE_ID_KEY = "vecto_device_id";
const SESSION_ID_KEY = "vecto_session_id";
const SESSION_LAST_ACTIVITY_KEY = "vecto_session_last_activity";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function generateUUID(): UUID {
  return crypto.randomUUID();
}

export function getUserId(): UUID {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = generateUUID();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

export function getDeviceId(): UUID {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = generateUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function getSessionId(): UUID {
  const now = Date.now();
  const lastActivity = localStorage.getItem(SESSION_LAST_ACTIVITY_KEY);
  
  let sessionId = localStorage.getItem(SESSION_ID_KEY);
  
  if (!sessionId || !lastActivity || (now - parseInt(lastActivity)) > SESSION_TIMEOUT_MS) {
    sessionId = generateUUID();
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  
  localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, now.toString());
  return sessionId;
}

export function getIdentity() {
  return {
    user_id: getUserId(),
    device_id: getDeviceId(),
    session_id: getSessionId(),
  };
}

export function linkUserAccount(accountUserId: UUID) {
  localStorage.setItem(USER_ID_KEY, accountUserId);
}
