import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PropOps Staff",
    short_name: "PropOps",
    description: "Ghi chỉ số và công việc hiện trường.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#181b20"
  };
}
