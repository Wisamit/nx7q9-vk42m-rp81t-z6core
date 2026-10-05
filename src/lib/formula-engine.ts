import { Prisma } from "../../generated/prisma/client";

type Token =
  | { type: "number"; value: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (/[0-9.]/.test(ch)) {
      const start = i;
      let dots = 0;
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        if (expression[i] === ".") dots++;
        i++;
      }
      const value = expression.slice(start, i);
      if (dots > 1 || value === ".") throw new Error("INVALID_FORMULA_NUMBER");
      tokens.push({ type: "number", value });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < expression.length && /[A-Za-z0-9_]/.test(expression[i])) i++;
      tokens.push({ type: "identifier", value: expression.slice(start, i).toUpperCase() });
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "operator", value: ch });
      i++;
      continue;
    }
    if (ch === "(") { tokens.push({ type: "lparen" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen" }); i++; continue; }

    throw new Error("INVALID_FORMULA_CHARACTER");
  }

  if (tokens.length === 0) throw new Error("EMPTY_FORMULA");
  return tokens;
}

export function formulaVariables(expression: string) {
  return [...new Set(tokenize(expression)
    .filter((token): token is Extract<Token, { type: "identifier" }> => token.type === "identifier")
    .map((token) => token.value))];
}

export function evaluateFormula(expression: string, inputValues: Record<string, Prisma.Decimal>) {
  const tokens = tokenize(expression);
  let index = 0;

  function primary(): Prisma.Decimal {
    const token = tokens[index];
    if (!token) throw new Error("UNEXPECTED_FORMULA_END");

    if (token.type === "number") {
      index++;
      return new Prisma.Decimal(token.value);
    }
    if (token.type === "identifier") {
      index++;
      const value = inputValues[token.value];
      if (!value) throw new Error("MISSING_FORMULA_INPUT:" + token.value);
      return new Prisma.Decimal(value);
    }
    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      index++;
      const value = primary();
      return token.value === "-" ? value.negated() : value;
    }
    if (token.type === "lparen") {
      index++;
      const value = expressionNode();
      if (tokens[index]?.type !== "rparen") throw new Error("MISSING_FORMULA_RPAREN");
      index++;
      return value;
    }

    throw new Error("INVALID_FORMULA_TOKEN");
  }

  function term(): Prisma.Decimal {
    let value = primary();
    while (true) {
      const token = tokens[index];
      if (token?.type !== "operator" || (token.value !== "*" && token.value !== "/")) break;
      index++;
      const rhs = primary();
      if (token.value === "/" && rhs.eq(0)) throw new Error("FORMULA_DIVISION_BY_ZERO");
      value = token.value === "*" ? value.mul(rhs) : value.div(rhs);
    }
    return value;
  }

  function expressionNode(): Prisma.Decimal {
    let value = term();
    while (true) {
      const token = tokens[index];
      if (token?.type !== "operator" || (token.value !== "+" && token.value !== "-")) break;
      index++;
      const rhs = term();
      value = token.value === "+" ? value.add(rhs) : value.sub(rhs);
    }
    return value;
  }

  const result = expressionNode();
  if (index !== tokens.length) throw new Error("TRAILING_FORMULA_TOKEN");
  if (!result.isFinite()) throw new Error("FORMULA_NON_FINITE_RESULT");
  return result;
}
