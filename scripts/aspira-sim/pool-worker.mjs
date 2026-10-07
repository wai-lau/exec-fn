// pool.mjs's worker entry: loads the task module and answers jobs.
import { parentPort, workerData } from "node:worker_threads";
const mod = await import(workerData.task);
parentPort.on("message", async ({ i, args }) => {
  try { parentPort.postMessage({ i, res: await mod.default(args) }); }
  catch (e) { parentPort.postMessage({ i, err: (e && e.stack) || String(e) }); }
});
