/** "ready": a new build waits. "switched": another tab moved to a new build. */
export type DemoUpdate = "ready" | "switched";

let registration: ServiceWorkerRegistration | undefined;
let notify: ((update: DemoUpdate) => void) | undefined;

const controllerChange = () =>
  new Promise((resolve) =>
    navigator.serviceWorker.addEventListener("controllerchange", resolve, {
      once: true,
    }),
  );
const installed = (worker: ServiceWorker) =>
  new Promise<boolean>((resolve) => {
    const check = () => {
      if (worker.state === "installing") return;
      worker.removeEventListener("statechange", check);
      resolve(worker.state === "installed");
    };
    worker.addEventListener("statechange", check);
    check();
  });

/**
 * Starts the sample API in a service worker and waits until it answers this
 * page's requests.
 */
export async function startDemo() {
  const workers = navigator.serviceWorker;
  if (!workers) return false;
  const base = import.meta.env.BASE_URL;
  // Some private windows have the API but refuse to register a worker.
  const registered = await workers
    .register(`${base}sw.js`, { scope: base })
    .then(() => true)
    .catch(() => false);
  if (!registered) return false;
  const current = await workers.ready;
  registration = current;
  await switchToNewest(current);
  // Another site on the same origin can control the page with its own worker.
  if (workers.controller?.scriptURL !== current.active?.scriptURL) {
    const claimed = controllerChange();
    current.active?.postMessage("claim");
    await claimed;
  }
  watchForUpdates(current);
  return true;
}

/**
 * A page that loads while a newer worker waits is that newer build, so it
 * switches before anything shows.
 */
async function switchToNewest(current: ServiceWorkerRegistration) {
  await current.update().catch(() => {});
  const next = current.installing ?? current.waiting;
  if (!next || !(await installed(next))) return;
  const switched = controllerChange();
  next.postMessage("update");
  // A tab on an older build can keep the old worker busy, or a newer release
  // can replace `next`. Show the page anyway; a late switch reloads or asks.
  await Promise.race([
    switched,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

function watchForUpdates(current: ServiceWorkerRegistration) {
  current.addEventListener("updatefound", () => {
    const worker = current.installing;
    if (worker) void installed(worker).then((ok) => ok && notify?.("ready"));
  });
  // From here a new worker means a new build, and this page's code is old.
  // Nobody sees a hidden tab reload, and the sign-in page has nothing to lose.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (document.hidden || !notify) window.location.reload();
    else notify("switched");
  });
}

/** Calls `listener` when the demo has a new build. Returns the unsubscribe. */
export function onDemoUpdate(listener: (update: DemoUpdate) => void) {
  notify = listener;
  if (registration?.waiting) listener("ready");
  return () => {
    if (notify === listener) notify = undefined;
  };
}
