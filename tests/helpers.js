// Shared test helpers. Tests never touch the network.

/** A fetch that always fails, as if offline. */
export const offlineFetch = async () => {
  throw new Error('offline (test)');
};

/** A fetch that answers from a list of [urlSubstring, jsonBody] pairs and records the URLs it saw. */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    const href = String(url);
    calls.push(href);
    const match = routes.find(([part]) => href.includes(part));
    if (!match) throw new Error(`unexpected fetch ${href}`);
    const [, body, status = 200] = match;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

export const FC_ROAD = { lat: 18.5236, lon: 73.841, label: 'FC Road, Pune' };
