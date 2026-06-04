const fizzbuzz = (n: number): string => {
  if (n % 15 === 0) return "FizzBuzz";
  if (n % 3 === 0) return "Fizz";
  if (n % 5 === 0) return "Buzz";
  return String(n);
};

for (let i = 1; i <= 100; i += 1) {
  console.log(fizzbuzz(i));
}
