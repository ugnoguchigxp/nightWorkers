import { p } from "./catalog";

p("review.llm-reviewer", {});
// @ts-expect-error A variable-free context rejects undeclared values.
p("review.llm-reviewer", { undeclared: true });
