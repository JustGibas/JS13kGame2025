// Simple HTML + JS packer for small game jam builds.
// Focus: clarity + reliability. All GLSL minification logic REMOVED per request.
//
// Usage:
//   node minify.cjs            -> reads index.html, writes index.min.html
//   node minify.cjs in.html out.html
//
// What it does:
// 1. Reads the input HTML file as text.
// 2. Extracts every <script>...</script> block (any attributes kept verbatim).
// 3. Minifies ONLY the JavaScript bodies with Terser (no GLSL heuristics).
// 4. Rebuilds the HTML with the minified scripts.
// 5. Minifies the final HTML (and any inline CSS) with html-minifier-terser.
// 6. Writes the output file.

// Dependencies (install once):
//   npm i terser html-minifier-terser
const { readFile, writeFile } = require("fs/promises");
const { minify: terser } = require("terser");
const { minify: minifyHTML } = require("html-minifier-terser");

// Main async IIFE so we can use await at top level.
(async () => {
  // Resolve input / output paths with simple defaults.
  const inFile  = process.argv[2] || "index.html";
  const outFile = process.argv[3] || "index.min.html";

  // 1. Read source HTML.
  let rawHtml;
  try {
    rawHtml = await readFile(inFile, "utf8");
  } catch (e) {
    console.error(`Could not read input file "${inFile}":`, e.message);
    process.exit(1);
  }

  // 2. Extract <script> blocks.
  // We store an object per script so we can replace with placeholders then re‑insert.
  // Pattern: <script ...> (any content, including newlines, non-greedy) </script>
  // NOTE: This is a pragmatic regex approach sufficient for controlled jam HTML.
  const scripts = []; // { idx, attrs, body }
  const htmlWithSlots = rawHtml.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attrs, body) => {
      const idx = scripts.length;
      scripts.push({ idx, attrs: attrs.trim(), body });
      return `<!--SCRIPT_SLOT_${idx}-->`;
    }
  );

  // 3. Configure terser. Options picked for good compression without breaking typical small games.
  const terserOptions = {
    ecma: 2020,        // Modern syntax support.
    toplevel: true,    // Allow mangling/compressing top-level scope.
    mangle: {
      toplevel: true,
      safari10: true   // Helps avoid edge Safari bugs.
    },
    compress: {
      passes: 3,           // Multiple passes can squeeze a bit more.
      toplevel: true,
      inline: 3,           // Aggressive inlining (still generally safe).
      pure_getters: true,  // Assume property access has no side effects.
      booleans_as_integers: true,
      unsafe: true,        // Standard "unsafe" opts (acceptable in jam context).
      unsafe_math: true,
      unsafe_arrows: true,
      drop_debugger: true,
      hoist_funs: true,
      keep_fnames: true    // Keep function names to avoid accidental global collisions.
      // Optionally: drop_console: true
    },
    keep_fnames: true,
    format: { ascii_only: true } // Ensures escaped non-ASCII (safer for some hosting pipelines).
  };

  // 4. Minify each script's JS body (raw text). We do NOT attempt to parse types;
  // If a script has a non-JS type (e.g., type="x-shader/x-vertex"), we now STILL attempt JS minification.
  // If that causes errors (because it's not JS), we fall back to original body.
  const rebuiltScripts = [];
  for (const s of scripts) {
    let minified = s.body;
    try {
      const result = await terser(s.body, terserOptions);
      minified = result.code;
    } catch (e) {
      console.warn(
        `[warn] Skipped minifying script #${s.idx} (likely non-JS or syntax error). Reason: ${e.message}`
      );
    }
    // Reconstruct the <script> tag. Only add a space before attributes if they exist.
    rebuiltScripts[s.idx] = `<script${s.attrs ? " " + s.attrs : ""}>${minified}</script>`;
  }

  // 5. Reinsert the minified scripts by replacing placeholders.
  let rebuiltHtml = htmlWithSlots;
  for (const s of scripts) {
    rebuiltHtml = rebuiltHtml.replace(`<!--SCRIPT_SLOT_${s.idx}-->`, rebuiltScripts[s.idx]);
  }

  // 6. Minify the HTML (includes inline CSS; JS already minified).
  let finalHtml;
  try {
    finalHtml = await minifyHTML(rebuiltHtml, {
      collapseWhitespace: true,
      removeComments: true,
      removeAttributeQuotes: true,
      removeOptionalTags: true,
      useShortDoctype: true,
      minifyCSS: true,
      minifyJS: false // We already handled JS; avoid double-processing.
    });
  } catch (e) {
    console.error("HTML minification failed, writing non-minified rebuilt version. Reason:", e.message);
    finalHtml = rebuiltHtml;
  }

  // 7. Write output file.
  try {
    await writeFile(outFile, finalHtml, "utf8");
    console.log(`Packed -> ${outFile}`);
  } catch (e) {
    console.error(`Failed to write output file "${outFile}":`, e.message);
    process.exit(1);
  }
})().catch(e => {
  // Catch any unanticipated failure.
  console.error("Build failed with unexpected error:", e);
  process.exit(1);
});
