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

export interface StartRunResponse {
  runId: string;
  topicId: string;
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

export interface SubmitRunResponse {
  runId: string;
  score: number;
  correctCount: number;
  total: number;
  cleared: boolean;
  results: GradedAnswer[];
  topicBestScore: number;
  isNewBest: boolean;
  globalScore: number;
}

export interface SessionResponse {
  uid: string;
}
