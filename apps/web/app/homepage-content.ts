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
  heroLabel?: string;
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
        label: "Setup your Staaash",
      },
      heroLabel: "First-run access",
      title: "Bring this Staaash instance online.",
      description:
        "Create the first owner account once. After that, access stays private and invite-only.",
    };
  }

  if (!role) {
    return {
      primaryAction: {
        href: "/sign-in",
        label: "Open sign-in",
      },
      title: "Private storage, right where you left it.",
      description:
        "This Staaash instance is already running. Sign in to continue.",
    };
  }

  return {
    primaryAction: {
      href: "/library",
      label: "Open library",
    },
    title: "Your library is ready.",
    description: "Continue directly into this Staaash instance.",
    supportNote:
      "The root route should redirect signed-in sessions before this fallback is shown.",
  };
}
