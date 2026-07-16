import { readExactDupValue as readFirstCopy } from "./exact-dup-copy";
import { readExactDupValue as readSecondCopy } from "./exact-dup-copy-two";

export function readCombinedDuplicateValue(): number {
  return readFirstCopy() + readSecondCopy();
}
