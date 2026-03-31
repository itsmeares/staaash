import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const resolvedSearchParams = await searchParams;
  const redirectParams = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        redirectParams.append(key, entry);
      }

      continue;
    }

    if (value) {
      redirectParams.set(key, value);
    }
  }

  const suffix = redirectParams.toString();
  redirect(suffix ? `/settings?${suffix}` : "/settings");
}
