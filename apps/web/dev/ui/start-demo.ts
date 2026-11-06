/**
 * Starts the sample API in a service worker and waits until it answers this
 * page's requests.
 */
export async function startDemo() {
  const workers = navigator.serviceWorker;
  if (!workers) return false;
  const base = import.meta.env.BASE_URL;
  await workers.register(`${base}sw.js`, { scope: base });
  const registration = await workers.ready;
  if (!workers.controller) {
    const claimed = new Promise((resolve) =>
      workers.addEventListener("controllerchange", resolve, { once: true }),
    );
    registration.active?.postMessage("claim");
    await claimed;
  }
  return true;
}
