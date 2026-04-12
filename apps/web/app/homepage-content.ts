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
  secondaryLinks: HomePageLink[];
  heroLabel: string;
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
        label: "Initialize this instance",
      },
      secondaryLinks: [
        {
          href: "/api/health/ready",
          label: "Readiness",
        },
      ],
      heroLabel: "Self-hosted cloud drive",
    };
  }

  if (!role) {
    return {
      primaryAction: {
        href: "/sign-in",
        label: "Open sign-in",
      },
      secondaryLinks: [
        {
          href: "/setup",
          label: "Setup is already complete",
        },
      ],
      heroLabel: "Private storage, on your terms",
    };
  }

  return {
    primaryAction: {
      href: "/library",
      label: "Open library",
    },
    secondaryLinks: [
      {
        href: "/settings",
        label: "Settings",
      },
      ...(role === "owner"
        ? [
            {
              href: "/admin",
              label: "Admin",
            },
          ]
        : []),
    ],
    heroLabel: "Your files, already within reach",
  };
}
