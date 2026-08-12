import { useEffect, useState } from 'react';

function App() {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/session', { method: 'POST', credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
        return res.json() as Promise<{ uid: string }>;
      })
      .then((data) => setUid(data.uid))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>QuizTrivia</h1>
      {error && <p style={{ color: 'red' }}>오류: {error}</p>}
      {!error && !uid && <p>로그인 중...</p>}
      {uid && (
        <p>
          내 uid: <code>{uid}</code>
        </p>
      )}
    </div>
  );
}

export default App;
