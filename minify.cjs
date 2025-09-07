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

  // Aggressive terser config (1st pass).
  // Every line documents WHY it helps and possible RISK.
  const terserOptions = {
    ecma: 2020,                 // Target syntax level for output + transforms.
    toplevel: true,             // Allow dropping unused top-level bindings + tighter mangling.
    mangle: {
      toplevel: true,           // Shorten top-level names.
      safari10: true,           // Keep Safari 10 quirks safety (still small cost).
      properties: {
        // Only mangle properties that look "private" (_foo). Lower risk for game code.
        regex: /^_/,
        // reserve: ['_keepMe']  // Example: keep specific props if needed later.
      }
    },
    compress: {
      // General iteration / exploration depth.
      passes: 5,                 // Multiple full compress passes (more = slower; diminishing returns).
      toplevel: true,            // Drop unused top-level vars/functions.
      inline: 3,                 // Aggressively inline functions (3 = max heuristic).
      pure_getters: true,        // Assume property getters have no side effects (RISK if getters mutate).
      booleans_as_integers: true,// Turn true/false into !0/!1 etc.
      unsafe: true,              // Enable several "unsafe" transforms assuming standard semantics.
      unsafe_arrows: true,       // Convert funcs to arrows when shorter (can change 'this').
      unsafe_math: true,         // Reassociate math (can affect FP precision).
      unsafe_Function: true,     // Optimize new Function() patterns (rare; small gain).
      unsafe_methods: true,      // Assumes prototype methods not replaced.
      unsafe_symbols: true,      // Assumes Symbol.* not monkey-patched.
      hoist_funs: true,          // Hoist function declarations (may affect TDZ edge cases).
      hoist_props: true,         // Hoist object literal props into vars when profitable.
      hoist_vars: true,          // Hoist vars (may change shadowing corner cases).
      reduce_funcs: true,        // Inline single-use function literals.
      reduce_vars: true,         // Substitute variables with values when safe.
      collapse_vars: true,       // Collapse sequences of assignments.
      conditionals: true,        // Optimize ?: and if.
      dead_code: true,           // Remove unreachable branches.
      evaluate: true,            // Precompute constant expressions.
      sequences: true,           // Join statements with commas where smaller.
      join_vars: true,           // Combine consecutive var declarations.
      loops: true,               // Optimize loops (e.g., while->for).
      switches: true,            // Deduplicate/optimize switch cases.
      comparisons: true,         // Optimize comparisons (e.g., === vs == if safe).
      drop_debugger: true,       // Remove debugger statements.
      arrows: true,              // Use arrow funcs where smaller.
      // EXTRA AGGRESSIVE ADDITIONS:
      keep_fargs: false,         // Drop unused function args (RISK: arity-based logic breaks).
      keep_fnames: false,        // Allow renaming/dropping function names (breaks .name or stack traces).
      side_effects: true,        // Prune calls/expressions marked pure or provably unused.
      //merge_vars: true,          // Merge and reuse variable declarations.
      negate_iife: true,         // !function(){}() -> (function(){}()) shorter where legal.
      unsafe_comps: true,        // Reorder comparisons (RISK with NaN/order edge cases).
      unsafe_proto: true,        // Optimize obj.__proto__ patterns (RISK if messing with prototypes).
      unsafe_regexp: true,       // Simplify some RegExps (RISK rare).
      unsafe_undefined: true,    // Replace undefined with void 0, assume not reassigned.
      //unsafe_passes: true,       // Re-run certain unsafe transforms for more gains.
      // pure_funcs: ['console.log','console.info','console.warn'], // Uncomment to drop these calls.
      // drop_console: true,     // Remove all console.* (RISK: lose debug info).
    },
    format: {
      ascii_only: true,          // Escape non-ASCII (safer for some packers).
      comments: false,           // Strip all comments.
      // ecma: 2020,             // Could set here; already covered by top-level ecma.
    }
  };

  // OPTIONAL "second pass" with ultra-aggressive settings.
  // Toggle here (no CLI flags).
  const SECOND_PASS = true;

  // This pass tries to push size further:
  // - Higher 'passes'
  // - property mangling broadened
  // - module:true (treats code as ESM; CAN BREAK top-level this / global usage)
  // - Additional pure_funcs / unsafe tweaks
  const terserUltraOptions = {
    ...terserOptions,
    ecma: 2022,                 // Slightly newer syntax allowances (may shorten).
    module: false,              // Set to true ONLY if script behaves like an ES module (no global this).
    mangle: {
      ...terserOptions.mangle,
      properties: {
        // Broader pattern: mangle most "wordy" props except a reserved whitelist.
        // RISK: Breaks external API / JSON data access / DOM API property strings.
        regex: /^[a-zA-Z_]\w{2,}$/, // skip 1-2 char names (already short), go after longer ones.
        //reserve: ['prototype','length','name'], // Keep some critical/meta props.
      }
    },
    compress: {
      ...terserOptions.compress,
      passes: 7,                 // Slightly more than first pass (beyond ~8 rarely helps).
      // Force dropping console again if uncommented.
      // drop_console: true,
      pure_funcs: ['console.log','console.info','console.warn','console.error'],
      // Adding another unsafe layer (already mostly on).
    }
  };

  // Minify scripts.
  const rebuilt = [];
  for (const s of scripts) {
    let code = s.body;
    try {
      // First pass
      code = (await terser(code, terserOptions)).code;
      // Second pass (only if toggle true)
      if (SECOND_PASS) {
        try {
          code = (await terser(code, terserUltraOptions)).code;
        } catch (e2) {
          console.warn("[2nd pass skipped]", s.i, e2.message);
        }
      }
    } catch (e) {
      console.warn("[skip]", s.i, e.message);
    }
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