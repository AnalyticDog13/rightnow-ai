import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/.next/", "**/dist/", "**/coverage/", "**/generated/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
