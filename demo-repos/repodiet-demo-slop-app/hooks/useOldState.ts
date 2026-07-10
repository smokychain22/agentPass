import { useState } from "react";

// TODO: legacy state hook from abandoned feature branch
export function useOldState<T>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const reset = () => setValue(initial);
  return { value, setValue, reset };
}
