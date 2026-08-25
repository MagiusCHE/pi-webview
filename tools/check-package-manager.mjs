// Blocks installs with npm/yarn/other managers: this project uses pnpm.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  console.error("");
  console.error("  ✋ Questo progetto usa pnpm come package manager.");
  console.error("     Installa le dipendenze con:  pnpm install");
  console.error(`     (rilevato: ${agent || "nessun package manager"})`);
  console.error("");
  process.exit(1);
}
