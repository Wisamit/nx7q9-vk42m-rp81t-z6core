/**
 * Reference-counted body scroll locking for stacked CRUD dialogs.
 *
 * The first dialog retains the existing inline overflow value; closing any
 * nested dialog must not make the underlying editable dialog scroll away.
 * The release callback is idempotent under React Strict Mode cleanup.
 */
type ScrollBody = { style: { overflow: string } };
const bodyLocks = new WeakMap<ScrollBody, { count: number; before: string }>();

export function acquireCrudModalScrollLock(body: ScrollBody): () => void {
  let state = bodyLocks.get(body);
  if (!state) {
    state = { count: 0, before: body.style.overflow };
    bodyLocks.set(body, state);
    body.style.overflow = "hidden";
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = bodyLocks.get(body);
    if (!current) return;
    current.count--;
    if (current.count === 0) {
      body.style.overflow = current.before;
      bodyLocks.delete(body);
    }
  };
}
