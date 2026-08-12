import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { auth } from './firebase';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });

    signInAnonymously(auth).catch((err) => setError(err.message));

    return unsubscribe;
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>QuizTrivia</h1>
      {error && <p style={{ color: 'red' }}>인증 오류: {error}</p>}
      {!error && !user && <p>로그인 중...</p>}
      {user && (
        <p>
          내 uid: <code>{user.uid}</code>
        </p>
      )}
    </div>
  );
}

export default App;
