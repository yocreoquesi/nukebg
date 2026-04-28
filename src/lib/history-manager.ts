/**
 * Bounded undo/redo stack, generic over the state shape it holds. The
 * caller decides what a "state" is — for the basic editor it's a
 * Uint8ClampedArray RGBA snapshot; for advanced editors it could be a
 * stroke record or a typed delta.
 *
 * Extracted from `ar-editor.ts` in #47/Phase-2. The component used to
 * carry two raw arrays (`undoStack` / `redoStack`) plus a hand-rolled
 * `pushUndo / undo / redo` triplet. Pulling it out lets the advanced
 * editor (Phase 3b) reuse the same primitive instead of growing yet
 * another copy.
 *
 * Cap policy: FIFO eviction at `maxEntries`. The default of 12 matches
 * the basic editor's existing budget — enough room for typical
 * touch-up sessions without letting full-RGBA snapshots blow the heap
 * on multi-megapixel images.
 */
export class HistoryManager<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private readonly maxEntries: number = 12) {}

  /** Push a new state. Drops the oldest entry once we exceed the cap.
   *  Pushing always wipes the redo stack — once the user starts a fresh
   *  branch of edits, the previously redoable entries are unreachable. */
  push(state: T): void {
    this.undoStack.push(state);
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /** Pop the most recent undo entry and return it. The caller passes
   *  the current state, which gets moved onto the redo stack so a
   *  subsequent `redo()` can return to it. Returns null if the undo
   *  stack is empty. */
  undo(currentState: T): T | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(currentState);
    return prev;
  }

  /** Pop the most recent redo entry and return it. Mirrors `undo()`:
   *  current state moves to the undo stack. Returns null if the redo
   *  stack is empty. */
  redo(currentState: T): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(currentState);
    return next;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Wipe both stacks. Call when the underlying state is replaced
   *  wholesale (new image loaded, editor reset, etc.). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
