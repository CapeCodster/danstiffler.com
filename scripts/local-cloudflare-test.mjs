import fs from "node:fs/promises";

const origin = process.env.TRIP_TEST_ORIGIN || "http://127.0.0.1:8788";
const vars = Object.fromEntries((await fs.readFile(new URL("../.dev.vars", import.meta.url), "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));

async function request(path, options = {}) {
  return fetch(`${origin}${path}`, {
    ...options,
    headers: { Origin: origin, ...(options.headers || {}) },
  });
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

const unauthenticated = await request("/api/trip/itinerary");
if (unauthenticated.status !== 401) throw new Error(`Expected unauthenticated itinerary 401, got ${unauthenticated.status}`);

const bootstrap = await request("/api/trip/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Trip-Bootstrap": vars.TRIP_BOOTSTRAP_SECRET,
  },
  body: JSON.stringify({
    users: [
      { displayName: "Dan", code: "111111" },
      { displayName: "Ken", code: "222222" },
    ],
  }),
});
if (bootstrap.status !== 201 && bootstrap.status !== 409) {
  throw new Error(`Bootstrap failed with ${bootstrap.status}`);
}
let recoveryCode = null;
let recoveryCount = null;
if (bootstrap.status === 201) {
  const body = await bootstrap.json();
  recoveryCode = body.recoveryCodes.Dan[0];
  recoveryCount = {
    Dan: body.recoveryCodes.Dan.length,
    Ken: body.recoveryCodes.Ken.length,
  };
}

const wrongLogin = await request("/api/trip/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ traveller: "Dan", code: "999999" }),
});
if (wrongLogin.status !== 401) throw new Error(`Expected wrong login 401, got ${wrongLogin.status}`);

const login = await request("/api/trip/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ traveller: "Dan", code: "111111" }),
});
if (login.status !== 200) throw new Error(`Expected login 200, got ${login.status}`);
const cookie = cookieFrom(login);
if (!cookie.startsWith("__Host-my_travels_session=")) throw new Error("Secure session cookie missing");

const session = await request("/api/trip/session", { headers: { Cookie: cookie } });
if (session.status !== 200) throw new Error(`Expected session 200, got ${session.status}`);

const itineraryBeforeSeed = await request("/api/trip/itinerary", { headers: { Cookie: cookie } });
if (![200, 503].includes(itineraryBeforeSeed.status)) throw new Error(`Unexpected itinerary status ${itineraryBeforeSeed.status}`);

const logout = await request("/api/trip/logout", { method: "POST", headers: { Cookie: cookie } });
if (logout.status !== 200) throw new Error(`Expected logout 200, got ${logout.status}`);

let recoveryRetired = null;
if (recoveryCode) {
  const recoveryReset = await request("/api/trip/recovery-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ traveller: "Dan", recoveryCode, newCode: "333333" }),
  });
  if (recoveryReset.status !== 200) throw new Error(`Expected recovery reset 200, got ${recoveryReset.status}`);
  const recoveryCookie = cookieFrom(recoveryReset);
  const restored = await request("/api/trip/access-code", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: recoveryCookie },
    body: JSON.stringify({ currentCode: "333333", newCode: "111111" }),
  });
  if (restored.status !== 200) throw new Error(`Expected restored access code 200, got ${restored.status}`);
  const reused = await request("/api/trip/recovery-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ traveller: "Dan", recoveryCode, newCode: "333333" }),
  });
  recoveryRetired = reused.status === 401;
  if (!recoveryRetired) throw new Error("Used recovery code was accepted twice");
}

console.log(JSON.stringify({
  unauthenticatedItinerary: unauthenticated.status,
  wrongLogin: wrongLogin.status,
  authenticatedSession: session.status,
  logout: logout.status,
  recoveryCount,
  recoveryRetired,
}));
