// Firebase's sign-in pages for "Continue with Google" (the Google window and the hand-back to Frixion), served from
// this site's own address instead of liquidalt.firebaseapp.com. Browsers that wall off other sites' storage lose the
// answer when the hand-back comes from another address, so the Google window closed and nothing happened. Firebase's
// own advice for that is this proxy; script.js then uses this site as authDomain, and each site's
// https://<site>/__/auth/handler is an authorized redirect URI of the Google sign-in client (Google Cloud console).
const FIREBASE_AUTH = 'https://liquidalt.firebaseapp.com';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const init = { method: request.method, headers: request.headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  const r = await fetch(FIREBASE_AUTH + url.pathname + url.search, init);
  return new Response(r.body, r);
}
