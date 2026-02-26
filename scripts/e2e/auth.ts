const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

export async function authenticate(
  email: string,
  password: string,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  // Step 1: Sign in with Firebase Auth REST API to get idToken
  const authRes = await fetch(`${FIREBASE_AUTH_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  if (!authRes.ok) {
    const err = await authRes.json().catch(() => ({}));
    throw new Error(`Firebase auth failed: ${err.error?.message || authRes.statusText}`);
  }

  const { idToken } = await authRes.json();
  if (!idToken) throw new Error('No idToken in auth response');

  // Step 2: Exchange idToken for session cookie
  const sessionRes = await fetch(`${baseUrl}/api/auth/session-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    redirect: 'manual',
  });

  if (!sessionRes.ok && sessionRes.status !== 302) {
    throw new Error(`Session login failed: ${sessionRes.status} ${sessionRes.statusText}`);
  }

  // Step 3: Extract session cookie from Set-Cookie header
  const setCookie = sessionRes.headers.get('set-cookie') || '';
  const match = setCookie.match(/session=([^;]+)/);
  if (!match) {
    throw new Error('No session cookie in response. Set-Cookie header: ' + setCookie);
  }

  return match[1];
}
