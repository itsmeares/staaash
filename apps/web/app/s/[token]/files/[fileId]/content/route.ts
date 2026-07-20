import { createPublicShareContentRouteResponse } from "@/app/s/content-route-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;
  return createPublicShareContentRouteResponse({
    request,
    token,
    fileId,
  });
}
