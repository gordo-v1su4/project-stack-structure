export function workActivityTagForUser(userId: string) {
  const normalized = userId.trim();
  if (!normalized) throw new Error("A user ID is required for work activity.");
  return `user:${normalized}`;
}

export function workActivityReadScopeForUser(userId: string) {
  return { read: { tags: [workActivityTagForUser(userId)] } };
}
