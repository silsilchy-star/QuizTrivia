// EP-5 저장소 계층. 화면 코드는 fetch를 직접 부르지 않고 이 파일만 부른다.
// 백엔드를 바꿀 때 이 파일 하나만 고치면 화면은 손대지 않는다 (PLAN 7.3절).

import type {
  SessionResponse,
  StartRunResponse,
  SubmitRunResponse,
  SubmittedAnswer,
  Topic,
} from './types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${path} 실패 (${res.status}) ${detail}`);
  }
  return res.json() as Promise<T>;
}

export function ensureSession(): Promise<SessionResponse> {
  return call<SessionResponse>('/api/session', { method: 'POST' });
}

export function getTopics(): Promise<Topic[]> {
  return call<Topic[]>('/api/topics');
}

export function startRun(topicId: string): Promise<StartRunResponse> {
  return call<StartRunResponse>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ topicId }),
  });
}

export function submitRun(runId: string, answers: SubmittedAnswer[]): Promise<SubmitRunResponse> {
  return call<SubmitRunResponse>(`/api/runs/${runId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}
