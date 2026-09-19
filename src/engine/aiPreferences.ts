const LLM_OPT_IN_KEY = "kuronuri_llm_opt_in";

export function isLlmOptInEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(LLM_OPT_IN_KEY) === "true";
}

export function setLlmOptInEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LLM_OPT_IN_KEY, enabled ? "true" : "false");
}
