import { z } from "zod";
import { PreviewError } from "./state";

export async function jsonBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new PreviewError(
      400,
      "Send a valid JSON request.",
      "INVALID_REQUEST",
    );
  }
  return z.record(z.string(), z.unknown()).parse(body);
}
