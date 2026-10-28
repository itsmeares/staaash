import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address for Settings; the query comes along.
export const Route = createFileRoute("/account")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/settings${location.searchStr}` });
  },
});
