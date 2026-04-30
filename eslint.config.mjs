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
    },
  },
];
