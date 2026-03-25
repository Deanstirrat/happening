import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import fs from "fs";
import path from "path";

let neighborhoodFeatures: any[] = [];
let loaded = false;

function loadNeighborhoods(): any[] {
  if (loaded) return neighborhoodFeatures;
  loaded = true;

  const filePath = path.join(process.cwd(), "public", "sf-neighborhoods.geojson");
  if (!fs.existsSync(filePath)) {
    console.warn("[neighborhoods] sf-neighborhoods.geojson not found — skipping neighborhood detection");
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const geojson = JSON.parse(raw);
    neighborhoodFeatures = geojson.features ?? [];
    console.log(`[neighborhoods] Loaded ${neighborhoodFeatures.length} neighborhood polygons`);
  } catch {
    neighborhoodFeatures = [];
  }

  return neighborhoodFeatures;
}

export function detectNeighborhood(lat: number, lon: number): string | null {
  const features = loadNeighborhoods();
  if (!features.length) return null;

  // turf uses [longitude, latitude] order
  const pt = point([lon, lat]);

  for (const feature of features) {
    try {
      if (booleanPointInPolygon(pt, feature)) {
        return (
          feature.properties?.nhood ??
          feature.properties?.name ??
          feature.properties?.neighborhoodname ??
          null
        );
      }
    } catch {
      // malformed polygon, skip
    }
  }

  return null; // outside SF — Oakland, Berkeley etc.
}
