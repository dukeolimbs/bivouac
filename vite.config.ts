import { defineConfig } from "vite";

// Builds src/module.ts into dist/module.js as a native ES module.
// Everything under public/ (module.json, lang/, templates/, styles/) is
// copied verbatim into dist/, so the built dist/ folder is a complete,
// loadable Foundry module. Link it into Foundry with `npm run link`.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: "src/module.ts",
      formats: ["es"],
      fileName: () => "module.js",
    },
    rollupOptions: {
      // Foundry globals (game, Hooks, CONFIG, ...) are provided at runtime,
      // never bundled. They are ambient, so nothing to externalize here, but
      // keep output predictable and unhashed for a stable module.json.
      output: {
        entryFileNames: "module.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
