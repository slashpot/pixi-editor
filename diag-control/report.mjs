// diag branch only: shows the rolldown thread pool setting in the StackBlitz terminal, and
// waits when given a number of seconds (to let Safari reclaim what the build left behind)
const seconds = Number(process.argv[2] ?? 0);
console.log(`[diag] NAPI_RS_ASYNC_WORK_POOL_SIZE=${process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? '(unset: 4 threads)'}`);
if (seconds > 0) {
  console.log(`[diag] waiting ${seconds}s between the build and the dev server`);
  setTimeout(() => console.log('[diag] done waiting'), seconds * 1000);
}
