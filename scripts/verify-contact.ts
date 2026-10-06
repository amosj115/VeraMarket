import { sanitizePublicText } from "../src/lib/contact-guard";
const cases: [string, boolean][] = [
  ["Call me on 082 123 4567", true], ["0821234567 whatsapp", true], ["+27 82 123 4567", true], ["+27821234567", true],
  ["zero eight two one two three four five six seven", true], ["082-one-two-three-4567", true],
  ["email me bob@gmail.com", true], ["bob at gmail dot com", true], ["wa.me/27821234567", true], ["ig @cool_seller", true],
  ["iPhone 13 Pro 256GB model A2633", false], ["Price R 1 500 000 negotiable", false], ["Serial 12345", false], ["2019 Golf 1.4 TSI 85000km", false], ["Asking R12500", false],
];
let fail = 0;
for (const [input, expected] of cases) {
  const r = sanitizePublicText(input);
  const ok = r.changed === expected;
  if (!ok) fail++;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(input), "=>", r.text);
}
process.exit(fail ? 1 : 0);
