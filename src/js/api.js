// fetch wrapper: 10 s timeout (EDGE-CASES §3.5), uniform ApiError with the
// server's error envelope so callers can switch on `code`.
//
// Auth (local variant): the session rides in an httpOnly cookie the browser
// attaches automatically (same-origin). Every call carries the X-Bento-Request
// header the server requires on mutations (defense-in-depth CSRF). A global
// hook lets auth.js bounce the whole app to the login / change-password screen
// on 401 / 403-password-change, regardless of which caller made the request.

export class ApiError extends Error {
  constructor(status, code, message, payload) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

let authErrorHandler = null;
export function setAuthErrorHandler(fn) {
  authErrorHandler = fn;
}

export async function api(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        'X-Bento-Request': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', "Couldn't reach the Bento host", null);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error?.code || 'ERROR';
    // Global auth reactions — fire before throwing so the app can switch
    // screens even if the direct caller only shows a local error.
    if (authErrorHandler) {
      if (res.status === 401) authErrorHandler('unauthenticated');
      else if (res.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') authErrorHandler('password_change');
    }
    throw new ApiError(res.status, code, data.error?.message || res.statusText, data);
  }
  return data;
}
