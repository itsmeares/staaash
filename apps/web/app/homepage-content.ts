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
      title: "Bring this Staaash instance online.",
      description:
        "Create the first owner account once. After that, this Staaash stays private and invite-only.",
    };
  }

  if (!role) {
    return {
      primaryAction: {
        href: "/sign-in",
        label: "Sign in",
      },
      title: "Private storage, right where you left it.",
      description: "Sign in to open your files, folders, and shared items.",
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
