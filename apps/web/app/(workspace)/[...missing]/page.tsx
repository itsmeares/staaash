import { notFound } from "next/navigation";

// Unknown addresses land here so they show the workspace not-found page.
export default function MissingPath() {
  notFound();
}
