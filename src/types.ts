// Worker와 프론트가 공유하는 타입. 순수 타입 선언만 두어 양쪽 tsconfig에서
// 함께 include 할 수 있게 한다 (EP-5 저장소 계층의 계약서 역할).

export type QuestionType = 'MULTIPLE_CHOICE' | 'NUMERIC_INPUT' | 'TEXT_INPUT';
export type Difficulty = 1 | 2 | 3 | 4;

/** 지금은 유튜브만. 컬럼(video_kind)을 따로 둔 건 나중에 늘릴 여지를 남긴 것. */
export type VideoKind = 'youtube';

/** 문항에 붙은 영상.
 *
 *  유저가 붙여넣은 URL은 저장하지도, 내려보내지도 않는다 — 제공자(kind)와
 *  영상 id만 남기고 실제 임베드 주소는 서버가 조립해 `embedUrl`로 준다.
 *  화면은 이 값을 iframe src에 그대로 쓰기만 하면 된다 (src/media.ts). */
export interface QuestionVideo {
  kind: VideoKind;
  id: string;
  embedUrl: string;
}

export interface Topic {
  id: string;
  name: string;
  kind: 'broad' | 'narrow';
  tagline: string;
  questionCount: Record<'1' | '2' | '3' | '4', number>;
}

/** 출제 시 클라이언트로 내려가는 문항. answer/explanation은 포함하지 않는다. */
export interface ServedQuestion {
  id: string;
  type: QuestionType;
  difficulty: Difficulty;
  body: string;
  choices: string[] | null;
  imageUrl: string | null;
  video: QuestionVideo | null;
}

/** PLAN 4.2절 — 12스테이지 전체 */
export const TOTAL_STAGES = 12;

export interface StartRunResponse {
  runId: string;
  topicId: string;
  stage: number;
  totalStages: number;
  questions: ServedQuestion[];
}

export interface SubmittedAnswer {
  questionId: string;
  given: string;
}

/** 채점 후에야 정답과 해설이 내려간다. */
export interface GradedAnswer {
  questionId: string;
  body: string;
  given: string;
  answer: string;
  correct: boolean;
  difficulty: Difficulty;
  explanation: string;
  imageUrl: string | null;
  video: QuestionVideo | null;
}

/** 판이 끝났을 때만 내려가는 최종 요약.
 *  ranked=false면 유저 창작마당(커뮤니티) 주제 — 랭킹에 반영되지 않으므로
 *  나머지 필드가 없다. */
export type RunFinalSummary =
  | { totalScore: number; stagesCleared: number; ranked: true; topicBestScore: number; isNewBest: boolean; globalScore: number }
  | { totalScore: number; stagesCleared: number; ranked: false };

export interface SubmitStageResponse {
  runId: string;
  stage: number;
  totalStages: number;
  correctCount: number;
  total: number;
  cleared: boolean;
  stageScore: number;
  results: GradedAnswer[];
  /** true면 판이 끝난 것 — 스테이지 실패, 또는 마지막 스테이지까지 클리어. */
  runOver: boolean;
  /** runOver가 false일 때만 채워진다. */
  nextStage?: { stage: number; questions: ServedQuestion[] };
  /** runOver가 true일 때만 채워진다. */
  final?: RunFinalSummary;
}

/** 유저 창작마당 — 자동 검증만 통과하면 즉시 공개되고, 랭킹에는 반영되지 않는다. */
export interface CommunityTopic {
  id: string;
  name: string;
  tagline: string | null;
  status: 'draft' | 'active';
  questionCount: Record<'1' | '2' | '3' | '4', number>;
  authorNickname: string | null;
  isMine: boolean;
  createdAt: string;
}

/** 입력은 유저가 붙여넣은 **날 URL** 그대로 받는다. 파싱·검증은 서버가 한다
 *  — 클라이언트가 미리 걸러주더라도 그건 편의일 뿐 신뢰 대상이 아니기 때문.
 *  imageUrl과 videoUrl은 동시에 채울 수 없다(한 문항에 하나만). */
export interface NewCommunityQuestionInput {
  type: QuestionType;
  difficulty: Difficulty;
  body: string;
  choices: string[] | null;
  answer: string;
  explanation: string;
  imageUrl: string | null;
  videoUrl: string | null;
}

/** uid는 일부러 내려주지 않는다 — 화면이 쓰지 않을뿐더러, 클라이언트가 uid를
 *  알 이유가 없다. 세션은 서명된 쿠키로만 식별한다 (worker/session.ts). */
export interface SessionResponse {
  isAnonymous: boolean;
  nickname: string | null;
}

/** PLAN 5.2절 — 랭킹 메뉴에는 통합 2개 보드만 노출한다. */
export type GlobalBoardId = 'global_all_time' | 'global_weekly';

export interface RankingEntry {
  rank: number;
  nickname: string | null;
  score: number;
  isMe: boolean;
}

export interface RankingBoardResponse {
  boardId: GlobalBoardId;
  top: RankingEntry[];
  /** 30위 밖일 때 "얼마나 더 하면 드는지" 기준선 (5.3절). 30명 미만이면 null. */
  cutoffScore: number | null;
  generatedAt: string | null;
  /** 로그인(계정 승계) 전이면 null — 익명 상태는 랭킹 집계 대상이 아니다. */
  me: { score: number; inTop: boolean } | null;
}

/** 주제별 순위는 랭킹 메뉴가 아니라 그 주제 결과 화면 안에서만 보여준다 (5.2절). */
export interface TopicRankingResponse {
  topicId: string;
  top: RankingEntry[];
  /** 이 주제 기록이 없거나 익명 상태면 null. */
  me: { score: number; rank: number } | null;
}
