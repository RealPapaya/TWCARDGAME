/// <reference types="vite/client" />

declare module "*.css";

declare module "virtual:asset-manifest" {
  export const assetManifest: {
    images: string[];
    audioSfx: string[];
    audioBgm: string[];
    video: string[];
  };
}
