const origin = process.env.TRIP_TEST_ORIGIN || "http://127.0.0.1:8788";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Origin", options.requestOrigin || origin);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${origin}${path}`, { ...options, headers });
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") || "").split(";", 1)[0];
}

async function login(traveller, code) {
  const response = await request("/api/trip/login", {
    method: "POST",
    body: JSON.stringify({ traveller, code, rememberDevice: true }),
  });
  assert(response.status === 200, `${traveller} login returned ${response.status}`);
  return cookieFrom(response);
}

async function replaceCodes(cookie, currentCode) {
  const response = await request("/api/trip/recovery-codes", {
    method: "POST",
    cookie,
    body: JSON.stringify({ currentCode }),
  });
  assert(response.status === 200, `Recovery-code replacement returned ${response.status}`);
  const body = await response.json();
  assert(body.replaced === true && Array.isArray(body.recoveryCodes) && body.recoveryCodes.length === 8, "Recovery-code replacement returned an incomplete set");
  assert(new Set(body.recoveryCodes).size === body.recoveryCodes.length, "Recovery-code replacement returned duplicates");
  return body.recoveryCodes;
}

async function resetCode(traveller, recoveryCode, newCode) {
  return request("/api/trip/recovery-reset", {
    method: "POST",
    body: JSON.stringify({ traveller, recoveryCode, newCode, rememberDevice: true }),
  });
}

const unauthenticatedReplacement = await request("/api/trip/recovery-codes", {
  method: "POST",
  body: JSON.stringify({ currentCode: "111111" }),
});
assert(unauthenticatedReplacement.status === 401, "Recovery codes could be replaced without a session");

let danSessionA = await login("Dan", "111111");
const danSessionB = await login("Dan", "111111");
let kenSessionA = await login("Ken", "222222");
const kenSessionB = await login("Ken", "222222");

const crossOriginReplacement = await request("/api/trip/recovery-codes", {
  method: "POST",
  cookie: danSessionA,
  requestOrigin: "https://example.invalid",
  body: JSON.stringify({ currentCode: "111111" }),
});
assert(crossOriginReplacement.status === 403, "Cross-origin recovery-code replacement was accepted");

const wrongReplacementCode = await request("/api/trip/recovery-codes", {
  method: "POST",
  cookie: danSessionA,
  body: JSON.stringify({ currentCode: "999999" }),
});
assert(wrongReplacementCode.status === 401, "Recovery codes were replaced with the wrong current code");

const danRecoveryCodes = await replaceCodes(danSessionA, "111111");
const crossTraveller = await resetCode("Ken", danRecoveryCodes[1], "222222");
assert(crossTraveller.status === 401, "Dan’s recovery code was accepted for Ken");

const danReset = await resetCode("Dan", danRecoveryCodes[0], "818181");
assert(danReset.status === 200, `Dan recovery reset returned ${danReset.status}`);
danSessionA = cookieFrom(danReset);
assert((await request("/api/trip/session", { cookie: danSessionB })).status === 401, "Dan’s earlier session survived recovery reset");
assert((await request("/api/trip/session", { cookie: kenSessionA })).status === 200, "Dan’s recovery reset invalidated Ken’s session");
assert((await request("/api/trip/login", {
  method: "POST",
  body: JSON.stringify({ traveller: "Dan", code: "111111" }),
})).status === 401, "Dan’s previous code survived recovery reset");
assert((await resetCode("Dan", danRecoveryCodes[0], "919191")).status === 401, "A consumed Dan recovery code was accepted twice");

const restoreDan = await request("/api/trip/access-code", {
  method: "POST",
  cookie: danSessionA,
  body: JSON.stringify({ currentCode: "818181", newCode: "111111" }),
});
assert(restoreDan.status === 200, "Dan’s local test code was not restored");
assert((await request("/api/trip/session", { cookie: danSessionA })).status === 200, "Ordinary Dan code change invalidated the current session");
await replaceCodes(danSessionA, "111111");
assert((await resetCode("Dan", danRecoveryCodes[1], "111111")).status === 401, "Dan’s replaced recovery-code set remained valid");

const kenRecoveryCodes = await replaceCodes(kenSessionA, "222222");
const kenReset = await resetCode("Ken", kenRecoveryCodes[0], "828282");
assert(kenReset.status === 200, `Ken recovery reset returned ${kenReset.status}`);
kenSessionA = cookieFrom(kenReset);
assert((await request("/api/trip/session", { cookie: kenSessionB })).status === 401, "Ken’s earlier session survived recovery reset");
assert((await request("/api/trip/session", { cookie: danSessionA })).status === 200, "Ken’s recovery reset invalidated Dan’s session");
assert((await resetCode("Ken", kenRecoveryCodes[0], "929292")).status === 401, "A consumed Ken recovery code was accepted twice");

const restoreKen = await request("/api/trip/access-code", {
  method: "POST",
  cookie: kenSessionA,
  body: JSON.stringify({ currentCode: "828282", newCode: "222222" }),
});
assert(restoreKen.status === 200, "Ken’s local test code was not restored");
assert((await request("/api/trip/session", { cookie: kenSessionA })).status === 200, "Ordinary Ken code change invalidated the current session");
await replaceCodes(kenSessionA, "222222");
assert((await resetCode("Ken", kenRecoveryCodes[1], "222222")).status === 401, "Ken’s replaced recovery-code set remained valid");

console.log(JSON.stringify({
  ok: true,
  unauthenticatedRecoveryReplacement: unauthenticatedReplacement.status,
  crossOriginRecoveryReplacement: crossOriginReplacement.status,
  travelerIsolation: true,
  danResetInvalidatedEarlierSessions: true,
  kenResetInvalidatedEarlierSessions: true,
  consumedCodesRejected: true,
  replacedSetsInvalidated: true,
  ordinaryCodeChangesPreservedSessions: true,
}));
