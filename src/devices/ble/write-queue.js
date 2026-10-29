/**
 * Serialized writes with retries: Web Bluetooth rejects a write while
 * another GATT operation is in progress, and devices drop the odd one.
 * write(data) is the raw write (e.g. characteristic.writeValueWithResponse).
 */
export function createWriteQueue(write, { retries = 2, retryDelayMs = 100, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let tail = Promise.resolve();
  return (data) => {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await write(data);
        } catch (err) {
          if (attempt >= retries) throw err;
          await sleep(retryDelayMs);
        }
      }
    };
    const result = tail.then(run, run);
    tail = result.catch(() => {}); // a failed write does not block the next ones
    return result;
  };
}
