import { createPublicShareContentRouteResponse } from "@/app/s/content-route-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return createPublicShareContentRouteResponse({ request, token });
}
