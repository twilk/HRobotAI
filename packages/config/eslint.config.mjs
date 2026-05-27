import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "generated/**", "coverage/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);
