// EP-5 저장소 계층. 화면 코드는 fetch를 직접 부르지 않고 이 파일만 부른다.
// 백엔드를 바꿀 때 이 파일 하나만 고치면 화면은 손대지 않는다 (PLAN 7.3절).

import type {
  CommunityTopic,
  GlobalBoardId,
  NewCommunityQuestionInput,
  RankingBoardResponse,
  SessionResponse,
  StartRunResponse,
  SubmitStageResponse,
  SubmittedAnswer,
  Topic,
  TopicRankingResponse,
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

export function submitStage(runId: string, answers: SubmittedAnswer[]): Promise<SubmitStageResponse> {
  return call<SubmitStageResponse>(`/api/runs/${runId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

/** OAuth는 최상위 리다이렉트가 필요해 fetch가 아니라 실제 페이지 이동으로 시작한다. */
export function goToGoogleLogin(): void {
  window.location.href = '/api/auth/google';
}

export function setNickname(nickname: string): Promise<{ nickname: string }> {
  return call<{ nickname: string }>('/api/nickname', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
}

export function getGlobalRanking(boardId: GlobalBoardId): Promise<RankingBoardResponse> {
  return call<RankingBoardResponse>(`/api/rankings/${boardId}`);
}

export function getTopicRanking(topicId: string): Promise<TopicRankingResponse> {
  return call<TopicRankingResponse>(`/api/rankings/topic/${encodeURIComponent(topicId)}`);
}

export function getCommunityTopics(): Promise<CommunityTopic[]> {
  return call<CommunityTopic[]>('/api/community/topics');
}

export function createCommunityTopic(name: string, tagline: string): Promise<CommunityTopic> {
  return call<CommunityTopic>('/api/community/topics', {
    method: 'POST',
    body: JSON.stringify({ name, tagline }),
  });
}

export function deleteCommunityTopic(topicId: string): Promise<{ deleted: true }> {
  return call<{ deleted: true }>(`/api/community/topics/${encodeURIComponent(topicId)}`, {
    method: 'DELETE',
  });
}

/** 기기에서 고른 이미지를 올리고, 문항에 넣을 경로를 돌려받는다.
 *  파일을 그대로 본문에 실어 보낸다 — multipart를 쓸 이유가 없다. */
export async function uploadQuestionImage(file: File): Promise<{ url: string }> {
  const res = await fetch('/api/community/images', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error((detail as { error?: string } | null)?.error ?? `업로드 실패 (${res.status})`);
  }
  return res.json() as Promise<{ url: string }>;
}

export function addCommunityQuestion(
  topicId: string,
  question: NewCommunityQuestionInput,
): Promise<CommunityTopic> {
  return call<CommunityTopic>(`/api/community/topics/${encodeURIComponent(topicId)}/questions`, {
    method: 'POST',
    body: JSON.stringify(question),
  });
}
