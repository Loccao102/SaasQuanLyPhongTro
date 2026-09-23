import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Habi Staff",
    short_name: "Habi Staff",
    description: "Chốt chỉ số điện nước offline-first.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#181b20"
  };
}
