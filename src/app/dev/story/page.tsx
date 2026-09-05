import { notFound } from "next/navigation";

import { StoryDevelopmentFixture } from "./ui";

export default function StoryDevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <StoryDevelopmentFixture />;
}
