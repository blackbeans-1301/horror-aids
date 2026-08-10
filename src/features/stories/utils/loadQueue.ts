// Caps how many audio-duration probes run at once. Without this, a table
// with hundreds of segments fires that many concurrent requests to the
// asset route on mount, saturating slow links (e.g. a Cloudflare Tunnel).
const MAX_CONCURRENT = 4;

let active = 0;
const queue: Array<() => void> = [];

export function withSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = (): void => {
      active += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          queue.shift()?.();
        });
    };

    if (active < MAX_CONCURRENT) {
      run();
    } else {
      queue.push(run);
    }
  });
}
