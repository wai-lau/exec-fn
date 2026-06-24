import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Loaded via <script src> in templates
        marked: "readonly",
        Sortable: "readonly",
        openCardDialog: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "no-redeclare": "error",
      "no-empty": ["error", { "allowEmptyCatch": true }],
      // Per-function size cap (counts real code, not blanks/comments). Keeps any
      // single function readable; the pre-commit hook runs this on staged web/*.js
      // (a ratchet — only files a commit touches).
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // web/*.js are same-global-scope files loaded in order (not modules), so each
    // file references globals defined in its siblings. Linted in isolation that
    // reads as undefined/unused — disable those two here; the size cap still runs.
    files: ["web/**/*.js"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
];
