/** Native JSI may return void even when the public typings say Promise<void>. */
export async function stopNativeCompletion(context: { stopCompletion(): void | Promise<void> } | null): Promise<void> {
  try { await context?.stopCompletion(); } catch { /* Cancellation is best effort. */ }
}
