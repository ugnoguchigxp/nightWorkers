export function fizzBuzz(n: number): string {
  if (n % 15 === 0) return "FizzBuzz";
  if (n % 3 === 0) return "Fizz";
  if (n % 5 === 0) return "Buzz";
  return String(n);
}

export function fizzBuzzList(limit: number): string[] {
  const result: string[] = [];
  for (let i = 1; i <= limit; i += 1) {
    result.push(fizzBuzz(i));
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = Number(process.argv[2] ?? "15");
  for (const value of fizzBuzzList(limit)) {
    console.log(value);
  }
}
