// dunkbing/mantou#2: errors in .tsx files report their own line, though Babel
// compiled the JSX above them into more lines than it took.
import { expect, test } from "bun:test";
import { Text, View } from "mantou-ui";

const A = () => (
  <View style={{ flexGrow: 1 }}>
    <Text>a</Text>
    <Text>b</Text>
  </View>
);

/** The line in this file that a stack trace names first. */
function lineOf(e: Error): number {
  const m = /lines\.test\.tsx:(\d+)/.exec(e.stack ?? "");
  return m ? Number(m[1]) : -1;
}

test("a thrown error names the line it was thrown on", () => {
  void A;
  const e = new Error("here"); // line 21
  expect(lineOf(e)).toBe(21);
});

test("an error after more JSX names its line too", () => {
  const B = () => (
    <View>
      <Text>{"x"}</Text>
    </View>
  );
  void B;
  const e = new Error("here"); // line 32
  expect(lineOf(e)).toBe(32);
});
