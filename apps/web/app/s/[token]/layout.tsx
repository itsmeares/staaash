import { TimeRoot } from "@/server/time-zone";

export default function ShareLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <TimeRoot user={null}>{children}</TimeRoot>;
}
