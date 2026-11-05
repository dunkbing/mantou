// A stand-in for an app: takes the single-instance lock, prints what it hears, exits on "quit".
import { singleInstance, onOpen } from "../../runtime/instance";
const mine = await singleInstance((args) => console.log("launch " + args.join(",")));
if (!mine) {
  console.log("second");
  process.exit(0);
}
onOpen((w) => console.log("open " + (w.url ?? w.file)));
console.log("first");
process.stdin.on("data", () => process.exit(0));
