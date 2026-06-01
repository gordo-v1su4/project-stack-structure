import { create } from "zustand";
import type { Comment } from "./types";

let seq = 0;
const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

interface CommentState {
  comments: Comment[];
  addComment: (input: Omit<Comment, "id" | "createdAt" | "resolved">) => Comment;
  removeComment: (id: string) => void;
  toggleResolved: (id: string) => void;
  commentsForVersion: (versionId: string) => Comment[];
}

export const useCommentStore = create<CommentState>((set, get) => ({
  comments: [],
  addComment: (input) => {
    const comment: Comment = {
      ...input,
      id: uid(),
      createdAt: Date.now(),
      resolved: false,
    };
    set((s) => ({ comments: [...s.comments, comment] }));
    return comment;
  },
  removeComment: (id) =>
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
  toggleResolved: (id) =>
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id ? { ...c, resolved: !c.resolved } : c
      ),
    })),
  commentsForVersion: (versionId) =>
    get()
      .comments.filter((c) => c.versionId === versionId)
      .sort((a, b) => a.createdAt - b.createdAt),
}));
