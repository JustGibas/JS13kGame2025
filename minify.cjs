// npm i terser html-minifier-terser
const { readFile, writeFile } = require("fs/promises");
const { minify: terser } = require("terser");
const { minify: minifyHTML } = require("html-minifier-terser");

// --- Simple GLSL minifier: keep #lines, drop comments, collapse spaces, keep newlines ---
function glslMinify(src) {
  // remove block comments first
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) { out.push(line); continue; } // keep preprocessor lines as-is (trimmed)
    // strip line comments outside of preprocessor
    const noLineComment = line.replace(/\/\/.*$/, "");
    const collapsed = noLineComment.replace(/\s+/g, " ").trim();
    if (collapsed) out.push(collapsed);
  }
  return out.join("\n");
}

// Minify GLSL inside JS template literals only if no ${} placeholders exist.
function minifyGlslInJs(js) {
  return js.replace(/`([\s\S]*?)`/g, (m, body) => {
    if ((/#version\b/.test(body) || /precision\s+(?:highp|mediump|lowp)\s+float/.test(body)) && !/\$\{/.test(body)) {
      return "`" + glslMinify(body) + "`";
    }
    return m;
  });
}

(async () => {
  const inFile  = process.argv[2] || "index.html";
  const outFile = process.argv[3] || "index.min.html";
  const rawHtml = await readFile(inFile, "utf8");

  // Extract all <script ...> blocks into slots
  const scriptMeta = []; // { idx, attrs, content }
  let htmlWithSlots = rawHtml.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attrs, body) => {
      const idx = scriptMeta.length;
      scriptMeta.push({ idx, attrs, body });
      return `<!--SCRIPT_SLOT_${idx}-->`;
    }
  );

  const terserOpts = {
    ecma: 2020,
    toplevel: true,
    mangle: {
      toplevel: true,
      safari10: true,
      // Reserve globals that exist due to window[MathName.toUpperCase()]
      // reserved: [
      //   "E","PI","LN2","LN10","LOG2E","LOG10E","SQRT1_2","SQRT2",
      //   "SIN","COS","TAN","ASIN","ACOS","ATAN","ATAN2",
      //   "ABS","MAX","MIN","POW","EXP","EXPM1","LOG","LOG1P","HYPOT",
      //   "FLOOR","CEIL","ROUND","TRUNC","RANDOM","SIGN","IMUL","CLZ32","FROUND"
      // ]
    },
    keep_fnames: true,
    compress: {
      passes: 3,
      toplevel: true,
      unsafe: true,
      unsafe_math: true,
      unsafe_arrows: true,
      pure_getters: true,
      drop_debugger: true,
      inline: 3,
      booleans_as_integers: true,
      hoist_funs: true,
      // keep function names to reduce risk of calling wrong globals
      keep_fnames: true
      // global_defs: { __DEV__: false },
      // drop_console: !!process.env.PACK_DROP_CONSOLE,
    },
    format: { ascii_only: true }
  };

  // Process each script
  const rebuiltBlocks = [];
  for (const s of scriptMeta) {
    const typeAttr = (s.attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [,""])[1].toLowerCase();

    // Dedicated shader tags
    if (typeAttr.startsWith("x-shader/") || typeAttr.includes("glsl")) {
      const minGlsl = glslMinify(s.body);
      rebuiltBlocks[s.idx] = `<script ${s.attrs}>${minGlsl}</script>`;
      continue;
    }

    // Normal JS (or type omitted): simple GLSL in templates, then heavy JS minify
    const jsWithMinGlsl = minifyGlslInJs(s.body);
    let code;
    try {
      ({ code } = await terser(jsWithMinGlsl, terserOpts));
    } catch (e) {
      console.warn(`Terser failed on script #${s.idx}, preserving unminified JS. Error: ${e.message}`);
      code = jsWithMinGlsl;
    }
    rebuiltBlocks[s.idx] = `<script${s.attrs ? " " + s.attrs : ""}>${code}</script>`;
  }

  // Put scripts back
  let rebuiltHtml = htmlWithSlots;
  for (const s of scriptMeta) {
    rebuiltHtml = rebuiltHtml.replace(`<!--SCRIPT_SLOT_${s.idx}-->`, rebuiltBlocks[s.idx]);
  }

  // Minify HTML+CSS only
  const finalHtml = await minifyHTML(rebuiltHtml, {
    collapseWhitespace: true,
    removeComments: true,
    removeAttributeQuotes: true,
    removeOptionalTags: true,
    useShortDoctype: true,
    minifyCSS: true,
    minifyJS: false
  });

  await writeFile(outFile, finalHtml, "utf8");
  console.log(`Packed -> ${outFile}`);
})().catch(e => {
  console.error("Build failed:", e);
  process.exit(1);
});
