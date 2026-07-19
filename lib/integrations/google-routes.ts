import { routeEstimateSchema } from "@/lib/domain/schemas";

export function googleDurationToMinutes(value: string) {
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) throw new Error("経路時間の形式が不正です");
  return Math.ceil(Number(match[1]) / 60);
}

export async function estimateGoogleRoute(input: {
  origin: { latitude: number; longitude: number };
  destination: string;
  mode: "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";
}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY_NOT_CONFIGURED");
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
    },
    body: JSON.stringify({
      origin: { location: { latLng: input.origin } },
      destination: { address: input.destination },
      travelMode: input.mode,
      languageCode: "ja",
      units: "METRIC"
    })
  });
  if (!response.ok) throw new Error(`経路を取得できませんでした (${response.status})`);
  const payload = await response.json() as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
  const route = payload.routes?.[0];
  if (!route?.duration || route.distanceMeters === undefined) throw new Error("利用できる経路が見つかりませんでした");
  return routeEstimateSchema.parse({
    durationMinutes: googleDurationToMinutes(route.duration),
    distanceMeters: route.distanceMeters,
    source: "google_routes",
    mode: input.mode,
    destination: input.destination
  });
}
