import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EasyShop",
    short_name: "EasyShop",
    description: "Household meal planner, shopping list and weekly shop",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f3",
    theme_color: "#2e7d55",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
