import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "iPresenterPlux Live",
    short_name: "iPresenterPlux",
    description: "Live church video, captions, scripture and multilingual interpretation.",
    start_url: "/live",
    display: "standalone",
    background_color: "#04070c",
    theme_color: "#04070c",
    orientation: "portrait-primary",
    categories: ["entertainment", "lifestyle", "productivity"]
  };
}
