// Worker pool for the simulator: runs a task module's default export over a
// list of jobs on every core but two (a game is single-threaded, ~110MB).
// POOL_WORKERS=n caps the workers.
// usage (from a script):
//   import { runPool } from "./pool.mjs";
//   const results = await runPool(new URL("./mytask.mjs", import.meta.url), jobs, { out, workers });
// A task module exports `default async (args) => result`; results come back in
// job order. With `out`, every result is appended as one JSON line as it lands
// (a crashed run keeps what finished). Jobs already in `out` are skipped on a
// re-run (resume), matched on JSON.stringify(args).
import fs from "node:fs";
import os from "node:os";
import { Worker } from "node:worker_threads";

export const WORKERS = Number(process.env.POOL_WORKERS) || Math.max(1, os.cpus().length - 2);

export function runPool(taskUrl, jobs, { out = null, workers = WORKERS, quiet = false } = {}) {
  const done = new Map();
  if (out && fs.existsSync(out)) for (const l of fs.readFileSync(out, "utf8").split("\n")) if (l) { const r = JSON.parse(l); done.set(JSON.stringify(r.args), r.res); }
  const results = new Array(jobs.length);
  const todo = [];
  jobs.forEach((args, i) => { const k = JSON.stringify(args); if (done.has(k)) results[i] = done.get(k); else todo.push(i); });
  if (!quiet && done.size) console.error(`pool: ${jobs.length - todo.length} of ${jobs.length} jobs resumed from ${out}`);
  if (!todo.length) return Promise.resolve(results);
  const n = Math.min(workers, todo.length), t0 = Date.now();
  let next = 0, finished = 0;
  const pool = [];
  return new Promise((resolve, reject) => {
    const spawn = () => {
      // the entry is its own file: a task module imports pool.mjs, and a worker
      // whose entry awaited that same module would deadlock on the cycle (exit 13)
      const w = new Worker(new URL("./pool-worker.mjs", import.meta.url), { workerData: { task: taskUrl.href || String(taskUrl) } });
      pool.push(w);
      const feed = () => { if (next < todo.length) w.postMessage({ i: todo[next++], args: jobs[todo[next - 1]] }); else { w.finished = true; w.terminate(); } };
      w.on("message", ({ i, res, err }) => {
        if (err) { reject(new Error(err)); return; }
        results[i] = res; finished++;
        if (out) fs.appendFileSync(out, JSON.stringify({ args: jobs[i], res }) + "\n");
        if (!quiet) console.error(`pool: ${finished}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        // the worker that answered LAST is still alive: terminate every one, or
        // the process never exits (and sat at 100% on one core, 2026-10-07)
        if (finished === todo.length) { for (const x of pool) { x.finished = true; x.terminate(); } resolve(results); } else feed();
      });
      w.on("error", reject);
      w.on("exit", code => { if (code !== 0 && !w.finished) reject(new Error("worker exited " + code)); }); // terminate() exits 1
      feed();
    };
    for (let k = 0; k < n; k++) spawn();
  });
}

