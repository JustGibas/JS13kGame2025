// Ultra‑minimal HTML+JS packer for jam builds.
// Usage: node minify.cjs [in.html] [out.html]
// Defaults: in=index.html  out=index.min.html
// Steps: read HTML -> extract <script> bodies -> aggressive Terser -> reinsert -> minify HTML -> write.

const { readFile, writeFile } = require("fs/promises");
const { minify: terser } = require("terser");
const { minify: minifyHTML } = require("html-minifier-terser");

(async () => {
  const inFile  = process.argv[2] || "index.html";
  const outFile = process.argv[3] || "index.min.html";

  // Read input.
  let src;
  try { src = await readFile(inFile, "utf8"); }
  catch (e) { console.error("Read fail:", e.message); process.exit(1); }

  // Extract scripts -> placeholders.
  const scripts = [];
  const withSlots = src.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
    const i = scripts.length;
    scripts.push({ i, attrs: attrs.trim(), body });
    return `<!--S${i}-->`;
  });

  // Aggressive terser (kept focused; property mangling only for _private style names).
  const terserOptions = {
    ecma: 2020,
    toplevel: true,
    mangle: { toplevel: true, safari10: true, properties: { regex: /^_/ } },
    compress: {
      passes: 5,
      toplevel: true,
      inline: 3,
      pure_getters: true,
      booleans_as_integers: true,
      unsafe: true,
      unsafe_arrows: true,
      unsafe_math: true,
      unsafe_Function: true,
      unsafe_methods: true,
      unsafe_symbols: true,
      hoist_funs: true,
      hoist_props: true,
      hoist_vars: true,
      reduce_funcs: true,
      reduce_vars: true,
      collapse_vars: true,
      conditionals: true,
      dead_code: true,
      evaluate: true,
      sequences: true,
      join_vars: true,
      loops: true,
      switches: true,
      comparisons: true,
      drop_debugger: true,
      arrows: true
    },
    format: { ascii_only: true, comments: false }
  };

  // Minify scripts.
  const rebuilt = [];
  for (const s of scripts) {
    let code = s.body;
    try { code = (await terser(s.body, terserOptions)).code; }
    catch (e) { console.warn("[skip]", s.i, e.message); }
    rebuilt[s.i] = `<script${s.attrs ? " " + s.attrs : ""}>${code}</script>`;
  }

  // Reinsert.
  let html = withSlots;
  for (const s of scripts) html = html.replace(`<!--S${s.i}-->`, rebuilt[s.i]);

  // Minify HTML (leave JS untouched now).
  try {
    html = await minifyHTML(html, {
      collapseWhitespace: true,
      removeComments: true,
      removeAttributeQuotes: true,
      removeOptionalTags: true,
      useShortDoctype: true,
      minifyCSS: true,
      minifyJS: false
    });
  } catch (e) {
    console.warn("HTML minify failed, using non-minified HTML:", e.message);
  }

  // Write output.
  try { await writeFile(outFile, html, "utf8"); console.log("Packed ->", outFile); }
  catch (e) { console.error("Write fail:", e.message); process.exit(1); }
})().catch(e => { console.error("Unexpected:", e); process.exit(1); });