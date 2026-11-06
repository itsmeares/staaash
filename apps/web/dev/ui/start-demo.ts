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
  const registration = await workers.ready;
  // Another site on the same origin can control the page with its own worker.
  if (workers.controller?.scriptURL !== registration.active?.scriptURL) {
    const claimed = new Promise((resolve) =>
      workers.addEventListener("controllerchange", resolve, { once: true }),
    );
    registration.active?.postMessage("claim");
    await claimed;
  }
  return true;
}
