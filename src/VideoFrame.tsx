// 문항에 붙은 영상을 그리는 곳. 퀴즈 화면·리뷰 목록·창작마당 미리보기가
// 전부 이 컴포넌트 하나를 쓴다 (App.tsx가 Workshop.tsx를 import하므로
// 순환을 피하려고 별도 파일로 뒀다).
import type { QuestionVideo } from './types';

/** src는 서버가 조립해준 `embedUrl`만 쓴다 — 유저가 붙여넣은 URL이 여기까지
 *  흘러오는 경로는 없다(src/media.ts). 그 성질이 이 iframe의 안전성을
 *  떠받치므로, 여기서 주소를 직접 만들거나 이어붙이지 말 것. */
export function VideoFrame({ video, className }: { video: QuestionVideo; className?: string }) {
  return (
    <div className={className ? `video-frame ${className}` : 'video-frame'}>
      <iframe
        src={video.embedUrl}
        title="문항 영상"
        loading="lazy"
        // 자동재생은 일부러 뺐다 — 문항이 열리자마자 소리가 나면 안 된다.
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}
