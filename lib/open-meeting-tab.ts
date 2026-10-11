const STORAGE_KEY = "recall-open-tab";

export function markOpenOnTranscript(meetingId: string) {
  sessionStorage.setItem(STORAGE_KEY, meetingId);
}

export function takeOpenOnTranscript(meetingId: string) {
  if (sessionStorage.getItem(STORAGE_KEY) !== meetingId) return false;
  sessionStorage.removeItem(STORAGE_KEY);
  return true;
}
