// Worker와 프론트가 공유하는 타입. 순수 타입 선언만 두어 양쪽 tsconfig에서
// 함께 include 할 수 있게 한다 (EP-5 저장소 계층의 계약서 역할).

export type QuestionType = 'MULTIPLE_CHOICE' | 'NUMERIC_INPUT';
export type Difficulty = 1 | 2 | 3 | 4;

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
}

/** 판이 끝났을 때만 내려가는 최종 요약. */
export interface RunFinalSummary {
  totalScore: number;
  stagesCleared: number;
  topicBestScore: number;
  isNewBest: boolean;
  globalScore: number;
}

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

export interface SessionResponse {
  uid: string;
  isAnonymous: boolean;
  nickname: string | null;
}
