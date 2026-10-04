import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "iPresenterPlux Live",
    short_name: "iPresenterPlux",
    description: "Live church video, captions, scripture and multilingual interpretation.",
    start_url: "/live",
    display: "standalone",
    background_color: "#07090d",
    theme_color: "#07090d",
    orientation: "portrait-primary",
    categories: ["entertainment", "lifestyle", "productivity"]
  };
}
