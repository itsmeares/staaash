export type HomePageRole = "owner" | "member" | null;

export type HomePageAction = {
  href: string;
  label: string;
};

export type HomePageLink = {
  href: string;
  label: string;
};

export type HomePageContent = {
  primaryAction: HomePageAction;
  secondaryAction?: HomePageLink;
  title: string;
  description: string;
  supportNote?: string;
};

export function getHomePageContent({
  isBootstrapped,
  role,
}: {
  isBootstrapped: boolean;
  role: HomePageRole;
}): HomePageContent {
  if (!isBootstrapped) {
    return {
      primaryAction: {
        href: "/setup",
        label: "Set up Staaash",
      },
      title: "Set up this Staaash.",
      description:
        "Create the first owner account once. After that, access is private and invite-only.",
    };
  }

  if (!role) {
    return {
      primaryAction: {
        href: "/sign-in",
        label: "Sign in",
      },
      title: "Sign in to this Staaash.",
      description: "This Staaash is already set up. Sign in to continue.",
    };
  }

  return {
    primaryAction: {
      href: "/library",
      label: "Open library",
    },
    title: "Your library is ready.",
    description: "Open your library.",
  };
}
